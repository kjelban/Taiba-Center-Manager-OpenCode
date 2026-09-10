import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  firestoreSetDocument,
  firestoreDeleteDocument,
  firestoreListCollectionDocuments,
  buildBackupV1Export,
  firestoreQueryCollection,
  auditLog,
  MANAGED_ENTITY_COLLECTIONS,
} from './server';
import {
  validateQueryParameters,
  encodeQueryCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './server-auth';

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * FIRESTORE EMULATOR BOUNDED QUERIES & PAGINATION INTEGRATION SUITE (AUDIT-007)
 * ════════════════════════════════════════════════════════════════════════════════
 * Production Safety:
 * Requires FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 against demo-taiba-center-tests.
 * Protected by fail-closed guard in beforeAll.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const isEmulatorActive = Boolean(EMULATOR_HOST);

describe.skipIf(!isEmulatorActive)('Firestore Emulator Bounded Queries & Pagination Integration Suite (AUDIT-007)', () => {
  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FAIL-CLOSED SAFETY GUARD: FIRESTORE_EMULATOR_HOST is not set. Execution aborted before database access to protect Production."
      );
    }
  });

  async function clearCollection(coll: string) {
    const docs = await firestoreListCollectionDocuments(coll);
    for (const d of docs) {
      await firestoreDeleteDocument(coll, d.id);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-01: Default Bound
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-01: Default Bound: Seed 120 records, request first page without limit returns exactly default page size (50)', async () => {
    await clearCollection('sales');

    // Seed 120 sales
    for (let i = 1; i <= 120; i++) {
      const pad = String(i).padStart(3, '0');
      const id = `sale_bound_${pad}`;
      const date = new Date(Date.UTC(2026, 7, 1, 0, i, 0)).toISOString();
      await firestoreSetDocument('sales', id, {
        id,
        date,
        totalAmount: 100 + i,
        profit: 20,
        paymentMethod: 'نقداً',
        items: [{ id: 'p1', name: 'قميص', quantity: 1, sellingPrice: 100 + i, purchasePrice: 80 }],
        createdBy: 'كاشير 1',
      });
    }

    const validation = validateQueryParameters({ collection: 'sales' });
    expect(validation.error).toBeUndefined();
    expect(validation.options).toBeDefined();
    expect(validation.options?.limit).toBe(DEFAULT_PAGE_SIZE);

    const result = await firestoreQueryCollection(validation.options!);
    expect(result.items.length).toBe(50);
    expect(result.totalReturned).toBe(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-02: Max Limit Enforcement
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-02: Max Limit Enforcement: Client requesting limit=100000 is capped to MAX_PAGE_SIZE (100)', async () => {
    const validation = validateQueryParameters({ collection: 'sales', limit: 100000 });
    expect(validation.error).toBeUndefined();
    expect(validation.options?.limit).toBe(MAX_PAGE_SIZE);
    expect(validation.options?.limit).toBe(100);

    const result = await firestoreQueryCollection(validation.options!);
    expect(result.items.length).toBe(100);
    expect(result.totalReturned).toBe(100);
    expect(result.hasMore).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-03: Cursor Pagination
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-03: Cursor Pagination: Traversing Page 1 and Page 2 produces complete coverage with zero duplicates', async () => {
    await clearCollection('sales');

    // Seed 75 records
    for (let i = 1; i <= 75; i++) {
      const pad = String(i).padStart(3, '0');
      const id = `sale_cursor_${pad}`;
      const date = new Date(Date.UTC(2026, 7, 10, 0, i, 0)).toISOString();
      await firestoreSetDocument('sales', id, {
        id,
        date,
        totalAmount: 50,
        profit: 10,
        paymentMethod: 'نقداً',
        items: [],
      });
    }

    // Page 1: limit 50
    const v1 = validateQueryParameters({
      collection: 'sales',
      limit: 50,
      orderByField: 'date',
      orderDirection: 'DESC',
    });
    const page1 = await firestoreQueryCollection(v1.options!);
    expect(page1.items.length).toBe(50);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: with nextCursor
    const v2 = validateQueryParameters({
      collection: 'sales',
      limit: 50,
      cursor: page1.nextCursor!,
      orderByField: 'date',
      orderDirection: 'DESC',
    });
    const page2 = await firestoreQueryCollection(v2.options!);
    expect(page2.items.length).toBe(25);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();

    // Verify zero duplicates
    const page1Ids = new Set(page1.items.map(i => i.id));
    const page2Ids = new Set(page2.items.map(i => i.id));
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }

    // Verify complete union (50 + 25 = 75)
    expect(page1Ids.size + page2Ids.size).toBe(75);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-04: Stable Same-Timestamp Pagination
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-04: Stable Same-Timestamp Pagination: Identical timestamps are cleanly tie-broken by document ID', async () => {
    await clearCollection('sales');

    const identicalDate = '2026-08-21T10:00:00.000Z';

    // Seed 10 records with exact same date but distinct IDs
    for (let i = 1; i <= 10; i++) {
      const pad = String(i).padStart(2, '0');
      const id = `same_time_${pad}`;
      await firestoreSetDocument('sales', id, {
        id,
        date: identicalDate,
        totalAmount: 10 * i,
      });
    }

    // Page 1: limit 5
    const v1 = validateQueryParameters({
      collection: 'sales',
      limit: 5,
      orderByField: 'date',
      orderDirection: 'DESC',
    });
    const page1 = await firestoreQueryCollection(v1.options!);
    expect(page1.items.length).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    // Page 2: limit 5 with cursor
    const v2 = validateQueryParameters({
      collection: 'sales',
      limit: 5,
      cursor: page1.nextCursor!,
      orderByField: 'date',
      orderDirection: 'DESC',
    });
    const page2 = await firestoreQueryCollection(v2.options!);
    expect(page2.items.length).toBe(5);

    // Verify distinct sets
    const p1Ids = new Set(page1.items.map(d => d.id));
    const p2Ids = new Set(page2.items.map(d => d.id));
    for (const id of p2Ids) {
      expect(p1Ids.has(id)).toBe(false);
    }
    expect(p1Ids.size + p2Ids.size).toBe(10);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-05: Date Range
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-05: Date Range: Query restricts results strictly to date bounds', async () => {
    await clearCollection('sales');

    // Seed 2 before range, 3 inside range, 2 after range
    await firestoreSetDocument('sales', 's_before_1', { id: 's_before_1', date: '2026-01-10T10:00:00.000Z', totalAmount: 10 });
    await firestoreSetDocument('sales', 's_before_2', { id: 's_before_2', date: '2026-02-15T10:00:00.000Z', totalAmount: 20 });

    await firestoreSetDocument('sales', 's_inside_1', { id: 's_inside_1', date: '2026-06-05T10:00:00.000Z', totalAmount: 30 });
    await firestoreSetDocument('sales', 's_inside_2', { id: 's_inside_2', date: '2026-06-15T10:00:00.000Z', totalAmount: 40 });
    await firestoreSetDocument('sales', 's_inside_3', { id: 's_inside_3', date: '2026-06-25T10:00:00.000Z', totalAmount: 50 });

    await firestoreSetDocument('sales', 's_after_1', { id: 's_after_1', date: '2026-10-01T10:00:00.000Z', totalAmount: 60 });
    await firestoreSetDocument('sales', 's_after_2', { id: 's_after_2', date: '2026-11-01T10:00:00.000Z', totalAmount: 70 });

    const v = validateQueryParameters({
      collection: 'sales',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T23:59:59.999Z',
      dateField: 'date',
      orderByField: 'date',
      orderDirection: 'ASC',
    });

    const result = await firestoreQueryCollection(v.options!);
    expect(result.items.length).toBe(3);
    const returnedIds = result.items.map(d => d.id);
    expect(returnedIds).toEqual(['s_inside_1', 's_inside_2', 's_inside_3']);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-06: Audit Log Pagination
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-06: Audit Log Pagination: Traverses growing audit log history cleanly with cursors', async () => {
    await clearCollection('audit_logs');

    // Seed 60 audit logs
    for (let i = 1; i <= 60; i++) {
      await auditLog(`event_${i}`, 'admin_test', 'admin@taiba.com', { index: i });
    }

    const v1 = validateQueryParameters({
      collection: 'audit_logs',
      limit: 50,
      orderByField: 'timestamp',
      orderDirection: 'DESC',
    });

    const page1 = await firestoreQueryCollection(v1.options!);
    expect(page1.items.length).toBe(50);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const v2 = validateQueryParameters({
      collection: 'audit_logs',
      limit: 50,
      cursor: page1.nextCursor!,
      orderByField: 'timestamp',
      orderDirection: 'DESC',
    });

    const page2 = await firestoreQueryCollection(v2.options!);
    expect(page2.items.length).toBe(10);
    expect(page2.hasMore).toBe(false);

    // Verify all 60 are covered
    const allIds = new Set([...page1.items.map(i => i.id), ...page2.items.map(i => i.id)]);
    expect(allIds.size).toBe(60);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-07: Attendance Date & Filter Query
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-07: Attendance Date Query: Correctly filters by employeeId and date range', async () => {
    await clearCollection('attendance');

    await firestoreSetDocument('attendance', 'att_emp1_june', {
      id: 'att_emp1_june',
      employeeId: 'emp_01',
      employeeName: 'أحمد',
      checkInTime: '2026-06-10T08:00:00.000Z',
    });
    await firestoreSetDocument('attendance', 'att_emp2_june', {
      id: 'att_emp2_june',
      employeeId: 'emp_02',
      employeeName: 'محمد',
      checkInTime: '2026-06-11T08:00:00.000Z',
    });
    await firestoreSetDocument('attendance', 'att_emp1_july', {
      id: 'att_emp1_july',
      employeeId: 'emp_01',
      employeeName: 'أحمد',
      checkInTime: '2026-07-10T08:00:00.000Z',
    });

    const v = validateQueryParameters({
      collection: 'attendance',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T23:59:59.999Z',
      dateField: 'checkInTime',
      filterField: 'employeeId',
      filterValue: 'emp_01',
    });

    const result = await firestoreQueryCollection(v.options!);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('att_emp1_june');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-08: Expenses Date Query
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-08: Expenses Date Query: Restricts expenses to requested period', async () => {
    await clearCollection('expenses');

    await firestoreSetDocument('expenses', 'exp_may', {
      id: 'exp_may',
      description: 'فاتورة كهرباء مايو',
      amount: 120,
      date: '2026-05-20T10:00:00.000Z',
      category: 'كهرباء',
    });
    await firestoreSetDocument('expenses', 'exp_june', {
      id: 'exp_june',
      description: 'فاتورة كهرباء يونيو',
      amount: 150,
      date: '2026-06-20T10:00:00.000Z',
      category: 'كهرباء',
    });

    const v = validateQueryParameters({
      collection: 'expenses',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T23:59:59.999Z',
      dateField: 'date',
    });

    const result = await firestoreQueryCollection(v.options!);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('exp_june');
    expect(result.items[0].amount).toBe(150);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-09: Invalid Query Parameters
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-09: Invalid Query Parameters: Rejected with validation error, no unrestricted fallback', () => {
    expect(validateQueryParameters({ collection: 'unknown_coll' }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', limit: -10 }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', limit: 0 }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', limit: 5.5 }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', cursor: 'bad-cursor' }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', orderByField: 'evil_column' }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', orderDirection: 'INVALID' }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', dateFrom: 'invalid-date' }).error).toBeDefined();
    expect(validateQueryParameters({ collection: 'sales', dateFrom: '2026-12-01', dateTo: '2026-01-01' }).error).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // INT-007-10: Intentional Full Scan Isolation
  // ─────────────────────────────────────────────────────────────────────────────
  it('INT-007-10: Intentional Full Scan Isolation: Administrative backup export remains complete (unaffected by 50/100 bounds)', async () => {
    await clearCollection('sales');

    // Seed 120 sales
    for (let i = 1; i <= 120; i++) {
      const pad = String(i).padStart(3, '0');
      const id = `sale_backup_${pad}`;
      await firestoreSetDocument('sales', id, {
        id,
        date: new Date(Date.UTC(2026, 7, 1, 0, i, 0)).toISOString(),
        totalAmount: 100,
        profit: 20,
        paymentMethod: 'نقداً',
        items: [],
      });
    }

    // Verify that query endpoint returns only bounded results (50 by default)
    const qRes = await firestoreQueryCollection(validateQueryParameters({ collection: 'sales' }).options!);
    expect(qRes.items.length).toBe(50);
    expect(qRes.totalReturned).toBe(50);

    // Verify that backup export builds FULL un-truncated export (all 120 items)
    const backupExport = await buildBackupV1Export();
    expect(backupExport.collections.sales.length).toBe(120);
    expect(backupExport.metadata.counts.sales).toBe(120);
  });
});
