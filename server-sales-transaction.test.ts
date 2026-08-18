import { describe, it, expect, vi } from 'vitest';
import { normalizeCartStockItems, validateSalePayload } from './server-auth';

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
    const readSnapshots = new Map<string, number>(); // path -> version read
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

    // Verify Optimistic Concurrency Control: None of the read documents have changed version
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
        continue; // Retry transaction from beginning with fresh reads
      }
      throw new Error('Transaction aborted: Contention / Conflict');
    }

    // Atomic commit
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

describe('AUDIT-005: Transactional Sales & Concurrency Semantics', () => {
  it('TX-005-01: Atomic Sale Success (stock deducted, sale created, customer debt updated)', async () => {
    const db = new MockFirestoreDatabase();
    db.setDoc('products', 'p1', { id: 'p1', name: 'قميص', stock: 5, sellingPrice: 20 });
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
      const norm = normalizeCartStockItems(sale.items);
      const stockItems = norm.items || [];

      // Read phase
      const p1 = await txn.get('products', 'p1');
      expect(p1?.data.stock).toBe(5);
      const c1 = await txn.get('customers', 'c1');

      // Write phase
      txn.set('sales', sale.id, sale);
      txn.update('products', 'p1', { ...p1?.data, stock: p1!.data.stock - stockItems[0].totalQuantity });
      txn.update('customers', 'c1', {
        ...c1?.data,
        totalPurchases: c1!.data.totalPurchases + sale.totalAmount,
        totalDebt: c1!.data.totalDebt + sale.totalAmount,
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

    const sale = {
      id: 's2',
      type: 'بيع',
      items: [{ id: 'p1', quantity: 2 }],
      totalAmount: 40,
      customerId: 'c1',
    };

    let errorThrown: any = null;
    try {
      await executeMockTransaction(db, async (txn) => {
        const p1 = await txn.get('products', 'p1');
        if (p1!.data.stock < 2) {
          const err: any = new Error('INSUFFICIENT_STOCK');
          err.code = 'INSUFFICIENT_STOCK';
          throw err;
        }
        txn.set('sales', sale.id, sale);
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

  it('TX-005-03: Concurrent Last Item: exactly one sale succeeds, second sale fails without overselling', async () => {
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
        // Artificial yield to simulate concurrency overlap
        await new Promise((r) => setTimeout(r, 5));
        txn.set('sales', saleId, { id: saleId, total: 20 });
        txn.update('products', 'p1', { ...p1.data, stock: p1.data.stock - 1 });
      });
    };

    // Execute two concurrent sales requests
    const results = await Promise.allSettled([runSale('sale-req-A'), runSale('sale-req-B')]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason?.code).toBe('INSUFFICIENT_STOCK');
    expect(db.getDoc('products', 'p1')?.data.stock).toBe(0); // Final stock is exactly 0, never negative!
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
      { id: 'p1', quantity: 4 }, // Total requested = 7
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

    // Update sale from qty 3 to qty 5 (delta = +2 required from inventory)
    await executeMockTransaction(db, async (txn) => {
      const oldSale = (await txn.get('sales', 's1'))!.data;
      const p1 = (await txn.get('products', 'p1'))!.data;

      const oldQty = oldSale.items[0].quantity; // 3
      const newQty = 5;
      const delta = newQty - oldQty; // +2

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

    // Delete sale -> Restores 2 items
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
    db.setDoc('products', 'p1', { id: 'p1', stock: 0 }); // out of stock

    try {
      await executeMockTransaction(db, async (txn) => {
        const p1 = await txn.get('products', 'p1');
        const c1 = await txn.get('customers', 'c1');

        if (p1!.data.stock < 1) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        txn.update('customers', 'c1', { totalDebt: c1!.data.totalDebt + 50 });
      });
    } catch {}

    expect(db.getDoc('customers', 'c1')?.data.totalDebt).toBe(100); // Unchanged!
  });
});
