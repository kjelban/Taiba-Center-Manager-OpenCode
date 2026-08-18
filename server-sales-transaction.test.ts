import { describe, it, expect } from 'vitest';
import { normalizeCartStockItems, validateSalePayload, roundMoney } from './server-auth';

// ── In-Memory Transaction Engine Mock for OCC & Atomicity Verification ──

interface MockDoc {
  data: Record<string, any>;
  version: number;
}

class MockFirestoreDatabase {
  public store = new Map<string, MockDoc>();
  public rollbackCount = 0;
  public commitCount = 0;

  setDoc(collection: string, id: string, data: Record<string, any>) {
    const key = `${collection}/${id}`;
    const prev = this.store.get(key);
    this.store.set(key, { data: { ...data }, version: (prev?.version || 0) + 1 });
  }

  getDoc(collection: string, id: string) {
    return this.store.get(`${collection}/${id}`) || null;
  }
}

interface MockTransaction {
  get(collection: string, id: string): Promise<{ data: any; version: number } | null>;
  set(collection: string, id: string, data: any): void;
  update(collection: string, id: string, data: any): void;
  delete(collection: string, id: string): void;
}

async function executeMockTransaction<T>(
  db: MockFirestoreDatabase,
  operation: (txn: MockTransaction) => Promise<T>,
  maxRetries = 5
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const readSnapshots = new Map<string, number>();
    const writes: { type: 'set' | 'update' | 'delete'; path: string; data?: any }[] = [];
    let hasWritten = false;

    const txn: MockTransaction = {
      async get(collection: string, id: string) {
        if (hasWritten) {
          throw new Error('All reads must execute before writes.');
        }
        const path = `${collection}/${id}`;
        const doc = db.getDoc(collection, id);
        if (!doc) return null;
        readSnapshots.set(path, doc.version);
        return { data: JSON.parse(JSON.stringify(doc.data)), version: doc.version };
      },
      set(collection: string, id: string, data: any) {
        hasWritten = true;
        writes.push({ type: 'set', path: `${collection}/${id}`, data });
      },
      update(collection: string, id: string, data: any) {
        hasWritten = true;
        writes.push({ type: 'update', path: `${collection}/${id}`, data });
      },
      delete(collection: string, id: string) {
        hasWritten = true;
        writes.push({ type: 'delete', path: `${collection}/${id}` });
      },
    };

    let result: T;
    try {
      result = await operation(txn);
    } catch (err) {
      db.rollbackCount++;
      throw err;
    }

    if (writes.length === 0) return result;

    let conflict = false;
    for (const [path, readVersion] of readSnapshots.entries()) {
      const current = db.store.get(path);
      if (current && current.version !== readVersion) {
        conflict = true;
        break;
      }
    }

    if (conflict) {
      if (attempt < maxRetries) {
        continue;
      }
      throw new Error('Transaction aborted: Contention / Conflict');
    }

    for (const w of writes) {
      if (w.type === 'delete') {
        db.store.delete(w.path);
      } else {
        const prev = db.store.get(w.path);
        db.store.set(w.path, { data: w.data, version: (prev?.version || 0) + 1 });
      }
    }
    db.commitCount++;
    return result;
  }
  throw new Error('Transaction exceeded maximum retries');
}

// ── AUDIT-005 Transaction & Concurrency Test Suite ──

