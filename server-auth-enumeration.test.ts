import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import {
  timingSafePasswordVerify,
  DUMMY_PBKDF2_HASH,
  sanitizeEmployeeResponse,
  getAuthLimiterOptions,
} from './server-auth';
import {
  createApp,
  hashPassword,
  verifyPassword,
  serverSessions,
  firestoreSetDocument,
  firestoreDeleteDocument,
} from './server';

const isEmulatorActive = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!isEmulatorActive)('AUDIT-009 — Public Employee Enumeration & Authentication Hardening', () => {
  let app: express.Express;
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  const testAdminId = `emp-test-admin-${crypto.randomUUID().slice(0, 8)}`;
  const testAdminEmail = `admin-${crypto.randomUUID().slice(0, 8)}@taiba.local`;
  const testAdminPass = 'AdminSecret@2026';
  let adminSessionToken: string;

  const testCashierId = `emp-test-cashier-${crypto.randomUUID().slice(0, 8)}`;
  const testCashierEmail = `cashier-${crypto.randomUUID().slice(0, 8)}@taiba.local`;
  const testCashierPass = 'CashierSecret@2026';
  let cashierSessionToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as any).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Seed test employees in Firestore / emulator
    await firestoreSetDocument('employees', testAdminId, {
      id: testAdminId,
      name: 'مدير الاختبار',
      email: testAdminEmail,
      passwordHash: hashPassword(testAdminPass),
      role: 'المدير العام',
      type: 'دوام كامل',
      salary: 2500,
      permissions: ['dashboard', 'pos', 'inventory', 'customers', 'suppliers', 'expenses', 'employees', 'settings'],
      createdAt: new Date().toISOString(),
    });

    await firestoreSetDocument('employees', testCashierId, {
      id: testCashierId,
      name: 'كاشير الاختبار',
      email: testCashierEmail,
      passwordHash: hashPassword(testCashierPass),
      role: 'كاشير',
      type: 'نصف دوام',
      salary: 1200,
      permissions: ['pos'],
      createdAt: new Date().toISOString(),
    });

    // Create sessions
    adminSessionToken = `sess_${crypto.randomBytes(32).toString('hex')}`;
    serverSessions.set(adminSessionToken, { employeeId: testAdminId, expiresAt: Date.now() + 86400000 });

    cashierSessionToken = `sess_${crypto.randomBytes(32).toString('hex')}`;
    serverSessions.set(cashierSessionToken, { employeeId: testCashierId, expiresAt: Date.now() + 86400000 });
  });

  afterAll(async () => {
    serverSessions.delete(adminSessionToken);
    serverSessions.delete(cashierSessionToken);
    await firestoreDeleteDocument('employees', testAdminId);
    await firestoreDeleteDocument('employees', testCashierId);

    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  // ── AUDIT-009-S01: Unauthenticated request cannot obtain employee/account list ──
  it('AUDIT-009-S01: Unauthenticated request to /api/auth/employees returns 401 Unauthorized and zero employee data', async () => {
    const res = await fetch(`${baseUrl}/api/auth/employees`, {
      headers: { 'Accept': 'application/json' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.employees).toBeUndefined();
    expect(Array.isArray(body)).toBe(false);
  });

  // ── AUDIT-009-S02: Public authentication/bootstrap endpoints do not expose passwordHash or secrets ──
  it('AUDIT-009-S02: Public authentication and bootstrap responses never expose passwordHash, password, or secrets', async () => {
    // 1. Check /api/has-employees
    const hasEmpRes = await fetch(`${baseUrl}/api/has-employees`);
    expect(hasEmpRes.status).toBe(200);
    const hasEmpBody = await hasEmpRes.json();
    expect(hasEmpBody.passwordHash).toBeUndefined();
    expect(hasEmpBody.password).toBeUndefined();
    expect(hasEmpBody.employees).toBeUndefined();

    // 2. Check successful login response
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testAdminEmail, password: testAdminPass }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.ok).toBe(true);
    expect(loginData.employee).toBeDefined();
    expect(loginData.employee.passwordHash).toBeUndefined();
    expect(loginData.employee.password).toBeUndefined();

    // 3. Test sanitizer directly
    const sanitized = sanitizeEmployeeResponse({
      id: 'emp-1',
      name: 'علي',
      passwordHash: 'secret-hash',
      password: 'plain-password',
      role: 'كاشير',
    });
    expect(sanitized.passwordHash).toBeUndefined();
    expect(sanitized.password).toBeUndefined();
    expect(sanitized.id).toBe('emp-1');
    expect(sanitized.name).toBe('علي');
  });

  // ── AUDIT-009-S03: Identical failure semantics for nonexistent account vs wrong password ──
  it('AUDIT-009-S03: Login with nonexistent identifier returns identical status code and error message as wrong password', async () => {
    // 1. Nonexistent account
    const nonExistentRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'nonexistent-user-9999@taiba.local', password: 'SomePassword123' }),
    });

    // 2. Existing account with incorrect password
    const wrongPasswordRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testAdminEmail, password: 'WrongPassword456' }),
    });

    expect(nonExistentRes.status).toBe(401);
    expect(wrongPasswordRes.status).toBe(401);

    const nonExistentBody = await nonExistentRes.json();
    const wrongPasswordBody = await wrongPasswordRes.json();

    expect(nonExistentBody.error).toBe('اسم المستخدم أو كلمة المرور غير صحيحة');
    expect(wrongPasswordBody.error).toBe('اسم المستخدم أو كلمة المرور غير صحيحة');
    expect(nonExistentBody).toEqual(wrongPasswordBody);
  });

  // ── AUDIT-009-S04: Valid employee can log in successfully via employeeId or email ──
  it('AUDIT-009-S04: Valid employee can log in successfully using employee ID or email address', async () => {
    // Login via employee ID
    const loginById = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testAdminId, password: testAdminPass }),
    });
    expect(loginById.status).toBe(200);
    const dataById = await loginById.json();
    expect(dataById.ok).toBe(true);
    expect(dataById.employee.id).toBe(testAdminId);

    // Verify session cookie was set
    const setCookie = loginById.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('taiba_session=sess_');
    expect(setCookie).toContain('HttpOnly');

    // Login via email address
    const loginByEmail = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testAdminEmail, password: testAdminPass }),
    });
    expect(loginByEmail.status).toBe(200);
    const dataByEmail = await loginByEmail.json();
    expect(dataByEmail.ok).toBe(true);
    expect(dataByEmail.employee.id).toBe(testAdminId);

    // Backward compatibility: passing employeeId field
    const loginLegacy = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: testAdminId, password: testAdminPass }),
    });
    expect(loginLegacy.status).toBe(200);
    expect((await loginLegacy.json()).ok).toBe(true);
  });

  // ── AUDIT-009-S05: Authorized employee management flow ──
  it('AUDIT-009-S05: Authenticated admin can access employee list, while non-admin gets 403', async () => {
    // Admin request
    const adminRes = await fetch(`${baseUrl}/api/auth/employees`, {
      headers: {
        'Authorization': `Bearer ${adminSessionToken}`,
      },
    });
    expect(adminRes.status).toBe(200);
    const adminData = await adminRes.json();
    expect(Array.isArray(adminData)).toBe(true);
    expect(adminData.length).toBeGreaterThanOrEqual(2);

    // Ensure none of the returned objects contain password or hash
    for (const emp of adminData) {
      expect(emp.passwordHash).toBeUndefined();
      expect(emp.password).toBeUndefined();
    }

    // Cashier request (lacks admin permission)
    const cashierRes = await fetch(`${baseUrl}/api/auth/employees`, {
      headers: {
        'Authorization': `Bearer ${cashierSessionToken}`,
      },
    });
    expect(cashierRes.status).toBe(403);
  });

  // ── AUDIT-009-S06: Unauthenticated probing of candidate replacement endpoints returns 401 or 404 ──
  it('AUDIT-009-S06: Unauthenticated attacker probing candidate endpoints cannot enumerate employees', async () => {
    const endpoints = [
      '/api/auth/employees',
      '/api/auth/users',
      '/api/public/employees',
      '/api/employees',
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      // Either 401 (blocked by auth middleware) or 404 (endpoint does not exist)
      expect([401, 404]).toContain(res.status);
      const text = await res.text();
      // Must not contain employee records
      expect(text).not.toContain(testAdminEmail);
      expect(text).not.toContain(testCashierEmail);
    }
  });

  // ── AUDIT-009-S07: /api/has-employees returns minimum bootstrap state ──
  it('AUDIT-009-S07: /api/has-employees returns only boolean status without counts or employee details', async () => {
    const res = await fetch(`${baseUrl}/api/has-employees`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.hasEmployees).toBe('boolean');
    expect(Object.keys(body)).toEqual(['hasEmployees']);
    expect(body.count).toBeUndefined();
    expect(body.employees).toBeUndefined();
    expect(body.users).toBeUndefined();
  });

  // ── AUDIT-009-T01: Existing-ID wrong-password and nonexistent-ID paths both execute equivalent PBKDF2 verification ──
  it('AUDIT-009-T01: Existing-ID wrong-password and nonexistent-ID paths both execute equivalent PBKDF2 verification', () => {
    let existingCallCount = 0;
    let nonexistentCallCount = 0;
    let existingHash = '';
    let nonexistentHash = '';

    const verifyExisting = (pw: string, hash: string) => {
      existingCallCount++;
      existingHash = hash;
      return false;
    };

    const verifyNonexistent = (pw: string, hash: string) => {
      nonexistentCallCount++;
      nonexistentHash = hash;
      return false;
    };

    const realHash = hashPassword('RealPassword123!');
    const resExisting = timingSafePasswordVerify('wrong-pass', realHash, verifyExisting);
    const resNonexistent = timingSafePasswordVerify('wrong-pass', null, verifyNonexistent);

    expect(resExisting).toBe(false);
    expect(resNonexistent).toBe(false);
    expect(existingCallCount).toBe(1);
    expect(nonexistentCallCount).toBe(1);

    // Both hashes use pbkdf2 with sha512 and 100,000 iterations
    const existingParts = existingHash.split(':');
    const nonexistentParts = nonexistentHash.split(':');
    expect(existingParts[0]).toBe('pbkdf2');
    expect(nonexistentParts[0]).toBe('pbkdf2');
    expect(existingParts[1]).toBe('sha512');
    expect(nonexistentParts[1]).toBe('sha512');
    expect(existingParts[2]).toBe('100000');
    expect(nonexistentParts[2]).toBe('100000');
    expect(existingParts[3].length).toBe(32); // 16-byte hex salt
    expect(nonexistentParts[3].length).toBe(32);
    expect(existingParts[4].length).toBe(128); // 64-byte hex derived key
    expect(nonexistentParts[4].length).toBe(128);
  });

  // ── AUDIT-009-T02: Existing-email wrong-password and nonexistent-email paths both execute equivalent PBKDF2 verification ──
  it('AUDIT-009-T02: Existing-email wrong-password and nonexistent-email paths both execute equivalent PBKDF2 verification', () => {
    let callCount = 0;
    const dummyVerify = (pw: string, hash: string) => {
      callCount++;
      return false;
    };

    const res = timingSafePasswordVerify('some-wrong-password', undefined, dummyVerify);
    expect(res).toBe(false);
    expect(callCount).toBe(1);

    // Verify real cryptographic execution of dummy verification
    const realVerifyResult = verifyPassword('some-wrong-password', DUMMY_PBKDF2_HASH);
    expect(realVerifyResult).toBe(false);
  });

  // ── AUDIT-009-T03: Failure response status and body remain identical across all permutations ──
  it('AUDIT-009-T03: Failure response status and body remain identical across existing/nonexistent IDs and emails', async () => {
    const permutations = [
      { label: 'existing-id', identifier: testAdminId, password: 'WrongPassword123!' },
      { label: 'nonexistent-id', identifier: 'emp-nonexistent-999', password: 'WrongPassword123!' },
      { label: 'existing-email', identifier: testAdminEmail, password: 'WrongPassword123!' },
      { label: 'nonexistent-email', identifier: 'nonexistent.user999@taiba.local', password: 'WrongPassword123!' },
    ];

    for (const p of permutations) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: p.identifier, password: p.password }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      expect(res.headers.get('content-type')).toContain('application/json');
    }
  });

  // ── AUDIT-009-T04: Repeated randomized timing measurements do not show a consistent account-existence timing oracle ──
  it('AUDIT-009-T04: Repeated randomized timing measurements show no account-existence timing oracle', async () => {
    const incorrectPassword = 'MismatchPassword123!';

    // Warm-up
    for (let i = 0; i < 3; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: testAdminId, password: incorrectPassword }),
      });
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'emp-nonexistent-warmup', password: incorrectPassword }),
      });
    }

    const groups: Record<string, { identifier: string; samples: number[] }> = {
      emp_id_existing: { identifier: testAdminId, samples: [] },
      emp_id_nonexistent: { identifier: 'emp-nonexistent-trial', samples: [] },
      email_existing: { identifier: testAdminEmail, samples: [] },
      email_nonexistent: { identifier: 'nonexistent.trial@taiba.local', samples: [] },
    };

    const queue: string[] = [];
    const keys = Object.keys(groups);
    for (const k of keys) {
      for (let i = 0; i < 8; i++) queue.push(k);
    }
    // Shuffle
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    for (const key of queue) {
      const start = performance.now();
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: groups[key].identifier, password: incorrectPassword }),
      });
      const duration = performance.now() - start;
      expect(res.status).toBe(401);
      groups[key].samples.push(duration);
    }

    const calcMedian = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const empExistingMed = calcMedian(groups.emp_id_existing.samples);
    const empNonexistentMed = calcMedian(groups.emp_id_nonexistent.samples);
    const empDelta = Math.abs(empNonexistentMed - empExistingMed);

    const emailExistingMed = calcMedian(groups.email_existing.samples);
    const emailNonexistentMed = calcMedian(groups.email_nonexistent.samples);
    const emailDelta = Math.abs(emailNonexistentMed - emailExistingMed);

    expect(empDelta).toBeLessThan(35);
    expect(emailDelta).toBeLessThan(35);
  }, 30000);

  // ── AUDIT-009-T05: Timing mitigation does not weaken login rate limiting in production ──
  it('AUDIT-009-T05: Timing mitigation does not weaken login rate limiting in production', () => {
    const prodOptions = getAuthLimiterOptions(true);
    expect(prodOptions.max).toBe(10);
    expect(prodOptions.windowMs).toBe(15 * 60 * 1000);

    const testOptions = getAuthLimiterOptions(false);
    expect(testOptions.max).toBe(10000);
  });

  // ── AUDIT-009-T06: Valid login remains functional for both employee ID and email ──
  it('AUDIT-009-T06: Valid login remains functional for both employee ID and email', async () => {
    // 1. Login via employee ID
    const resId = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testAdminId, password: testAdminPass }),
    });
    expect(resId.status).toBe(200);
    const dataId = await resId.json();
    expect(dataId.ok).toBe(true);
    expect(dataId.employee.id).toBe(testAdminId);
    expect(dataId.employee.passwordHash).toBeUndefined();
    expect(resId.headers.get('set-cookie')).toBeDefined();

    // 2. Login via email
    const resEmail = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testCashierEmail, password: testCashierPass }),
    });
    expect(resEmail.status).toBe(200);
    const dataEmail = await resEmail.json();
    expect(dataEmail.ok).toBe(true);
    expect(dataEmail.employee.id).toBe(testCashierId);
    expect(dataEmail.employee.passwordHash).toBeUndefined();
    expect(resEmail.headers.get('set-cookie')).toBeDefined();
  });

  // ── AUDIT-009-S09: Session verification and logout remain intact ──
  it('AUDIT-009-S09: /api/auth/me verifies active session and /api/auth/logout invalidates session cleanly', async () => {
    // Verify session
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${adminSessionToken}`,
      },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.ok).toBe(true);
    expect(meData.employee.id).toBe(testAdminId);
    expect(meData.employee.passwordHash).toBeUndefined();

    // Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminSessionToken}`,
      },
    });
    expect(logoutRes.status).toBe(200);
    expect(serverSessions.has(adminSessionToken)).toBe(false);

    // After logout, session is rejected
    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${adminSessionToken}`,
      },
    });
    expect(meAfterLogout.status).toBe(401);
  });
});
