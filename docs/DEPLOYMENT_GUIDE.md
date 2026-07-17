# دليل نشر مركز طيبة

## نظرة عامة

هذا الدليل يشرح خطوات نشر نظام مركز طيبة على بيئة الإنتاج.

## المتطلبات

- حساب Railway
- حساب Firebase
- مستودع GitHub
- Node.js 20+ (للتطوير المحلي)

## خطوات النشر

### 1. إعداد Firebase

#### تفعيل Authentication
1. افتح Firebase Console
2. اذهب إلى Authentication > Sign-in method
3. فعّل **Email/Password**
4. تأكد من تعطيل باقي الطرق

#### Firestore Rules
1. اذهب إلى Firestore Database > Rules
2. انشر قواعد `firestore.rules` من المشروع
3. تأكد من أن القواعد تتضمن:
   - `isSignedIn()` للمستخدمين المسجلين
   - `hasPermission(perm)` للصلاحيات
   - `isAdmin()` للوصول الإداري
   - حماية `audit_logs` (قراءة admin فقط، كتابة محظورة)

#### Firestore Indexes
1. اذهب إلى Firestore Database > Indexes
2. أنشئ Composite Indexes المطلوبة:
   - `attendance`: `employeeId` + `checkOutTime`
   - `sales`: `date` + `createdBy`
3. انتظر اكتمال الفهرسة (قد يستغرق دقائق)

### 2. إعداد Environment Variables

أنشئ متغيرات البيئة التالية في Railway:

#### متغيرات الواجهة (Vite - تظهر في JavaScript المجمع)

```env
# Firebase Client Config (من Firebase Console > Project Settings > General)
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=ai-studio-taibacentermanag-c767774a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ai-studio-taibacentermanag-c767774a
VITE_FIREBASE_STORAGE_BUCKET=ai-studio-taibacentermanag-c767774a.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=807688048835
VITE_FIREBASE_APP_ID=1:807688048835:web:6648221124274976946b13
VITE_FIREBASE_MEASUREMENT_ID=G-9G3H53M3M2
VITE_FIREBASE_DATABASE_ID=ai-studio-taibacentermanag-c767774a-873a-4b8d-81a6-1c3761dba0ea

# Bootstrap Password (لأول تسجيل دخول فقط - لا يظهر للعميل)
BOOTSTRAP_PASSWORD=<secure-password>
```

> **ملاحظة أمنية:** `BOOTSTRAP_PASSWORD` يُتحقق منه فقط على السيرفر ولا يظهر في الكود المصدري للعميل.
> - `VITE_FIREBASE_*` آمنة لأنها عامة في Firebase (الأمان يأتي من Firestore Rules)

#### متغيرات السيرفر (لا تظهر في الكود المصدري)

```env
# Firebase App Config (JSON string - يُستخدم للتحقق من ID Tokens)
FIREBASE_APPLET_CONFIG={"apiKey":"...","authDomain":"...","projectId":"..."}

# Google OAuth (لـ Firestore REST API)
# مطلوب لأن النظام يستخدم Firestore REST API للقراءة/الكتابة
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REFRESH_TOKEN=<your-refresh-token>

# Server
PORT=3000
NODE_ENV=production

# Gemini AI (اختياري - لتحليل البيانات)
GEMINI_API_KEY=<your-gemini-api-key>

# CORS
ALLOWED_ORIGINS=https://your-app.railway.app
```

> **ملاحظة:** `PROXY_SECRET` لم يعد مستخدماً. جميع الطلبات تستخدم Firebase Auth.

#### لماذا Google OAuth مطلوب؟

النظام يستخدم Firestore REST API (وليس Firebase Admin SDK) لقراءة وكتابة البيانات. هذا يتطلب:
- `GOOGLE_CLIENT_ID`: معرف العميل
- `GOOGLE_CLIENT_SECRET`: سر العميل
- `GOOGLE_REFRESH_TOKEN`: رمز التحديث (لا ينتهي صلاحيته)

> **ملاحظة:** هذه المتغيرات سرية ولا يجب مشاركتها. إذا تم كشفها، قم بتحديثها فوراً من Google Cloud Console.

#### لماذا نستخدم REST API بدلاً من Admin SDK؟

لأن النظام يعمل كـ SPA (Single Page Application) على Vite، ويجب أن يتفاعل مع Firestore بشكل مباشر. REST API يسمح بـ:
- قراءة وكتابة البيانات عبر HTTP
- تجنب تثبيت Firebase Admin SDK (الذي يحتاج Node.js server)
- بساطة التكوين

### 3. بناء ونشر

#### من GitHub
1. ادفع التغييرات إلى المستودع
2. Railway ستبني المشروع تلقائياً
3. تأكد من نجاح الـ Build

#### يدوياً
```bash
# بناء المشروع
npm install
npm run build

# اختبار محلي
npm run dev

# نشر عبر Railway CLI
railway up
```

### 4. ما بعد النشر

#### اختبار الاتصال
```bash
curl https://your-app.railway.app/api/health
# يجب أن يُرجع: {"status":"ok"}
```

#### اختبار المصادقة
```bash
# محاولة وصول Endpoint إداري بدون Token
curl -X POST https://your-app.railway.app/api/admin/create-user \
  -H "Content-Type: application/json" \
  -d '{"email":"test@taiba.com","password":"test123456"}'

# النتيجة: 401 Unauthorized (يتطلب Firebase Auth token)
```

## ملاحظات أمنية

### Firebase Auth
- جميع الطلبات تتطلب Firebase Auth token
- الـ ID token يُتحقق عبر Identity Toolkit API
- البحث عن الموظف في Firestore يتحقق من الصلاحيات

### Google OAuth Credentials
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` سرية
- لا تشاركها ولا تضغطها في Git
- إذا تم كشفها، قم بتحديثها فوراً

### Environment Variables
- لا تضغط أي variables في Git
- تأكد من أن `.env` موجود في `.gitignore`
- استخدم Railway Environment Variables للإنتاج

## استكشاف الأخطاء

### المشكلة: المستخدم لا يستطيع تسجيل الدخول
- تأكد من تفعيل Email/Password في Firebase Console
- تأكد من صحة الـ API Key
- تحقق من Firestore Rules

### المشكلة: 403 Forbidden
- تأكد من أن للمستخدم صلاحيات كافية في `employees` collection
- تحقق من أن حقل `permissions` يحتوي على الصلاحيات المطلوبة

### المشكلة: أخطاء Firestore REST API
- تأكد من صحة `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- تحقق من صلاحيات Service Account
- تحقق من أن Google Cloud API مفعل

### المشكلة: CORS Error
- تأكد من إعداد `ALLOWED_ORIGINS`
- تأكد من أن الـ Origin مطابق تماماً (مع https://)

## التحقق النهائي

- [ ] Firestore Rules منشورة وصحيحة (role-based)
- [ ] Composite Indexes مكتملة
- [ ] Email/Password مفعل
- [ ] Environment Variables مُعدّة (بما في ذلك Google OAuth)
- [ ] `PROXY_SECRET` غير موجود في الكود (تم إزالته)
- [ ] Build ناجح
- [ ] Health check يعمل
- [ ] تسجيل الدخول يعمل
- [ ] تسجيل الخروج يعمل
- [ ] Admin endpoints تتطلب Firebase Auth + صلاحيات admin
