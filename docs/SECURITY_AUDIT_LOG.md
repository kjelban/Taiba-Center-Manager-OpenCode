# Security Audit Activity Log — Taiba Center Manager

This log tracks chronologically all remediation, validation, and status updates for security findings in accordance with canonical registry standards.

---

### Entry: 2026-08-20 — AUDIT-004, AUDIT-005, AUDIT-013, AUDIT-014, AUDIT-016
- **AUDIT-005, AUDIT-013, AUDIT-014**: Financial mutations protected with Firestore OCC transactions, server-side authoritative pricing, and SHA-256 idempotency fingerprinting. Verified closed under `2567e74`.
- **AUDIT-004**: Attendance session tracking reconciled with server state and cross-tab BroadcastChannel sync. Verified closed under `2567e74` and `0a248d3`.
- **AUDIT-016**: Credential exposure audit confirmed no session tokens or credentials leaked to browser localStorage or raw JSON bodies. Verified closed under `afad7bb`.

---

### Entry: 2026-08-21 — AUDIT-012, AUDIT-015
- **AUDIT-012**: Backup restore engine re-engineered with durable pre-restore snapshot storage, transactional write batching, post-restore verification with compensating automated rollback, and startup crash recovery. Verified closed under `8fd1a22` and `4d852ba`.
- **AUDIT-015**: Dependency vulnerability reachability triage executed. High-risk supply chain advisories addressed via safe package overrides in `package.json`. Verified closed under `7f0b741`.

---

### Entry: 2026-09-10 (Earlier) — AUDIT-007
- **AUDIT-007**: Unbounded Firestore reads mitigated with strict collection query policies, max page limits (100 docs), base64url cursor pagination, date-range bounding, and tie-breaking by document ID. Full database backup exports isolated to dedicated administrative pipeline. Verified closed under `3ccb734`.

---

### Entry: 2026-09-10 (Current) — AUDIT-010: CSP script-src Hardening
- **Finding ID**: `AUDIT-010`
- **Action**: Hardened Helmet Content-Security-Policy `script-src` directive in production.
- **Root Cause**: Helmet configuration in `server.ts` statically provided `script-src: ["'self'", "'unsafe-inline'", "'unsafe-eval'"]`.
- **Investigation Results**:
  - Full codebase inspection found 0 inline `<script>` tags in `index.html` and `dist/index.html`.
  - 0 inline JavaScript event attributes (`onclick`, `onload`, etc.).
  - 0 `javascript:` pseudo-protocol URLs.
  - 0 `eval()` or `new Function()` invocations in application source.
  - Production build outputs only static ES module bundles loaded via same-origin `<script type="module" src="...">`.
  - Nonce migration is not required since production uses pure external script bundles.
- **Remediation**:
  - Implemented `getCspDirectives(isProduction)` in `server-auth.ts`.
  - Production CSP sets `scriptSrc: ["'self'"]`.
  - Development CSP sets `scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"]` strictly scoped to `NODE_ENV !== 'production'`.
  - Configured `createHelmetMiddleware(isProduction)` in `server.ts` to enforce the strict policy in production.
- **Verification Evidence**:
  - `server-csp.test.ts`: 9/9 unit & live HTTP tests passed (`AUDIT-010-S01` .. `AUDIT-010-S09`).
  - Runtime verification with live production HTTP server (`dist/server.cjs`) confirmed header:
    `Content-Security-Policy: default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;font-src 'self' https://fonts.gstatic.com;img-src 'self' data: blob:;connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com;base-uri 'self';form-action 'self';frame-ancestors 'self';object-src 'none';script-src-attr 'none';upgrade-insecure-requests`
  - Zero presence of `'unsafe-inline'` or `'unsafe-eval'` in production `script-src`.
  - `npx tsc --noEmit`: Clean exit code 0.
  - `npm test`: 109 unit tests passed.
  - Firestore Emulator integration run: All 153 tests passed (Attendance, Sales, Backup/Restore, Query Pagination, CSP).
  - Production build: `npm run build` succeeded.
- **Status Change**: **AUDIT-010** -> **VERIFIED CLOSED**.

---

### Entry: 2026-09-10 (Current) — AUDIT-009: Public Employee Enumeration Endpoint & Login Security
- **Finding ID**: `AUDIT-009`
- **Action**: Completely eradicated public employee enumeration and account discovery across client and server.
- **Root Cause**:
  - `GET /api/auth/employees` was previously unauthenticated and consumed by `UserLogin.tsx` to populate an employee selection `<select>` dropdown.
  - Non-existent account logins failed prematurely without running PBKDF2 hash verification, exposing a timing disparity (~70ms) versus accounts with bad passwords.
- **Investigation Results**:
  - Identified all call sites of `/api/auth/employees`.
  - Audited all API endpoints to confirm zero alternative public routes leak employee lists or identity metadata.
  - Confirmed `/api/has-employees` is solely used for bootstrap detection and returns only `{ hasEmployees: boolean }`.
