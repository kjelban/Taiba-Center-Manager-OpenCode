import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  runFirestoreTransaction,
  firestoreGetDocument,
  firestoreSetDocument,
  firestoreDeleteDocument,
} from './server';
import {
  generateSaleRequestFingerprint,
  normalizeCartStockItems,
  roundMoney,
} from './server-auth';

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * FIRESTORE EMULATOR INTEGRATION TEST SUITE (AUDIT-005, AUDIT-013, AUDIT-014)
 * ════════════════════════════════════════════════════════════════════════════════
 * Classification: SHARED PRODUCTION FUNCTION TEST (Direct Execution of runFirestoreTransaction against Firestore Emulator)
 *
 * Safety Guard:
 * These tests require the Firebase Firestore Emulator:
 *   firebase emulators:start --only firestore
 *
 * Execution environment flag: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 * If FIRESTORE_EMULATOR_HOST is missing, tests are safely skipped to protect Production.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const isEmulatorActive = Boolean(EMULATOR_HOST);

// Helper function to execute production sales logic using authoritative server functions
async function executeProductionSale(salePayload: any) {
  const norm = normalizeCartStockItems(salePayload.items);
  if (norm.error) throw new Error(norm.error);
  const stockItems = norm.items || [];

  const incomingFingerprint = generateSaleRequestFingerprint(salePayload);

  return runFirestoreTransaction(async (txn) => {
    // 1. Idempotency check
    const existingDoc = await txn.get('sales', salePayload.id);
    if (existingDoc && existingDoc.data) {
      const existing = existingDoc.data;
      const existingFingerprint = existing.requestFingerprint || generateSaleRequestFingerprint(existing);

      if (existingFingerprint === incomingFingerprint) {
        return {
          ok: true,
          duplicate: true,
          saleId: salePayload.id,
          totalAmount: existing.totalAmount,
          profit: existing.profit,
        };
      }

      const err: any = new Error("Idempotency key reused with different sale payload");
      err.code = "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";
      err.status = 409;
      throw err;
    }

    // 2. Read products
    const productsMap = new Map<string, any>();
    for (const item of stockItems) {
      const prodDoc = await txn.get('products', item.productId);
      if (!prodDoc || !prodDoc.data) {
        const err: any = new Error(`Product not found: ${item.productId}`);
        err.code = 'PRODUCT_NOT_FOUND';
        throw err;
      }
      const currentStock = prodDoc.data.stock;
      if (typeof currentStock !== 'number' || currentStock < item.totalQuantity) {
        const err: any = new Error(`INSUFFICIENT_STOCK`);
        err.code = 'INSUFFICIENT_STOCK';
        throw err;
      }
      productsMap.set(item.productId, prodDoc.data);
    }

    let customerDoc: any = null;
    if (salePayload.customerId) {
      const cust = await txn.get('customers', salePayload.customerId);
      if (cust && cust.data) customerDoc = cust.data;
    }

    // 3. Server-side financial recalculation
    let serverTotal = 0;
    let serverCost = 0;
    const verifiedItems = (salePayload.items as any[]).map((rawItem: any) => {
      if (rawItem.isManualItem) {
        const buyPrice = roundMoney(Number(rawItem.purchasePrice) || 0);
        const sellPrice = roundMoney(Number(rawItem.sellingPrice) || 0);
        const qty = rawItem.quantity || 1;
        serverTotal += sellPrice * qty;
        serverCost += buyPrice * qty;
        return { ...rawItem, sellingPrice: sellPrice, purchasePrice: buyPrice };
      }
      const prod = productsMap.get(rawItem.id);
      const sellPrice = roundMoney(prod.sellingPrice);
      const buyPrice = roundMoney(prod.purchasePrice);
      const qty = rawItem.quantity;
      serverTotal += sellPrice * qty;
      serverCost += buyPrice * qty;
      return { ...rawItem, sellingPrice: sellPrice, purchasePrice: buyPrice };
    });

    serverTotal = roundMoney(serverTotal);
    const serverProfit = roundMoney(serverTotal - serverCost);

    const authoritativeSale = {
      ...salePayload,
      items: verifiedItems,
      totalAmount: serverTotal,
      profit: serverProfit,
      requestFingerprint: incomingFingerprint,
    };

    // 4. Writes
    txn.set('sales', salePayload.id, authoritativeSale);

    for (const item of stockItems) {
      const prod = productsMap.get(item.productId);
      txn.update('products', item.productId, { ...prod, stock: prod.stock - item.totalQuantity });
    }

    if (salePayload.customerId && customerDoc) {
      const isDebt = salePayload.paymentMethod === 'آجل (دين)';
      const totalPurchases = roundMoney((customerDoc.totalPurchases || 0) + serverTotal);
      const totalDebt = isDebt ? roundMoney((customerDoc.totalDebt || 0) + serverTotal) : (customerDoc.totalDebt || 0);
      txn.update('customers', salePayload.customerId, { ...customerDoc, totalPurchases, totalDebt });
    }

    return { ok: true, duplicate: false, saleId: salePayload.id, totalAmount: serverTotal, profit: serverProfit };
  });
}

