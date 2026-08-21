import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  firestoreSetDocument,
  firestoreGetDocument,
  firestoreDeleteDocument,
  firestoreListCollectionDocuments,
  buildBackupV1Export,
  validateBackupPayload,
  executeFailureSafeRestore,
  getRestoreLock,
  setRestoreLock,
  clearRestoreLock,
  setTestRestoreFaultInjection,
  requireNoActiveRestore,
  MANAGED_ENTITY_COLLECTIONS,
  MANAGED_SINGLETON_COLLECTIONS,
} from './server';

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * FIRESTORE EMULATOR BACKUP & RESTORE INTEGRATION TEST SUITE (AUDIT-012)
 * ════════════════════════════════════════════════════════════════════════════════
 * Production Safety:
 * Requires FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 against demo-taiba-center-tests.
 * Protected by fail-closed guard in beforeAll.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const isEmulatorActive = Boolean(EMULATOR_HOST);

describe.skipIf(!isEmulatorActive)('Firestore Emulator Backup & Restore Integration Suite (AUDIT-012)', () => {
  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FAIL-CLOSED SAFETY GUARD: FIRESTORE_EMULATOR_HOST is not set. Execution aborted before database access to protect Production."
      );
    }
  });

  beforeEach(() => {
    clearRestoreLock();
    setTestRestoreFaultInjection(null);
  });

  afterAll(() => {
    clearRestoreLock();
    setTestRestoreFaultInjection(null);
  });

  // Helper to clear test collections between isolated tests
  async function cleanAllManagedCollections() {
    for (const coll of MANAGED_ENTITY_COLLECTIONS) {
      const docs = await firestoreListCollectionDocuments(coll);
      for (const d of docs) {
        await firestoreDeleteDocument(coll, d.id);
      }
    }
    for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
      await firestoreSetDocument(singleColl, 'all', { items: [] });
    }
  }

  it('INT-012-01: Valid Backup creates full export with valid metadata, checksum, and preserved IDs', async () => {
    await cleanAllManagedCollections();

    const prodId = `prod-backup-${crypto.randomUUID().slice(0, 8)}`;
    const custId = `cust-backup-${crypto.randomUUID().slice(0, 8)}`;
    const empId = `emp-backup-${crypto.randomUUID().slice(0, 8)}`;

    await firestoreSetDocument('products', prodId, {
      id: prodId,
      name: 'فستان بناتي سهرة',
      sellingPrice: 120,
      costPrice: 70,
      stock: 15,
    });

    await firestoreSetDocument('customers', custId, {
      id: custId,
      name: 'سارة علي',
      phone: '0912345678',
      totalDebt: 0,
    });

    await firestoreSetDocument('employees', empId, {
      id: empId,
      name: 'محمود',
      email: 'mahmoud@taiba.local',
      role: 'كاشير',
    });

    await firestoreSetDocument('categories', 'all', { items: ['فساتين', 'أطقم'] });

    const exportData = await buildBackupV1Export();

    expect(exportData.metadata.formatVersion).toBe(1);
    expect(exportData.metadata.app).toBe('Taiba Center Manager');
    expect(exportData.metadata.checksum).toBeDefined();
    expect(typeof exportData.metadata.checksum).toBe('string');
    expect(exportData.metadata.counts.products).toBeGreaterThanOrEqual(1);
    expect(exportData.metadata.counts.customers).toBeGreaterThanOrEqual(1);
    expect(exportData.metadata.counts.employees).toBeGreaterThanOrEqual(1);

    const exportedProd = exportData.collections.products.find((p: any) => p.id === prodId);
    expect(exportedProd).toBeDefined();
    expect(exportedProd.name).toBe('فستان بناتي سهرة');

    const exportedCust = exportData.collections.customers.find((c: any) => c.id === custId);
    expect(exportedCust).toBeDefined();
    expect(exportedCust.name).toBe('سارة علي');

    expect(exportData.collections.categories).toContain('فساتين');
  });

  it('INT-012-02: Invalid Backup is rejected during pre-flight before any destructive database mutation', async () => {
    await cleanAllManagedCollections();

    const initialProdId = `prod-keep-${crypto.randomUUID().slice(0, 8)}`;
    await firestoreSetDocument('products', initialProdId, {
      id: initialProdId,
      name: 'بيجامة أطفال شتوية',
      sellingPrice: 45,
      costPrice: 25,
      stock: 8,
    });

    // Malformed backup payload: missing product name & invalid price type
    const invalidBackupPayload = {
      metadata: { formatVersion: 1, app: 'Taiba Center Manager' },
      collections: {
        products: [
          { id: 'corrupt-1', sellingPrice: -100 } // Missing name, negative price
        ],
        sales: []
      }
    };

    let errorThrown: any = null;
    try {
      await executeFailureSafeRestore(invalidBackupPayload);
    } catch (e: any) {
      errorThrown = e;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown.status).toBe(400);

    // Verify existing Firestore data is 100% untouched and unchanged
    const docAfter = await firestoreGetDocument(`products/${initialProdId}`);
    expect(docAfter).toBeDefined();
    expect(docAfter.name).toBe('بيجامة أطفال شتوية');
    expect(docAfter.stock).toBe(8);

    // Verify lock is released cleanly
    expect(getRestoreLock()).toBeNull();
  });

  it('INT-012-03: Successful Exact Restore replaces state completely with no orphaned records', async () => {
    await cleanAllManagedCollections();

    // Database State A
    const oldProdId = `prod-old-A-${crypto.randomUUID().slice(0, 8)}`;
    await firestoreSetDocument('products', oldProdId, {
      id: oldProdId,
      name: 'منتج قديم سيحذف',
      sellingPrice: 10,
      costPrice: 5,
      stock: 2,
    });

    // Backup State B
    const newProdId1 = `prod-new-B1-${crypto.randomUUID().slice(0, 8)}`;
    const newProdId2 = `prod-new-B2-${crypto.randomUUID().slice(0, 8)}`;
    const backupStateB = {
      metadata: { formatVersion: 1, app: 'Taiba Center Manager' },
      collections: {
        products: [
          { id: newProdId1, name: 'قميص شبابي', sellingPrice: 65, costPrice: 35, stock: 20 },
          { id: newProdId2, name: 'بنطلون جينز', sellingPrice: 90, costPrice: 50, stock: 15 },
        ],
        sales: [],
        expenses: [],
        employees: [],
        customers: [],
        suppliers: [],
        attendance: [],
        categories: ['قمصان', 'بناطيل'],
        seasons: ['صيف 2026'],
      }
    };

    const restoreResult = await executeFailureSafeRestore(backupStateB);
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.stats.restoredCounts.products).toBe(2);
    expect(restoreResult.stats.deletedCounts.products).toBe(1);

    // Verify state in Firestore strictly matches State B
    const oldDocInDb = await firestoreGetDocument(`products/${oldProdId}`);
    expect(oldDocInDb).toBeNull(); // Cleanly deleted

    const docB1 = await firestoreGetDocument(`products/${newProdId1}`);
    expect(docB1).toBeDefined();
    expect(docB1.name).toBe('قميص شبابي');
    expect(docB1.stock).toBe(20);

    const docB2 = await firestoreGetDocument(`products/${newProdId2}`);
    expect(docB2).toBeDefined();
    expect(docB2.name).toBe('بنطلون جينز');

    const catDoc = await firestoreGetDocument('categories/all');
    expect(catDoc.items).toEqual(['قمصان', 'بناطيل']);
  });

  it('INT-012-04: Mid-Restore Failure triggers automated compensating rollback to pre-restore snapshot', async () => {
    await cleanAllManagedCollections();

    // Seed State A
    const originalProdId = `prod-state-A-${crypto.randomUUID().slice(0, 8)}`;
    await firestoreSetDocument('products', originalProdId, {
      id: originalProdId,
      name: 'جاكيت شتوي أصلي',
      sellingPrice: 200,
      costPrice: 120,
      stock: 5,
    });

    const originalCustId = `cust-state-A-${crypto.randomUUID().slice(0, 8)}`;
    await firestoreSetDocument('customers', originalCustId, {
      id: originalCustId,
      name: 'زبون أصلي',
      phone: '0920000000',
    });

    // Backup State B
    const backupStateB = {
      metadata: { formatVersion: 1, app: 'Taiba Center Manager' },
      collections: {
        products: [
          { id: `prod-state-B1-${crypto.randomUUID().slice(0, 8)}`, name: 'منتج ب 1', sellingPrice: 50, costPrice: 30, stock: 10 },
          { id: `prod-state-B2-${crypto.randomUUID().slice(0, 8)}`, name: 'منتج ب 2', sellingPrice: 60, costPrice: 35, stock: 10 },
        ],
        sales: [],
        expenses: [],
        employees: [],
        customers: [
          { id: `cust-state-B1-${crypto.randomUUID().slice(0, 8)}`, name: 'زبون ب 1' }
        ],
        suppliers: [],
        attendance: [],
        categories: [],
        seasons: [],
      }
    };

    // Inject fault after 1 write operation during restore mutation phase
    setTestRestoreFaultInjection(1);

    let errorThrown: any = null;
    try {
      await executeFailureSafeRestore(backupStateB);
    } catch (e: any) {
      errorThrown = e;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown.code).toBe('RESTORE_FAILED_ROLLBACK_SUCCESS');

    // Verify Firestore was rolled back completely to State A
    const restoredProdA = await firestoreGetDocument(`products/${originalProdId}`);
    expect(restoredProdA).toBeDefined();
    expect(restoredProdA.name).toBe('جاكيت شتوي أصلي');
    expect(restoredProdA.stock).toBe(5);

    const restoredCustA = await firestoreGetDocument(`customers/${originalCustId}`);
    expect(restoredCustA).toBeDefined();
    expect(restoredCustA.name).toBe('زبون أصلي');

    // Verify State B artifacts do NOT exist in Firestore
    const prodList = await firestoreListCollectionDocuments('products');
    expect(prodList.length).toBe(1);
    expect(prodList[0].id).toBe(originalProdId);
  });

  it('INT-012-05: Rollback verification independently confirms document counts by direct Firestore reread', async () => {
    await cleanAllManagedCollections();

    const seededId1 = `prod-verify-${crypto.randomUUID().slice(0, 8)}`;
    const seededId2 = `prod-verify-${crypto.randomUUID().slice(0, 8)}`;
    await firestoreSetDocument('products', seededId1, { id: seededId1, name: 'فستان 1', sellingPrice: 50, costPrice: 25, stock: 4 });
    await firestoreSetDocument('products', seededId2, { id: seededId2, name: 'فستان 2', sellingPrice: 60, costPrice: 30, stock: 6 });

    const backupPayload = {
      collections: {
        products: [
          { id: 'new-unseen-id', name: 'منتج غير مكتمل', sellingPrice: 80, costPrice: 40, stock: 10 }
        ]
      }
    };

    setTestRestoreFaultInjection(1);

    try {
      await executeFailureSafeRestore(backupPayload);
    } catch (e: any) {
      expect(e.code).toBe('RESTORE_FAILED_ROLLBACK_SUCCESS');
    }

    // Direct independent reread
    const productsInDb = await firestoreListCollectionDocuments('products');
    expect(productsInDb.length).toBe(2);
    const ids = productsInDb.map(p => p.id);
    expect(ids).toContain(seededId1);
    expect(ids).toContain(seededId2);
    expect(ids).not.toContain('new-unseen-id');
  });

  it('INT-012-06: Concurrent Restore attempts are rejected with 409 Conflict', async () => {
    // Simulate active lock
    setRestoreLock({
      state: 'RESTORING',
      opId: 'res-lock-test',
      startedAt: Date.now(),
      initiatedBy: 'admin@taiba.local',
    });

    let errorThrown: any = null;
    try {
      await executeFailureSafeRestore({ collections: { products: [] } });
    } catch (e: any) {
      errorThrown = e;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown.status).toBe(409);
    expect(errorThrown.code).toBe('RESTORE_ALREADY_IN_PROGRESS');

    clearRestoreLock();
  });

  it('INT-012-07: Mutative operations are blocked with 503 Maintenance Mode while Restore Lock is active', async () => {
    setRestoreLock({
      state: 'RESTORING',
      opId: 'res-mutex-active',
      startedAt: Date.now(),
      initiatedBy: 'admin@taiba.local',
    });

    let resStatus = 0;
    let resBody: any = null;
    const mockRes: any = {
      status(s: number) {
        resStatus = s;
        return {
          json(b: any) {
            resBody = b;
          }
        };
      }
    };
    let nextCalled = false;
    const mockNext = () => { nextCalled = true; };

    requireNoActiveRestore({} as any, mockRes, mockNext);

    expect(resStatus).toBe(503);
    expect(resBody.code).toBe('RESTORE_IN_PROGRESS');
    expect(nextCalled).toBe(false);

    // Release lock and verify middleware allows subsequent requests
    clearRestoreLock();
    nextCalled = false;
    requireNoActiveRestore({} as any, mockRes, mockNext);
    expect(nextCalled).toBe(true);
  });

  it('INT-012-08: Document IDs across relations are strictly preserved after restore', async () => {
    await cleanAllManagedCollections();

    const specificSaleId = 'SALE-2026-PRESERVED-ID-999';
    const specificCustomerId = 'CUST-LOYAL-777';

    const backupPayload = {
      metadata: { formatVersion: 1 },
      collections: {
        customers: [{ id: specificCustomerId, name: 'فاطمة محمود' }],
        sales: [{
          id: specificSaleId,
          customerId: specificCustomerId,
          customerName: 'فاطمة محمود',
          items: [{ id: 'p1', name: 'بلوزة', sellingPrice: 40, quantity: 1 }],
          totalAmount: 40,
          profit: 15,
          paymentMethod: 'نقدي',
        }],
      }
    };

    await executeFailureSafeRestore(backupPayload);

    const saleInDb = await firestoreGetDocument(`sales/${specificSaleId}`);
    expect(saleInDb).toBeDefined();
    expect(saleInDb.id).toBe(specificSaleId);
    expect(saleInDb.customerId).toBe(specificCustomerId);

    const custInDb = await firestoreGetDocument(`customers/${specificCustomerId}`);
    expect(custInDb).toBeDefined();
    expect(custInDb.id).toBe(specificCustomerId);
  });

  it('INT-012-09: Extra documents in current DB not present in backup are removed under Exact Replace semantics', async () => {
    await cleanAllManagedCollections();

    const extraProdId = `prod-extra-${crypto.randomUUID().slice(0, 8)}`;
    await firestoreSetDocument('products', extraProdId, {
      id: extraProdId,
      name: 'منتج إضافي زائد',
      sellingPrice: 10,
      costPrice: 5,
      stock: 1,
    });

    const targetProdId = `prod-target-${crypto.randomUUID().slice(0, 8)}`;
    const backupPayload = {
      collections: {
        products: [
          { id: targetProdId, name: 'المنتج المستهدف فقط', sellingPrice: 50, costPrice: 25, stock: 10 }
        ]
      }
    };

    await executeFailureSafeRestore(backupPayload);

    const extraDoc = await firestoreGetDocument(`products/${extraProdId}`);
    expect(extraDoc).toBeNull(); // Removed

    const targetDoc = await firestoreGetDocument(`products/${targetProdId}`);
    expect(targetDoc).toBeDefined();
    expect(targetDoc.name).toBe('المنتج المستهدف فقط');
  });

  it('INT-012-10: Historical financial snapshot values in backup are preserved without recalculation', async () => {
    await cleanAllManagedCollections();

    const prodId = 'prod-catalog-price-100';
    // Current catalog product price in store
    await firestoreSetDocument('products', prodId, {
      id: prodId,
      name: 'فستان مخملي',
      sellingPrice: 100, // Current price: 100
      costPrice: 60,
      stock: 10,
    });

    // Backup contains a historical sale of that same product sold at a discount (80)
    const historicalSaleId = 'HIST-SALE-888';
    const backupPayload = {
      collections: {
        products: [
          { id: prodId, name: 'فستان مخملي', sellingPrice: 100, costPrice: 60, stock: 10 }
        ],
        sales: [
          {
            id: historicalSaleId,
            items: [{ id: prodId, name: 'فستان مخملي', sellingPrice: 80, purchasePrice: 50, quantity: 1 }],
            totalAmount: 80, // Historical discounted total preserved
            profit: 30,      // Historical profit preserved
            paymentMethod: 'نقدي',
            date: '2025-12-01T10:00:00Z',
          }
        ]
      }
    };

    await executeFailureSafeRestore(backupPayload);

    const saleInDb = await firestoreGetDocument(`sales/${historicalSaleId}`);
    expect(saleInDb).toBeDefined();
    expect(saleInDb.totalAmount).toBe(80);
    expect(saleInDb.profit).toBe(30);
    expect(saleInDb.items[0].sellingPrice).toBe(80);
  });
});