- **Remediation**:
  - **Login UX Redesign (`UserLogin.tsx`)**: Removed unauthenticated fetch of employee list and selection dropdown. Added unified identifier input (`معرف الموظف أو البريد الإلكتروني`) allowing login via Employee ID or Email.
  - **Endpoint Protection (`server.ts`)**: Hardened `GET /api/auth/employees` with `requireFirebaseAuth` and `requireAdmin`. Unauthenticated requests yield 401; non-admin users yield 403.
  - **Timing Discrepancy Elimination (`server-auth.ts`)**: Implemented `timingSafePasswordVerify()` with `DUMMY_PBKDF2_HASH` (100,000 rounds, sha512) ensuring non-existent accounts take equivalent processing time to existent accounts with wrong passwords.
  - **Error Unification**: Standardized HTTP 401 response and identical Arabic message (`"اسم المستخدم أو كلمة المرور غير صحيحة"`) for both invalid username and invalid password.
  - **Response Minimization**: Added `sanitizeEmployeeResponse()` to strip `password` and `passwordHash` before returning employee records across all server responses.
- **Verification Evidence**:
  - `server-auth.test.ts`: 5 new unit tests (`AUDIT-009-U01`..`U05`) passing (75 total auth unit tests).
  - `server-auth-enumeration.test.ts`: 9 security regression tests (`AUDIT-009-S01`..`AUDIT-009-S09`) passing against Firestore emulator.
  - Live HTTP runtime verification against production server bundle (`dist/server.cjs`) confirming:
    - `GET /api/auth/employees` (no session) = 401 Unauthorized (`{"error":"Missing or invalid authorization session"}`)
    - `POST /api/auth/login` (non-existent account) = 401 Unauthorized (`{"error":"اسم المستخدم أو كلمة المرور غير صحيحة"}`)
    - `POST /api/auth/login` (existent account + wrong password) = 401 Unauthorized (`{"error":"اسم المستخدم أو كلمة المرور غير صحيحة"}`)
    - `POST /api/auth/login` (valid credentials) = 200 OK + session cookie + sanitized employee object (no passwordHash).
    - `GET /api/auth/employees` (admin cookie) = 200 OK + sanitized employee list.
    - `GET /api/has-employees` = 200 OK (`{"hasEmployees": true}`).
  - `npx tsc --noEmit`: Clean exit code 0.
  - `npm test`: 114 unit tests passed.
  - Firestore Emulator integration run: All 9 test files / 167 tests passed with zero failures.
  - Production build: `npm run build` succeeded cleanly.
- **Status Change**: **AUDIT-009** -> **INITIAL CLOSURE RECORDED** (Pending detailed timing verification pass).

---

### Entry: 2026-09-29 (Current) — AUDIT-009: Verification & Correction Pass (Login Timing Enumeration Resistance)
- **Finding ID**: `AUDIT-009`
- **Action**: Addressed runtime timing discrepancy between existent and nonexistent accounts identified during post-closure audit review.
- **Root Cause & Structural Gap**:
  - The initial runtime verification noted a single-sample discrepancy (350ms vs 156ms).
  - Code analysis revealed that `firestoreFindEmployeeByIdentifier()` was falling through to execute an email structured query (`documents:runQuery`) when an employee ID lookup failed, introducing an extra Firestore network roundtrip for nonexistent IDs.
- **Remediation**:
  - **Code Path Isolation**: Segregated email queries (containing `@`, querying via structuredQuery with `IN` filter) from employee ID lookups (pure document GET). Both existent and nonexistent identifiers of the same type now execute exactly one database operation.
  - **Cryptographic Password-Verification Parity**: `timingSafePasswordVerify()` ensures 100,000 rounds of PBKDF2 with SHA-512 and identical key lengths regardless of account existence.
  - **Rate Limiting Hardening**: Added `getAuthLimiterOptions()` enforcing strict 10 attempts per 15-minute window in production.
- **Statistical Benchmark Results (50 Samples / Condition, 200 Total Trials)**:
  - Employee ID: Existing (Median: 94.62 ms, Mean: 96.11 ms, P95: 113.68 ms) vs Nonexistent (Median: 93.99 ms, Mean: 94.55 ms, P95: 109.84 ms) -> Mean Diff: -1.56 ms, Median Diff: -0.63 ms, Mean Ratio: 0.984.
  - Email: Existing (Median: 94.49 ms, Mean: 97.83 ms, P95: 112.56 ms) vs Nonexistent (Median: 94.39 ms, Mean: 94.95 ms, P95: 110.14 ms) -> Mean Diff: -2.88 ms, Median Diff: -0.10 ms, Mean Ratio: 0.971.
  - **TIMING PORTION VERIFIED**: Equivalent password-verification work with no practically useful account-existence timing discrepancy observed under the tested conditions.
- **Verification Evidence**:
  - Unit tests: `server-auth.test.ts` (76/76 passing, including `AUDIT-009-U01`..`U06`).
  - Integration suite: `server-auth-enumeration.test.ts` expanded with `AUDIT-009-T01` through `AUDIT-009-T06` (14/14 passing).
  - `npx tsc --noEmit`: Clean exit code 0.
  - Full sequential emulator run: 9/9 test suites passed (173/173 tests, 0 failures).
  - Production build: `npm run build` succeeded cleanly.
- **Status Change**: **AUDIT-009** confirmed **VERIFIED CLOSED**.
- **Canonical Remaining Findings**: **NONE**.
- **Overall Security Audit Status**: **ALL CANONICAL SECURITY AUDIT FINDINGS VERIFIED CLOSED**.


