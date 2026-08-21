import 'dotenv/config';
import express from "express";
import path from "path";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  ALLOWED_COLLECTIONS,
  isValidCollection,
  isValidDocumentId,
  WRITE_PERMISSIONS,
  hasWritePermission,
  validateProxyPayload,
  validateSalePayload,
  normalizeCartStockItems,
  roundMoney,
  generateSaleRequestFingerprint,
} from './server-auth';

declare global {
  namespace Express {
    interface Request {
      uid?: string;
      employee?: any;
    }
  }
}

// ---- Cryptographic Password Helpers ----

export function hashPassword(password: string, salt?: string): string {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2:sha512:100000:${s}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (!storedHash.startsWith('pbkdf2:')) {
    return password === storedHash;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 5) return false;
  const iterations = parseInt(parts[2], 10);
  const salt = parts[3];
  const originalHash = parts[4];
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

export function isLegacyPassword(storedHash: string): boolean {
  return !storedHash || !storedHash.startsWith('pbkdf2:');
}

// ---- Google Service Account Auth for Firestore REST API ----

let cachedGoogleToken: { token: string; expiresAt: number } | null = null;

function getServiceAccountCredentials(): { client_email: string; private_key: string; project_id: string } | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch {}
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      project_id: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'taiba-center-manager',
    };
  }
  return null;
}

export async function getGoogleAccessToken(): Promise<string> {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return 'owner';
  }

  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60000) {
    return cachedGoogleToken.token;
  }

  const creds = getServiceAccountCredentials();
  if (!creds) {
    throw new Error(
      "Missing service account credentials. Set FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY."
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const b64Url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsignedToken = `${b64Url(header)}.${b64Url(claimSet)}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedToken);
  const signature = signer.sign(creds.private_key, "base64url");
  const jwt = `${unsignedToken}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to get Google OAuth token: ${resp.status} ${text}`);
  }

  const data = await resp.json() as any;
  cachedGoogleToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedGoogleToken.token;
}

// ---- Firestore REST Helpers ----

export function getFirestoreProjectId(): string {
  return process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'taiba-center-manager';
}

export function getFirestoreDbPath(): string {
  return `projects/${getFirestoreProjectId()}/databases/(default)`;
}

export const PROJECT_ID = getFirestoreProjectId();
export const FIRESTORE_DB_PATH = getFirestoreDbPath();

export function getFirestoreBaseUrl(): string {
  const dbPath = getFirestoreDbPath();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/${dbPath}`;
  }
  return `https://firestore.googleapis.com/v1/${dbPath}`;
}

export function jsToFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: val.toString() };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(jsToFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function firestoreValueToJs(val: any): any {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(firestoreValueToJs);
  }
  if ('mapValue' in val) {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      result[k] = firestoreValueToJs(v as any);
    }
    return result;
  }
  return null;
}

export async function firestoreGetDocument(path: string): Promise<any | null> {
  const token = await getGoogleAccessToken();
  const baseUrl = getFirestoreBaseUrl();
  const resp = await fetch(
    `${baseUrl}/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Firestore GET failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as any;
  const result: Record<string, any> = { id: data.name.split('/').pop() };
  if (data.fields) {
    for (const [k, v] of Object.entries(data.fields)) {
      result[k] = firestoreValueToJs(v as any);
    }
  }
  return result;
}

export async function firestoreSetDocument(collection: string, id: string, data: any) {
  const token = await getGoogleAccessToken();
  const baseUrl = getFirestoreBaseUrl();
  const fields = jsToFirestoreValue(data).mapValue.fields;
  const resp = await fetch(
    `${baseUrl}/documents/${collection}/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    }
  );
  if (!resp.ok) throw new Error(`Firestore SET failed: ${resp.status} ${await resp.text()}`);
}

export async function firestoreDeleteDocument(collection: string, id: string) {
  const token = await getGoogleAccessToken();
  const baseUrl = getFirestoreBaseUrl();
  const resp = await fetch(
    `${baseUrl}/documents/${collection}/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok && resp.status !== 404) throw new Error(`Firestore DELETE failed: ${resp.status} ${await resp.text()}`);
}

export async function firestoreFindActiveAttendance(employeeId: string): Promise<any | null> {
  const token = await getGoogleAccessToken();
  const baseUrl = getFirestoreBaseUrl();
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: "attendance" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "employeeId" },
          op: "EQUAL",
          value: { stringValue: employeeId }
        }
      },
      limit: 50
    }
  };

  const resp = await fetch(`${baseUrl}/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(queryBody),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore runQuery failed: ${resp.status} ${errText}`);
  }

  const results = (await resp.json()) as any[];
  const activeDocs: any[] = [];
  for (const item of results) {
    if (item.document && item.document.fields) {
      const doc: Record<string, any> = { id: item.document.name.split("/").pop() };
      for (const [k, v] of Object.entries(item.document.fields)) {
        doc[k] = firestoreValueToJs(v as any);
      }
      if (!doc.checkOutTime) {
        activeDocs.push(doc);
      }
    }
  }

  if (activeDocs.length === 0) return null;
  // If multiple exist due to historical orphaned shifts, sort by checkInTime descending
  activeDocs.sort((a, b) => {
    const tA = new Date(a.checkInTime || 0).getTime();
    const tB = new Date(b.checkInTime || 0).getTime();
    return tB - tA;
  });
  return activeDocs[0];
}

// ---- Firestore Transaction Engine (Optimistic Concurrency Control) ----

export interface FirestoreTransaction {
  get(collection: string, id: string): Promise<{ data: any; updateTime?: string } | null>;
  set(collection: string, id: string, data: any): void;
  update(collection: string, id: string, data: any): void;
  delete(collection: string, id: string): void;
}

export async function runFirestoreTransaction<T>(
  operation: (txn: FirestoreTransaction) => Promise<T>,
  maxRetries = 5
): Promise<T> {
  let attempt = 0;
  let previousTxnId: string | undefined;
  const baseUrl = getFirestoreBaseUrl();

  while (attempt < maxRetries) {
    attempt++;
    const token = await getGoogleAccessToken();

    const beginBody: any = { options: { readWrite: {} } };

    const beginResp = await fetch(
      `${baseUrl}/documents:beginTransaction`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(beginBody),
      }
    );

    if (!beginResp.ok) {
      const errText = await beginResp.text();
      throw new Error(`Failed to begin Firestore transaction: ${beginResp.status} ${errText}`);
    }

    const { transaction: txnId } = (await beginResp.json()) as { transaction: string };
    previousTxnId = txnId;

    const writes: { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }[] = [];
    const readVersions = new Map<string, string>();
    let hasWritten = false;

    const txn: FirestoreTransaction = {
      async get(collection: string, id: string) {
        if (hasWritten) {
          throw new Error("Firestore transactions require all reads to execute before writes.");
        }
        const url = process.env.FIRESTORE_EMULATOR_HOST
          ? `${baseUrl}/documents/${collection}/${id}`
          : `${baseUrl}/documents/${collection}/${id}?transaction=${encodeURIComponent(txnId)}`;
        const resp = await fetch(
          url,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (resp.status === 404) return null;
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Firestore transaction GET failed (${collection}/${id}): ${resp.status} ${errText}`);
        }
        const data = (await resp.json()) as any;
        const result: Record<string, any> = { id: data.name.split("/").pop() };
        if (data.fields) {
          for (const [k, v] of Object.entries(data.fields)) {
            result[k] = firestoreValueToJs(v as any);
          }
        }
        if (data.updateTime) {
          readVersions.set(`${collection}/${id}`, data.updateTime);
        }
        return { data: result, updateTime: data.updateTime };
      },
      set(collection: string, id: string, data: any) {
        hasWritten = true;
        writes.push({ type: 'set', collection, id, data });
      },
      update(collection: string, id: string, data: any) {
        hasWritten = true;
        writes.push({ type: 'update', collection, id, data });
      },
      delete(collection: string, id: string) {
        hasWritten = true;
        writes.push({ type: 'delete', collection, id });
      },
    };

    let result: T;
    try {
      result = await operation(txn);
    } catch (userErr: any) {
      throw userErr;
    }

    if (writes.length === 0) {
      return result;
    }

    const dbPath = getFirestoreDbPath();
    const commitBody: any = {
      transaction: txnId,
      writes: writes.map(w => {
        if (w.type === 'delete') {
          return { delete: `${dbPath}/documents/${w.collection}/${w.id}` };
        }
        const fields = jsToFirestoreValue(w.data || {}).mapValue.fields;
        const writeObj: any = {
          update: {
            name: `${dbPath}/documents/${w.collection}/${w.id}`,
            fields,
          },
        };
        const readUpdateTime = readVersions.get(`${w.collection}/${w.id}`);
        if (readUpdateTime) {
          writeObj.currentDocument = { updateTime: readUpdateTime };
        }
        return writeObj;
      }),
    };

    const commitResp = await fetch(
      `${baseUrl}/documents:commit`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commitBody),
      }
    );

    if (commitResp.ok) {
      return result;
    }

    const commitErrText = await commitResp.text();
    const isContention = commitResp.status === 409 || commitResp.status === 400 || commitResp.status === 503 || commitErrText.includes("ABORTED") || commitErrText.includes("conflict") || commitErrText.includes("UNAVAILABLE") || commitErrText.includes("FAILED_PRECONDITION");
    if (isContention && attempt < maxRetries) {
      const backoffMs = Math.min(1000, Math.pow(2, attempt) * 40 + Math.floor(Math.random() * 30));
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      continue;
    }

    throw new Error(`Firestore transaction commit failed: ${commitResp.status} ${commitErrText}`);
  }

  throw new Error("Firestore transaction exceeded maximum retries due to contention.");
}

// ---- Attendance transactional business functions (AUDIT-004 Enforced) ----

export async function executeClockIn(payload: {
  employeeId: string;
  employeeName?: string;
  date?: string;
  checkInTime?: string;
}): Promise<{ ok: boolean; id: string; record: any; alreadyActive: boolean }> {
  const { employeeId, employeeName, date, checkInTime } = payload;
  if (!employeeId || !isValidDocumentId(employeeId)) {
    const err: any = new Error("Missing or invalid employeeId");
    err.status = 400;
    throw err;
  }

  return await runFirestoreTransaction(async (txn) => {
    // 1. Check employee doc for active shift pointer
    const empDoc = await txn.get('employees', employeeId);
    if (empDoc && empDoc.data && empDoc.data.activeAttendanceId) {
      const activeDoc = await txn.get('attendance', empDoc.data.activeAttendanceId);
      if (activeDoc && activeDoc.data && !activeDoc.data.checkOutTime) {
        return {
          ok: true,
          id: activeDoc.data.id,
          record: activeDoc.data,
          alreadyActive: true,
        };
      }
    }

    // 2. Query fallback for existing active attendance
    const queryActive = await firestoreFindActiveAttendance(employeeId);
    if (queryActive && !queryActive.checkOutTime) {
      if (empDoc && empDoc.data) {
        txn.update('employees', employeeId, { ...empDoc.data, activeAttendanceId: queryActive.id });
      }
      return {
        ok: true,
        id: queryActive.id,
        record: queryActive,
        alreadyActive: true,
      };
    }

    // 3. Create new attendance record
    const id = crypto.randomUUID();
    const now = checkInTime || new Date().toISOString();
    const record = {
      id,
      employeeId,
      employeeName: employeeName || empDoc?.data?.name || '',
      date: date || now.split('T')[0],
      checkInTime: now,
      checkOutTime: null,
      durationMinutes: null,
    };

    txn.set('attendance', id, record);
    if (empDoc && empDoc.data) {
      txn.update('employees', employeeId, { ...empDoc.data, activeAttendanceId: id });
    }

    return { ok: true, id, record, alreadyActive: false };
  });
}

