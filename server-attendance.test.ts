import { describe, it, expect } from 'vitest';

// Pure logic helpers representing Attendance & Session State Decisions

export interface StoredSessionInfo {
  employeeId: string;
  sessionId: string;
  lastActivity: string;
}

export function decideSessionRestoration(params: {
  storedUser: { id: string; name: string } | null;
  storedSession: { id: string; checkInTime: string; checkOutTime: string | null } | null;
  serverActiveSession: { id: string; checkInTime: string; checkOutTime: string | null } | null;
  elapsedMsSinceLastActivity: number;
}): {
  userRestored: boolean;
  activeSession: { id: string; checkInTime: string; checkOutTime: string | null } | null;
  recoveredFromServer: boolean;
} {
  const { storedUser, storedSession, serverActiveSession } = params;
  if (!storedUser) {
    return { userRestored: false, activeSession: null, recoveredFromServer: false };
  }

  // Active session check from local cache
  if (storedSession && storedSession.id && storedSession.checkInTime && !storedSession.checkOutTime) {
    return { userRestored: true, activeSession: storedSession, recoveredFromServer: false };
  }

  // Authoritative fallback from server
  if (serverActiveSession && serverActiveSession.id && !serverActiveSession.checkOutTime) {
    return { userRestored: true, activeSession: serverActiveSession, recoveredFromServer: true };
  }

  return { userRestored: true, activeSession: null, recoveredFromServer: false };
}

export function calculateSafeDurationMinutes(checkInTime: string, checkOutTime: string, clientDuration?: number): number {
  if (typeof clientDuration === 'number' && Number.isFinite(clientDuration) && clientDuration >= 0) {
    return clientDuration;
  }
  const tIn = new Date(checkInTime).getTime();
  const tOut = new Date(checkOutTime).getTime();
  if (Number.isFinite(tIn) && Number.isFinite(tOut) && tOut >= tIn) {
    return Math.max(0, Math.round((tOut - tIn) / 60000));
  }
  return 0;
}

export function decideClockOutAction(currentDoc: {
  id: string;
  checkInTime: string;
  checkOutTime: string | null;
  durationMinutes: number | null;
}, requestCheckOutTime: string): {
  action: 'UPDATE' | 'NOOP_ALREADY_CLOSED';
  resultingDoc: any;
} {
  if (currentDoc.checkOutTime) {
    return { action: 'NOOP_ALREADY_CLOSED', resultingDoc: currentDoc };
  }
  const duration = calculateSafeDurationMinutes(currentDoc.checkInTime, requestCheckOutTime);
  return {
    action: 'UPDATE',
    resultingDoc: {
      ...currentDoc,
      checkOutTime: requestCheckOutTime,
      durationMinutes: duration,
    },
  };
}

describe('AUDIT-004 (UNIT): Attendance & Session State Integrity', () => {
  it('ATT-004-U01: Preserves active session across page refreshes regardless of elapsed time', () => {
    const res = decideSessionRestoration({
      storedUser: { id: 'emp-1', name: 'أحمد' },
      storedSession: { id: 'att-1', checkInTime: '2026-08-21T08:00:00Z', checkOutTime: null },
      serverActiveSession: null,
      elapsedMsSinceLastActivity: 3600 * 1000, // 1 hour elapsed (way past 30s)
    });

    expect(res.userRestored).toBe(true);
    expect(res.activeSession?.id).toBe('att-1');
    expect(res.recoveredFromServer).toBe(false);
  });

  it('ATT-004-U02: Recovers active attendance session from server if localStorage was cleared', () => {
    const res = decideSessionRestoration({
      storedUser: { id: 'emp-2', name: 'سارة' },
      storedSession: null, // Local storage cleared
      serverActiveSession: { id: 'att-server-99', checkInTime: '2026-08-21T09:00:00Z', checkOutTime: null },
      elapsedMsSinceLastActivity: 50000,
    });

    expect(res.userRestored).toBe(true);
    expect(res.activeSession?.id).toBe('att-server-99');
    expect(res.recoveredFromServer).toBe(true);
  });

  it('ATT-004-U03: Stale or closed local session does not block authoritative recovery', () => {
    const res = decideSessionRestoration({
      storedUser: { id: 'emp-3', name: 'محمود' },
      storedSession: { id: 'att-old', checkInTime: '2026-08-20T08:00:00Z', checkOutTime: '2026-08-20T16:00:00Z' }, // Closed session
      serverActiveSession: { id: 'att-fresh', checkInTime: '2026-08-21T08:00:00Z', checkOutTime: null },
      elapsedMsSinceLastActivity: 10000,
    });

    expect(res.userRestored).toBe(true);
    expect(res.activeSession?.id).toBe('att-fresh');
    expect(res.recoveredFromServer).toBe(true);
  });

  it('ATT-004-U04: Safe duration calculation guarantees non-negative minutes and handles clock skew', () => {
    // Normal 2-hour shift
    expect(calculateSafeDurationMinutes('2026-08-21T08:00:00Z', '2026-08-21T10:00:00Z')).toBe(120);

    // Sub-minute shift
    expect(calculateSafeDurationMinutes('2026-08-21T08:00:00Z', '2026-08-21T08:00:20Z')).toBe(0);

    // Negative clock skew (client time behind checkInTime)
    expect(calculateSafeDurationMinutes('2026-08-21T08:00:00Z', '2026-08-21T07:55:00Z')).toBe(0);

    // Invalid date inputs
    expect(calculateSafeDurationMinutes('invalid', '2026-08-21T08:00:00Z')).toBe(0);
  });

  it('ATT-004-U05: Clock-out idempotency prevents duplicate modification of already closed shift', () => {
    const initialDoc = {
      id: 'att-100',
      checkInTime: '2026-08-21T08:00:00Z',
      checkOutTime: null,
      durationMinutes: null,
    };

    // First clock-out
    const firstOut = decideClockOutAction(initialDoc, '2026-08-21T16:00:00Z');
    expect(firstOut.action).toBe('UPDATE');
    expect(firstOut.resultingDoc.checkOutTime).toBe('2026-08-21T16:00:00Z');
    expect(firstOut.resultingDoc.durationMinutes).toBe(480);

    // Second clock-out (duplicate retry)
    const secondOut = decideClockOutAction(firstOut.resultingDoc, '2026-08-21T16:05:00Z');
    expect(secondOut.action).toBe('NOOP_ALREADY_CLOSED');
    expect(secondOut.resultingDoc.checkOutTime).toBe('2026-08-21T16:00:00Z');
    expect(secondOut.resultingDoc.durationMinutes).toBe(480);
  });
});