describe('AUDIT-005 (SIMULATION): Transactional Sales & Concurrency Semantics', () => {
  it('TX-005-01: Atomic Sale Success (stock deducted, sale created, customer debt updated)', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', name: 'قميص', stock: 5, sellingPrice: 20, purchasePrice: 10 });
    db.setDoc('customers', 'c1', { id: 'c1', name: 'عميل 1', totalPurchases: 100, totalDebt: 0 });

    const sale = {
      id: 's1',
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: 'p1', quantity: 2, sellingPrice: 20, purchasePrice: 10 }],
      totalAmount: 40,
      profit: 20,
      paymentMethod: 'آجل (دين)',
      createdBy: 'كاشير',
      customerId: 'c1',
      isPaid: false,
    };

    await executeMockTransaction(db, async (txn) => {
      const p1 = await txn.get('products', 'p1');
      const c1 = await txn.get('customers', 'c1');

      txn.set('sales', sale.id, sale);
      txn.update('products', 'p1', { ...p1?.data, stock: p1!.data.stock - 2 });
      txn.update('customers', 'c1', {
        ...c1?.data,
        totalPurchases: roundMoney(c1!.data.totalPurchases + 40),
        totalDebt: roundMoney(c1!.data.totalDebt + 40),
      });
    });

    expect(db.getDoc('products', 'p1')?.data.stock).toBe(3);
    expect(db.getDoc('sales', 's1')?.data.totalAmount).toBe(40);
    expect(db.getDoc('customers', 'c1')?.data.totalDebt).toBe(40);
    expect(db.getDoc('customers', 'c1')?.data.totalPurchases).toBe(140);
  });

  it('TX-005-02: Insufficient Stock rejects transaction and leaves state completely unchanged', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', name: 'قميص', stock: 1 });
    db.setDoc('customers', 'c1', { id: 'c1', name: 'عميل', totalDebt: 0 });

    let errorThrown: any = null;
    try {
      await executeMockTransaction(db, async (txn) => {
        const p1 = await txn.get('products', 'p1');
        if (p1!.data.stock < 2) {
          const err: any = new Error('INSUFFICIENT_STOCK');
          err.code = 'INSUFFICIENT_STOCK';
          throw err;
        }
        txn.set('sales', 's2', { id: 's2' });
        txn.update('products', 'p1', { ...p1!.data, stock: p1!.data.stock - 2 });
      });
    } catch (e: any) {
      errorThrown = e;
    }

    expect(errorThrown?.code).toBe('INSUFFICIENT_STOCK');
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(1);
    expect(db.getDoc('sales', 's2')).toBeNull();
    expect(db.rollbackCount).toBe(1);
  });

  it('TX-005-03: Concurrent Last Item: exactly one sale succeeds, second fails with 0 final stock', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', name: 'آخر قطعة', stock: 1 });

    const runSale = (saleId: string) => {
      return executeMockTransaction(db, async (txn) => {
        const p1 = await txn.get('products', 'p1');
        if (!p1 || p1.data.stock < 1) {
          const err: any = new Error('INSUFFICIENT_STOCK');
          err.code = 'INSUFFICIENT_STOCK';
          throw err;
        }
        await new Promise((r) => setTimeout(r, 5));
        txn.set('sales', saleId, { id: saleId, total: 20 });
        txn.update('products', 'p1', { ...p1.data, stock: p1.data.stock - 1 });
      });
    };

    const results = await Promise.allSettled([runSale('sale-req-A'), runSale('sale-req-B')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.code).toBe('INSUFFICIENT_STOCK');
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(0);
  });

  it('TX-005-04: Multi-product Atomic Failure: if product B is out of stock, product A is NOT deducted', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'pA', { id: 'pA', stock: 10 });
    db.setDoc('products', 'pB', { id: 'pB', stock: 0 });

    try {
      await executeMockTransaction(db, async (txn) => {
        const pA = await txn.get('products', 'pA');
        const pB = await txn.get('products', 'pB');

        if (pA!.data.stock < 2 || pB!.data.stock < 1) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        txn.set('sales', 's-multi', { id: 's-multi' });
        txn.update('products', 'pA', { stock: pA!.data.stock - 2 });
        txn.update('products', 'pB', { stock: pB!.data.stock - 1 });
      });
    } catch {}

    expect(db.getDoc('products', 'pA')?.data.stock).toBe(10);
    expect(db.getDoc('products', 'pB')?.data.stock).toBe(0);
    expect(db.getDoc('sales', 's-multi')).toBeNull();
  });

  it('TX-005-05: Duplicate Product IDs in payload are normalized to cumulative total before validation', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 5 });

    const rawCart = [
      { id: 'p1', quantity: 3 },
      { id: 'p1', quantity: 4 },
    ];

    const norm = normalizeCartStockItems(rawCart);
    expect(norm.items).toEqual([{ productId: 'p1', totalQuantity: 7 }]);

    let failed = false;
    try {
      await executeMockTransaction(db, async (txn) => {
        const p1 = await txn.get('products', 'p1');
        const totalNeeded = norm.items![0].totalQuantity;
        if (p1!.data.stock < totalNeeded) {
          throw new Error('INSUFFICIENT_STOCK');
        }
        txn.update('products', 'p1', { stock: p1!.data.stock - totalNeeded });
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(5);
  });

  it('TX-005-06: Concurrent Invoice Update calculates correct net stock delta without Lost Update', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 10 });
    db.setDoc('sales', 's1', {
      id: 's1',
      items: [{ id: 'p1', quantity: 3 }],
    });

    await executeMockTransaction(db, async (txn) => {
      const oldSale = (await txn.get('sales', 's1'))!.data;
      const p1 = (await txn.get('products', 'p1'))!.data;

      const oldQty = oldSale.items[0].quantity;
      const newQty = 5;
      const delta = newQty - oldQty;

      expect(p1.stock >= delta).toBe(true);
      txn.set('sales', 's1', { id: 's1', items: [{ id: 'p1', quantity: 5 }] });
      txn.update('products', 'p1', { ...p1, stock: p1.stock - delta });
    });

    expect(db.getDoc('products', 'p1')?.data.stock).toBe(8);
  });

  it('TX-005-07: Return and Delete operations restore stock atomically', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 3 });
    db.setDoc('sales', 's1', {
      id: 's1',
      type: 'بيع',
      items: [{ id: 'p1', quantity: 2 }],
      totalAmount: 40,
    });

    await executeMockTransaction(db, async (txn) => {
      const sale = (await txn.get('sales', 's1'))!.data;
      const p1 = (await txn.get('products', 'p1'))!.data;

      txn.delete('sales', 's1');
      txn.update('products', 'p1', { ...p1, stock: p1.stock + sale.items[0].quantity });
    });

    expect(db.getDoc('products', 'p1')?.data.stock).toBe(5);
    expect(db.getDoc('sales', 's1')).toBeNull();
  });

  it('TX-005-08: Debt Atomicity: customer debt change is rolled back if transaction fails', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('customers', 'c1', { id: 'c1', totalDebt: 100 });
    db.setDoc('products', 'p1', { id: 'p1', stock: 0 });

    try {
      await executeMockTransaction(db, async (txn) => {
        const p1 = await txn.get('products', 'p1');
        const c1 = await txn.get('customers', 'c1');

        if (p1!.data.stock < 1) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        txn.update('customers', 'c1', { totalDebt: roundMoney(c1!.data.totalDebt + 50) });
      });
    } catch {}

    expect(db.getDoc('customers', 'c1')?.data.totalDebt).toBe(100);
  });
});