export async function executeClockOut(payload: {
  attendanceId: string;
  checkOutTime?: string;
  durationMinutes?: number;
}): Promise<{ ok: boolean; record: any; alreadyClosed: boolean }> {
  const { attendanceId, checkOutTime, durationMinutes } = payload;
  if (!attendanceId || !isValidDocumentId(attendanceId)) {
    const err: any = new Error("Missing or invalid attendanceId");
    err.status = 400;
    throw err;
  }

  return await runFirestoreTransaction(async (txn) => {
    // 1. Read Phase (ALL reads strictly before any writes)
    const docWrapper = await txn.get('attendance', attendanceId);
    if (!docWrapper || !docWrapper.data) {
      const err: any = new Error("Attendance record not found");
      err.status = 404;
      throw err;
    }
    const doc = docWrapper.data;

    // Idempotency: if already clocked out, return cleanly without corrupting state or duration
    if (doc.checkOutTime) {
      return { ok: true, record: doc, alreadyClosed: true };
    }

    let empWrapper: any = null;
    if (doc.employeeId) {
      empWrapper = await txn.get('employees', doc.employeeId);
    }

    // 2. Write Phase
    const now = checkOutTime || new Date().toISOString();
    const checkInMs = new Date(doc.checkInTime).getTime();
    const checkOutMs = new Date(now).getTime();
    const safeDuration = (Number.isFinite(checkInMs) && checkOutMs >= checkInMs)
      ? Math.max(0, Math.round((checkOutMs - checkInMs) / 60000))
      : 0;
    const finalDuration = (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes >= 0)
      ? durationMinutes
      : safeDuration;

    const updated = {
      ...doc,
      checkOutTime: now,
      durationMinutes: finalDuration,
    };

    txn.update('attendance', attendanceId, updated);

    // Clear activeAttendanceId on employee if it points to this record
    if (empWrapper && empWrapper.data && empWrapper.data.activeAttendanceId === attendanceId) {
      txn.update('employees', doc.employeeId, { ...empWrapper.data, activeAttendanceId: null });
    }

    return { ok: true, record: updated, alreadyClosed: false };
  });
}

export async function executeGetActiveAttendance(employeeId: string): Promise<any | null> {
  if (!employeeId || !isValidDocumentId(employeeId)) return null;
  return await firestoreFindActiveAttendance(employeeId);
}

// ---- end Firestore proxy ----

export async function auditLog(eventType: string, userId: string, userEmail: string, details: Record<string, any> = {}) {
  try {
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await firestoreSetDocument('audit_logs', id, {
      id,
      timestamp: new Date().toISOString(),
      eventType,
      userId,
      userEmail,
      ip: details.ip || 'server',
      details,
    });
  } catch (e: any) {
    console.error('Failed to write audit log:', e.message);
  }
}

// In-memory session store (validated server-side)
export const serverSessions = new Map<string, { employeeId: string; expiresAt: number }>();

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, sess] of serverSessions.entries()) {
    if (sess.expiresAt < now) serverSessions.delete(token);
  }
}
setInterval(cleanExpiredSessions, 10 * 60 * 1000);

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (name) list[name] = decodeURIComponent(val);
    }
  });
  return list;
}

export function buildSessionCookieHeader(token: string, isProduction: boolean, maxAgeMs = 24 * 60 * 60 * 1000): string {
  const parts = [
    `taiba_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(isProduction: boolean): string {
  const parts = [
    'taiba_session=',
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function setSessionCookie(res: express.Response, token: string, maxAgeMs = 24 * 60 * 60 * 1000) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', buildSessionCookieHeader(token, isProduction, maxAgeMs));
}

export function clearSessionCookie(res: express.Response) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', buildClearSessionCookieHeader(isProduction));
}

// ---- Firestore batch commit helper (for legacy and maintenance operations) ----

// ---- Firestore batch commit & listing helpers (AUDIT-012 Safe Operations) ----

export async function firestoreCommit(
  writes: { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }[],
  batchSize = 400
): Promise<void> {
  if (writes.length === 0) return;
  const token = await getGoogleAccessToken();
  const baseUrl = getFirestoreBaseUrl();
  const dbPath = getFirestoreDbPath();

  for (let i = 0; i < writes.length; i += batchSize) {
    const chunk = writes.slice(i, i + batchSize);
    const batchBody: any = {
      writes: chunk.map(w => {
        if (w.type === 'delete') {
          return { delete: `${dbPath}/documents/${w.collection}/${w.id}` };
        }
        const fields = jsToFirestoreValue(w.data || {}).mapValue.fields;
        return { update: { name: `${dbPath}/documents/${w.collection}/${w.id}`, fields } };
      }),
    };
    const resp = await fetch(`${baseUrl}/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batchBody),
    });
    if (!resp.ok) throw new Error(`Firestore commit failed: ${resp.status} ${await resp.text()}`);
  }
}

