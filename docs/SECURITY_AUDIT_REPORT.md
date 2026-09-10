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
| **AUDIT-009** | MEDIUM | Information Disclosure | **OPEN** | *Pending* | Public Employee Enumeration Endpoint (`/api/auth/employees`). |
| **AUDIT-010** | MEDIUM | Web Security / CSP | **VERIFIED CLOSED** | `Current HEAD` | Content Security Policy script-src hardening: removed `'unsafe-inline'` and `'unsafe-eval'` in production. |
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