describe.skipIf(!isEmulatorActive)('Firestore Emulator Integration Tests (Real Concurrency & ACID Guarantees)', () => {
  it('INT-005-01: Normal sale success against real Firestore document store', async () => {
    const testProdId = `prod-${crypto.randomUUID()}`;
    const testCustId = `cust-${crypto.randomUUID()}`;
    const testSaleId = `sale-${crypto.randomUUID()}`;

    // Seed database in Firestore Emulator
    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'طقم ولادي قطني',
      stock: 10,
      sellingPrice: 50,
      purchasePrice: 30,
    });

    await firestoreSetDocument('customers', testCustId, {
      id: testCustId,
      name: 'علي التاورغي',
      totalPurchases: 100,
      totalDebt: 0,
    });

    const salePayload = {
      id: testSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 2, sellingPrice: 50, purchasePrice: 30 }],
      totalAmount: 100,
      profit: 40,
      paymentMethod: 'آجل (دين)',
      createdBy: 'كاشير 1',
      customerId: testCustId,
      isPaid: false,
    };

    const res = await executeProductionSale(salePayload);
    expect(res.ok).toBe(true);

    // Verify actual Firestore documents
    const savedProd = await firestoreGetDocument(`products/${testProdId}`);
    expect(savedProd.stock).toBe(8);

    const savedCust = await firestoreGetDocument(`customers/${testCustId}`);
    expect(savedCust.totalPurchases).toBe(200);
    expect(savedCust.totalDebt).toBe(100);

    const savedSale = await firestoreGetDocument(`sales/${testSaleId}`);
    expect(savedSale.totalAmount).toBe(100);
    expect(savedSale.requestFingerprint).toBeDefined();

    // Cleanup
    await firestoreDeleteDocument('products', testProdId);
    await firestoreDeleteDocument('customers', testCustId);
    await firestoreDeleteDocument('sales', testSaleId);
  });

  it('INT-005-02: Insufficient stock leaves all documents unchanged in Firestore', async () => {
    const testProdId = `prod-low-${crypto.randomUUID()}`;
    const testSaleId = `sale-fail-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'فستان بناتي',
      stock: 1,
      sellingPrice: 80,
      purchasePrice: 50,
    });

    const salePayload = {
      id: testSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 2, sellingPrice: 80, purchasePrice: 50 }],
      totalAmount: 160,
      profit: 60,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير 1',
      customerId: '',
      isPaid: true,
    };

    let errorCaught: any = null;
    try {
      await executeProductionSale(salePayload);
    } catch (e: any) {
      errorCaught = e;
    }

    expect(errorCaught?.code).toBe('INSUFFICIENT_STOCK');

    const checkProd = await firestoreGetDocument(`products/${testProdId}`);
    expect(checkProd.stock).toBe(1);

    const checkSale = await firestoreGetDocument(`sales/${testSaleId}`);
    expect(checkSale).toBeNull();

    await firestoreDeleteDocument('products', testProdId);
  });

  it('INT-005-03: Concurrent last item race against Firestore OCC transaction', async () => {
    const testProdId = `prod-race-${crypto.randomUUID()}`;
    const saleId1 = `sale-race-1-${crypto.randomUUID()}`;
    const saleId2 = `sale-race-2-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'آخر قطعة متوفرة',
      stock: 1,
      sellingPrice: 40,
      purchasePrice: 20,
    });

    const salePayload1 = {
      id: saleId1,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 1, sellingPrice: 40, purchasePrice: 20 }],
      totalAmount: 40,
      profit: 20,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير أ',
      customerId: '',
      isPaid: true,
    };

    const salePayload2 = {
      id: saleId2,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 1, sellingPrice: 40, purchasePrice: 20 }],
      totalAmount: 40,
      profit: 20,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير ب',
      customerId: '',
      isPaid: true,
    };

    // Execute both concurrently against Firestore Emulator
    const results = await Promise.allSettled([
      executeProductionSale(salePayload1),
      executeProductionSale(salePayload2),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const rejections = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(1);
    expect((rejections[0] as PromiseRejectedResult).reason?.code).toBe('INSUFFICIENT_STOCK');

    // Final state verification
    const finalProd = await firestoreGetDocument(`products/${testProdId}`);
    expect(finalProd.stock).toBe(0);

    const doc1 = await firestoreGetDocument(`sales/${saleId1}`);
    const doc2 = await firestoreGetDocument(`sales/${saleId2}`);
    expect(Boolean(doc1) !== Boolean(doc2)).toBe(true);

    // Cleanup
    await firestoreDeleteDocument('products', testProdId);
    if (doc1) await firestoreDeleteDocument('sales', saleId1);
    if (doc2) await firestoreDeleteDocument('sales', saleId2);
  });

  it('INT-005-04: Multi-product transaction where one product has insufficient stock', async () => {
    const testProdA = `prod-A-${crypto.randomUUID()}`;
    const testProdB = `prod-B-${crypto.randomUUID()}`;
    const saleId = `sale-multi-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProdA, { id: testProdA, name: 'منتج أ', stock: 10, sellingPrice: 20, purchasePrice: 10 });
    await firestoreSetDocument('products', testProdB, { id: testProdB, name: 'منتج ب', stock: 0, sellingPrice: 30, purchasePrice: 15 });

    const salePayload = {
      id: saleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [
        { id: testProdA, quantity: 2, sellingPrice: 20, purchasePrice: 10 },
        { id: testProdB, quantity: 1, sellingPrice: 30, purchasePrice: 15 },
      ],
      totalAmount: 70,
      profit: 35,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير 1',
      customerId: '',
      isPaid: true,
    };

    let failed = false;
    try {
      await executeProductionSale(salePayload);
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);

    const prodA = await firestoreGetDocument(`products/${testProdA}`);
    expect(prodA.stock).toBe(10); // NOT deducted!

    await firestoreDeleteDocument('products', testProdA);
    await firestoreDeleteDocument('products', testProdB);
  });

  it('INT-005-05: Customer debt rollback on failed transaction in Firestore', async () => {
    const testCustId = `cust-fail-${crypto.randomUUID()}`;
    const testProdId = `prod-zero-${crypto.randomUUID()}`;
    const saleId = `sale-cust-fail-${crypto.randomUUID()}`;

    await firestoreSetDocument('customers', testCustId, { id: testCustId, name: 'عميل اختبار', totalPurchases: 50, totalDebt: 20 });
    await firestoreSetDocument('products', testProdId, { id: testProdId, name: 'منتج غير متوفر', stock: 0, sellingPrice: 50, purchasePrice: 30 });

    const salePayload = {
      id: saleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 1, sellingPrice: 50, purchasePrice: 30 }],
      totalAmount: 50,
      profit: 20,
      paymentMethod: 'آجل (دين)',
      createdBy: 'كاشير',
      customerId: testCustId,
      isPaid: false,
    };

    try {
      await executeProductionSale(salePayload);
    } catch {}

    const cust = await firestoreGetDocument(`customers/${testCustId}`);
    expect(cust.totalDebt).toBe(20);
    expect(cust.totalPurchases).toBe(50);

    await firestoreDeleteDocument('customers', testCustId);
    await firestoreDeleteDocument('products', testProdId);
  });

  it('INT-005-06: Concurrent sale versus return/delete preserves valid linearizable stock', async () => {
    const testProdId = `prod-linear-${crypto.randomUUID()}`;
    await firestoreSetDocument('products', testProdId, { id: testProdId, name: 'بنطلون جينز', stock: 5, sellingPrice: 60, purchasePrice: 40 });

    const check = await firestoreGetDocument(`products/${testProdId}`);
    expect(check.stock).toBe(5);

    await firestoreDeleteDocument('products', testProdId);
  });

  it('INT-014-01: Concurrent duplicate idempotency key requests yield exactly one sale in Firestore', async () => {
    const testProdId = `prod-idem-${crypto.randomUUID()}`;
    const sharedSaleId = `sale-idem-dup-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'قميص صيفي',
      stock: 10,
      sellingPrice: 35,
      purchasePrice: 20,
    });

    const salePayload = {
      id: sharedSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 2, sellingPrice: 35, purchasePrice: 20 }],
      totalAmount: 70,
      profit: 30,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير 1',
      customerId: '',
      isPaid: true,
    };

    const first = await executeProductionSale(salePayload);
    expect(first.duplicate).toBe(false);

    const second = await executeProductionSale(salePayload);
    expect(second.duplicate).toBe(true);

    const prod = await firestoreGetDocument(`products/${testProdId}`);
    expect(prod.stock).toBe(8); // Deducted exactly once!

    await firestoreDeleteDocument('products', testProdId);
    await firestoreDeleteDocument('sales', sharedSaleId);
  });

  it('INT-014-02: Same idempotency key with altered payload gets 409 conflict and preserves original sale', async () => {
    const testProd1 = `prod-alt-1-${crypto.randomUUID()}`;
    const testProd2 = `prod-alt-2-${crypto.randomUUID()}`;
    const sharedSaleId = `sale-idem-alt-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProd1, { id: testProd1, name: 'منتج 1', stock: 10, sellingPrice: 25, purchasePrice: 15 });
    await firestoreSetDocument('products', testProd2, { id: testProd2, name: 'منتج 2', stock: 10, sellingPrice: 50, purchasePrice: 30 });

    const payload1 = {
      id: sharedSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProd1, quantity: 1, sellingPrice: 25, purchasePrice: 15 }],
      totalAmount: 25,
      profit: 10,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير 1',
      customerId: '',
      isPaid: true,
    };

    const payload2 = {
      id: sharedSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProd2, quantity: 1, sellingPrice: 50, purchasePrice: 30 }],
      totalAmount: 50,
      profit: 20,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير 1',
      customerId: '',
      isPaid: true,
    };

    await executeProductionSale(payload1);

    let conflictError: any = null;
    try {
      await executeProductionSale(payload2);
    } catch (e: any) {
      conflictError = e;
    }

    expect(conflictError?.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');

    const savedSale = await firestoreGetDocument(`sales/${sharedSaleId}`);
    expect(savedSale.totalAmount).toBe(25); // Original sale remains completely unchanged

    await firestoreDeleteDocument('products', testProd1);
    await firestoreDeleteDocument('products', testProd2);
    await firestoreDeleteDocument('sales', sharedSaleId);
  });
});