export async function firestoreListCollectionDocuments(collectionName: string): Promise<any[]> {
  const token = await getGoogleAccessToken();
  const baseUrl = getFirestoreBaseUrl();
  const docs: any[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${baseUrl}/documents/${collectionName}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (resp.status === 404) break;
    if (!resp.ok) {
      throw new Error(`Failed to list collection "${collectionName}": ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json() as any;
    if (data.documents && Array.isArray(data.documents)) {
      for (const d of data.documents) {
        const id = d.name.split('/').pop();
        const item: Record<string, any> = { id };
        if (d.fields) {
          for (const [k, v] of Object.entries(d.fields)) {
            item[k] = firestoreValueToJs(v as any);
          }
        }
        docs.push(item);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return docs;
}

// ── AUDIT-012: Durable Backup Format, Validation, Lock State Machine & Compensating Rollback ──

export const MANAGED_ENTITY_COLLECTIONS = [
  'products',
  'sales',
  'expenses',
  'employees',
  'customers',
  'suppliers',
  'attendance'
] as const;

export const MANAGED_SINGLETON_COLLECTIONS = [
  'categories',
  'seasons'
] as const;

export const ALL_MANAGED_COLLECTIONS = [
  ...MANAGED_ENTITY_COLLECTIONS,
  ...MANAGED_SINGLETON_COLLECTIONS
] as const;

export const SYSTEM_RECOVERY_OPERATIONS_COLLECTION = '_system_restore_operations';
export const SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION = '_system_restore_snapshots';

export type RestoreLockState =
  | 'IDLE'
  | 'PREPARING'
  | 'SNAPSHOT_READY'
  | 'RESTORING'
  | 'VERIFYING'
  | 'ROLLING_BACK'
  | 'ROLLED_BACK'
  | 'COMPLETED'
  | 'ABORTED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED';

export interface DurableRestoreOperation {
  opId: string;
  state: RestoreLockState;
  startedAt: number;
  heartbeatAt: number;
  initiatedBy: string;
  backupChecksum?: string;
  snapshotStateHash?: string;
  snapshotCounts?: Record<string, number>;
  lastError?: string;
  recoveryStatus?: string;
}

export const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of no heartbeat

let activeRestoreLock: DurableRestoreOperation | null = null;
let testFaultInjectionAfterWrites: number | null = null;

export function getRestoreLock(): DurableRestoreOperation | null {
  if (activeRestoreLock) {
    const isTerminalState =
      activeRestoreLock.state === 'IDLE' ||
      activeRestoreLock.state === 'COMPLETED' ||
      activeRestoreLock.state === 'ROLLED_BACK' ||
      activeRestoreLock.state === 'ABORTED';

    if (isTerminalState) {
      return null;
    }

    // Only expire if heartbeat has elapsed past STALE_LOCK_THRESHOLD_MS
    if (Date.now() - activeRestoreLock.heartbeatAt > STALE_LOCK_THRESHOLD_MS) {
      activeRestoreLock = null;
    }
  }
  return activeRestoreLock;
}

export function setRestoreLock(info: DurableRestoreOperation | null): void {
  activeRestoreLock = info;
}

export function clearRestoreLock(): void {
  activeRestoreLock = null;
}

export function setTestRestoreFaultInjection(writesThreshold: number | null): void {
  testFaultInjectionAfterWrites = writesThreshold;
}

// ── Canonical Serialization & Full State Equality Hashing ──

export function canonicalizeValue(val: any): any {
  if (val === null || val === undefined || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }
  const sortedKeys = Object.keys(val).sort();
  const result: Record<string, any> = {};
  for (const k of sortedKeys) {
    result[k] = canonicalizeValue(val[k]);
  }
  return result;
}

export function computeCanonicalStateHash(state: Record<string, any>): string {
  const sortedColls = Object.keys(state).sort();
  const normalizedState: Record<string, any> = {};

  for (const coll of sortedColls) {
    const raw = state[coll];
    if (Array.isArray(raw)) {
      // Sort items deterministically by ID or serialized representation
      const sortedItems = [...raw].map(canonicalizeValue).sort((a, b) => {
        const idA = (a && typeof a === 'object' && a.id) ? String(a.id) : JSON.stringify(a);
        const idB = (b && typeof b === 'object' && b.id) ? String(b.id) : JSON.stringify(b);
        return idA.localeCompare(idB);
      });
      normalizedState[coll] = sortedItems;
    } else {
      normalizedState[coll] = canonicalizeValue(raw);
    }
  }

  const canonicalJson = JSON.stringify(normalizedState);
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

export function compareCanonicalStates(
  stateA: Record<string, any>,
  stateB: Record<string, any>
): { equal: boolean; hashA: string; hashB: string; mismatches: string[] } {
  const hashA = computeCanonicalStateHash(stateA);
  const hashB = computeCanonicalStateHash(stateB);
  const mismatches: string[] = [];

  const allColls = new Set([...Object.keys(stateA), ...Object.keys(stateB)]);
  for (const c of allColls) {
    const subHashA = computeCanonicalStateHash({ [c]: stateA[c] || [] });
    const subHashB = computeCanonicalStateHash({ [c]: stateB[c] || [] });
    if (subHashA !== subHashB) {
      mismatches.push(c);
    }
  }

  return { equal: hashA === hashB, hashA, hashB, mismatches };
}

export function computeBackupChecksum(collectionsData: Record<string, any>): string {
  return computeCanonicalStateHash(collectionsData);
}

// ── Durable Recovery Journal in Firestore ──

export async function getDurableRestoreOperation(): Promise<DurableRestoreOperation | null> {
  try {
    const doc = await firestoreGetDocument(`${SYSTEM_RECOVERY_OPERATIONS_COLLECTION}/current`);
    if (!doc || !doc.opId) return null;
    return doc as DurableRestoreOperation;
  } catch (e: any) {
    return null;
  }
}

export async function setDurableRestoreOperation(op: DurableRestoreOperation): Promise<void> {
  setRestoreLock(op);
  try {
    await firestoreSetDocument(SYSTEM_RECOVERY_OPERATIONS_COLLECTION, 'current', op);
    // Also log historical trace doc for permanent audit trail
    await firestoreSetDocument(SYSTEM_RECOVERY_OPERATIONS_COLLECTION, op.opId, op);
  } catch (e: any) {
    console.error('[AUDIT-012] Failed to write durable restore operation:', e.message);
  }
}

export async function persistDurablePreRestoreSnapshot(
  opId: string,
  snapshot: Record<string, any>
): Promise<{ stateHash: string; counts: Record<string, number> }> {
  const counts: Record<string, number> = {};
  const stateHash = computeCanonicalStateHash(snapshot);

  const CHUNK_SIZE = 100;
  const writes: { type: 'set'; collection: string; id: string; data: any }[] = [];

  for (const collName of MANAGED_ENTITY_COLLECTIONS) {
    const items = snapshot[collName] || [];
    counts[collName] = items.length;
    const totalChunks = Math.max(1, Math.ceil(items.length / CHUNK_SIZE));
    for (let i = 0; i < totalChunks; i++) {
      const chunkItems = items.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkId = `${opId}_${collName}_chunk_${i}`;
      writes.push({
        type: 'set',
        collection: SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION,
        id: chunkId,
        data: {
          opId,
          collectionName: collName,
          chunkIndex: i,
          totalChunks,
          items: chunkItems,
          createdAt: new Date().toISOString(),
        },
      });
    }
  }

  for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
    const items = snapshot[singleColl] || [];
    counts[singleColl] = items.length;
    writes.push({
      type: 'set',
      collection: SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION,
      id: `${opId}_${singleColl}_all`,
      data: {
        opId,
        collectionName: singleColl,
        items,
        createdAt: new Date().toISOString(),
      },
    });
  }

  await firestoreCommit(writes);
  return { stateHash, counts };
}

export async function loadDurablePreRestoreSnapshot(opId: string): Promise<Record<string, any> | null> {
  try {
    const allSnapshotDocs = await firestoreListCollectionDocuments(SYSTEM_RECOVERY_SNAPSHOTS_COLLECTION);
    const opDocs = allSnapshotDocs.filter((d: any) => d.opId === opId);
    if (opDocs.length === 0) return null;

    const reconstructed: Record<string, any> = {};

    for (const collName of MANAGED_ENTITY_COLLECTIONS) {
      const collChunks = opDocs
        .filter((d: any) => d.collectionName === collName)
        .sort((a: any, b: any) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
      const mergedItems: any[] = [];
      for (const chunk of collChunks) {
        if (Array.isArray(chunk.items)) {
          mergedItems.push(...chunk.items);
        }
      }
      reconstructed[collName] = mergedItems;
    }

    for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
      const doc = opDocs.find((d: any) => d.collectionName === singleColl);
      reconstructed[singleColl] = (doc && Array.isArray(doc.items)) ? doc.items : [];
    }

    return reconstructed;
  } catch (e: any) {
    console.error('[AUDIT-012] Failed to load durable pre-restore snapshot:', e.message);
    return null;
  }
}

export interface NormalizedBackup {
  metadata: {
    formatVersion: number;
    createdAt: string;
    app: string;
    counts: Record<string, number>;
    checksum?: string;
  };
  collections: {
    products: any[];
    sales: any[];
    expenses: any[];
    employees: any[];
    customers: any[];
    suppliers: any[];
    attendance: any[];
    categories: string[];
    seasons: string[];
  };
}

export function validateBackupPayload(payload: any): { valid: boolean; error?: string; normalized?: NormalizedBackup } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Backup payload must be a non-null JSON object' };
  }

  // Guard against prototype pollution
  const jsonStr = JSON.stringify(payload);
  if (jsonStr.includes('"__proto__"') || jsonStr.includes('"constructor"') || jsonStr.includes('"prototype"')) {
    return { valid: false, error: 'Prototype pollution attempt detected in backup payload' };
  }

  let collectionsInput: any;
  let metadataInput: any;

  if (payload.collections && typeof payload.collections === 'object') {
    collectionsInput = payload.collections;
    metadataInput = payload.metadata;
  } else {
    // Legacy format compatibility (flat structure)
    collectionsInput = payload;
    metadataInput = {
      formatVersion: 1,
      createdAt: payload.timestamp || new Date().toISOString(),
      app: 'Taiba Center Manager',
    };
  }

  if (metadataInput && metadataInput.formatVersion !== undefined) {
    if (typeof metadataInput.formatVersion !== 'number' || metadataInput.formatVersion > 1 || metadataInput.formatVersion < 1) {
      return { valid: false, error: `Unsupported backup formatVersion: ${metadataInput.formatVersion}` };
    }
  }

  // Validate collection keys (reject unknown top-level collection names)
  const allowedKeys = new Set([...ALL_MANAGED_COLLECTIONS, 'metadata', 'timestamp']);
  for (const key of Object.keys(collectionsInput)) {
    if (!allowedKeys.has(key as any)) {
      return { valid: false, error: `Disallowed or unknown collection in backup: "${key}"` };
    }
  }

  const normalized: NormalizedBackup = {
    metadata: {
      formatVersion: 1,
      createdAt: metadataInput?.createdAt || new Date().toISOString(),
      app: 'Taiba Center Manager',
      counts: {},
      checksum: metadataInput?.checksum,
    },
    collections: {
      products: [],
      sales: [],
      expenses: [],
      employees: [],
      customers: [],
      suppliers: [],
      attendance: [],
      categories: [],
      seasons: [],
    }
  };

  // Validate Entity Collections
  for (const collName of MANAGED_ENTITY_COLLECTIONS) {
    const rawItems = collectionsInput[collName];
    if (rawItems === undefined) {
      normalized.collections[collName] = [];
      normalized.metadata.counts[collName] = 0;
      continue;
    }
    if (!Array.isArray(rawItems)) {
      return { valid: false, error: `Collection "${collName}" must be an array of documents` };
    }

    const seenIds = new Set<string>();
    const validatedItems: any[] = [];

    for (let i = 0; i < rawItems.length; i++) {
      const doc = rawItems[i];
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return { valid: false, error: `Item at index ${i} in "${collName}" is not a valid object` };
      }
      if (!doc.id || typeof doc.id !== 'string' || !isValidDocumentId(doc.id)) {
        return { valid: false, error: `Item at index ${i} in "${collName}" has invalid or missing "id"` };
      }
      if (seenIds.has(doc.id)) {
        return { valid: false, error: `Duplicate document ID "${doc.id}" found in "${collName}"` };
      }
      seenIds.add(doc.id);

      // Schema Type & Required Field Validations
      if (collName === 'products') {
        if (!doc.name || typeof doc.name !== 'string') {
          return { valid: false, error: `Product "${doc.id}" missing valid "name"` };
        }
        if (typeof doc.sellingPrice !== 'number' || isNaN(doc.sellingPrice) || doc.sellingPrice < 0) {
          return { valid: false, error: `Product "${doc.id}" has invalid "sellingPrice"` };
        }
        if (typeof doc.costPrice !== 'number' || isNaN(doc.costPrice) || doc.costPrice < 0) {
          return { valid: false, error: `Product "${doc.id}" has invalid "costPrice"` };
        }
      } else if (collName === 'sales') {
        if (!Array.isArray(doc.items) || doc.items.length === 0) {
          return { valid: false, error: `Sale "${doc.id}" must contain non-empty "items" array` };
        }
        if (typeof doc.totalAmount !== 'number' || isNaN(doc.totalAmount)) {
          return { valid: false, error: `Sale "${doc.id}" has invalid "totalAmount"` };
        }
      } else if (collName === 'employees') {
        if (!doc.name || typeof doc.name !== 'string') {
          return { valid: false, error: `Employee "${doc.id}" missing valid "name"` };
        }
        if (!doc.email || typeof doc.email !== 'string') {
          return { valid: false, error: `Employee "${doc.id}" missing valid "email"` };
        }
      } else if (collName === 'customers') {
        if (!doc.name || typeof doc.name !== 'string') {
          return { valid: false, error: `Customer "${doc.id}" missing valid "name"` };
        }
      } else if (collName === 'expenses') {
        if (typeof doc.amount !== 'number' || isNaN(doc.amount) || doc.amount < 0) {
          return { valid: false, error: `Expense "${doc.id}" has invalid "amount"` };
        }
      } else if (collName === 'attendance') {
        if (!doc.employeeId || typeof doc.employeeId !== 'string') {
          return { valid: false, error: `Attendance "${doc.id}" missing "employeeId"` };
        }
      }

      validatedItems.push(doc);
    }

    normalized.collections[collName] = validatedItems;
    normalized.metadata.counts[collName] = validatedItems.length;
  }

  // Validate Singleton Collections (categories, seasons)
  for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
    const rawVal = collectionsInput[singleColl];
    if (rawVal === undefined) {
      normalized.collections[singleColl] = [];
      normalized.metadata.counts[singleColl] = 0;
      continue;
    }

    let itemsList: string[] = [];
    if (Array.isArray(rawVal)) {
      itemsList = rawVal.filter((x): x is string => typeof x === 'string');
    } else if (rawVal && typeof rawVal === 'object' && Array.isArray(rawVal.items)) {
      itemsList = rawVal.items.filter((x: any): x is string => typeof x === 'string');
    } else {
      return { valid: false, error: `Collection "${singleColl}" must be an array or { items: string[] }` };
    }

    normalized.collections[singleColl] = itemsList;
    normalized.metadata.counts[singleColl] = itemsList.length;
  }

  return { valid: true, normalized };
}

export async function capturePreRestoreSnapshot(): Promise<Record<string, any>> {
  const snapshot: Record<string, any> = {};

  for (const coll of MANAGED_ENTITY_COLLECTIONS) {
    snapshot[coll] = await firestoreListCollectionDocuments(coll);
  }

  for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
    const doc = await firestoreGetDocument(`${singleColl}/all`);
    snapshot[singleColl] = (doc && Array.isArray(doc.items)) ? doc.items : [];
  }

  return snapshot;
}

export async function executeCompensatingRollback(
  snapshot: Record<string, any>,
  opId: string,
  reason: string
): Promise<void> {
  console.warn(`[AUDIT-012] Executing compensating rollback for opId=${opId} (Reason: ${reason})...`);

  for (const collName of MANAGED_ENTITY_COLLECTIONS) {
    const currentDocsInDb = await firestoreListCollectionDocuments(collName);
    const originalDocs = snapshot[collName] || [];
    const originalIdSet = new Set(originalDocs.map((x: any) => x.id));

    const rollbackWrites: { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }[] = [];

    // Delete docs written during restore that were not originally present
    for (const cur of currentDocsInDb) {
      if (!originalIdSet.has(cur.id)) {
        rollbackWrites.push({ type: 'delete', collection: collName, id: cur.id });
      }
    }

    // Re-write all original snapshot documents
    for (const orig of originalDocs) {
      rollbackWrites.push({ type: 'set', collection: collName, id: orig.id, data: orig });
    }

    await firestoreCommit(rollbackWrites);
  }

  for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
    const origItems = snapshot[singleColl] || [];
    await firestoreSetDocument(singleColl, 'all', { items: origItems });
  }
}

export async function executeFailureSafeRestore(
  rawBackupPayload: any,
  options?: { initiatedBy?: string; faultInjectionAfterWritesCount?: number }
): Promise<{ ok: boolean; stats: { restoredCounts: Record<string, number>; deletedCounts: Record<string, number> } }> {
  // 1. MUTUAL EXCLUSION & DURABLE LOCK CHECK
  const currentLock = getRestoreLock();
  if (currentLock) {
    const err: any = new Error('A database restore operation is already in progress');
    err.status = 409;
    err.code = 'RESTORE_ALREADY_IN_PROGRESS';
    err.lock = currentLock;
    throw err;
  }

  const opId = 'res_' + crypto.randomUUID();
  const initiatedBy = options?.initiatedBy || 'admin';

  let currentOp: DurableRestoreOperation = {
    opId,
    state: 'PREPARING',
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    initiatedBy,
  };
  await setDurableRestoreOperation(currentOp);

  let preRestoreSnapshot: Record<string, any> | null = null;

  try {
    // 2. SCHEMA & PAYLOAD VALIDATION (Strict Pre-Flight Check)
    const validation = validateBackupPayload(rawBackupPayload);
    if (!validation.valid || !validation.normalized) {
      const err: any = new Error(`Backup validation failed: ${validation.error}`);
      err.status = 400;
      err.code = 'INVALID_BACKUP_SCHEMA';
      throw err;
    }

    const normalized = validation.normalized;
    currentOp.backupChecksum = computeBackupChecksum(normalized.collections);

    // 3. CAPTURE & PERSIST DURABLE PRE-RESTORE SNAPSHOT BEFORE ANY MUTATION
    preRestoreSnapshot = await capturePreRestoreSnapshot();
    const persistedSnapshotMeta = await persistDurablePreRestoreSnapshot(opId, preRestoreSnapshot);

    currentOp = {
      ...currentOp,
      state: 'SNAPSHOT_READY',
      heartbeatAt: Date.now(),
      snapshotStateHash: persistedSnapshotMeta.stateHash,
      snapshotCounts: persistedSnapshotMeta.counts,
    };
    await setDurableRestoreOperation(currentOp);

    // 4. RESTORATION MUTATION PHASE (Exact Replacement Semantics)
    currentOp = {
      ...currentOp,
      state: 'RESTORING',
      heartbeatAt: Date.now(),
    };
    await setDurableRestoreOperation(currentOp);

    let totalWritesExecuted = 0;
    const deletedCounts: Record<string, number> = {};
    const restoredCounts: Record<string, number> = {};
    const faultThreshold = options?.faultInjectionAfterWritesCount ?? testFaultInjectionAfterWrites;

    // Apply entity collections
    for (const collName of MANAGED_ENTITY_COLLECTIONS) {
      const currentDocs = preRestoreSnapshot[collName] || [];
      const backupItems = normalized.collections[collName] || [];
      const backupIdSet = new Set(backupItems.map((item: any) => item.id));

      const writes: { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }[] = [];

      // Calculate Deletions (docs currently in DB not in backup)
      let deletedForColl = 0;
      for (const curDoc of currentDocs) {
        if (!backupIdSet.has(curDoc.id)) {
          writes.push({ type: 'delete', collection: collName, id: curDoc.id });
          deletedForColl++;
        }
      }
      deletedCounts[collName] = deletedForColl;

      // Calculate Sets (docs in backup)
      for (const item of backupItems) {
        writes.push({ type: 'set', collection: collName, id: item.id, data: item });
      }
      restoredCounts[collName] = backupItems.length;

      // Check Fault Injection before committing
      if (faultThreshold !== null && (totalWritesExecuted + writes.length) > faultThreshold) {
        // Execute partial chunk up to threshold to simulate mid-restore failure
        const partialWrites = writes.slice(0, Math.max(1, faultThreshold - totalWritesExecuted));
        if (partialWrites.length > 0) {
          await firestoreCommit(partialWrites);
        }
        throw new Error('TEST_FAULT_INJECTION: Mid-restore simulated network/process abort');
      }

      await firestoreCommit(writes);
      totalWritesExecuted += writes.length;

      // Keep heartbeat active during long multi-collection operations
      currentOp.heartbeatAt = Date.now();
      await setDurableRestoreOperation(currentOp);
    }

    // Apply singleton collections
    for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
      const itemsList = normalized.collections[singleColl] || [];
      await firestoreSetDocument(singleColl, 'all', { items: itemsList });
      restoredCounts[singleColl] = itemsList.length;
    }

    // 5. POST-RESTORE VERIFICATION PHASE (Canonical Full-State Verification)
    currentOp = {
      ...currentOp,
      state: 'VERIFYING',
      heartbeatAt: Date.now(),
    };
    await setDurableRestoreOperation(currentOp);

    const postRestoreDbState = await capturePreRestoreSnapshot();
    const stateComparison = compareCanonicalStates(postRestoreDbState, normalized.collections);

    if (!stateComparison.equal) {
      throw new Error(`Post-restore verification mismatch on collections: ${stateComparison.mismatches.join(', ')}`);
    }

    // 6. SUCCESS & MARK OPERATION COMPLETED
    currentOp = {
      ...currentOp,
      state: 'COMPLETED',
      heartbeatAt: Date.now(),
    };
    await setDurableRestoreOperation(currentOp);
    clearRestoreLock();

    return { ok: true, stats: { restoredCounts, deletedCounts } };
  } catch (error: any) {
    // 7. COMPENSATING ROLLBACK PHASE (Automated Rollback & Full-State Equality Proof)
    if (preRestoreSnapshot) {
      currentOp = {
        ...currentOp,
        state: 'ROLLING_BACK',
        heartbeatAt: Date.now(),
        lastError: error.message,
      };
      await setDurableRestoreOperation(currentOp);

      try {
        await executeCompensatingRollback(preRestoreSnapshot, opId, error.message);

        // Verification of Rollback State Equality against Pre-Restore Snapshot
        const rolledBackState = await capturePreRestoreSnapshot();
        const rollbackComparison = compareCanonicalStates(rolledBackState, preRestoreSnapshot);

        if (!rollbackComparison.equal) {
          throw new Error(
            `Rollback verification state mismatch on collections: ${rollbackComparison.mismatches.join(', ')}`
          );
        }

        console.log(`[AUDIT-012] Automated compensating rollback succeeded. Full canonical state matches pre-restore snapshot.`);

        currentOp = {
          ...currentOp,
          state: 'ROLLED_BACK',
          heartbeatAt: Date.now(),
          recoveryStatus: 'Compensating rollback succeeded; full canonical state restored',
        };
        await setDurableRestoreOperation(currentOp);
        clearRestoreLock();

        const rollbackErr: any = new Error(
          `Restore failed (${error.message}). Automated rollback executed successfully: database restored to exact prior state.`
        );
        rollbackErr.status = error.status || 500;
        rollbackErr.code = 'RESTORE_FAILED_ROLLBACK_SUCCESS';
        rollbackErr.originalError = error.message;
        rollbackErr.stateHash = rollbackComparison.hashA;
        throw rollbackErr;
      } catch (rollbackFatalErr: any) {
        if (rollbackFatalErr.code === 'RESTORE_FAILED_ROLLBACK_SUCCESS') {
          throw rollbackFatalErr;
        }
        currentOp = {
          ...currentOp,
          state: 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED',
          heartbeatAt: Date.now(),
          lastError: `Fatal: Restore failed (${error.message}) AND rollback failed (${rollbackFatalErr.message})`,
        };
        await setDurableRestoreOperation(currentOp);

        const fatal: any = new Error(
          `FATAL: Restore failed (${error.message}) and automated rollback encountered an error: ${rollbackFatalErr.message}.`
        );
        fatal.status = 500;
        fatal.code = 'FATAL_RESTORE_AND_ROLLBACK_FAILED';
        throw fatal;
      }
    } else {
      // Pre-restore snapshot was not taken (failed during pre-flight validation)
      currentOp = {
        ...currentOp,
        state: 'ABORTED',
        heartbeatAt: Date.now(),
        lastError: error.message,
      };
      await setDurableRestoreOperation(currentOp);
      clearRestoreLock();
      throw error;
    }
  }
}

export async function recoverPendingRestoreOperation(): Promise<{
  recovered: boolean;
  status: 'NO_OP' | 'ABORTED_PRE_MUTATION' | 'ROLLED_BACK_CRASH' | 'RECOVERY_FAILED_CORRUPT_SNAPSHOT';
  opId?: string;
  stateHash?: string;
  error?: string;
}> {
  const currentOp = await getDurableRestoreOperation();
  if (
    !currentOp ||
    currentOp.state === 'IDLE' ||
    currentOp.state === 'COMPLETED' ||
    currentOp.state === 'ROLLED_BACK' ||
    currentOp.state === 'ABORTED'
  ) {
    return { recovered: false, status: 'NO_OP' };
  }

  console.warn(`[AUDIT-012] Found uncompleted restore operation on startup: opId=${currentOp.opId}, state=${currentOp.state}`);

  if (currentOp.state === 'PREPARING') {
    // Mutation has not started! Safely abort.
    await setDurableRestoreOperation({
      ...currentOp,
      state: 'ABORTED',
      recoveryStatus: 'Aborted safely during startup before any database mutation began',
      heartbeatAt: Date.now(),
    });
    await auditLog('restore_startup_aborted', 'system', 'system', { opId: currentOp.opId });
    clearRestoreLock();
    return { recovered: true, status: 'ABORTED_PRE_MUTATION', opId: currentOp.opId };
  }

  if (
    currentOp.state === 'SNAPSHOT_READY' ||
    currentOp.state === 'RESTORING' ||
    currentOp.state === 'VERIFYING' ||
    currentOp.state === 'ROLLING_BACK'
  ) {
    // Process crash detected mid-mutation
    console.warn(`[AUDIT-012] Crash detected mid-restore (opId=${currentOp.opId}). Executing durable startup rollback...`);
    await setDurableRestoreOperation({
      ...currentOp,
      state: 'ROLLING_BACK',
      recoveryStatus: 'Crash detected; recovering from durable pre-restore snapshot',
      heartbeatAt: Date.now(),
    });

    const durableSnapshot = await loadDurablePreRestoreSnapshot(currentOp.opId);
    if (!durableSnapshot) {
      const errMsg = `Durable pre-restore snapshot missing for opId=${currentOp.opId}`;
      console.error(`[AUDIT-012] FATAL: ${errMsg}`);
      await setDurableRestoreOperation({
        ...currentOp,
        state: 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED',
        lastError: errMsg,
        heartbeatAt: Date.now(),
      });
      await auditLog('restore_startup_recovery_failed', 'system', 'system', { opId: currentOp.opId, reason: 'MISSING_SNAPSHOT' });
      return { recovered: false, status: 'RECOVERY_FAILED_CORRUPT_SNAPSHOT', opId: currentOp.opId, error: 'MISSING_SNAPSHOT' };
    }

    if (currentOp.snapshotStateHash) {
      const loadedHash = computeCanonicalStateHash(durableSnapshot);
      if (loadedHash !== currentOp.snapshotStateHash) {
        const errMsg = `Durable snapshot hash mismatch (expected ${currentOp.snapshotStateHash}, got ${loadedHash})`;
        console.error(`[AUDIT-012] FATAL: ${errMsg}`);
        await setDurableRestoreOperation({
          ...currentOp,
          state: 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED',
          lastError: errMsg,
          heartbeatAt: Date.now(),
        });
        await auditLog('restore_startup_recovery_failed', 'system', 'system', { opId: currentOp.opId, reason: 'CORRUPT_SNAPSHOT' });
        return { recovered: false, status: 'RECOVERY_FAILED_CORRUPT_SNAPSHOT', opId: currentOp.opId, error: 'CORRUPT_SNAPSHOT' };
      }
    }

    // Execute compensating rollback from durable snapshot
    await executeCompensatingRollback(durableSnapshot, currentOp.opId, 'Startup Crash Recovery');

    const finalDbState = await capturePreRestoreSnapshot();
    const comparison = compareCanonicalStates(finalDbState, durableSnapshot);
    if (!comparison.equal) {
      const errMsg = `Startup rollback state comparison mismatch on collections: ${comparison.mismatches.join(', ')}`;
      console.error(`[AUDIT-012] ${errMsg}`);
      await setDurableRestoreOperation({
        ...currentOp,
        state: 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED',
        lastError: errMsg,
        heartbeatAt: Date.now(),
      });
      return { recovered: false, status: 'RECOVERY_FAILED_CORRUPT_SNAPSHOT', opId: currentOp.opId, error: errMsg };
    }

    await setDurableRestoreOperation({
      ...currentOp,
      state: 'ROLLED_BACK',
      recoveryStatus: 'Compensating rollback succeeded; full canonical state restored',
      heartbeatAt: Date.now(),
    });
    clearRestoreLock();

    await auditLog('restore_startup_recovery_succeeded', 'system', 'system', { opId: currentOp.opId, stateHash: comparison.hashA });
    console.log(`[AUDIT-012] Startup crash recovery completed successfully. State hash: ${comparison.hashA}`);
    return { recovered: true, status: 'ROLLED_BACK_CRASH', opId: currentOp.opId, stateHash: comparison.hashA };
  }

  return { recovered: false, status: 'NO_OP' };
}

export async function buildBackupV1Export(): Promise<NormalizedBackup> {
  const snapshot = await capturePreRestoreSnapshot();
  const counts: Record<string, number> = {};

  const collectionsData: any = {};
  for (const coll of MANAGED_ENTITY_COLLECTIONS) {
    collectionsData[coll] = snapshot[coll] || [];
    counts[coll] = collectionsData[coll].length;
  }
  for (const singleColl of MANAGED_SINGLETON_COLLECTIONS) {
    collectionsData[singleColl] = snapshot[singleColl] || [];
    counts[singleColl] = collectionsData[singleColl].length;
  }

  const checksum = computeBackupChecksum(collectionsData);

  return {
    metadata: {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      app: 'Taiba Center Manager',
      counts,
      checksum,
    },
    collections: collectionsData,
  };
}

export function requireNoActiveRestore(req: express.Request, res: express.Response, next: express.NextFunction) {
  const lock = getRestoreLock();
  if (lock) {
    if (lock.state === 'RECOVERY_FAILED_MANUAL_INTERVENTION_REQUIRED' || lock.state === 'FAILED') {
      return res.status(503).json({
        error: 'Maintenance mode: database recovery failed and requires manual administrator intervention.',
        code: 'RESTORE_RECOVERY_REQUIRED',
        lock,
      });
    }
    const isBlocking =
      lock.state === 'PREPARING' ||
      lock.state === 'SNAPSHOT_READY' ||
      lock.state === 'RESTORING' ||
      lock.state === 'VERIFYING' ||
      lock.state === 'ROLLING_BACK';

    if (isBlocking) {
      return res.status(503).json({
        error: 'Maintenance mode: database restore in progress. Please retry after restore completes.',
        code: 'RESTORE_IN_PROGRESS',
        lock,
      });
    }
  }
  next();
}

// ---- Sales transactional business function (Shared Production Logic) ----

export interface SaleTransactionResult {
  ok: boolean;
  duplicate: boolean;
  saleId: string;
  totalAmount: number;
  profit: number;
  message?: string;
}

export async function executeSaleTransaction(salePayload: any): Promise<SaleTransactionResult> {
  const norm = normalizeCartStockItems(salePayload.items);
  if (norm.error) {
    const err: any = new Error(norm.error);
    err.status = 400;
    err.code = 'INVALID_CART_ITEMS';
    throw err;
  }
  const stockItems = norm.items || [];

  // Calculate Canonical Intent Fingerprint for Idempotency (AUDIT-014)
  const incomingFingerprint = generateSaleRequestFingerprint(salePayload);

  return runFirestoreTransaction(async (txn) => {
    // --- 1. IDEMPOTENCY CHECK (AUDIT-014: Canonical Payload Equivalence) ---
    const existingSaleDoc = await txn.get('sales', salePayload.id);
    if (existingSaleDoc && existingSaleDoc.data) {
      const existing = existingSaleDoc.data;
      // Determine existing fingerprint (support backward compatibility for historical records)
      const existingFingerprint = existing.requestFingerprint || generateSaleRequestFingerprint(existing);

      if (existingFingerprint === incomingFingerprint) {
        return {
          ok: true,
          duplicate: true,
          saleId: salePayload.id,
          totalAmount: existing.totalAmount,
          profit: existing.profit,
          message: 'Sale already processed',
        };
      }

      const err: any = new Error("Idempotency key reused with different sale payload");
      err.code = "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";
      err.status = 409;
      throw err;
    }

    // --- 2. READ PHASE (all reads strictly before writes) ---
    const productsMap = new Map<string, any>();
    for (const item of stockItems) {
      const prodDoc = await txn.get('products', item.productId);
      if (!prodDoc || !prodDoc.data) {
        const err: any = new Error(`Product not found: ${item.productId}`);
        err.code = 'PRODUCT_NOT_FOUND';
        err.status = 404;
        throw err;
      }
      const currentStock = prodDoc.data.stock;
      if (typeof currentStock !== 'number' || currentStock < item.totalQuantity) {
        const err: any = new Error(`الرصيد غير كافٍ للمنتج "${prodDoc.data.name || item.productId}": المتوفر ${currentStock ?? 0}، المطلوب ${item.totalQuantity}`);
        err.code = 'INSUFFICIENT_STOCK';
        err.status = 400;
        err.available = currentStock;
        err.requested = item.totalQuantity;
        err.productId = item.productId;
        throw err;
      }
      productsMap.set(item.productId, prodDoc.data);
    }

    // Security check for manual items: ensure manual item ID is not masquerading as a catalog product (AUDIT-013)
    for (const item of (salePayload.items as any[])) {
      if (item?.isManualItem && item.id) {
        const collisionDoc = await txn.get('products', item.id);
        if (collisionDoc && collisionDoc.data) {
          const err: any = new Error(`Cannot treat existing catalog product "${collisionDoc.data.name}" as manual item.`);
          err.code = 'MANUAL_ITEM_CATALOG_COLLISION';
          err.status = 400;
          throw err;
        }
      }
    }

    let customerDoc: any = null;
    if (salePayload.customerId) {
      const cust = await txn.get('customers', salePayload.customerId);
      if (cust && cust.data) {
        customerDoc = cust.data;
      }
    }

    // --- 3. SERVER-SIDE FINANCIAL RECALCULATION (AUDIT-013) ---
    let serverTotalAmount = 0;
    let serverTotalCost = 0;
    const verifiedItems = (salePayload.items as any[]).map((rawItem: any) => {
      if (rawItem.isManualItem) {
        const buyPrice = typeof rawItem.purchasePrice === 'number' && Number.isFinite(rawItem.purchasePrice) && rawItem.purchasePrice >= 0 ? roundMoney(rawItem.purchasePrice) : 0;
        const sellPrice = typeof rawItem.sellingPrice === 'number' && Number.isFinite(rawItem.sellingPrice) && rawItem.sellingPrice > 0 ? roundMoney(rawItem.sellingPrice) : 0;
        const qty = rawItem.quantity || 1;
        serverTotalAmount += sellPrice * qty;
        serverTotalCost += buyPrice * qty;
        return {
          ...rawItem,
          sellingPrice: sellPrice,
          purchasePrice: buyPrice,
        };
      }

      const trustedProduct = productsMap.get(rawItem.id);
      const trustedSellPrice = typeof trustedProduct?.sellingPrice === 'number' ? roundMoney(trustedProduct.sellingPrice) : (rawItem.sellingPrice || 0);
      const trustedBuyPrice = typeof trustedProduct?.purchasePrice === 'number' ? roundMoney(trustedProduct.purchasePrice) : (rawItem.purchasePrice || 0);
      const qty = rawItem.quantity;

      serverTotalAmount += trustedSellPrice * qty;
      serverTotalCost += trustedBuyPrice * qty;

      return {
        ...rawItem,
        name: trustedProduct?.name || rawItem.name,
        category: trustedProduct?.category || rawItem.category,
        size: trustedProduct?.size || rawItem.size,
        color: trustedProduct?.color || rawItem.color,
        sellingPrice: trustedSellPrice,
        purchasePrice: trustedBuyPrice,
      };
    });

    serverTotalAmount = roundMoney(serverTotalAmount);
    const serverProfit = roundMoney(serverTotalAmount - serverTotalCost);

    const authoritativeSale = {
      ...salePayload,
      items: verifiedItems,
      totalAmount: serverTotalAmount,
      profit: serverProfit,
      requestFingerprint: incomingFingerprint,
    };

    // --- 4. WRITE PHASE (atomic commit) ---
    txn.set('sales', salePayload.id, authoritativeSale);

    for (const item of stockItems) {
      const product = productsMap.get(item.productId);
      const newStock = (product.stock || 0) - item.totalQuantity;
      txn.update('products', item.productId, { ...product, stock: newStock });
    }

    if (salePayload.customerId && customerDoc) {
      const isDebt = salePayload.paymentMethod === 'آجل (دين)';
      const totalPurchases = roundMoney((customerDoc.totalPurchases || 0) + serverTotalAmount);
      const totalDebt = isDebt ? roundMoney((customerDoc.totalDebt || 0) + serverTotalAmount) : (customerDoc.totalDebt || 0);
      const updatedCustomer = { ...customerDoc, totalPurchases, totalDebt, lastPurchaseDate: new Date().toISOString() };
      txn.update('customers', salePayload.customerId, updatedCustomer);
    }

    return { ok: true, duplicate: false, saleId: salePayload.id, totalAmount: serverTotalAmount, profit: serverProfit };
  });
}

async function startServer() {
  // Execute startup check for uncompleted restore operations (AUDIT-012 Crash Safety)
  try {
    await recoverPendingRestoreOperation();
  } catch (e: any) {
    console.error("[AUDIT-012] Startup recovery check encountered an error:", e.message);
  }

  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: [
          "'self'",
          "https://*.firebaseio.com",
          "https://*.googleapis.com",
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://firestore.googleapis.com",
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: "Too many requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const skipPaths = [
        '/api/auth/login',
        '/api/clockin',
        '/api/clockout',
        '/api/has-employees',
        '/api/bootstrap',
      ];
      return skipPaths.includes(req.path);
    },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many login attempts. Please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Too many admin requests." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(globalLimiter);

  // CORS lock-down
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isProduction = process.env.NODE_ENV === 'production';
    const host = req.headers.host;

    if (!origin) {
      return next();
    }

    if (host) {
      const originHost = origin.replace(/^https?:\/\//, '');
      if (originHost === host) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        return next();
      }
    }

    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
      : [];

    if (!isProduction) {
      allowedOrigins.push('http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173');
    }

    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      return next();
    }

    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'CORS policy: Origin not allowed' });
    }
    return next();
  });

  app.use(express.json({ limit: '10mb' }));

  let aiInstance: GoogleGenAI | null = null;
  function getAI(): GoogleGenAI | null {
    if (aiInstance) return aiInstance;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    aiInstance = new GoogleGenAI({ apiKey });
    return aiInstance;
  }

  // Auth Middleware
  async function requireFirebaseAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies['taiba_session'];

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.split("Bearer ")[1];
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Missing or invalid authorization session" });
    }

    if (token.startsWith('sess_')) {
      const session = serverSessions.get(token);
      if (session && session.expiresAt > Date.now()) {
        req.uid = session.employeeId;
        try {
          const emp = await firestoreGetDocument(`employees/${session.employeeId}`);
          if (emp) {
            req.employee = emp;
            return next();
          }
        } catch {}
      }
      serverSessions.delete(token);
      return res.status(401).json({ error: "Session expired or invalid" });
    }

    try {
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
        }
      );
      if (!resp.ok) {
        return res.status(401).json({ error: "Invalid or expired Firebase Auth token" });
      }
      const data = await resp.json() as any;
      const user = data.users?.[0];
      if (!user) {
        return res.status(401).json({ error: "User not found for token" });
      }
      req.uid = user.localId;
      try {
        const emp = await firestoreGetDocument(`employees/${user.localId}`);
        req.employee = emp || null;
      } catch {
        req.employee = null;
      }
      next();
    } catch (e: any) {
      res.status(401).json({ error: "Token verification failed: " + e.message });
    }
  }

  function requirePermission(perm: string) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const employee = req.employee;
      if (!employee) return res.status(403).json({ error: "Access denied: employee record not found" });
      const perms: string[] = employee.permissions || [];
      if (perms.includes('employees') || perms.includes('settings') || perms.includes(perm)) {
        return next();
      }
      return res.status(403).json({ error: `Access denied: missing "${perm}" permission` });
    };
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const employee = req.employee;
    if (!employee) return res.status(403).json({ error: "Access denied: employee record not found" });
    const perms: string[] = employee.permissions || [];
    if (perms.includes('employees') || perms.includes('settings')) {
      return next();
    }
    return res.status(403).json({ error: "Access denied: admin permission required" });
  }

  // ---- Public / Auth Endpoints ----

  app.get("/api/has-employees", async (req, res) => {
    try {
      const token = await getGoogleAccessToken();
      const baseUrl = getFirestoreBaseUrl();
      const resp = await fetch(
        `${baseUrl}/documents/employees?pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        return res.json({ hasEmployees: false });
      }
      const data = await resp.json() as any;
      const hasEmployees = Boolean(data.documents && data.documents.length > 0);
      res.json({ hasEmployees });
    } catch (e: any) {
      res.json({ hasEmployees: false });
    }
  });

  app.post("/api/bootstrap", async (req, res) => {
    try {
      const { password, name, email } = req.body;
      const expectedPass = process.env.BOOTSTRAP_PASSWORD;
      if (!expectedPass) {
        return res.status(400).json({ error: "Bootstrap is disabled (BOOTSTRAP_PASSWORD not configured)" });
      }
      if (password !== expectedPass) {
        return res.status(403).json({ error: "Invalid bootstrap password" });
      }

      const token = await getGoogleAccessToken();
      const baseUrl = getFirestoreBaseUrl();
      const checkResp = await fetch(
        `${baseUrl}/documents/employees?pageSize=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (checkResp.ok) {
        const checkData = await checkResp.json() as any;
        if (checkData.documents && checkData.documents.length > 0) {
          return res.status(400).json({ error: "System already bootstrapped. Use normal admin login." });
        }
      }

      const adminId = 'emp-admin-01';
      const adminPass = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@123456';
      const passwordHash = hashPassword(adminPass);

      await firestoreSetDocument('employees', adminId, {
        id: adminId,
        name: name || 'المدير العام',
        email: email || 'admin@taiba.local',
        passwordHash,
        role: 'المدير العام',
        type: 'دوام كامل',
        salary: 0,
        permissions: ['dashboard', 'pos', 'inventory', 'customers', 'suppliers', 'expenses', 'employees', 'reports', 'settings', 'attendance'],
        createdAt: new Date().toISOString(),
      });

      await auditLog('bootstrap_executed', 'system', 'system', { adminId });
      res.json({ ok: true, message: "Admin created successfully. Please login and change password immediately." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const { employeeId, password } = req.body;
      if (!employeeId || !password) {
        return res.status(400).json({ error: "Missing employeeId or password" });
      }
      if (!isValidDocumentId(employeeId)) {
        return res.status(400).json({ error: "Invalid employee ID format" });
      }

      const emp = await firestoreGetDocument(`employees/${employeeId}`);
      if (!emp) {
        return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }

      const storedHash = emp.passwordHash || emp.password || '';
      const isValid = verifyPassword(password, storedHash);

      if (!isValid) {
        await auditLog('auth_login_failed', employeeId, emp.email, { reason: 'bad_password', ip: req.ip });
        return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }

      if (isLegacyPassword(storedHash)) {
        try {
          const newHash = hashPassword(password);
          const updatedEmp = { ...emp, passwordHash: newHash };
          delete updatedEmp.password;
          await firestoreSetDocument('employees', employeeId, updatedEmp);
        } catch (migErr) {
          console.error('Password auto-migration failed:', migErr);
        }
      }

      const sessionToken = `sess_${generateSessionToken()}`;
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      serverSessions.set(sessionToken, { employeeId, expiresAt });

      setSessionCookie(res, sessionToken, 24 * 60 * 60 * 1000);

      const safeEmployee = { ...emp };
      delete safeEmployee.passwordHash;
      delete safeEmployee.password;

      await auditLog('auth_login_success', employeeId, emp.email, { ip: req.ip });
      res.json({ ok: true, employee: safeEmployee });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      let token = cookies['taiba_session'];
      if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.split("Bearer ")[1];
        }
      }
      if (token && token.startsWith('sess_')) {
        serverSessions.delete(token);
      }
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/auth/me", requireFirebaseAuth, async (req, res) => {
    try {
      const safeEmployee = { ...req.employee };
      delete safeEmployee.passwordHash;
      delete safeEmployee.password;
      res.json({ ok: true, employee: safeEmployee });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/change-password", requireFirebaseAuth, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل" });
      }

      const emp = req.employee;
      if (!emp) return res.status(404).json({ error: "Employee not found" });

      const storedHash = emp.passwordHash || emp.password || '';
      if (!verifyPassword(oldPassword, storedHash)) {
        return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
      }

      const newHash = hashPassword(newPassword);
      const updated = { ...emp, passwordHash: newHash };
      delete updated.password;
      await firestoreSetDocument('employees', emp.id, updated);

      await auditLog('password_changed', req.uid!, emp.email, { ip: req.ip });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Admin endpoints ----

  app.post("/api/admin/reset-password", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { targetEmployeeId, newPassword } = req.body;
      if (!targetEmployeeId || !newPassword) {
        return res.status(400).json({ error: "Missing targetEmployeeId or newPassword" });
      }
      if (!isValidDocumentId(targetEmployeeId)) return res.status(400).json({ error: "Invalid employee ID format" });
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
      }

      const emp = await firestoreGetDocument(`employees/${targetEmployeeId}`);
      if (!emp) return res.status(404).json({ error: "Target employee not found" });

      const passwordHash = hashPassword(newPassword);
      const updated = { ...emp, passwordHash };
      delete updated.password;
      await firestoreSetDocument('employees', targetEmployeeId, updated);

      for (const [tok, sess] of serverSessions.entries()) {
        if (sess.employeeId === targetEmployeeId) serverSessions.delete(tok);
      }

      await auditLog('admin_reset_password', req.uid!, req.employee?.email, { targetEmployeeId });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/delete-user", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { targetEmployeeId } = req.body;
      if (!targetEmployeeId || !isValidDocumentId(targetEmployeeId)) {
        return res.status(400).json({ error: "Missing or invalid targetEmployeeId" });
      }
      if (targetEmployeeId === req.uid) {
        return res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص" });
      }

      await firestoreDeleteDocument('employees', targetEmployeeId);

      for (const [tok, sess] of serverSessions.entries()) {
        if (sess.employeeId === targetEmployeeId) serverSessions.delete(tok);
      }

      await auditLog('user_deleted', req.uid!, req.employee?.email, { targetEmployeeId });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/create-user", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { name, email, password, role, type, salary, permissions } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: "Missing required fields: name, email, password" });
      }
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
      }

      const empId = 'emp-' + crypto.randomBytes(4).toString('hex');
      const passwordHash = hashPassword(password);

      await firestoreSetDocument('employees', empId, {
        id: empId,
        name,
        email,
        passwordHash,
        role: role || 'كاشير',
        type: type || 'دوام كامل',
        salary: typeof salary === 'number' ? salary : 0,
        permissions: Array.isArray(permissions) ? permissions : ['pos'],
        createdAt: new Date().toISOString(),
      });

      await auditLog('user_created', req.uid!, req.employee?.email, { newUserId: empId, name, role });
      res.json({ ok: true, id: empId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Attendance endpoints (AUDIT-004) ----

  app.post("/api/attendance/active", requireFirebaseAuth, async (req, res) => {
    try {
      const targetId = req.body?.employeeId || req.uid;
      if (!targetId || !isValidDocumentId(targetId)) {
        return res.status(400).json({ error: "Missing or invalid employeeId" });
      }
      const isSelf = targetId === req.uid;
      const isAdmin = req.employee?.permissions?.includes('employees') || req.employee?.permissions?.includes('settings');
      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: "Cannot query attendance for another employee" });
      }
      const session = await executeGetActiveAttendance(targetId);
      res.json({ ok: true, session });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/clockout", requireFirebaseAuth, requireNoActiveRestore, async (req, res) => {
    try {
      const attendanceId = req.body?.attendanceId || req.body?.id;
      const { checkOutTime, durationMinutes } = req.body;
      if (!attendanceId || !isValidDocumentId(attendanceId)) {
        return res.status(400).json({ error: "Missing or invalid attendanceId" });
      }

      const doc = await firestoreGetDocument(`attendance/${attendanceId}`);
      if (!doc) return res.status(404).json({ error: "Attendance record not found" });

      const isSelf = doc.employeeId === req.uid;
      const isAdmin = req.employee?.permissions?.includes('employees') || req.employee?.permissions?.includes('settings');
      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: "Cannot clock out for another employee" });
      }

      const result = await executeClockOut({
        attendanceId,
        checkOutTime,
        durationMinutes,
      });

      if (!result.alreadyClosed) {
        await auditLog('clock_out', req.uid || '', req.employee?.email || '', {
          attendanceId,
          durationMinutes: result.record?.durationMinutes,
        });
      }
      res.json({ ok: true, record: result.record, alreadyClosed: result.alreadyClosed });
    } catch (e: any) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.post("/api/clockin", requireFirebaseAuth, requireNoActiveRestore, async (req, res) => {
    try {
      const { employeeId, employeeName, date, checkInTime } = req.body;
      const targetId = employeeId || req.uid;
      if (!targetId || !isValidDocumentId(targetId)) {
        return res.status(400).json({ error: "Missing or invalid employeeId" });
      }
      const isSelf = targetId === req.uid;
      const isAdmin = req.employee?.permissions?.includes('employees') || req.employee?.permissions?.includes('settings');
      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: "Cannot clock in for another employee" });
      }

      const result = await executeClockIn({
        employeeId: targetId,
        employeeName: employeeName || req.employee?.name || '',
        date,
        checkInTime,
      });

      if (!result.alreadyActive) {
        await auditLog('clock_in', req.uid || '', req.employee?.email || '', { attendanceId: result.id });
      }
      res.json(result);
    } catch (e: any) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
  });

  // ---- AI endpoints (authenticated) ----

  app.post("/api/gemini/suggest-price", requireFirebaseAuth, async (req, res) => {
    try {
      const ai = getAI();
      if (!ai) return res.status(503).json({ error: "AI service not available (API key not configured)" });

      const { name, category, purchasePrice } = req.body;
      const prompt = `أنت خبير تسعير لمحل ملابس أطفال اسمه "طيبة سنتر".
المنتج: "${name || 'غير محدد'}"
القسم: "${category || 'عام'}"
سعر الشراء (التكلفة): ${purchasePrice || 0} دينار ليبي

المطلوب:
1. اقترح سعر بيع مناسب بالدينار الليبي يحقق هامش ربح عادل ومنافس.
2. اكتب تبريراً قصيراً جداً (سطرين كحد أقصى) لسبب هذا السعر.

أجب بصيغة JSON فقط كالتالي:
{"suggestedPrice": number, "reason": "string"}`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });
      res.json(JSON.parse(response.text || '{}'));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/gemini/analyze-business", requireFirebaseAuth, async (req, res) => {
    try {
      const ai = getAI();
      if (!ai) return res.status(503).json({ error: "AI service not available (API key not configured)" });

      const { summary } = req.body;
      const prompt = `أنت مستشار أعمال وتجزئة لمحل ملابس أطفال "طيبة سنتر".
إليك ملخص أداء المحل:
${JSON.stringify(summary, null, 2)}

قدم تحليلاً عملياً ومختصراً يحتوي على:
1. تقييم سريع للأداء المالي.
2. 3 نصائح عملية ومحددة لزيادة المبيعات أو تقليل المصاريف.
3. تنبيه بأي مخاطر (مثل المخزون الراكد أو انخفاض هامش الربح).

اكتب بلهجة مهنية ومشجعة باللغة العربية.`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt
      });
      res.json({ analysis: response.text });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Generic Firestore proxy endpoints ----

  app.post("/api/proxy/set", requireFirebaseAuth, requireNoActiveRestore, async (req, res) => {
    try {
      const { collection, id, data } = req.body;
      if (!collection || !id || !data) return res.status(400).json({ error: "Missing collection, id, or data" });
      if (!isValidCollection(collection)) return res.status(403).json({ error: "Access denied: invalid collection" });
      if (!isValidDocumentId(id)) return res.status(400).json({ error: "Invalid document ID format" });
      if (!hasWritePermission(req.employee, collection)) {
        return res.status(403).json({ error: `Access denied: missing permission for collection "${collection}"` });
      }
      const validationError = validateProxyPayload(collection, id, data);
      if (validationError) return res.status(400).json({ error: validationError });

      await firestoreSetDocument(collection, id, data);
      await auditLog('proxy_set', req.uid || '', req.employee?.email || '', { collection, documentId: id });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proxy/delete", requireFirebaseAuth, requireNoActiveRestore, async (req, res) => {
    try {
      const { collection, id } = req.body;
      if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
      if (!isValidCollection(collection)) return res.status(403).json({ error: "Access denied: invalid collection" });
      if (!isValidDocumentId(id)) return res.status(400).json({ error: "Invalid document ID format" });
      if (!hasWritePermission(req.employee, collection)) {
        return res.status(403).json({ error: `Access denied: missing permission for collection "${collection}"` });
      }
      if (collection === 'audit_logs') {
        return res.status(403).json({ error: "Cannot delete audit logs" });
      }
      if (collection === 'employees' && id === req.uid) {
        return res.status(403).json({ error: "Cannot delete your own employee record via proxy. Use /api/admin/delete-user instead." });
      }
      await firestoreDeleteDocument(collection, id);
      await auditLog('proxy_delete', req.uid || '', req.employee?.email || '', { collection, documentId: id });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proxy/get", requireFirebaseAuth, async (req, res) => {
    try {
      const { path: docPath } = req.body;
      if (!docPath || typeof docPath !== 'string') return res.status(400).json({ error: "Missing or invalid path" });
      const pathParts = docPath.split('/');
      if (pathParts.length !== 2 || !isValidCollection(pathParts[0]) || !isValidDocumentId(pathParts[1])) {
        return res.status(400).json({ error: "Invalid path format. Expected: collection/documentId" });
      }
      const doc = await firestoreGetDocument(docPath);
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proxy/batch", requireFirebaseAuth, requireNoActiveRestore, async (req, res) => {
    try {
      const { writes } = req.body;
      if (!Array.isArray(writes) || writes.length === 0) return res.status(400).json({ error: "Missing or empty writes array" });
      if (writes.length > 500) return res.status(400).json({ error: "Batch size exceeds limit (max 500)" });

      for (const w of writes) {
        if (!w.collection || !isValidCollection(w.collection)) {
          return res.status(400).json({ error: `Invalid collection in batch write: ${w.collection}` });
        }
        if (!w.id || !isValidDocumentId(w.id)) {
          return res.status(400).json({ error: `Invalid document ID in batch write: ${w.id}` });
        }
        if (!hasWritePermission(req.employee, w.collection)) {
          return res.status(403).json({ error: `Access denied: missing permission for collection "${w.collection}"` });
        }
        if (w.type === 'set' && w.data) {
          const valError = validateProxyPayload(w.collection, w.id, w.data);
          if (valError) return res.status(400).json({ error: `Batch validation error on ${w.collection}/${w.id}: ${valError}` });
        }
      }

      const token = await getGoogleAccessToken();
      const baseUrl = getFirestoreBaseUrl();
      const batchBody: any = { writes: writes.map(w => {
        if (w.type === 'set') {
          const fields = jsToFirestoreValue(w.data || {}).mapValue.fields;
          return { update: { name: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}`, fields } };
        }
        if (w.type === 'delete') {
          return { delete: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}` };
        }
        return null;
      }).filter(Boolean) };
      const resp = await fetch(`${baseUrl}/documents:commit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(batchBody),
      });
      if (!resp.ok) throw new Error(`Firestore batch failed: ${resp.status} ${await resp.text()}`);
      await auditLog('proxy_batch', req.uid || '', req.employee?.email || '', { writeCount: writes.length, collections: [...new Set(writes.map((w: any) => w.collection))] });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Sales transactional endpoints (AUDIT-005, AUDIT-013, AUDIT-014 Enforced) ----

  app.post("/api/sales/create", requireFirebaseAuth, requirePermission('pos'), requireNoActiveRestore, async (req, res) => {
    try {
      const { sale } = req.body;
      const valError = validateSalePayload(sale);
      if (valError) return res.status(400).json({ error: valError });

      const result = await executeSaleTransaction(sale);

      // Audit log strictly after successful transaction commit
      if (!result.duplicate) {
        await auditLog('sale_created', req.uid || '', req.employee?.email || '', { saleId: sale.id, totalAmount: result.totalAmount, paymentMethod: sale.paymentMethod });
      }
      res.json(result);
    } catch (e: any) {
      const status = e.status || (e.code === 'INSUFFICIENT_STOCK' ? 400 : 500);
      res.status(status).json({ error: e.message, code: e.code || 'TRANSACTION_ERROR', details: e.available !== undefined ? { available: e.available, requested: e.requested, productId: e.productId } : undefined });
    }
  });

  app.post("/api/sales/update", requireFirebaseAuth, requirePermission('pos'), requireNoActiveRestore, async (req, res) => {
    try {
      const { sale } = req.body;
      const valError = validateSalePayload(sale);
      if (valError) return res.status(400).json({ error: valError });

      const normNew = normalizeCartStockItems(sale.items);
      if (normNew.error) return res.status(400).json({ error: normNew.error });
      const newStockItems = normNew.items || [];

      await runFirestoreTransaction(async (txn) => {
        // 1. Read existing sale
        const oldSaleDoc = await txn.get('sales', sale.id);
        if (!oldSaleDoc || !oldSaleDoc.data) {
          const err: any = new Error("Sale not found");
          err.status = 404;
          throw err;
        }
        const oldSale = oldSaleDoc.data;

        const normOld = normalizeCartStockItems(oldSale.items || []);
        const oldStockItems = normOld.items || [];

        const allProductIds = new Set([
          ...oldStockItems.map(i => i.productId),
          ...newStockItems.map(i => i.productId)
        ]);

        const oldQtyMap = new Map(oldStockItems.map(i => [i.productId, i.totalQuantity]));
        const newQtyMap = new Map(newStockItems.map(i => [i.productId, i.totalQuantity]));

        const productsMap = new Map<string, { data: any; delta: number }>();
        for (const pid of allProductIds) {
          const prodDoc = await txn.get('products', pid);
          if (!prodDoc || !prodDoc.data) {
            const err: any = new Error(`Product not found: ${pid}`);
            err.code = 'PRODUCT_NOT_FOUND';
            err.status = 404;
            throw err;
          }
          const oldQty = oldQtyMap.get(pid) || 0;
          const newQty = newQtyMap.get(pid) || 0;
          const delta = newQty - oldQty;
          const currentStock = prodDoc.data.stock || 0;

          if (delta > 0 && currentStock < delta) {
            const err: any = new Error(`الرصيد غير كافٍ للمنتج "${prodDoc.data.name || pid}": المتوفر ${currentStock}، المطلوب إضافته ${delta}`);
            err.code = 'INSUFFICIENT_STOCK';
            err.status = 400;
            throw err;
          }
          productsMap.set(pid, { data: prodDoc.data, delta });
        }

        let oldCustomerDoc: any = null;
        let newCustomerDoc: any = null;
        if (oldSale.customerId) {
          const c = await txn.get('customers', oldSale.customerId);
          if (c && c.data) oldCustomerDoc = c.data;
        }
        if (sale.customerId && sale.customerId !== oldSale.customerId) {
          const c = await txn.get('customers', sale.customerId);
          if (c && c.data) newCustomerDoc = c.data;
        } else if (sale.customerId) {
          newCustomerDoc = oldCustomerDoc;
        }

        // --- Recalculate totals server-side (AUDIT-013) ---
        let serverTotalAmount = 0;
        let serverTotalCost = 0;
        const verifiedItems = (sale.items as any[]).map((rawItem: any) => {
          if (rawItem.isManualItem) {
            const buyPrice = typeof rawItem.purchasePrice === 'number' && Number.isFinite(rawItem.purchasePrice) && rawItem.purchasePrice >= 0 ? roundMoney(rawItem.purchasePrice) : 0;
            const sellPrice = typeof rawItem.sellingPrice === 'number' && Number.isFinite(rawItem.sellingPrice) && rawItem.sellingPrice > 0 ? roundMoney(rawItem.sellingPrice) : 0;
            const qty = rawItem.quantity || 1;
            serverTotalAmount += sellPrice * qty;
            serverTotalCost += buyPrice * qty;
            return { ...rawItem, sellingPrice: sellPrice, purchasePrice: buyPrice };
          }

          const prod = productsMap.get(rawItem.id)?.data;
          const trustedSellPrice = typeof prod?.sellingPrice === 'number' ? roundMoney(prod.sellingPrice) : (rawItem.sellingPrice || 0);
          const trustedBuyPrice = typeof prod?.purchasePrice === 'number' ? roundMoney(prod.purchasePrice) : (rawItem.purchasePrice || 0);
          const qty = rawItem.quantity;
          serverTotalAmount += trustedSellPrice * qty;
          serverTotalCost += trustedBuyPrice * qty;

          return {
            ...rawItem,
            sellingPrice: trustedSellPrice,
            purchasePrice: trustedBuyPrice,
          };
        });

        serverTotalAmount = roundMoney(serverTotalAmount);
        const serverProfit = roundMoney(serverTotalAmount - serverTotalCost);

        const authoritativeSale = {
          ...sale,
          items: verifiedItems,
          totalAmount: serverTotalAmount,
          profit: serverProfit,
          requestFingerprint: generateSaleRequestFingerprint(sale),
        };

        // 2. Write phase
        txn.set('sales', sale.id, authoritativeSale);

        for (const [pid, { data, delta }] of productsMap.entries()) {
          txn.update('products', pid, { ...data, stock: (data.stock || 0) - delta });
        }

        if (oldCustomerDoc && oldSale.customerId !== sale.customerId) {
          const oldIsDebt = oldSale.paymentMethod === 'آجل (دين)' && !oldSale.isPaid;
          const totalPurchases = roundMoney((oldCustomerDoc.totalPurchases || 0) - (oldSale.totalAmount || 0));
          const totalDebt = roundMoney((oldCustomerDoc.totalDebt || 0) - (oldIsDebt ? (oldSale.totalAmount || 0) : 0));
          txn.update('customers', oldSale.customerId, { ...oldCustomerDoc, totalPurchases: Math.max(0, totalPurchases), totalDebt: Math.max(0, totalDebt) });
        }

        if (newCustomerDoc && sale.customerId) {
          const isSameCust = oldSale.customerId === sale.customerId;
          const prevPurchases = isSameCust ? (oldSale.totalAmount || 0) : 0;
          const prevDebt = (isSameCust && oldSale.paymentMethod === 'آجل (دين)' && !oldSale.isPaid) ? (oldSale.totalAmount || 0) : 0;
          const newIsDebt = sale.paymentMethod === 'آجل (دين)' && !sale.isPaid;

          const totalPurchases = roundMoney((newCustomerDoc.totalPurchases || 0) - prevPurchases + serverTotalAmount);
          const totalDebt = roundMoney((newCustomerDoc.totalDebt || 0) - prevDebt + (newIsDebt ? serverTotalAmount : 0));
          txn.update('customers', sale.customerId, { ...newCustomerDoc, totalPurchases: Math.max(0, totalPurchases), totalDebt: Math.max(0, totalDebt) });
        }
      });

      await auditLog('sale_updated', req.uid || '', req.employee?.email || '', { saleId: sale.id });
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.status || (e.code === 'INSUFFICIENT_STOCK' ? 400 : 500);
      res.status(status).json({ error: e.message, code: e.code || 'TRANSACTION_ERROR' });
    }
  });

  app.post("/api/sales/delete", requireFirebaseAuth, requirePermission('pos'), requireNoActiveRestore, async (req, res) => {
    try {
      const { id } = req.body;
      if (!id || !isValidDocumentId(id)) return res.status(400).json({ error: "Missing or invalid sale ID" });

      await runFirestoreTransaction(async (txn) => {
        const saleDoc = await txn.get('sales', id);
        if (!saleDoc || !saleDoc.data) {
          const err: any = new Error("Sale not found");
          err.status = 404;
          throw err;
        }
        const sale = saleDoc.data;

        const norm = normalizeCartStockItems(sale.items || []);
        const stockItems = norm.items || [];
        const stockMultiplier = sale.type === 'مرتجع' ? -1 : 1;

        const productsMap = new Map<string, any>();
        for (const item of stockItems) {
          const prodDoc = await txn.get('products', item.productId);
          if (prodDoc && prodDoc.data) {
            productsMap.set(item.productId, prodDoc.data);
          }
        }

        let customerDoc: any = null;
        if (sale.customerId) {
          const c = await txn.get('customers', sale.customerId);
          if (c && c.data) customerDoc = c.data;
        }

        txn.delete('sales', id);

        for (const item of stockItems) {
          const product = productsMap.get(item.productId);
          if (product) {
            const restoredStock = (product.stock || 0) + (item.totalQuantity * stockMultiplier);
            txn.update('products', item.productId, { ...product, stock: restoredStock });
          }
        }

        if (sale.customerId && customerDoc) {
          let debtAdjustment = 0;
          if (sale.paymentMethod === 'آجل (دين)' && !sale.isPaid) {
            debtAdjustment = -(sale.totalAmount || 0);
          }
          const totalPurchases = roundMoney((customerDoc.totalPurchases || 0) - (sale.totalAmount || 0));
          const totalDebt = roundMoney((customerDoc.totalDebt || 0) + debtAdjustment);
          const updatedCustomer = { ...customerDoc, totalPurchases: Math.max(0, totalPurchases), totalDebt: Math.max(0, totalDebt) };
          txn.update('customers', sale.customerId, updatedCustomer);
        }
      });

      await auditLog('sale_deleted', req.uid || '', req.employee?.email || '', { saleId: id });
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.post("/api/sales/reschedule-debt", requireFirebaseAuth, requirePermission('pos'), requireNoActiveRestore, async (req, res) => {
    try {
      const { saleId, newDate } = req.body;
      if (!saleId || !isValidDocumentId(saleId)) return res.status(400).json({ error: "Missing or invalid sale ID" });
      if (!newDate || typeof newDate !== 'string') return res.status(400).json({ error: "Missing or invalid new date" });

      const sale = await firestoreGetDocument(`sales/${saleId}`);
      if (!sale) return res.status(404).json({ error: "Sale not found" });

      const updatedSale = { ...sale, dueDate: new Date(newDate).toISOString() };
      await firestoreSetDocument('sales', saleId, updatedSale);
      await auditLog('sale_debt_rescheduled', req.uid || '', req.employee?.email || '', { saleId, newDate });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/sales/settle-debt", requireFirebaseAuth, requirePermission('pos'), requireNoActiveRestore, async (req, res) => {
    try {
      const { saleId } = req.body;
      if (!saleId || !isValidDocumentId(saleId)) return res.status(400).json({ error: "Missing or invalid sale ID" });

      await runFirestoreTransaction(async (txn) => {
        const saleDoc = await txn.get('sales', saleId);
        if (!saleDoc || !saleDoc.data) {
          const err: any = new Error("Sale not found");
          err.status = 404;
          throw err;
        }
        const sale = saleDoc.data;
        if (sale.isPaid) {
          const err: any = new Error("Sale is already settled");
          err.status = 400;
          throw err;
        }

        let customerDoc: any = null;
        if (sale.customerId) {
          const c = await txn.get('customers', sale.customerId);
          if (c && c.data) customerDoc = c.data;
        }

        const updatedSale = { ...sale, isPaid: true, paidAt: new Date().toISOString() };
        txn.update('sales', saleId, updatedSale);

        if (sale.customerId && customerDoc) {
          const totalDebt = roundMoney((customerDoc.totalDebt || 0) - (sale.totalAmount || 0));
          const updatedCustomer = { ...customerDoc, totalDebt: Math.max(0, totalDebt) };
          txn.update('customers', sale.customerId, updatedCustomer);
        }
      });

      await auditLog('sale_debt_settled', req.uid || '', req.employee?.email || '', { saleId });
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.post("/api/sales/return", requireFirebaseAuth, requirePermission('pos'), requireNoActiveRestore, async (req, res) => {
    try {
      const { originalSale, user } = req.body;
      if (!originalSale || typeof originalSale !== 'object') return res.status(400).json({ error: "Missing original sale data" });
      if (!originalSale.id || !isValidDocumentId(originalSale.id)) return res.status(400).json({ error: "Invalid original sale ID" });

      const returnId = `R-${crypto.randomUUID()}`;
      const returnSale = {
        id: returnId,
        type: 'مرتجع',
        date: new Date().toISOString(),
        items: originalSale.items,
        totalAmount: -Math.abs(originalSale.totalAmount),
        profit: -Math.abs(originalSale.profit),
        paymentMethod: originalSale.paymentMethod,
        createdBy: user || req.employee?.email || 'مجهول',
        customerId: originalSale.customerId || '',
        customerName: originalSale.customerName || '',
        originalSaleId: originalSale.id,
        isPaid: true,
      };

      const norm = normalizeCartStockItems(originalSale.items || []);
      const stockItems = norm.items || [];

      await runFirestoreTransaction(async (txn) => {
        const existingSale = await txn.get('sales', originalSale.id);
        if (!existingSale || !existingSale.data) {
          const err: any = new Error("Original sale not found");
          err.status = 404;
          throw err;
        }

        const productsMap = new Map<string, any>();
        for (const item of stockItems) {
          const prodDoc = await txn.get('products', item.productId);
          if (prodDoc && prodDoc.data) {
            productsMap.set(item.productId, prodDoc.data);
          }
        }

        let customerDoc: any = null;
        if (originalSale.customerId) {
          const c = await txn.get('customers', originalSale.customerId);
          if (c && c.data) customerDoc = c.data;
        }

        txn.set('sales', returnId, returnSale);

        for (const item of stockItems) {
          const product = productsMap.get(item.productId);
          if (product) {
            txn.update('products', item.productId, { ...product, stock: (product.stock || 0) + item.totalQuantity });
          }
        }

        if (originalSale.customerId && customerDoc) {
          let debtAdjustment = 0;
          if (originalSale.paymentMethod === 'آجل (دين)' && !originalSale.isPaid) {
            debtAdjustment = -(originalSale.totalAmount || 0);
          }
          const totalPurchases = roundMoney((customerDoc.totalPurchases || 0) - (originalSale.totalAmount || 0));
          const totalDebt = roundMoney((customerDoc.totalDebt || 0) + debtAdjustment);
          const updatedCustomer = { ...customerDoc, totalPurchases: Math.max(0, totalPurchases), totalDebt: Math.max(0, totalDebt) };
          txn.update('customers', originalSale.customerId, updatedCustomer);
        }
      });

      await auditLog('sale_returned', req.uid || '', req.employee?.email || '', { returnId, originalSaleId: originalSale.id, totalAmount: originalSale.totalAmount });
      res.json({ ok: true, returnId });
    } catch (e: any) {
      const status = e.status || 500;
      res.status(status).json({ error: e.message });
    }
  });

  // ---- Backup operation endpoints (admin only, AUDIT-012 Protected) ----

  app.get("/api/backup/export", adminLimiter, requireFirebaseAuth, requireAdmin, requireNoActiveRestore, async (req, res) => {
    try {
      await auditLog('backup_export_started', req.uid || '', req.employee?.email || '', {});
      const backupData = await buildBackupV1Export();

      const todayStr = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="taiba_backup_${todayStr}.json"`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      await auditLog('backup_export_completed', req.uid || '', req.employee?.email || '', {
        counts: backupData.metadata.counts,
        checksum: backupData.metadata.checksum,
      });

      res.json(backupData);
    } catch (e: any) {
      await auditLog('backup_export_failed', req.uid || '', req.employee?.email || '', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/backup/restore", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const payload = req.body?.data || req.body;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: "Missing backup data payload" });
      }

      await auditLog('backup_restore_started', req.uid || '', req.employee?.email || '', {});

      const result = await executeFailureSafeRestore(payload, {
        initiatedBy: req.employee?.email || req.uid,
      });

      await auditLog('backup_restore_completed', req.uid || '', req.employee?.email || '', { stats: result.stats });
      res.json(result);
    } catch (e: any) {
      const status = e.status || 500;
      await auditLog('backup_restore_failed', req.uid || '', req.employee?.email || '', {
        error: e.message,
        code: e.code,
      });
      res.status(status).json({
        error: e.message,
        code: e.code || 'RESTORE_ERROR',
        details: e.originalError || undefined,
      });
    }
  });

  app.post("/api/backup/clear", adminLimiter, requireFirebaseAuth, requireAdmin, requireNoActiveRestore, async (req, res) => {
    try {
      await auditLog('data_clear_requested', req.uid || '', req.employee?.email || '', {});

      for (const coll of ALL_MANAGED_COLLECTIONS) {
        const docs = await firestoreListCollectionDocuments(coll);
        if (docs.length > 0) {
          const deleteWrites = docs.map((d: any) => ({
            type: 'delete' as const, collection: coll, id: d.id
          }));
          await firestoreCommit(deleteWrites);
        }
      }

      await auditLog('data_clear_completed', req.uid || '', req.employee?.email || '', {});
      res.json({ ok: true });
    } catch (e: any) {
      await auditLog('data_clear_failed', req.uid || '', req.employee?.email || '', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/backup/migrate", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { data } = req.body;
      if (!data || typeof data !== 'object') return res.status(400).json({ error: "Missing migration data" });

      const token = await getGoogleAccessToken();
      const baseUrl = getFirestoreBaseUrl();
      const metaResp = await fetch(
        `${baseUrl}/documents/metadata/migration_status`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (metaResp.ok) {
        const metaData = await metaResp.json() as any;
        const migrated = metaData.fields?.migrated?.booleanValue;
        if (migrated) return res.json({ ok: false, message: "Already migrated" });
      }

      await auditLog('migration_started', req.uid || '', req.employee?.email || '', {});

      const writeArrayData = async (items: any[], collectionName: string) => {
        if (!Array.isArray(items)) return;
        const writes: { type: 'set'; collection: string; id: string; data: any }[] = [];
        for (const item of items) {
          if (item && item.id && isValidDocumentId(item.id)) {
            writes.push({ type: 'set', collection: collectionName, id: item.id, data: item });
          }
        }
        for (let i = 0; i < writes.length; i += 450) {
          await firestoreCommit(writes.slice(i, i + 450));
        }
      };

      await writeArrayData(data.products, 'products');
      await writeArrayData(data.sales, 'sales');
      await writeArrayData(data.expenses, 'expenses');
      await writeArrayData(data.employees, 'employees');
      await writeArrayData(data.customers, 'customers');
      await writeArrayData(data.suppliers, 'suppliers');
      await writeArrayData(data.attendance, 'attendance');

      if (Array.isArray(data.categories)) {
        await firestoreSetDocument('categories', 'all', { items: data.categories });
      }
      if (Array.isArray(data.seasons)) {
        await firestoreSetDocument('seasons', 'all', { items: data.seasons });
      }

      await firestoreSetDocument('metadata', 'migration_status', { migrated: true, timestamp: new Date().toISOString() });
      await auditLog('migration_completed', req.uid || '', req.employee?.email || '', {});
      res.json({ ok: true });
    } catch (e: any) {
      await auditLog('migration_failed', req.uid || '', req.employee?.email || '', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ---- end proxy endpoints ----

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    } catch (err) {
      serveStatic();
    }
  } else {
    serveStatic();
  }

  function serveStatic() {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only start the server if not running inside a test runner
if (process.env.NODE_ENV !== 'test') {
  startServer();
}
