import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

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

  // Load Firebase Config for Auth
  let firebaseConfig: any = null;
  try {
      const configStr = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
      firebaseConfig = JSON.parse(configStr);
  } catch (e) {
      console.warn("Failed to load firebase config, authentication verification will fail.");
  }

  // Auth Middleware
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  app.post("/api/gemini/suggest-price", requireAuth, async (req: express.Request, res: express.Response) => {
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
      
      const response = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      res.json({ suggestion: response.text || "لم يتم استلام رد" });
    } catch (error: any) {
      console.error("Suggest Price Error:", error);
      res.status(500).json({ error: error.message || "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي" });
    }
  });

  app.post("/api/gemini/analyze-business", requireAuth, async (req: express.Request, res: express.Response) => {
    try {
      const ai = getAI();
      if (!ai) return res.status(500).json({ error: "الذكاء الاصطناعي غير ممكّن حالياً" });

      const { sales = [], products = [] } = req.body;
      const salesSummary = sales.length > 0 ? `عدد المبيعات: ${sales.length}, إجمالي المبيعات: ${sales.reduce((acc: number, s: any) => acc + (s.totalAmount || 0), 0)}` : "لا توجد مبيعات.";
      const productsSummary = products.length > 0 ? `عدد المنتجات: ${products.length}, المخزون الإجمالي: ${products.reduce((acc: number, p: any) => acc + (p.stock || 0), 0)}` : "لا توجد منتجات.";

      const prompt = `يرجى تحليل بيانات متجري التالية وتقديم ملخص قصير بأهم التوصيات باللغة العربية.
بيانات المبيعات: ${salesSummary}
بيانات المنتجات: ${productsSummary}`;

      const response = await ai.models.generateContent({ model: "gemini-3.5-flash", contents: prompt });
      res.json({ analysis: response.text || "لا توجد نصائح" });
    } catch (error: any) {
      res.status(500).json({ error: "خطأ بالتحليل" });
    }
  });

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
