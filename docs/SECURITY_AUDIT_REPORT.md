# Security Audit Report — Taiba Center Manager

## Executive Summary
This document provides the canonical registry and status of all security audit findings for the Taiba Center Manager platform. Each finding is tracked with a permanent canonical ID, formal impact analysis, verification gates, and lifecycle status.

---

## Canonical Audit Findings Registry

| Finding ID | Severity | Category | Status | Commit / Milestone | Description |
|---|---|---|---|---|---|
| **AUDIT-004** | HIGH | Auth & Session Integrity | **VERIFIED CLOSED** | `2567e74`, `0a248d3` | Clock-in / clock-out session reconciliation, multi-tab sync, and server authority. |
| **AUDIT-005** | HIGH | Financial / Data Integrity | **VERIFIED CLOSED** | `8d32d01` | Race conditions & OCC concurrency in stock deduction & customer debt balance. |
| **AUDIT-007** | MEDIUM | Performance / Scalability | **VERIFIED CLOSED** | `3ccb734` | Unbounded Firestore collection reads bounded via cursor pagination & date ranges. |
| **AUDIT-009** | MEDIUM | Information Disclosure | **VERIFIED CLOSED** | `Current HEAD` | Public Employee Enumeration Endpoint eliminated: unauthenticated listing removed, login redesigned with identifier, constant-time authentication, server response minimization. |
| **AUDIT-010** | MEDIUM | Web Security / CSP | **VERIFIED CLOSED** | `f253b25` | Content Security Policy script-src hardening: removed `'unsafe-inline'` and `'unsafe-eval'` in production. |
| **AUDIT-012** | CRITICAL | Disaster Recovery / Integrity | **VERIFIED CLOSED** | `8fd1a22`, `c8d20f9` | Backup restore transaction safety, exact replacement, durable journal & crash rollback. |
| **AUDIT-013** | HIGH | Financial Integrity | **VERIFIED CLOSED** | `8d32d01` | Server-authoritative price recalculation overriding untrusted client totals. |
| **AUDIT-014** | HIGH | Financial Integrity | **VERIFIED CLOSED** | `8d32d01` | Distributed idempotency protection preventing duplicate transaction submission. |
| **AUDIT-015** | MEDIUM | Supply Chain / Dependencies | **VERIFIED CLOSED** | `5a472c1` | Dependency vulnerability reachability triage and safe package overrides. |
| **AUDIT-016** | HIGH | Credential Exposure | **VERIFIED CLOSED** | `afad7bb` | Verification that raw session credentials and bearer tokens are not exposed to browser storage. |

---

## Deep Dive: AUDIT-010 — CSP script-src Hardening

### 1. Root Cause
In `server.ts`, Helmet's `contentSecurityPolicy` directives configured `scriptSrc` unconditionally as:
```typescript
scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
```
This allowed arbitrary inline script injection and dynamic code execution via `eval()`, significantly undermining browser-side XSS defenses in production.

### 2. Resolution Strategy
1. **Source Code & Dependency Inspection**:
   - Comprehensive audit of `index.html`, `dist/index.html`, source TypeScript (`*.ts`, `*.tsx`), and production bundles (`dist/assets/*.js`).
   - Verified zero occurrences of inline `<script>` tags, inline event handler attributes (`onclick`, etc.), `javascript:` pseudo-protocols, or dynamic `eval()` / `new Function()` execution required by application code.
   - Nonce migration was evaluated and deemed **unnecessary** because all production scripts are statically bundled same-origin assets (`/assets/*.js`).
2. **Environment Separation**:
   - Implemented `getCspDirectives(isProduction: boolean)` in `server-auth.ts`.
   - **Production CSP**: `script-src 'self'` strictly, completely omitting `'unsafe-inline'` and `'unsafe-eval'`.
   - **Development CSP**: Permits `'unsafe-inline'` and `'unsafe-eval'` solely to support Vite HMR and development server tooling.
   - `createHelmetMiddleware(isProduction)` in `server.ts` defaults to production mode when `process.env.NODE_ENV === 'production'`.
3. **Preservation of Legitimate Resources**:
   - `connect-src` maintains essential connections to Firebase and Google APIs.
   - `font-src` and `style-src` maintain Google Fonts connectivity.
   - `img-src` allows data URIs and blob URIs for barcodes, receipts, and photo rendering.

### 3. Verification Gates
- **Automated Tests**: Added `server-csp.test.ts` covering 9 discrete security specifications (`AUDIT-010-S01` through `AUDIT-010-S09`).
- **Live HTTP Runtime Verification**: Executed live HTTP request against compiled production server (`dist/server.cjs`) verifying the exact header `Content-Security-Policy: script-src 'self'` without `'unsafe-inline'` or `'unsafe-eval'`.
- **Regressions**: All 153 unit and emulator integration tests passing without error.

---

## Deep Dive: AUDIT-009 — Public Employee Enumeration Endpoint & Login Security

