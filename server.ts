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

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computedHash, 'hex'));
    } catch {
      return false;
    }
  }
  // Legacy sha256 fallback compatibility
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return storedHash === legacyHash;
}

// ---- Firestore REST API proxy (bypasses restrictive security rules) ----
const FIRESTORE_DB_PATH = "projects/adroit-weaver-v6tp2/databases/ai-studio-taibacentermanag-c767774a-873a-4b8d-81a6-1c3761dba0ea";

function jsToFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  const t = typeof val;
  if (t === "string") return { stringValue: val };
  if (t === "boolean") return { booleanValue: val };
  if (t === "number") return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(jsToFirestoreValue) } };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (t === "object") {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function firestoreValueToJs(val: any): any {
  if (!val || typeof val !== "object") return val;
  if (val.nullValue !== undefined) return null;
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.integerValue !== undefined) return Number(val.integerValue);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.mapValue?.fields) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields)) obj[k] = firestoreValueToJs(v);
    return obj;
  }
  if (val.arrayValue?.values) return val.arrayValue.values.map(firestoreValueToJs);
  return val;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth env vars not configured");
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await resp.json() as any;
  if (!data.access_token) throw new Error("Failed to get Google access token: " + JSON.stringify(data));
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function firestoreGetDocument(path: string) {
  const token = await getGoogleAccessToken();
  const resp = await fetch(`https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) throw new Error(`Firestore GET failed: ${resp.status} ${await resp.text()}`);
  if (resp.status === 404) return null;
  const data = await resp.json() as any;
  const result: Record<string, any> = { id: data.name.split("/").pop() };
  if (data.fields) {
    for (const [k, v] of Object.entries(data.fields)) {
      result[k] = firestoreValueToJs(v as any);
    }
  }
  return result;
}

async function firestoreSetDocument(collection: string, id: string, data: any) {
  const token = await getGoogleAccessToken();
  const body = { fields: jsToFirestoreValue(data).mapValue.fields };
  let resp = await fetch(
    `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${collection}/${id}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (resp.status === 404) {
    resp = await fetch(
      `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${collection}?documentId=${id}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
  }
  if (!resp.ok) throw new Error(`Firestore SET failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function firestoreDeleteDocument(collection: string, id: string) {
  const token = await getGoogleAccessToken();
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${collection}/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok && resp.status !== 404) throw new Error(`Firestore DELETE failed: ${resp.status} ${await resp.text()}`);
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

  while (attempt < maxRetries) {
    attempt++;
    const token = await getGoogleAccessToken();

    const beginBody: any = { options: { readWrite: {} } };
    if (previousTxnId) {
      beginBody.options.readWrite.retryTransaction = previousTxnId;
    }

    const beginResp = await fetch(
      `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents:beginTransaction`,
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
    let hasWritten = false;

    const txn: FirestoreTransaction = {
      async get(collection: string, id: string) {
        if (hasWritten) {
          throw new Error("Firestore transactions require all reads to execute before writes.");
        }
        const resp = await fetch(
          `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${collection}/${id}?transaction=${encodeURIComponent(txnId)}`,
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
      // Explicitly rollback transaction on business logic error or insufficient stock
      try {
        await fetch(
          `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents:rollback`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ transaction: txnId }),
          }
        );
      } catch {}
      throw userErr;
    }

    if (writes.length === 0) {
      return result;
    }

    const commitBody: any = {
      transaction: txnId,
      writes: writes.map(w => {
        if (w.type === 'delete') {
          return { delete: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}` };
        }
        const fields = jsToFirestoreValue(w.data || {}).mapValue.fields;
        return {
          update: {
            name: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}`,
            fields,
          },
        };
      }),
    };

    const commitResp = await fetch(
      `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents:commit`,
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
    const isContention = commitResp.status === 409 || commitErrText.includes("ABORTED") || commitErrText.includes("conflict");
    if (isContention && attempt < maxRetries) {
      const backoffMs = Math.min(1000, Math.pow(2, attempt) * 40 + Math.floor(Math.random() * 30));
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      continue;
    }

    throw new Error(`Firestore transaction commit failed: ${commitResp.status} ${commitErrText}`);
  }

  throw new Error("Firestore transaction exceeded maximum retries due to contention.");
}

// ---- end Firestore proxy ----

async function auditLog(eventType: string, userId: string, userEmail: string, details: Record<string, any> = {}) {
  try {
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await firestoreSetDocument('audit_logs', id, {
      id,
      timestamp: new Date().toISOString(),
      eventType,
      userId,
      userEmail,
      ...details,
    });
  } catch (e) {
    console.error('Failed to write audit log:', e);
  }
}

async function startServer() {
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Security Headers
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://firestore.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "wss://*.firebaseio.com"],
      }
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS - allow same-origin and configured origins (API routes only)
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();

    const origin = req.headers.origin;
    const host = req.headers.host;

    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host === host) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          if (req.method === 'OPTIONS') return res.sendStatus(204);
          return next();
        }
      } catch {}
    }

    if (ALLOWED_ORIGINS.length > 0 && origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
      // allow same-origin
    } else if (isProduction && origin) {
      return res.status(403).json({ error: "CORS origin denied" });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Body Parser (Limit payload size to 10mb for backups)
  app.use(express.json({ limit: "10mb" }));

  // In-Memory Session Store
  const sessions = new Map<string, { uid: string; email: string; createdAt: number }>();
  const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  function createSession(uid: string, email: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { uid, email, createdAt: Date.now() });
    return token;
  }

  function getSession(token: string): { uid: string; email: string } | null {
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > SESSION_TTL) {
      sessions.delete(token);
      return null;
    }
    return { uid: session.uid, email: session.email };
  }

  // Rate Limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const p = req.path;
      return p === '/api/auth/login' || p === '/api/clockin' || p === '/api/clockout';
    },
    message: { error: "طلبات كثيرة جداً، يرجى المحاولة لاحقاً" }
  });

  app.use("/api/", apiLimiter);

  // Stricter rate limit for admin/user-management endpoints
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "طلبات كثيرة جداً، يرجى المحاولة لاحقاً" }
  });

  let aiClient: GoogleGenAI | null = null;
  function getAI() {
    if (!aiClient) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return null;
      aiClient = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
    }
    return aiClient;
  }

  // Authentication Middleware
  const requireFirebaseAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: "Missing or invalid authorization header" });
      }

      const token = authHeader.split('Bearer ')[1];
      try {
          let uid: string | null = null;
          const session = getSession(token);
          if (session) {
              uid = session.uid;
          } else {
              const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.VITE_FIREBASE_API_KEY || ''}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ idToken: token })
              });
              if (!resp.ok) {
                  return res.status(401).json({ error: "Unauthorized: Invalid token" });
              }
              const data = await resp.json() as any;
              uid = data.users?.[0]?.localId;
          }

          if (!uid) {
              return res.status(401).json({ error: "Invalid token payload" });
          }
          const employee = await firestoreGetDocument(`employees/${uid}`);
          if (!employee) {
              return res.status(403).json({ error: "Employee record not found" });
          }
          req.uid = uid;
          req.employee = employee;
          next();
      } catch (e) {
          res.status(500).json({ error: "Failed to verify token" });
      }
  };

  // Require a specific permission on the authenticated employee
  const requirePermission = (permission: string) => {
      return (req: express.Request, res: express.Response, next: express.NextFunction) => {
          if (!req.employee) {
              return res.status(401).json({ error: "Authentication required" });
          }
          const permissions: string[] = req.employee.permissions || [];
          if (!permissions.includes(permission) && !permissions.includes('employees') && !permissions.includes('settings')) {
              return res.status(403).json({ error: `Missing required permission: ${permission}` });
          }
          next();
      };
  };

  // Require admin-level access (employees permission or settings)
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!req.employee) {
          return res.status(401).json({ error: "Authentication required" });
      }
      const permissions: string[] = req.employee.permissions || [];
      if (!permissions.includes('employees') && !permissions.includes('settings')) {
          return res.status(403).json({ error: "Admin access required" });
      }
      next();
  };

  // ---- Public endpoints (no auth required) ----

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  app.get("/api/admin/has-employees", async (_req, res) => {
    try {
      const token = await getGoogleAccessToken();
      const resp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/employees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (resp.ok) {
        const data = await resp.json() as any;
        return res.json({ hasEmployees: !!(data.documents && data.documents.length > 0) });
      }
      res.json({ hasEmployees: false });
    } catch {
      res.json({ hasEmployees: false });
    }
  });

  app.get("/api/auth/employees", async (_req, res) => {
    try {
      const token = await getGoogleAccessToken();
      const resp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/employees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) return res.json([]);
      const data = await resp.json() as any;
      if (!data.documents) return res.json([]);
      const employees = data.documents.map((doc: any) => {
        const f = doc.fields || {};
        return {
          id: doc.name.split('/').pop(),
          name: f.name?.stringValue || '',
          email: f.email?.stringValue || '',
        };
      }).filter((e: any) => e.name || e.email);
      res.json(employees);
    } catch {
      res.json([]);
    }
  });

  const BOOTSTRAP_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'TaibaAdmin2024!';

  app.post("/api/admin/bootstrap", adminLimiter, async (req, res) => {
    try {
      const token = await getGoogleAccessToken();
      const checkResp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/employees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (checkResp.ok) {
        const data = await checkResp.json() as any;
        if (data.documents && data.documents.length > 0) {
          return res.status(403).json({ error: "System is already initialized. Bootstrap endpoint is disabled." });
        }
      }

      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: "Missing required fields: name, email, password" });
      }
      if (password !== BOOTSTRAP_PASSWORD) {
        return res.status(403).json({ error: "Invalid bootstrap authorization password" });
      }

      const adminId = 'admin-' + crypto.randomBytes(4).toString('hex');
      const passwordHash = hashPassword(password);

      await firestoreSetDocument('employees', adminId, {
        id: adminId,
        name,
        email,
        passwordHash,
        role: 'مدير',
        type: 'دوام كامل',
        salary: 0,
        permissions: ['dashboard', 'pos', 'invoices', 'inventory', 'reports', 'expenses', 'employees', 'settings'],
        createdAt: new Date().toISOString(),
      });

      const sessionToken = createSession(adminId, email);
      await auditLog('system_bootstrap', adminId, email, { name, role: 'مدير' });
      res.json({ ok: true, token: sessionToken, employee: { id: adminId, name, email, role: 'مدير' } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/login", adminLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Missing email or password" });
      }

      const token = await getGoogleAccessToken();
      const resp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/employees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) return res.status(401).json({ error: "Invalid credentials" });

      const data = await resp.json() as any;
      const docs = data.documents || [];

      let matchedEmployee: any = null;
      for (const doc of docs) {
        const emp = { id: doc.name.split('/').pop(), ...firestoreValueToJs({ mapValue: { fields: doc.fields } }) };
        if (emp.email?.toLowerCase() === email.toLowerCase() || emp.name === email) {
          matchedEmployee = emp;
          break;
        }
      }

      if (!matchedEmployee || !matchedEmployee.passwordHash) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValid = verifyPassword(password, matchedEmployee.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (!matchedEmployee.passwordHash.startsWith('scrypt$')) {
        const upgradedHash = hashPassword(password);
        await firestoreSetDocument('employees', matchedEmployee.id, {
          ...matchedEmployee,
          passwordHash: upgradedHash,
        });
      }

      const sessionToken = createSession(matchedEmployee.id, matchedEmployee.email);
      const { passwordHash: _, ...safeEmployee } = matchedEmployee;
      await auditLog('user_login', matchedEmployee.id, matchedEmployee.email, {});
      res.json({ ok: true, token: sessionToken, employee: safeEmployee });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        sessions.delete(token);
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/change-password", requireFirebaseAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Missing current or new password" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const employee = req.employee;
      if (!employee.passwordHash || !verifyPassword(currentPassword, employee.passwordHash)) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const newHash = hashPassword(newPassword);
      await firestoreSetDocument('employees', req.uid!, {
        ...employee,
        passwordHash: newHash,
      });

      await auditLog('password_changed', req.uid!, employee.email, {});
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Admin user management endpoints ----

  app.post("/api/admin/migrate-users", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { users } = req.body;
      if (!Array.isArray(users)) return res.status(400).json({ error: "Users must be an array" });

      let count = 0;
      for (const u of users) {
        if (!u.id || !u.name) continue;
        const passwordHash = hashPassword(u.password || '123456');
        await firestoreSetDocument('employees', u.id, {
          id: u.id,
          name: u.name,
          email: u.email || `${u.name}@taiba.local`,
          passwordHash,
          role: u.role || 'كاشير',
          type: u.type || 'دوام كامل',
          salary: u.salary || 0,
          permissions: u.permissions || ['pos'],
        });
        count++;
      }

      await auditLog('users_migrated', req.uid!, req.employee?.email, { count });
      res.json({ ok: true, count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/delete-user", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { uid } = req.body;
      if (!uid || !isValidDocumentId(uid)) return res.status(400).json({ error: "Missing or invalid uid" });
      if (uid === req.uid) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      await firestoreDeleteDocument('employees', uid);

      const token = await getGoogleAccessToken();
      const attResp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/attendance`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (attResp.ok) {
        const attData = await attResp.json() as any;
        const attDocs = attData.documents || [];
        for (const doc of attDocs) {
          const empId = doc.fields?.employeeId?.stringValue;
          if (empId === uid) {
            const attId = doc.name.split('/').pop();
            await firestoreDeleteDocument('attendance', attId);
          }
        }
      }

      await auditLog('user_deleted', req.uid!, req.employee?.email, { targetUid: uid });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/reset-password", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { uid, newPassword } = req.body;
      if (!uid || !isValidDocumentId(uid) || !newPassword) {
        return res.status(400).json({ error: "Missing uid or newPassword" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const targetEmp = await firestoreGetDocument(`employees/${uid}`);
      if (!targetEmp) return res.status(404).json({ error: "Employee not found" });

      const newHash = hashPassword(newPassword);
      await firestoreSetDocument('employees', uid, {
        ...targetEmp,
        passwordHash: newHash,
      });

      await auditLog('password_reset_by_admin', req.uid!, req.employee?.email, { targetUid: uid });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/create-user", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { name, email, password, role, type, salary, permissions } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: "Missing name, email, or password" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
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

  // ---- Attendance endpoints ----

  app.post("/api/clockout", requireFirebaseAuth, async (req, res) => {
    try {
      const { attendanceId, checkOutTime, durationMinutes } = req.body;
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

      const now = checkOutTime || new Date().toISOString();
      const updated = {
        ...doc,
        checkOutTime: now,
        durationMinutes: durationMinutes ?? (doc.checkInTime ? Math.round((new Date(now).getTime() - new Date(doc.checkInTime).getTime()) / 60000) : 0),
      };
      await firestoreSetDocument('attendance', attendanceId, updated);
      await auditLog('clock_out', req.uid || '', req.employee?.email || '', { attendanceId, durationMinutes: updated.durationMinutes });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/clockin", requireFirebaseAuth, async (req, res) => {
    try {
      const { employeeId, employeeName, date, checkInTime } = req.body;
      if (!employeeId || !isValidDocumentId(employeeId)) {
        return res.status(400).json({ error: "Missing or invalid employeeId" });
      }
      const isSelf = employeeId === req.uid;
      const isAdmin = req.employee?.permissions?.includes('employees') || req.employee?.permissions?.includes('settings');
      if (!isSelf && !isAdmin) {
        return res.status(403).json({ error: "Cannot clock in for another employee" });
      }

      const id = crypto.randomUUID();
      const record = {
        id,
        employeeId,
        employeeName: employeeName || req.employee?.name || '',
        date: date || new Date().toISOString().split('T')[0],
        checkInTime: checkInTime || new Date().toISOString(),
        checkOutTime: null,
        durationMinutes: null,
      };
      await firestoreSetDocument('attendance', id, record);
      await auditLog('clock_in', req.uid || '', req.employee?.email || '', { attendanceId: id });
      res.json({ ok: true, id, record });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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

  app.post("/api/proxy/set", requireFirebaseAuth, async (req, res) => {
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

  app.post("/api/proxy/delete", requireFirebaseAuth, async (req, res) => {
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

  app.post("/api/proxy/batch", requireFirebaseAuth, async (req, res) => {
    try {
      const { writes } = req.body;
      if (!Array.isArray(writes) || writes.length === 0) return res.status(400).json({ error: "Missing or empty writes array" });
      if (writes.length > 500) return res.status(400).json({ error: "Batch size exceeds limit (max 500)" });

      for (const w of writes) {
        if (!w.collection || !isValidCollection(w.collection)) {
          return res.status(403).json({ error: `Access denied: invalid collection "${w.collection}"` });
        }
        if (!w.id || !isValidDocumentId(w.id)) {
          return res.status(400).json({ error: `Invalid document ID: "${w.id}"` });
        }
        if (w.type !== "set" && w.type !== "delete") {
          return res.status(400).json({ error: `Invalid write type: "${w.type}"` });
        }
        if (!hasWritePermission(req.employee, w.collection)) {
          return res.status(403).json({ error: `Access denied: missing permission for collection "${w.collection}"` });
        }
        if (w.type === "set") {
          const validationError = validateProxyPayload(w.collection, w.id, w.data);
          if (validationError) return res.status(400).json({ error: `${w.collection}/${w.id}: ${validationError}` });
        }
        if (w.type === "delete" && w.collection === 'audit_logs') {
          return res.status(403).json({ error: "Cannot delete audit logs" });
        }
        if (w.type === "delete" && w.collection === 'employees' && w.id === req.uid) {
          return res.status(403).json({ error: "Cannot delete your own employee record via batch" });
        }
      }

      const token = await getGoogleAccessToken();
      const batchBody: any = { writes: writes.map((w: any) => {
        if (w.type === "set") {
          return { update: { name: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}`, fields: jsToFirestoreValue(w.data).mapValue.fields } };
        }
        if (w.type === "delete") {
          return { delete: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}` };
        }
        return null;
      }).filter(Boolean) };
      const resp = await fetch(`https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents:commit`, {
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

  // ---- Firestore batch commit helper (for legacy and maintenance operations) ----

  async function firestoreCommit(writes: { type: 'set' | 'update' | 'delete'; collection: string; id: string; data?: any }[]): Promise<void> {
    if (writes.length === 0) return;
    const token = await getGoogleAccessToken();
    const batchBody: any = {
      writes: writes.map(w => {
        if (w.type === 'delete') {
          return { delete: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}` };
        }
        const fields = jsToFirestoreValue(w.data || {}).mapValue.fields;
        return { update: { name: `${FIRESTORE_DB_PATH}/documents/${w.collection}/${w.id}`, fields } };
      }),
    };
    const resp = await fetch(`https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batchBody),
    });
    if (!resp.ok) throw new Error(`Firestore commit failed: ${resp.status} ${await resp.text()}`);
  }

  // ---- Sales transactional endpoints (AUDIT-005 Fixed: Full ACID & Concurrency Guarantees) ----

  app.post("/api/sales/create", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
    try {
      const { sale } = req.body;
      const valError = validateSalePayload(sale);
      if (valError) return res.status(400).json({ error: valError });

      const norm = normalizeCartStockItems(sale.items);
      if (norm.error) return res.status(400).json({ error: norm.error });
      const stockItems = norm.items || [];

      await runFirestoreTransaction(async (txn) => {
        // --- 1. READ PHASE (all reads strictly before writes) ---
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

        let customerDoc: any = null;
        if (sale.customerId) {
          const cust = await txn.get('customers', sale.customerId);
          if (cust && cust.data) {
            customerDoc = cust.data;
          }
        }

        // --- 2. WRITE PHASE (atomic commit) ---
        txn.set('sales', sale.id, sale);

        for (const item of stockItems) {
          const product = productsMap.get(item.productId);
          const newStock = (product.stock || 0) - item.totalQuantity;
          txn.update('products', item.productId, { ...product, stock: newStock });
        }

        if (sale.customerId && customerDoc) {
          const isDebt = sale.paymentMethod === 'آجل (دين)';
          const totalPurchases = (customerDoc.totalPurchases || 0) + sale.totalAmount;
          const totalDebt = isDebt ? (customerDoc.totalDebt || 0) + sale.totalAmount : (customerDoc.totalDebt || 0);
          const updatedCustomer = { ...customerDoc, totalPurchases, totalDebt, lastPurchaseDate: new Date().toISOString() };
          txn.update('customers', sale.customerId, updatedCustomer);
        }
      });

      // Audit log strictly after successful transaction commit
      await auditLog('sale_created', req.uid || '', req.employee?.email || '', { saleId: sale.id, totalAmount: sale.totalAmount, paymentMethod: sale.paymentMethod });
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.status || (e.code === 'INSUFFICIENT_STOCK' ? 400 : 500);
      res.status(status).json({ error: e.message, code: e.code || 'TRANSACTION_ERROR', details: e.available !== undefined ? { available: e.available, requested: e.requested, productId: e.productId } : undefined });
    }
  });

  app.post("/api/sales/update", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
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

        // 2. Write phase
        txn.set('sales', sale.id, sale);

        for (const [pid, { data, delta }] of productsMap.entries()) {
          txn.update('products', pid, { ...data, stock: (data.stock || 0) - delta });
        }

        if (oldCustomerDoc && oldSale.customerId !== sale.customerId) {
          const oldIsDebt = oldSale.paymentMethod === 'آجل (دين)' && !oldSale.isPaid;
          const totalPurchases = (oldCustomerDoc.totalPurchases || 0) - (oldSale.totalAmount || 0);
          const totalDebt = (oldCustomerDoc.totalDebt || 0) - (oldIsDebt ? (oldSale.totalAmount || 0) : 0);
          txn.update('customers', oldSale.customerId, { ...oldCustomerDoc, totalPurchases: Math.max(0, totalPurchases), totalDebt: Math.max(0, totalDebt) });
        }

        if (newCustomerDoc && sale.customerId) {
          const isSameCust = oldSale.customerId === sale.customerId;
          const prevPurchases = isSameCust ? (oldSale.totalAmount || 0) : 0;
          const prevDebt = (isSameCust && oldSale.paymentMethod === 'آجل (دين)' && !oldSale.isPaid) ? (oldSale.totalAmount || 0) : 0;
          const newIsDebt = sale.paymentMethod === 'آجل (دين)' && !sale.isPaid;

          const totalPurchases = (newCustomerDoc.totalPurchases || 0) - prevPurchases + sale.totalAmount;
          const totalDebt = (newCustomerDoc.totalDebt || 0) - prevDebt + (newIsDebt ? sale.totalAmount : 0);
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

  app.post("/api/sales/delete", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
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
          const totalPurchases = (customerDoc.totalPurchases || 0) - (sale.totalAmount || 0);
          const totalDebt = (customerDoc.totalDebt || 0) + debtAdjustment;
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

  app.post("/api/sales/reschedule-debt", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
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

  app.post("/api/sales/settle-debt", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
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
          const totalDebt = (customerDoc.totalDebt || 0) - (sale.totalAmount || 0);
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

  app.post("/api/sales/return", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
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
          const totalPurchases = (customerDoc.totalPurchases || 0) - (originalSale.totalAmount || 0);
          const totalDebt = (customerDoc.totalDebt || 0) + debtAdjustment;
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

  // ---- Backup operation endpoints (admin only) ----

  app.post("/api/backup/restore", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { data } = req.body;
      if (!data || typeof data !== 'object') return res.status(400).json({ error: "Missing backup data" });

      await auditLog('backup_restore_started', req.uid || '', req.employee?.email || '', {});

      const collectionsToClear = ['products', 'sales', 'expenses', 'employees', 'customers', 'suppliers', 'attendance', 'categories', 'seasons', 'metadata'];
      for (const coll of collectionsToClear) {
        const token = await getGoogleAccessToken();
        const listResp = await fetch(
          `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${coll}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (listResp.ok) {
          const listData = await listResp.json() as any;
          const docs = listData.documents || [];
          if (docs.length > 0) {
            const deleteWrites = docs.map((d: any) => ({
              type: 'delete' as const, collection: coll, id: d.name.split('/').pop()
            }));
            await firestoreCommit(deleteWrites);
          }
        }
      }

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
      await writeArrayData(data.attendance, 'attendance');
      await writeArrayData(data.suppliers, 'suppliers');

      if (Array.isArray(data.categories)) {
        await firestoreSetDocument('categories', 'all', { items: data.categories });
      }
      if (Array.isArray(data.seasons)) {
        await firestoreSetDocument('seasons', 'all', { items: data.seasons });
      }

      await auditLog('backup_restore_completed', req.uid || '', req.employee?.email || '', {});
      res.json({ ok: true });
    } catch (e: any) {
      await auditLog('backup_restore_failed', req.uid || '', req.employee?.email || '', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/backup/clear", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      await auditLog('data_clear_requested', req.uid || '', req.employee?.email || '', {});

      const collectionsToClear = ['products', 'sales', 'expenses', 'employees', 'customers', 'suppliers', 'attendance', 'categories', 'seasons', 'metadata'];
      for (const coll of collectionsToClear) {
        const token = await getGoogleAccessToken();
        const listResp = await fetch(
          `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/${coll}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (listResp.ok) {
          const listData = await listResp.json() as any;
          const docs = listData.documents || [];
          if (docs.length > 0) {
            const deleteWrites = docs.map((d: any) => ({
              type: 'delete' as const, collection: coll, id: d.name.split('/').pop()
            }));
            await firestoreCommit(deleteWrites);
          }
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
      const metaResp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/metadata/migration_status`,
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
startServer();
