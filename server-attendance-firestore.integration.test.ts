import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import {
  executeClockIn,
  executeClockOut,
  executeGetActiveAttendance,
  firestoreGetDocument,
  firestoreDeleteDocument,
  firestoreSetDocument,
} from './server';

const isEmulatorActive = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!isEmulatorActive)('Firestore Emulator Attendance Integration Tests (AUDIT-004)', () => {
  beforeAll(() => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        "FAIL-CLOSED SAFETY GUARD: FIRESTORE_EMULATOR_HOST is not set. Execution aborted before database access to protect Production."
      );
    }
  });

  it('INT-004-01: No Duplicate Active Shift under concurrent clock-in requests', async () => {
    const testEmpId = `emp-race-${crypto.randomUUID()}`;

    // Clean initial state in Firestore
    await firestoreSetDocument('employees', testEmpId, {
      id: testEmpId,
      name: 'موظف تجريبي للسباق',
      role: 'كاشير',
      permissions: ['pos'],
    });

    // Send two concurrent clock-in operations for the same employee
    const [res1, res2] = await Promise.all([
      executeClockIn({ employeeId: testEmpId, employeeName: 'موظف تجريبي للسباق' }),
      executeClockIn({ employeeId: testEmpId, employeeName: 'موظف تجريبي للسباق' }),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);

    // Both operations must resolve to the EXACT SAME logical attendance session
    expect(res1.id).toBe(res2.id);

    // Exactly one operation created it, the other recognized it as alreadyActive (or both safely merged)
    expect(res1.alreadyActive || res2.alreadyActive).toBe(true);

    // Verify Firestore state has the single active record with checkOutTime == null
    const activeSession = await executeGetActiveAttendance(testEmpId);
    expect(activeSession).not.toBeNull();
    expect(activeSession.id).toBe(res1.id);
    expect(activeSession.checkOutTime).toBeNull();

    // Cleanup
    await firestoreDeleteDocument('attendance', res1.id);
    await firestoreDeleteDocument('employees', testEmpId);
  });

  it('INT-004-02: Active shift recovery from Firestore when UI localStorage is missing', async () => {
    const testEmpId = `emp-rec-${crypto.randomUUID()}`;
    const testAttId = `att-rec-${crypto.randomUUID()}`;
    const checkInTime = new Date().toISOString();

    // Setup active open attendance record directly in Firestore
    await firestoreSetDocument('attendance', testAttId, {
      id: testAttId,
      employeeId: testEmpId,
      employeeName: 'أحمد محمود',
      date: checkInTime.split('T')[0],
      checkInTime,
      checkOutTime: null,
      durationMinutes: null,
    });

    // Client/UI has no local storage data, calls executeGetActiveAttendance
    const recovered = await executeGetActiveAttendance(testEmpId);
    expect(recovered).not.toBeNull();
    expect(recovered.id).toBe(testAttId);
    expect(recovered.employeeId).toBe(testEmpId);
    expect(recovered.checkInTime).toBe(checkInTime);
    expect(recovered.checkOutTime).toBeNull();

    // Attempting a subsequent clock-in returns the recovered session without creating a new document
    const clockInRes = await executeClockIn({ employeeId: testEmpId });
    expect(clockInRes.ok).toBe(true);
    expect(clockInRes.alreadyActive).toBe(true);
    expect(clockInRes.id).toBe(testAttId);

    // Cleanup
    await firestoreDeleteDocument('attendance', testAttId);
  });

  it('INT-004-03: Clock-out successfully populates checkOutTime and durationMinutes >= 0', async () => {
    const testEmpId = `emp-out-${crypto.randomUUID()}`;
    const clockInRes = await executeClockIn({
      employeeId: testEmpId,
      employeeName: 'سارة خالد',
      checkInTime: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour ago
    });

    expect(clockInRes.ok).toBe(true);
    const attId = clockInRes.id;

    // Perform clock-out
    const outRes = await executeClockOut({
      attendanceId: attId,
      checkOutTime: new Date().toISOString(),
    });

    expect(outRes.ok).toBe(true);
    expect(outRes.alreadyClosed).toBe(false);
    expect(outRes.record.checkOutTime).toBeDefined();
    expect(outRes.record.durationMinutes).toBeGreaterThanOrEqual(59);
    expect(outRes.record.durationMinutes).toBeLessThanOrEqual(61);

    // Verify document in Firestore
    const finalDoc = await firestoreGetDocument(`attendance/${attId}`);
    expect(finalDoc.checkOutTime).not.toBeNull();
    expect(finalDoc.durationMinutes).toBe(outRes.record.durationMinutes);

    // No active shift remains in Firestore for this employee
    const activeAfterClose = await executeGetActiveAttendance(testEmpId);
    expect(activeAfterClose).toBeNull();

    // Cleanup
    await firestoreDeleteDocument('attendance', attId);
  });

  it('INT-004-04: Clock-out idempotency on real Firestore document', async () => {
    const testEmpId = `emp-idem-${crypto.randomUUID()}`;
    const clockInRes = await executeClockIn({
      employeeId: testEmpId,
      employeeName: 'علي حسن',
      checkInTime: new Date(Date.now() - 7200 * 1000).toISOString(), // 2 hours ago
    });

    const attId = clockInRes.id;
    const firstCheckOutTime = new Date().toISOString();

    // First clock-out
    const res1 = await executeClockOut({
      attendanceId: attId,
      checkOutTime: firstCheckOutTime,
    });
    expect(res1.ok).toBe(true);
    expect(res1.alreadyClosed).toBe(false);
    const initialDuration = res1.record.durationMinutes;

    // Second clock-out (retry/double-click) with a later timestamp
    const res2 = await executeClockOut({
      attendanceId: attId,
      checkOutTime: new Date(Date.now() + 600000).toISOString(), // 10 minutes later
    });

    expect(res2.ok).toBe(true);
    expect(res2.alreadyClosed).toBe(true);
    // Preserves original checkOutTime and duration without alteration
    expect(res2.record.checkOutTime).toBe(firstCheckOutTime);
    expect(res2.record.durationMinutes).toBe(initialDuration);

    // Cleanup
    await firestoreDeleteDocument('attendance', attId);
  });
});
