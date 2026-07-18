import 'dotenv/config';
import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ALLOWED_COLLECTIONS, isValidCollection, isValidDocumentId, WRITE_PERMISSIONS, hasWritePermission, validateProxyPayload } from './server-auth';


declare global {
  namespace Express {
    interface Request {
      uid?: string;
      employee?: any;
    }
  }
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
// ---- end Firestore proxy ----

async function auditLog(eventType: string, userId: string, userEmail: string, details: Record<string, any> = {}) {
  try {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  // CORS - restrict to known origins (API routes only; static files are same-origin)
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  app.use((req, res, next) => {
    // Skip CORS for non-API requests (static assets, index.html, etc.)
    if (!req.path.startsWith('/api/')) return next();

    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.length === 0) {
      if (isProduction) {
        // In production with no allowed origins configured, reject cross-origin requests
        // Only same-origin requests (no Origin header) are allowed
        if (origin) {
          return res.status(403).json({ error: "CORS: No allowed origins configured" });
        }
      } else {
        // In development, allow all origins
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "10mb" }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
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

  // Load Firebase Config for Auth (from env var only — file fallback removed for security)
  let firebaseConfig: any = null;
  try {
      const envConfig = process.env.FIREBASE_APPLET_CONFIG;
      if (envConfig) {
          firebaseConfig = JSON.parse(envConfig);
          console.log("Firebase config loaded from environment variable.");
      } else {
          console.warn("FIREBASE_APPLET_CONFIG env var not set. Authentication verification will fail.");
      }
  } catch (e) {
      console.warn("Failed to parse FIREBASE_APPLET_CONFIG, authentication verification will fail.");
  }

  // ---- Auth Middleware ----

  // Verify Firebase ID token, extract UID, and look up employee record
  const requireFirebaseAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(' ')[1];
      if (!firebaseConfig?.apiKey) {
          return res.status(500).json({ error: "Server authentication misconfigured." });
      }
      try {
          const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`;
          const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: token })
          });
          if (!response.ok) {
              return res.status(401).json({ error: "Invalid or expired token" });
          }
          const data = await response.json() as any;
          const uid = data?.users?.[0]?.localId;
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
          if (!permissions.includes(permission)) {
              return res.status(403).json({ error: `Missing required permission: ${permission}` });
          }
          next();
      };
  };

  // Require admin-level access (employees permission)
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

  // Bootstrap: create first admin user (only works when no employees exist)
  // Password is NEVER sent to or compared on the client — all validation is server-side.
  app.post("/api/admin/bootstrap", adminLimiter, async (req, res) => {
    try {
      if (!firebaseConfig?.apiKey) {
        return res.status(500).json({ error: "Firebase config not available" });
      }

      const bootstrapPassword = process.env.BOOTSTRAP_PASSWORD;
      if (!bootstrapPassword) {
        return res.status(503).json({ error: "Bootstrap not available: BOOTSTRAP_PASSWORD env var not set" });
      }

      const { email, password } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: "Invalid email" });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: "Password is required" });
      }
      if (password !== bootstrapPassword) {
        return res.status(403).json({ error: "Invalid bootstrap password" });
      }

      // Check if any employees already exist
      const token = await getGoogleAccessToken();
      const listResp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/employees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (listResp.ok) {
        const listData = await listResp.json() as any;
        if (listData.documents && listData.documents.length > 0) {
          return res.status(409).json({ error: "Employees already exist. Bootstrap is only available for initial setup." });
        }
      }

      // Create Firebase Auth user
      const createResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );
      const createData = await createResp.json() as any;
      if (!createResp.ok) {
        const msg = createData?.error?.message || 'Failed to create user';
        if (msg === 'EMAIL_EXISTS') {
          return res.status(409).json({ error: "Email already exists in Firebase Auth" });
        }
        return res.status(400).json({ error: msg });
      }

      const newUid = createData.localId;

      // Create employee document with full admin permissions
      const adminEmployee = {
        id: newUid,
        name: 'المدير العام',
        email: email,
        role: 'مدير',
        type: 'دوام كامل',
        salary: 0,
        permissions: ['dashboard', 'pos', 'invoices', 'inventory', 'reports', 'expenses', 'employees', 'settings'],
      };
      await firestoreSetDocument("employees", newUid, adminEmployee);

      auditLog('admin_bootstrap', newUid, email, {});

      res.json({ uid: newUid, employee: adminEmployee });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Authenticated endpoints ----

  // Migrate existing users to Firebase Auth (admin operation via REST API)
  app.post("/api/admin/migrate-users", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      if (!firebaseConfig?.apiKey) {
        return res.status(500).json({ error: "Firebase config not available" });
      }

      // Get all employees from Firestore
      const token = await getGoogleAccessToken();
      const listResp = await fetch(
        `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/employees`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (!listResp.ok) {
        return res.status(500).json({ error: "Failed to fetch employees" });
      }

      const listData = await listResp.json() as any;
      const documents = listData.documents || [];
      
      const results = {
        migrated: [] as { oldId: string; newUid: string; email: string }[],
        skipped: [] as { id: string; reason: string }[],
        errors: [] as { id: string; error: string }[]
      };

      for (const docRef of documents) {
        const oldId = docRef.name.split('/').pop();
        const fields = docRef.fields || {};
        
        // Extract employee data
        const email = fields.email?.stringValue;
        const password = fields.password?.stringValue;
        const name = fields.name?.stringValue;
        
        // Skip if already has a Firebase Auth UID (no password field means migrated)
        if (!password) {
          results.skipped.push({ id: oldId, reason: "No password field (already migrated)" });
          continue;
        }
        
        // Skip if no email
        if (!email) {
          results.skipped.push({ id: oldId, reason: "No email address" });
          continue;
        }

        try {
          // Create Firebase Auth user with the existing password
          const createResp = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password, returnSecureToken: true }),
            }
          );
          
          const createData = await createResp.json() as any;
          
          if (!createResp.ok) {
            const msg = createData?.error?.message || 'Failed to create user';
            if (msg === 'EMAIL_EXISTS') {
              // User already exists in Firebase Auth, skip
              results.skipped.push({ id: oldId, reason: "Email already exists in Firebase Auth" });
              continue;
            }
            results.errors.push({ id: oldId, error: msg });
            continue;
          }

          const newUid = createData.localId;
          
          // Update employee document with new UID and remove password field
          const updatedEmployee = {
            id: newUid,
            name: name?.stringValue || 'Unknown',
            email: email,
            role: fields.role?.stringValue || '',
            type: fields.type?.stringValue || 'دوام كامل',
            salary: fields.salary?.integerValue ? parseInt(fields.salary.integerValue) : 0,
            permissions: fields.permissions?.arrayValue?.values?.map((v: any) => v.stringValue) || ['pos']
          };

          // Create new document with new UID
          await firestoreSetDocument("employees", newUid, updatedEmployee);
          
          // Delete old document
          await firestoreDeleteDocument("employees", oldId);
          
          // Update attendance records
          const attResp = await fetch(
            `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/attendance`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          
          if (attResp.ok) {
            const attData = await attResp.json() as any;
            const attDocs = attData.documents || [];
            
            for (const attDoc of attDocs) {
              const attId = attDoc.name.split('/').pop();
              const attFields = attDoc.fields || {};
              const attEmployeeId = attFields.employeeId?.stringValue;
              
              if (attEmployeeId === oldId) {
                // Update attendance record with new UID
                const updatedAtt = {
                  id: attId,
                  employeeId: newUid,
                  employeeName: attFields.employeeName?.stringValue || name?.stringValue,
                  date: attFields.date?.stringValue,
                  checkInTime: attFields.checkInTime?.stringValue,
                  checkOutTime: attFields.checkOutTime?.stringValue,
                  durationMinutes: attFields.durationMinutes?.integerValue ? parseInt(attFields.durationMinutes.integerValue) : null
                };
                await firestoreSetDocument("attendance", attId, updatedAtt);
              }
            }
          }

          results.migrated.push({ oldId, newUid, email });
          
        } catch (err: any) {
          results.errors.push({ id: oldId, error: err.message });
        }
      }

      // Store migration tracking data
      try {
        await firestoreSetDocument('metadata', 'user_migration', {
          migrated: true,
          timestamp: new Date().toISOString(),
          migratedCount: results.migrated.length,
          skippedCount: results.skipped.length,
          errorCount: results.errors.length,
          migratedUsers: results.migrated.map(m => ({ oldId: m.oldId, newUid: m.newUid, email: m.email })),
        });
      } catch (trackErr) {
        console.warn('Failed to write migration tracking data:', trackErr);
      }

      res.json({ success: true, results });
      auditLog('users_migrated', req.uid || '', req.employee?.email || '', {
        migrated: results.migrated.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete user: removes Firestore data (employee + attendance). Auth deletion requires Admin SDK.
  app.post("/api/admin/delete-user", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { uid } = req.body;
      if (!uid || typeof uid !== 'string') {
        return res.status(400).json({ error: "Missing or invalid uid" });
      }

      // Prevent self-deletion
      if (uid === req.uid) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      const errors: string[] = [];

      // 1. Delete attendance records for this user
      try {
        const token = await getGoogleAccessToken();
        const attResp = await fetch(
          `https://firestore.googleapis.com/v1/${FIRESTORE_DB_PATH}/documents/attendance`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (attResp.ok) {
          const attData = await attResp.json() as any;
          const attDocs = attData.documents || [];
          for (const attDoc of attDocs) {
            const attId = attDoc.name.split('/').pop();
            const attFields = attDoc.fields || {};
            if (attFields.employeeId?.stringValue === uid) {
              await firestoreDeleteDocument("attendance", attId);
            }
          }
        }
      } catch (e: any) {
        errors.push(`Attendance cleanup: ${e.message}`);
      }

      // 2. Delete employee document
      try {
        await firestoreDeleteDocument("employees", uid);
      } catch (e: any) {
        errors.push(`Employee deletion: ${e.message}`);
      }

      auditLog('user_deleted', req.uid || '', req.employee?.email || '', {
        targetUid: uid,
        errors: errors.length > 0 ? errors : undefined,
      });

      res.json({
        success: errors.length === 0,
        message: errors.length === 0
          ? "تم حذف المستخدم بنجاح"
          : `تم الحذف مع بعض الأخطاء: ${errors.join('; ')}`,
        authDeletionNote: "تم تعطيل حساب المصادقة (حُذف سجل الموظف). لحذف حساب المصادقة بالكامل، استخدم Firebase Console > Authentication > Users.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reset password via Firebase Auth (admin operation via REST API)
  app.post("/api/admin/reset-password", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: "Invalid email" });
      }
      
      if (!firebaseConfig?.apiKey) {
        return res.status(500).json({ error: "Firebase config not available" });
      }

      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            requestType: "PASSWORD_RESET",
            email: email
          }),
        }
      );
      
      const data = await resp.json() as any;
      
      if (!resp.ok) {
        const msg = data?.error?.message || 'Failed to send reset email';
        if (msg === 'EMAIL_NOT_FOUND') {
          return res.status(404).json({ error: "البريد الإلكتروني غير مسجل في النظام" });
        }
        return res.status(400).json({ error: msg });
      }
      
      res.json({ success: true, message: "تم إرسال رابط إعادة تعيين كلمة المرور" });
      auditLog('password_reset_requested', req.uid || '', req.employee?.email || '', { targetEmail: email });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create Firebase Auth user (admin operation via REST API)
  app.post("/api/admin/create-user", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: "Invalid email" });
      }
      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      if (!firebaseConfig?.apiKey) {
        return res.status(500).json({ error: "Firebase config not available" });
      }
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );
      const data = await resp.json() as any;
      if (!resp.ok) {
        const msg = data?.error?.message || 'Failed to create user';
        if (msg === 'EMAIL_EXISTS') {
          return res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
        }
        return res.status(400).json({ error: msg });
      }
      res.json({ uid: data.localId });
      auditLog('user_created', req.uid || '', req.employee?.email || '', { newUid: data.localId, targetEmail: email });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/clockout", requireFirebaseAuth, async (req, res) => {
    try {
      const { id } = req.body;
      if (!id || !isValidDocumentId(id)) return res.status(400).json({ error: "Missing or invalid record id" });
      const doc = await firestoreGetDocument(`attendance/${id}`);
      if (!doc) return res.status(404).json({ error: "Record not found" });

      // Ownership check: only the employee who owns the record or an admin can clock out
      const isAdmin = req.employee?.permissions?.includes('employees') || req.employee?.permissions?.includes('settings');
      if (doc.employeeId !== req.uid && !isAdmin) {
        return res.status(403).json({ error: "Cannot clock out another employee's record" });
      }

      if (doc.checkOutTime) return res.json({ ok: true });
      const now = new Date();
      const diffMs = now.getTime() - new Date(doc.checkInTime).getTime();
      const diffMins = Math.round(diffMs / 60000);
      doc.checkOutTime = now.toISOString();
      doc.durationMinutes = diffMins;
      await firestoreSetDocument("attendance", id, doc);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Gemini endpoints (Firebase Auth) ----

  app.post("/api/gemini/suggest-price", requireFirebaseAuth, async (req: express.Request, res: express.Response) => {
    try {
      const { productName, costPrice, season } = req.body;
      if (!productName || typeof productName !== 'string' || productName.trim() === '') {
          return res.status(400).json({ error: "اسم المنتج مطلوب وغير صالح" });
      }
      if (typeof costPrice !== 'number' || costPrice < 0) {
          return res.status(400).json({ error: "سعر التكلفة يجب أن يكون رقماً موجباً" });
      }
      if (!season || typeof season !== 'string') {
          return res.status(400).json({ error: "الموسم مطلوب وغير صالح" });
      }

      const ai = getAI();
      if (!ai) return res.status(500).json({ error: "الذكاء الاصطناعي غير ممكّن حالياً" });

      const safeProductName = productName.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, '').slice(0, 100);
      const safeSeason = season.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, '').slice(0, 50);

      const prompt = `أنا أدير متجر ملابس أطفال (طيبة سنتر).\nلدي منتج: ${safeProductName}.\nسعر التكلفة: ${costPrice} دينار.\nالموسم: ${safeSeason}.\n\nاقترح سعر بيع مناسب يحقق ربح جيد ومنافس.\nاشرح باختصار لماذا اخترت هذا السعر واذكر نسبة الربح المقترحة.\nاجعل الإجابة قصيرة ومباشرة باللغة العربية.`;
      
      const response = await ai.models.generateContent({ model: "gemini-1.5-flash", contents: prompt });
      res.json({ suggestion: response.text || "لم يتم استلام رد" });
    } catch (error: any) {
      console.error("Suggest Price Error:", error);
      res.status(500).json({ error: error.message || "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي" });
    }
  });

  app.post("/api/gemini/analyze-business", requireFirebaseAuth, async (req: express.Request, res: express.Response) => {
    try {
      const ai = getAI();
      if (!ai) return res.status(500).json({ error: "الذكاء الاصطناعي غير ممكّن حالياً" });

      const { sales = [], products = [] } = req.body;
      const salesSummary = sales.length > 0 ? `عدد المبيعات: ${sales.length}, إجمالي المبيعات: ${sales.reduce((acc: number, s: any) => acc + (s.totalAmount || 0), 0)}` : "لا توجد مبيعات.";
      const productsSummary = products.length > 0 ? `عدد المنتجات: ${products.length}, المخزون الإجمالي: ${products.reduce((acc: number, p: any) => acc + (p.stock || 0), 0)}` : "لا توجد منتجات.";

      const prompt = `يرجى تحليل بيانات متجري التالية وتقديم ملخص قصير بأهم التوصيات باللغة العربية.
بيانات المبيعات: ${salesSummary}
بيانات المنتجات: ${productsSummary}`;

      const response = await ai.models.generateContent({ model: "gemini-1.5-flash", contents: prompt });
      res.json({ analysis: response.text || "لا توجد نصائح" });
    } catch (error: any) {
      res.status(500).json({ error: "خطأ بالتحليل" });
    }
  });

  // ---- Firestore proxy endpoints (require proxy auth + collection validation) ----

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
      // Prevent self-deletion of employee record (would lock out the admin)
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
      // Validate path format: must be "collection/documentId" (no traversal)
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

      // Validate all writes before executing
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
        // Server-side permission check for each write
        if (!hasWritePermission(req.employee, w.collection)) {
          return res.status(403).json({ error: `Access denied: missing permission for collection "${w.collection}"` });
        }
        // Schema validation for set operations
        if (w.type === "set") {
          const validationError = validateProxyPayload(w.collection, w.id, w.data);
          if (validationError) return res.status(400).json({ error: `${w.collection}/${w.id}: ${validationError}` });
        }
        // Block deletes to audit_logs
        if (w.type === "delete" && w.collection === 'audit_logs') {
          return res.status(403).json({ error: "Cannot delete audit logs" });
        }
        // Prevent self-deletion of employee record
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
  // ---- Firestore batch commit helper (atomic multi-document writes via REST API) ----

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

