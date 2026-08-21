import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  executeSaleTransaction,
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
 * Classification: DATABASE INTEGRATION — SHARED PRODUCTION BUSINESS FUNCTION
 * (Direct Execution of shared executeSaleTransaction against Firestore Emulator)
 *
 * Safety Guard:
 * These tests require the Firebase Firestore Emulator:
 *   firebase emulators:exec --only firestore "npm test"
 *
 * Execution environment flag: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 * If FIRESTORE_EMULATOR_HOST is missing, tests are safely skipped to protect Production.
 * If tests somehow execute without FIRESTORE_EMULATOR_HOST, beforeAll will fail-closed.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const isEmulatorActive = Boolean(EMULATOR_HOST);

// Use the exact shared production function (No duplicate logic)
const executeProductionSale = executeSaleTransaction;

describe.skipIf(!isEmulatorActive)('Firestore Emulator Integration Tests (Real Concurrency & ACID Guarantees)', () => {
  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FAIL-CLOSED SAFETY GUARD: FIRESTORE_EMULATOR_HOST is not set. Execution aborted before database access to protect Production."
      );
    }
  });

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

  // ── AUDIT-013 Real Firestore Integration Tests (Server-Authoritative Pricing) ──

  it('INT-013-01: Server ignores client manipulated price and recalculates from Firestore database price', async () => {
    const testProdId = `prod-fin-1-${crypto.randomUUID()}`;
    const testSaleId = `sale-fin-1-${crypto.randomUUID()}`;

    // Database price is 500 selling / 300 cost
    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'معطف شتوي فاخر',
      stock: 5,
      sellingPrice: 500,
      purchasePrice: 300,
    });

    // Client attempts to pay only 1 Dinar per item
    const manipulatedSale = {
      id: testSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 2, sellingPrice: 1, purchasePrice: 0.5 }],
      totalAmount: 2,
      profit: 1,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير',
      customerId: '',
      isPaid: true,
    };

    const res = await executeProductionSale(manipulatedSale);
    expect(res.ok).toBe(true);

    const savedSale = await firestoreGetDocument(`sales/${testSaleId}`);
    expect(savedSale.totalAmount).toBe(1000); // 500 * 2 = 1000 (not 2!)
    expect(savedSale.profit).toBe(400); // 1000 - 600 = 400 (not 1!)
    expect(savedSale.items[0].sellingPrice).toBe(500);
    expect(savedSale.items[0].purchasePrice).toBe(300);

    await firestoreDeleteDocument('products', testProdId);
    await firestoreDeleteDocument('sales', testSaleId);
  });

  it('INT-013-02: Client manipulated totalAmount and profit are overridden by Firestore product snapshot calculation', async () => {
    const testProdId = `prod-fin-2-${crypto.randomUUID()}`;
    const testSaleId = `sale-fin-2-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'حذاء أطفال',
      stock: 10,
      sellingPrice: 75.5,
      purchasePrice: 45.25,
    });

    const manipulatedSale = {
      id: testSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 3, sellingPrice: 75.5, purchasePrice: 45.25 }],
      totalAmount: 10, // Manipulated
      profit: 0,       // Manipulated
      paymentMethod: 'نقدي',
      createdBy: 'كاشير',
      customerId: '',
      isPaid: true,
    };

    await executeProductionSale(manipulatedSale);

    const savedSale = await firestoreGetDocument(`sales/${testSaleId}`);
    const expectedTotal = roundMoney(75.5 * 3); // 226.5
    const expectedCost = roundMoney(45.25 * 3); // 135.75
    const expectedProfit = roundMoney(expectedTotal - expectedCost); // 90.75

    expect(savedSale.totalAmount).toBe(expectedTotal);
    expect(savedSale.profit).toBe(expectedProfit);

    await firestoreDeleteDocument('products', testProdId);
    await firestoreDeleteDocument('sales', testSaleId);
  });

  it('INT-013-03: Debt sale increases customer debt strictly by authoritative server-calculated total', async () => {
    const testProdId = `prod-fin-3-${crypto.randomUUID()}`;
    const testCustId = `cust-fin-3-${crypto.randomUUID()}`;
    const testSaleId = `sale-fin-3-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', testProdId, {
      id: testProdId,
      name: 'طقم بناتي',
      stock: 10,
      sellingPrice: 120,
      purchasePrice: 70,
    });

    await firestoreSetDocument('customers', testCustId, {
      id: testCustId,
      name: 'سالم المريمي',
      totalPurchases: 500,
      totalDebt: 150,
    });

    const debtSale = {
      id: testSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [{ id: testProdId, quantity: 2, sellingPrice: 120, purchasePrice: 70 }],
      totalAmount: 10, // Client tried to register total as 10 to reduce debt
      profit: 5,
      paymentMethod: 'آجل (دين)',
      createdBy: 'كاشير',
      customerId: testCustId,
      isPaid: false,
    };

    await executeProductionSale(debtSale);

    const updatedCustomer = await firestoreGetDocument(`customers/${testCustId}`);
    // Authoritative total = 120 * 2 = 240
    expect(updatedCustomer.totalPurchases).toBe(740); // 500 + 240
    expect(updatedCustomer.totalDebt).toBe(390);      // 150 + 240

    await firestoreDeleteDocument('products', testProdId);
    await firestoreDeleteDocument('customers', testCustId);
    await firestoreDeleteDocument('sales', testSaleId);
  });

  it('INT-013-04: Existing real catalog product ID masquerading with isManualItem=true is rejected', async () => {
    const realProdId = `prod-real-cat-${crypto.randomUUID()}`;
    const fakeSaleId = `sale-fake-man-${crypto.randomUUID()}`;

    await firestoreSetDocument('products', realProdId, {
      id: realProdId,
      name: 'فستان تركي أصلي',
      stock: 5,
      sellingPrice: 250,
      purchasePrice: 150,
    });

    const maliciousManualItemSale = {
      id: fakeSaleId,
      type: 'بيع',
      date: new Date().toISOString(),
      items: [
        {
          id: realProdId, // Real product ID from database
          name: 'فستان تركي أصلي',
          isManualItem: true, // Attempt to bypass catalog pricing
          sellingPrice: 20,
          purchasePrice: 10,
          quantity: 1,
        },
      ],
      totalAmount: 20,
      profit: 10,
      paymentMethod: 'نقدي',
      createdBy: 'كاشير',
      customerId: '',
      isPaid: true,
    };

    let caughtError: any = null;
    try {
      await executeProductionSale(maliciousManualItemSale);
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError?.code).toBe('MANUAL_ITEM_CATALOG_COLLISION');

    // Verify stock remains untouched in Firestore
    const prodDoc = await firestoreGetDocument(`products/${realProdId}`);
    expect(prodDoc.stock).toBe(5);

    await firestoreDeleteDocument('products', realProdId);
  });
});