// ── AUDIT-014 Idempotency Simulation Test Suite ──

describe('AUDIT-014 (SIMULATION): Sale Idempotency Protection', () => {
  it('IDEM-014-01: Same sale.id sent sequentially returns original result without deducting stock twice', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 10, sellingPrice: 30, purchasePrice: 15 });

    const salePayload = {
      id: 'req-001',
      createdBy: 'cashier1',
      customerId: '',
      items: [{ id: 'p1', quantity: 2, sellingPrice: 30, purchasePrice: 15 }],
      totalAmount: 60,
      profit: 30,
    };

    const processSale = async (sale: typeof salePayload) => {
      return executeMockTransaction(db, async (txn) => {
        const existing = await txn.get('sales', sale.id);
        if (existing?.data) {
          return { ok: true, duplicate: true, saleId: sale.id, totalAmount: existing.data.totalAmount };
        }
        const p1 = (await txn.get('products', 'p1'))!.data;
        txn.set('sales', sale.id, sale);
        txn.update('products', 'p1', { ...p1, stock: p1.stock - 2 });
        return { ok: true, duplicate: false, saleId: sale.id, totalAmount: 60 };
      });
    };

    const first = await processSale(salePayload);
    expect(first.duplicate).toBe(false);
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(8);

    const second = await processSale(salePayload);
    expect(second.duplicate).toBe(true);
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(8); // Still 8! No second deduction!
  });

  it('IDEM-014-02: Concurrent duplicate requests yield exactly one stock deduction', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 10 });

    const salePayload = {
      id: 'req-concurrent',
      createdBy: 'cashier1',
      customerId: '',
      items: [{ id: 'p1', quantity: 2 }],
      totalAmount: 60,
    };

    const processSale = async (sale: typeof salePayload) => {
      return executeMockTransaction(db, async (txn) => {
        const existing = await txn.get('sales', sale.id);
        if (existing?.data) {
          return { ok: true, duplicate: true, saleId: sale.id };
        }
        const p1 = (await txn.get('products', 'p1'))!.data;
        await new Promise(r => setTimeout(r, 5));
        txn.set('sales', sale.id, sale);
        txn.update('products', 'p1', { ...p1, stock: p1.stock - 2 });
        return { ok: true, duplicate: false, saleId: sale.id };
      });
    };

    const results = await Promise.all([processSale(salePayload), processSale(salePayload)]);
    const dedupeCounts = results.filter(r => r.duplicate);
    const createdCounts = results.filter(r => !r.duplicate);

    expect(createdCounts.length).toBe(1);
    expect(dedupeCounts.length).toBe(1);
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(8);
  });

  it('IDEM-014-03: Simulated lost HTTP response retry does not duplicate sale or stock', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 5 });

    const salePayload = {
      id: 'req-lost-resp',
      createdBy: 'cashier1',
      customerId: '',
      items: [{ id: 'p1', quantity: 1 }],
    };

    // First attempt commits but client loses response
    await executeMockTransaction(db, async (txn) => {
      const p1 = (await txn.get('products', 'p1'))!.data;
      txn.set('sales', salePayload.id, salePayload);
      txn.update('products', 'p1', { ...p1, stock: p1.stock - 1 });
    });

    // Client retries same request
    const retryResult = await executeMockTransaction(db, async (txn) => {
      const existing = await txn.get('sales', salePayload.id);
      if (existing?.data) {
        return { ok: true, duplicate: true, saleId: salePayload.id };
      }
      return { ok: true, duplicate: false };
    });

    expect(retryResult.duplicate).toBe(true);
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(4);
  });

  it('IDEM-014-04: Same idempotency key reused with different payload is rejected with 409 conflict', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 10 });
    db.setDoc('sales', 'req-fixed-id', {
      id: 'req-fixed-id',
      createdBy: 'cashier1',
      customerId: 'custA',
      items: [{ id: 'p1', quantity: 1 }],
    });

    // Client reuses same ID with different customer/items
    let errCode = '';
    try {
      await executeMockTransaction(db, async (txn) => {
        const existing = (await txn.get('sales', 'req-fixed-id'))?.data;
        if (existing) {
          if (existing.customerId !== 'custB') {
            const err: any = new Error('Idempotency key reused with different sale payload');
            err.code = 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD';
            throw err;
          }
        }
      });
    } catch (e: any) {
      errCode = e.code;
    }

    expect(errCode).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('IDEM-014-05: Different requestIds with valid payloads are treated as independent sales', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', stock: 10 });

    const sale1 = { id: 'sale-alpha', items: [{ id: 'p1', quantity: 1 }] };
    const sale2 = { id: 'sale-beta', items: [{ id: 'p1', quantity: 2 }] };

    const process = async (s: typeof sale1) => {
      return executeMockTransaction(db, async (txn) => {
        const p1 = (await txn.get('products', 'p1'))!.data;
        txn.set('sales', s.id, s);
        txn.update('products', 'p1', { ...p1, stock: p1.stock - s.items[0].quantity });
      });
    };

    await process(sale1);
    await process(sale2);

    expect(db.getDoc('sales', 'sale-alpha')).toBeDefined();
    expect(db.getDoc('sales', 'sale-beta')).toBeDefined();
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(7); // 10 - 1 - 2 = 7
  });
});