// ---- Sales transaction endpoints ----

app.post("/api/sales/create", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
  try {
    const { sale } = req.body;
    if (!sale || typeof sale !== 'object') return res.status(400).json({ error: "Missing sale data" });
    if (!sale.id || !isValidDocumentId(sale.id)) return res.status(400).json({ error: "Invalid sale ID" });
    if (!sale.type || typeof sale.type !== 'string') return res.status(400).json({ error: "Missing or invalid type" });
    if (!sale.date || typeof sale.date !== 'string') return res.status(400).json({ error: "Missing or invalid date" });
    if (!Array.isArray(sale.items)) return res.status(400).json({ error: "Missing or invalid items" });
    if (typeof sale.totalAmount !== 'number') return res.status(400).json({ error: "Missing or invalid totalAmount" });
    if (typeof sale.profit !== 'number') return res.status(400).json({ error: "Missing or invalid profit" });
    if (!sale.paymentMethod || typeof sale.paymentMethod !== 'string') return res.status(400).json({ error: "Missing or invalid paymentMethod" });
    if (!sale.createdBy || typeof sale.createdBy !== 'string') return res.status(400).json({ error: "Missing or invalid createdBy" });
    if (typeof sale.isPaid !== 'boolean') return res.status(400).json({ error: "Missing or invalid isPaid" });

    // Validate stock availability for non-manual items
    const stockItems = (sale.items as any[]).filter((i: any) => !i.isManualItem);
    for (const item of stockItems) {
      if (!item.id || typeof item.quantity !== 'number' || item.quantity <= 0) {
        return res.status(400).json({ error: `Invalid stock item: ${JSON.stringify(item)}` });
      }
      const product = await firestoreGetDocument(`products/${item.id}`);
      if (!product) return res.status(400).json({ error: `Product not found: ${item.id}` });
      if (typeof product.stock !== 'number' || product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name || item.id}: available ${product.stock}, requested ${item.quantity}` });
      }
    }

    // Build atomic commit
    const writes: { type: 'set' | 'update'; collection: string; id: string; data: any }[] = [];
    writes.push({ type: 'set', collection: 'sales', id: sale.id, data: sale });

    // Stock adjustments
    for (const item of stockItems) {
      const product = await firestoreGetDocument(`products/${item.id}`);
      if (!product) return res.status(400).json({ error: `Product not found: ${item.id}` });
      writes.push({ type: 'set', collection: 'products', id: item.id, data: { ...product, stock: (product.stock || 0) - item.quantity } });
    }

    // Customer updates
    if (sale.customerId) {
      const customer = await firestoreGetDocument(`customers/${sale.customerId}`);
      if (customer) {
        const isDebt = sale.paymentMethod === 'آجل (دين)';
        const totalPurchases = (customer.totalPurchases || 0) + sale.totalAmount;
        const totalDebt = isDebt ? (customer.totalDebt || 0) + sale.totalAmount : (customer.totalDebt || 0);
        const updatedCustomer = { ...customer, totalPurchases, totalDebt, lastPurchaseDate: new Date().toISOString() };
        writes.push({ type: 'set', collection: 'customers', id: sale.customerId, data: updatedCustomer });
      }
    }

    await firestoreCommit(writes);
    await auditLog('sale_created', req.uid || '', req.employee?.email || '', { saleId: sale.id, totalAmount: sale.totalAmount, paymentMethod: sale.paymentMethod });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sales/update", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
  try {
    const { sale } = req.body;
    if (!sale || typeof sale !== 'object') return res.status(400).json({ error: "Missing sale data" });
    if (!sale.id || !isValidDocumentId(sale.id)) return res.status(400).json({ error: "Invalid sale ID" });

    const oldSale = await firestoreGetDocument(`sales/${sale.id}`);
    if (!oldSale) return res.status(404).json({ error: "Sale not found" });

    const writes: { type: 'set' | 'update'; collection: string; id: string; data: any }[] = [];
    writes.push({ type: 'set', collection: 'sales', id: sale.id, data: sale });

    // Reverse old stock, apply new stock
    const oldStockItems = (oldSale.items as any[]).filter((i: any) => !i.isManualItem);
    const newStockItems = (sale.items as any[]).filter((i: any) => !i.isManualItem);

    for (const item of oldStockItems) {
      const product = await firestoreGetDocument(`products/${item.id}`);
      if (product) {
        writes.push({ type: 'set', collection: 'products', id: item.id, data: { ...product, stock: (product.stock || 0) + item.quantity } });
      }
    }
    for (const item of newStockItems) {
      const product = await firestoreGetDocument(`products/${item.id}`);
      if (product) {
        writes.push({ type: 'set', collection: 'products', id: item.id, data: { ...product, stock: (product.stock || 0) - item.quantity } });
      }
    }

    await firestoreCommit(writes);
    await auditLog('sale_updated', req.uid || '', req.employee?.email || '', { saleId: sale.id });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sales/delete", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
  try {
    const { id } = req.body;
    if (!id || !isValidDocumentId(id)) return res.status(400).json({ error: "Missing or invalid sale ID" });

    const sale = await firestoreGetDocument(`sales/${id}`);
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    const writes: { type: 'set' | 'delete'; collection: string; id: string; data?: any }[] = [];
    writes.push({ type: 'delete', collection: 'sales', id });

    // Restore stock (reverse the sale)
    const stockMultiplier = sale.type === 'مرتجع' ? -1 : 1;
    const stockItems = (sale.items as any[]).filter((i: any) => !i.isManualItem);
    for (const item of stockItems) {
      const product = await firestoreGetDocument(`products/${item.id}`);
      if (product) {
        writes.push({ type: 'set', collection: 'products', id: item.id, data: { ...product, stock: (product.stock || 0) + item.quantity * stockMultiplier } });
      }
    }

    // Customer adjustments
    if (sale.customerId) {
      const customer = await firestoreGetDocument(`customers/${sale.customerId}`);
      if (customer) {
        let debtAdjustment = 0;
        if (sale.paymentMethod === 'آجل (دين)' && !sale.isPaid) {
          debtAdjustment = -(sale.totalAmount || 0);
        }
        const totalPurchases = (customer.totalPurchases || 0) - (sale.totalAmount || 0);
        const totalDebt = (customer.totalDebt || 0) + debtAdjustment;
        const updatedCustomer = { ...customer, totalPurchases, totalDebt };
        writes.push({ type: 'set', collection: 'customers', id: sale.customerId, data: updatedCustomer });
      }
    }

    await firestoreCommit(writes);
    await auditLog('sale_deleted', req.uid || '', req.employee?.email || '', { saleId: id });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
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

    const sale = await firestoreGetDocument(`sales/${saleId}`);
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    if (sale.isPaid) return res.status(400).json({ error: "Sale is already settled" });

    const updatedSale = { ...sale, isPaid: true, paidAt: new Date().toISOString() };
    const writes: { type: 'set'; collection: string; id: string; data: any }[] = [];
    writes.push({ type: 'set', collection: 'sales', id: saleId, data: updatedSale });

    // Clear customer debt
    if (sale.customerId) {
      const customer = await firestoreGetDocument(`customers/${sale.customerId}`);
      if (customer) {
        const totalDebt = (customer.totalDebt || 0) - (sale.totalAmount || 0);
        const updatedCustomer = { ...customer, totalDebt: Math.max(0, totalDebt) };
        writes.push({ type: 'set', collection: 'customers', id: sale.customerId, data: updatedCustomer });
      }
    }

    await firestoreCommit(writes);
    await auditLog('sale_debt_settled', req.uid || '', req.employee?.email || '', { saleId, totalAmount: sale.totalAmount });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sales/return", requireFirebaseAuth, requirePermission('pos'), async (req, res) => {
  try {
    const { originalSale, user } = req.body;
    if (!originalSale || typeof originalSale !== 'object') return res.status(400).json({ error: "Missing original sale data" });
    if (!originalSale.id || !isValidDocumentId(originalSale.id)) return res.status(400).json({ error: "Invalid original sale ID" });

    const existingSale = await firestoreGetDocument(`sales/${originalSale.id}`);
    if (!existingSale) return res.status(404).json({ error: "Original sale not found" });

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

    const writes: { type: 'set'; collection: string; id: string; data: any }[] = [];
    writes.push({ type: 'set', collection: 'sales', id: returnId, data: returnSale });

    // Restore stock
    const stockItems = (originalSale.items as any[]).filter((i: any) => !i.isManualItem);
    for (const item of stockItems) {
      const product = await firestoreGetDocument(`products/${item.id}`);
      if (product) {
        writes.push({ type: 'set', collection: 'products', id: item.id, data: { ...product, stock: (product.stock || 0) + item.quantity } });
      }
    }

    // Customer adjustments
    if (originalSale.customerId) {
      const customer = await firestoreGetDocument(`customers/${originalSale.customerId}`);
      if (customer) {
        let debtAdjustment = 0;
        if (originalSale.paymentMethod === 'آجل (دين)' && !originalSale.isPaid) {
          debtAdjustment = -(originalSale.totalAmount || 0);
        }
        const totalPurchases = (customer.totalPurchases || 0) - (originalSale.totalAmount || 0);
        const totalDebt = (customer.totalDebt || 0) + debtAdjustment;
        const updatedCustomer = { ...customer, totalPurchases, totalDebt: Math.max(0, totalDebt) };
        writes.push({ type: 'set', collection: 'customers', id: originalSale.customerId, data: updatedCustomer });
      }
    }

    await firestoreCommit(writes);
    await auditLog('sale_returned', req.uid || '', req.employee?.email || '', { returnId, originalSaleId: originalSale.id, totalAmount: originalSale.totalAmount });
    res.json({ ok: true, returnId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Backup operation endpoints (admin only) ----

app.post("/api/backup/restore", adminLimiter, requireFirebaseAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: "Missing backup data" });

    await auditLog('backup_restore_started', req.uid || '', req.employee?.email || '', {});

    // Clear existing data first
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

    // Restore collections from backup
    const writeArrayData = async (items: any[], collectionName: string) => {
      if (!Array.isArray(items)) return;
      const writes: { type: 'set'; collection: string; id: string; data: any }[] = [];
      for (const item of items) {
        if (item && item.id && isValidDocumentId(item.id)) {
          writes.push({ type: 'set', collection: collectionName, id: item.id, data: item });
        }
      }
      // Process in chunks of 450 to avoid batch limits
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
