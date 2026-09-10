import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import {
  timingSafePasswordVerify,
  DUMMY_PBKDF2_HASH,
  sanitizeEmployeeResponse,
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

  // ── AUDIT-009-S08: Constant-time PBKDF2 dummy verification executes on missing account ──
  it('AUDIT-009-S08: timingSafePasswordVerify executes dummy PBKDF2 verification when account does not exist', () => {
    let dummyVerifyCalled = false;
    let verifiedPassword = '';
    let verifiedHash = '';

    const mockVerify = (pw: string, hash: string) => {
      dummyVerifyCalled = true;
      verifiedPassword = pw;
      verifiedHash = hash;
      return false;
    };

    const result = timingSafePasswordVerify('user-input-pass', undefined, mockVerify);
    expect(result).toBe(false);
    expect(dummyVerifyCalled).toBe(true);
    expect(verifiedPassword).toBe('user-input-pass');
    expect(verifiedHash).toBe(DUMMY_PBKDF2_HASH);

    // Verify DUMMY_PBKDF2_HASH is a syntactically valid PBKDF2 structure with 100,000 rounds
    const parts = DUMMY_PBKDF2_HASH.split(':');
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('sha512');
    expect(parseInt(parts[2], 10)).toBe(100000);

    // Run real verifyPassword against dummy hash to ensure it executes without throw
    const realVerifyResult = verifyPassword('any-password', DUMMY_PBKDF2_HASH);
    expect(realVerifyResult).toBe(false);
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
