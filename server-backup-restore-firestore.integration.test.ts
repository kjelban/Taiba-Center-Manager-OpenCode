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
  SYSTEM_RECOVERY_OPERATIONS_COLLECTION,
  SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION,
  capturePreRestoreSnapshot,
  computeCanonicalStateHash,
  compareCanonicalStates,
  persistDurablePreRestoreSnapshot,
  loadDurablePreRestoreSnapshot,
  setDurableRestoreOperation,
  recoverPendingRestoreOperation,
} from './server';

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * FIRESTORE EMULATOR BACKUP & RESTORE DURABILITY INTEGRATION SUITE (AUDIT-012)
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
    // Clean system recovery collections
    const sysOps = await firestoreListCollectionDocuments(SYSTEM_RECOVERY_OPERATIONS_COLLECTION);
    for (const d of sysOps) {
      await firestoreDeleteDocument(SYSTEM_RECOVERY_OPERATIONS_COLLECTION, d.id);
    }
    const sysSnaps = await firestoreListCollectionDocuments(SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION);
    for (const d of sysSnaps) {
      await firestoreDeleteDocument(SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION, d.id);
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

    const stateBefore = await capturePreRestoreSnapshot();
    const hashBefore = computeCanonicalStateHash(stateBefore);

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

    // Verify existing Firestore data is 100% untouched with identical full-state hash
    const stateAfter = await capturePreRestoreSnapshot();
    const hashAfter = computeCanonicalStateHash(stateAfter);
    expect(hashAfter).toBe(hashBefore);

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

    // Verify state in Firestore strictly matches State B with canonical hash equality
    const dbStateAfter = await capturePreRestoreSnapshot();
    const comparison = compareCanonicalStates(dbStateAfter, backupStateB.collections);
    expect(comparison.equal).toBe(true);

    const oldDocInDb = await firestoreGetDocument(`products/${oldProdId}`);
    expect(oldDocInDb).toBeNull(); // Cleanly deleted
  });

  it('INT-012-04: Mid-Restore Failure triggers automated rollback and proves full canonical state hash equality', async () => {
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

    const stateA = await capturePreRestoreSnapshot();
    const hashA = computeCanonicalStateHash(stateA);

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

    // Verify Firestore was rolled back completely to State A with exact canonical hash match
    const finalDbState = await capturePreRestoreSnapshot();
    const finalHash = computeCanonicalStateHash(finalDbState);

    expect(finalHash).toBe(hashA);
    const comparison = compareCanonicalStates(finalDbState, stateA);
    expect(comparison.equal).toBe(true);
    expect(comparison.mismatches.length).toBe(0);
  });

  it('INT-012-05: Rollback restores full canonical database state across all 3 mutation types (delete, overwrite, insert)', async () => {
    await cleanAllManagedCollections();

    // 1. Existing doc that should be deleted in B
    const docToDeleteId = `prod-to-delete-${crypto.randomUUID().slice(0, 6)}`;
    await firestoreSetDocument('products', docToDeleteId, {
      id: docToDeleteId,
      name: 'منتج سيحذف بالكامل',
      sellingPrice: 40,
      costPrice: 20,
      stock: 3,
    });

    // 2. Existing doc that should be overwritten with different content in B
    const docToOverwriteId = `prod-to-overwrite-${crypto.randomUUID().slice(0, 6)}`;
    await firestoreSetDocument('products', docToOverwriteId, {
      id: docToOverwriteId,
      name: 'منتج أصلي قبل التعديل',
      sellingPrice: 100,
      costPrice: 50,
      stock: 10,
    });

    const stateA = await capturePreRestoreSnapshot();
    const hashA = computeCanonicalStateHash(stateA);

    // Backup State B: Contains overwritten doc + newly inserted doc (and omits docToDeleteId)
    const docToInsertId = `prod-new-inserted-${crypto.randomUUID().slice(0, 6)}`;
    const backupStateB = {
      collections: {
        products: [
          { id: docToOverwriteId, name: 'منتج معدل في النسخة ب', sellingPrice: 999, costPrice: 500, stock: 1 },
          { id: docToInsertId, name: 'منتج جديد تماماً مضاف', sellingPrice: 55, costPrice: 30, stock: 8 },
        ]
      }
    };

    // Inject fault after writes begin so mutations occur before abort
    setTestRestoreFaultInjection(2);

    try {
      await executeFailureSafeRestore(backupStateB);
    } catch (e: any) {
      expect(e.code).toBe('RESTORE_FAILED_ROLLBACK_SUCCESS');
    }

    // Direct Firestore assertions for all 3 mutation types:
    // 1. Deleted doc restored with original content
    const restoredDeletedDoc = await firestoreGetDocument(`products/${docToDeleteId}`);
    expect(restoredDeletedDoc).toBeDefined();
    expect(restoredDeletedDoc.name).toBe('منتج سيحذف بالكامل');
    expect(restoredDeletedDoc.sellingPrice).toBe(40);

    // 2. Overwritten doc restored to original content
    const restoredOverwrittenDoc = await firestoreGetDocument(`products/${docToOverwriteId}`);
    expect(restoredOverwrittenDoc).toBeDefined();
    expect(restoredOverwrittenDoc.name).toBe('منتج أصلي قبل التعديل');
    expect(restoredOverwrittenDoc.sellingPrice).toBe(100);

    // 3. Newly inserted doc cleanly removed
    const insertedDocInDb = await firestoreGetDocument(`products/${docToInsertId}`);
    expect(insertedDocInDb).toBeNull();

    // 4. Full canonical hash matches State A
    const finalState = await capturePreRestoreSnapshot();
    expect(computeCanonicalStateHash(finalState)).toBe(hashA);
  });

  it('INT-012-06: Concurrent Restore attempts are rejected with 409 Conflict', async () => {
    // Set active lock
    setRestoreLock({
      state: 'RESTORING',
      opId: 'res-lock-test',
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
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
      heartbeatAt: Date.now(),
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

  it('INT-012-11: Crash Recovery: Process crash during RESTORING is recovered on startup via durable journal', async () => {
    await cleanAllManagedCollections();

    // 1. Seed State A in Firestore
    const prodAId = `prod-crash-orig-${crypto.randomUUID().slice(0, 6)}`;
    await firestoreSetDocument('products', prodAId, {
      id: prodAId,
      name: 'فستان أصلي قبل الكراش',
      sellingPrice: 150,
      costPrice: 90,
      stock: 7,
    });

    const stateA = await capturePreRestoreSnapshot();
    const hashA = computeCanonicalStateHash(stateA);

    // 2. Persist durable pre-restore snapshot for simulated operation
    const crashOpId = 'res_simulated_crash_' + crypto.randomUUID().slice(0, 6);
    const persistedMeta = await persistDurablePreRestoreSnapshot(crashOpId, stateA);

    // 3. Simulate mid-restore partial mutation before crash:
    // Insert a dirty document that was written during partial restore
    const dirtyProdId = `prod-dirty-partial-${crypto.randomUUID().slice(0, 6)}`;
    await firestoreSetDocument('products', dirtyProdId, {
      id: dirtyProdId,
      name: 'بيانات غير مكتملة بعد كراش السيرفر',
      sellingPrice: 99,
      costPrice: 50,
      stock: 1,
    });

    // Set durable operation state to RESTORING (representing a severed process)
    await setDurableRestoreOperation({
      opId: crashOpId,
      state: 'RESTORING',
      startedAt: Date.now() - 60000,
      heartbeatAt: Date.now() - 60000,
      initiatedBy: 'admin',
      snapshotStateHash: persistedMeta.stateHash,
      snapshotCounts: persistedMeta.counts,
    });

    // 4. Invoke startup crash recovery function (as would happen when server boots up)
    const recoveryResult = await recoverPendingRestoreOperation();

    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.status).toBe('ROLLED_BACK_CRASH');
    expect(recoveryResult.opId).toBe(crashOpId);

    // 5. Verify database was restored exactly to State A:
    // Dirty document removed
    const dirtyInDb = await firestoreGetDocument(`products/${dirtyProdId}`);
    expect(dirtyInDb).toBeNull();

    // Original document intact
    const origInDb = await firestoreGetDocument(`products/${prodAId}`);
    expect(origInDb).toBeDefined();
    expect(origInDb.name).toBe('فستان أصلي قبل الكراش');

    // Full canonical state hash strictly matches State A
    const finalDbState = await capturePreRestoreSnapshot();
    expect(computeCanonicalStateHash(finalDbState)).toBe(hashA);
  });

  it('INT-012-12: Missing/Corrupt Snapshot on Crash Recovery enters MANUAL_INTERVENTION_REQUIRED and protects database', async () => {
    await cleanAllManagedCollections();

    const corruptOpId = 'res_corrupt_snap_' + crypto.randomUUID().slice(0, 6);

    // Record an active operation in Firestore whose durable snapshot is missing/corrupted
    await setDurableRestoreOperation({
      opId: corruptOpId,
      state: 'RESTORING',
      startedAt: Date.now() - 60000,
      heartbeatAt: Date.now() - 60000,
      initiatedBy: 'admin',
      snapshotStateHash: 'non_existent_hash_123',
    });

    // Invoke startup recovery
    const recoveryResult = await recoverPendingRestoreOperation();

    expect(recoveryResult.recovered).toBe(false);
    expect(recoveryResult.status).toBe('RECOVERY_FAILED_CORRUPT_SNAPSHOT');

    // Verify lock state is in MANUAL_INTERVENTION_REQUIRED
    const lock = getRestoreLock();
    expect(lock).not.toBeNull();
    expect(lock?.state).toBe('RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED');
  });

  it('INT-012-13: Startup Mutation Blocking: Mutations are blocked with 503 while recovery is required', async () => {
    // Set lock state to RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED
    setRestoreLock({
      opId: 'res-recovery-block-test',
      state: 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED',
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      initiatedBy: 'admin',
    });

    let resStatus = 0;
    let resBody: any = null;
    const mockRes: any = {
      status(s: number) {
        resStatus = s;
        return { json(b: any) { resBody = b; } };
      }
    };
    let nextCalled = false;
    const mockNext = () => { nextCalled = true; };

    requireNoActiveRestore({} as any, mockRes, mockNext);

    expect(resStatus).toBe(503);
    expect(resBody.code).toBe('RESTORE_RECOVERY_REQUIRED');
    expect(nextCalled).toBe(false);

    clearRestoreLock();
  });
});