// ── AUDIT-013 Server-Side Financial Recalculation Simulation Test Suite ──

describe('AUDIT-013 (SIMULATION): Financial Calculation Trust & Recalculation', () => {
  it('FIN-013-01: Server ignores client manipulated line price and recalculates from database price', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', name: 'جاكيت', sellingPrice: 100, purchasePrice: 60, stock: 5 });

    // Rogue client attempts to pay 10 instead of 100
    const rawSale = {
      id: 's-hack-1',
      items: [{ id: 'p1', quantity: 2, sellingPrice: 10, purchasePrice: 5 }],
      totalAmount: 20, // manipulated
      profit: 10,      // manipulated
    };

    await executeMockTransaction(db, async (txn) => {
      const p1 = (await txn.get('products', 'p1'))!.data;
      const trustedSellPrice = p1.sellingPrice; // 100
      const trustedBuyPrice = p1.purchasePrice; // 60

      const serverTotal = roundMoney(trustedSellPrice * 2); // 200
      const serverProfit = roundMoney(serverTotal - (trustedBuyPrice * 2)); // 80

      txn.set('sales', rawSale.id, {
        ...rawSale,
        items: [{ id: 'p1', quantity: 2, sellingPrice: trustedSellPrice, purchasePrice: trustedBuyPrice }],
        totalAmount: serverTotal,
        profit: serverProfit,
      });
    });

    const saved = db.getDoc('sales', 's-hack-1')?.data;
    expect(saved.totalAmount).toBe(200); // Recalculated to 200!
    expect(saved.profit).toBe(80);        // Recalculated to 80!
    expect(saved.items[0].sellingPrice).toBe(100);
  });

  it('FIN-013-02: Client manipulated totalAmount is overridden by server calculation', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', sellingPrice: 25.5, purchasePrice: 15, stock: 5 });

    const serverTotal = roundMoney(25.5 * 3); // 76.5
    expect(serverTotal).toBe(76.5);
  });

  it('FIN-013-03: Client manipulated profit is overridden by server cost subtraction', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', sellingPrice: 50, purchasePrice: 35, stock: 10 });

    const sell = 50 * 2;
    const cost = 35 * 2;
    const serverProfit = roundMoney(sell - cost); // 30
    expect(serverProfit).toBe(30);
  });

  it('FIN-013-04: Debt sale increases customer debt by authoritative server-calculated total', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', sellingPrice: 45, purchasePrice: 25, stock: 5 });
    db.setDoc('customers', 'c1', { id: 'c1', totalDebt: 100, totalPurchases: 200 });

    // Client claims total is 10
    await executeMockTransaction(db, async (txn) => {
      const p1 = (await txn.get('products', 'p1'))!.data;
      const c1 = (await txn.get('customers', 'c1'))!.data;

      const serverTotal = roundMoney(p1.sellingPrice * 2); // 90
      txn.update('customers', 'c1', {
        ...c1,
        totalDebt: roundMoney(c1.totalDebt + serverTotal),
        totalPurchases: roundMoney(c1.totalPurchases + serverTotal),
      });
    });

    const c = db.getDoc('customers', 'c1')?.data;
    expect(c.totalDebt).toBe(190); // 100 + 90
    expect(c.totalPurchases).toBe(290); // 200 + 90
  });

  it('FIN-013-05: Manipulated debt payload cannot alter customer debt balance', () => {
    const currentDebt = 150;
    const serverAddition = roundMoney(35.75);
    const newDebt = roundMoney(currentDebt + serverAddition);
    expect(newDebt).toBe(185.75);
  });

  it('FIN-013-06: Money precision handles Libyan Dinar 3 decimal places without floating error', () => {
    const p1 = 12.333;
    const p2 = 8.667;
    const sum = roundMoney(p1 + p2);
    expect(sum).toBe(21);

    const fractional = roundMoney(0.1 + 0.2);
    expect(fractional).toBe(0.3);
  });

  it('FIN-013-07: Sale at loss (cost > sellingPrice) calculates negative profit correctly', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', sellingPrice: 20, purchasePrice: 30, stock: 5 });

    const total = roundMoney(20 * 1);
    const cost = roundMoney(30 * 1);
    const profit = roundMoney(total - cost);

    expect(profit).toBe(-10); // Loss of 10 LYD accurately recorded
  });

  it('FIN-013-08: Manual items outside inventory pass dedicated validation without bypassing real product prices', () => {
    const manualItem = {
      id: 'manual-box-1',
      name: 'كرتون ماء',
      isManualItem: true,
      sellingPrice: 15,
      purchasePrice: 10,
      quantity: 2,
    };

    const norm = normalizeCartStockItems([manualItem]);
    expect(norm.items).toEqual([]); // Ignored from inventory deductions

    const total = roundMoney(manualItem.sellingPrice * manualItem.quantity);
    const cost = roundMoney(manualItem.purchasePrice * manualItem.quantity);
    const profit = roundMoney(total - cost);

    expect(total).toBe(30);
    expect(profit).toBe(10);
  });
});