### 1. Root Cause
Historically, `GET /api/auth/employees` was completely unauthenticated and served as a data source for the frontend `UserLogin.tsx` component to populate an HTML dropdown selector containing all employee accounts. Any unauthenticated network client could fetch this endpoint to discover employee names, IDs, emails, roles, and administrative data. Furthermore, `POST /api/auth/login` historically terminated early if an identifier did not exist, creating a measurable execution timing disparity (~70ms) between existent and non-existent accounts due to PBKDF2 calculation on existent accounts.

### 2. Resolution Strategy
1. **Frontend Authentication Redesign (`UserLogin.tsx`)**:
   - Completely excised unauthenticated calls to `/api/auth/employees` and eliminated the account selection dropdown.
   - Designed a secure identifier input field accepting either Employee ID (`emp-...`) or corporate Email address.
   - Initial system state check queries `/api/has-employees` which returns strictly a minimal boolean `{ hasEmployees: true/false }` with zero identity leakage.
2. **Access Control on `/api/auth/employees`**:
   - Protected the endpoint with both `requireFirebaseAuth` and `requireAdmin`. Unauthenticated requests receive HTTP 401 Unauthorized; non-admin users receive HTTP 403 Forbidden.
   - Zero alternative or renamed public enumeration endpoints exist across the entire API surface.
3. **Constant-Time Login & Error Unification (`POST /api/auth/login`)**:
   - Implemented `timingSafePasswordVerify()` in `server-auth.ts`: when an account or password hash does not exist, a pre-computed dummy PBKDF2 verification (100,000 iterations, sha512) is executed against `DUMMY_PBKDF2_HASH`.
   - Unified authentication failure semantics: both non-existent accounts and incorrect passwords return identical HTTP 401 Unauthorized status with the localized generic message `"اسم المستخدم أو كلمة المرور غير صحيحة"`.
4. **Server-Side Response Data Minimization**:
   - Implemented `sanitizeEmployeeResponse()` in `server-auth.ts`, ensuring `password` and `passwordHash` are stripped before returning any employee record across all authentication, profile, or administrative endpoints.

### 3. Verification Gates & Timing Parity Adjudication
- **Unit Tests**: `server-auth.test.ts` (`AUDIT-009-U01` through `AUDIT-009-U06`) verifying timing mitigation, dummy PBKDF2 calculation (100k rounds, sha512), sanitized payloads, credential stripping, and production rate limiting configuration.
- **Timing Discrepancy Investigation & Code Path Isolation**:
  - Initial verification noted a single sample variance (350ms vs 156ms). Structural code path analysis revealed that nonexistent employee IDs previously fell through to an unneeded email structured query (`documents:runQuery`), introducing a second Firestore network roundtrip.
  - Remediated by strictly isolating email lookups (containing `@`, using a single structured query) from employee document ID lookups (using direct document GET only). Both existent and nonexistent identifiers of the same type now follow structurally identical single-operation database paths.
- **Statistical Timing Verification (50 Samples / Condition, 200 Total Trials)**:
  - Conducted 200 randomized, interleaved HTTP authentication failure requests across 4 independent test groups following warm-up:
    1. **Employee ID (Existing Account)**: n=50, Median = 94.62 ms, Mean = 96.11 ms, P95 = 113.68 ms, StdDev = 9.47 ms
    2. **Employee ID (Nonexistent Account)**: n=50, Median = 93.99 ms, Mean = 94.55 ms, P95 = 109.84 ms, StdDev = 6.87 ms
       - **Mean Difference**: -1.56 ms, **Median Difference**: -0.63 ms, **Mean Ratio**: 0.984
    3. **Email (Existing Account)**: n=50, Median = 94.49 ms, Mean = 97.83 ms, P95 = 112.56 ms, StdDev = 17.58 ms
    4. **Email (Nonexistent Account)**: n=50, Median = 94.39 ms, Mean = 94.95 ms, P95 = 110.14 ms, StdDev = 7.43 ms
       - **Mean Difference**: -2.88 ms, **Median Difference**: -0.10 ms, **Mean Ratio**: 0.971
  - **Timing Assessment**: Equivalent password-verification work with no practically useful account-existence timing discrepancy observed under the tested conditions.
- **Integration Test Suite**: `server-auth-enumeration.test.ts` covering `AUDIT-009-S01` through `AUDIT-009-S09` and `AUDIT-009-T01` through `AUDIT-009-T06` running against Firestore emulator, asserting:
  - Equivalent PBKDF2 iterations (100,000 rounds) across existing and nonexistent IDs and emails.
  - Identical HTTP 401 status and error message (`"اسم المستخدم أو كلمة المرور غير صحيحة"`).
  - Rate limiting preserved in production (`max: 10` per 15 minutes).
  - Valid logins for both employee IDs and emails remain 100% operational.
- **Full Regressions**: All 173 unit and emulator integration tests pass sequentially with zero errors.


