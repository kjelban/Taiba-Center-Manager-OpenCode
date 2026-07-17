import 'dotenv/config';
import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "fs";

// ---- Firestore REST API proxy (bypasses restrictive security rules) ----
const FIRESTORE_DB_PATH = "projects/adroit-weaver-v6tp2/databases/ai-studio-taibacentermanag-c767774a-873a-4b8d-81a6-1c3761dba0ea";

// Allowed collections whitelist - prevents writing to arbitrary collections
const ALLOWED_COLLECTIONS = new Set([
  'products', 'sales', 'expenses', 'employees', 'customers',
  'suppliers', 'categories', 'seasons', 'attendance', 'metadata'
]);

function isValidCollection(name: string): boolean {
  return typeof name === 'string' && ALLOWED_COLLECTIONS.has(name);
}

function isValidDocumentId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

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
        connectSrc: ["'self'"],
      }
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS - restrict to known origins
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.length === 0) {
      // In development or when no origins configured, allow all
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Proxy-Token');
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

  let aiClient: GoogleGenAI | null = null;
  function getAI() {
    if (!aiClient) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return null;
      aiClient = new GoogleGenAI({ apiKey: key, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
    }
    return aiClient;
  }

  // Load Firebase Config for Auth (from env var or file)
  let firebaseConfig: any = null;
  try {
      const envConfig = process.env.FIREBASE_APPLET_CONFIG;
      if (envConfig) {
          firebaseConfig = JSON.parse(envConfig);
          console.log("Firebase config loaded from environment variable.");
      } else {
          const configStr = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
          firebaseConfig = JSON.parse(configStr);
          console.log("Firebase config loaded from file.");
      }
  } catch (e) {
      console.warn("Failed to load firebase config, authentication verification will fail.");
  }

  // ---- Auth Middleware ----

  // Verify Firebase ID token (for Gemini endpoints)
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
          next();
      } catch (e) {
          res.status(500).json({ error: "Failed to verify token" });
      }
  };

  // Verify proxy token (for proxy endpoints)
  const requireProxyAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const proxyToken = req.headers['x-proxy-token'];
      const expectedToken = process.env.PROXY_SECRET;
      if (!expectedToken) {
          console.error("PROXY_SECRET environment variable is not set!");
          return res.status(500).json({ error: "Server proxy authentication not configured." });
      }
      if (!proxyToken || proxyToken !== expectedToken) {
          return res.status(401).json({ error: "Unauthorized: Invalid proxy token" });
      }
      next();
  };

  // ---- Public endpoints (no auth required) ----

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // ---- Authenticated endpoints ----

  app.post("/api/clockout", requireProxyAuth, async (req, res) => {
    try {
      const { id } = req.body;
      if (!id || !isValidDocumentId(id)) return res.status(400).json({ error: "Missing or invalid record id" });
      const doc = await firestoreGetDocument(`attendance/${id}`);
      if (!doc) return res.status(404).json({ error: "Record not found" });
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

  app.post("/api/proxy/set", requireProxyAuth, async (req, res) => {
    try {
      const { collection, id, data } = req.body;
      if (!collection || !id || !data) return res.status(400).json({ error: "Missing collection, id, or data" });
      if (!isValidCollection(collection)) return res.status(403).json({ error: "Access denied: invalid collection" });
      if (!isValidDocumentId(id)) return res.status(400).json({ error: "Invalid document ID format" });
      await firestoreSetDocument(collection, id, data);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proxy/delete", requireProxyAuth, async (req, res) => {
    try {
      const { collection, id } = req.body;
      if (!collection || !id) return res.status(400).json({ error: "Missing collection or id" });
      if (!isValidCollection(collection)) return res.status(403).json({ error: "Access denied: invalid collection" });
      if (!isValidDocumentId(id)) return res.status(400).json({ error: "Invalid document ID format" });
      await firestoreDeleteDocument(collection, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/proxy/get", requireProxyAuth, async (req, res) => {
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

  app.post("/api/proxy/batch", requireProxyAuth, async (req, res) => {
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
      res.json({ ok: true });
    } catch (e: any) {
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
