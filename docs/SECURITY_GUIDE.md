# دليل الأمان - مركز طيبة

## نظرة عامة

هذا الدليل يستهدف فريق التطوير والأمان. يشرح نموذج الأمان في النظام وأفضل الممارسات.

## نموذج المصادقة (Authentication)

### كيف يعمل النظام؟

```
المستخدم
    ↓
Firebase Auth (Email/Password)
    ↓
ID Token (Bearer)
    ↓
السيرفر (تحقق من صحة Token + البحث عن الموظف)
    ↓
تفويض الصلاحيات (Permissions)
    ↓
الوصول للبيانات
```

### مراحل المصادقة

#### 1. تسجيل الدخول
```typescript
// Firebase Auth SDK
const credential = await signInWithEmailAndPassword(auth, email, password);
const user = credential.user;
```

#### 2. الحصول على ID Token
```typescript
// Firebase Auth SDK
const token = await user.getIdToken();
```

#### 3. إرسال الطلب للسيرفر
```typescript
// HTTP Request - جميع الطلبات تستخدم Authorization header
fetch('/api/admin/create-user', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ email, password })
});
```

#### 4. تحقق السيرفر
```typescript
// Server-side verification
const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
const response = await fetch(url, {
  method: 'POST',
  body: JSON.stringify({ idToken: token })
});
const data = await response.json();
const uid = data.users[0].localId;

// البحث عن الموظف في Firestore
const employee = await firestoreGetDocument(`employees/${uid}`);
req.uid = uid;
req.employee = employee;
```

### أنواع المصادقة

| النوع | الاستخدام | المثال |
|-------|-----------|--------|
| Firebase Auth | تسجيل الدخول الرئيسي + جميع الطلبات | `Authorization: Bearer <token>` |
| Google OAuth | Firestore REST API (سيرفر فقط) | `GOOGLE_CLIENT_ID` |

> **ملاحظة:** `PROXY_SECRET` و `X-Proxy-Token` لم يعودا مستخدمين. جميع الطلبات تستخدم Firebase Auth.

## نموذج التفويض (Authorization)

### Firestore Rules (.role-based)

```javascript
function isSignedIn() {
  return request.auth != null && request.auth.uid != null;
}

function employeeExists() {
  return isSignedIn() &&
    exists(/databases/$(database)/documents/employees/$(request.auth.uid));
}

function getEmployee() {
  return get(/databases/$(database)/documents/employees/$(request.auth.uid));
}

function hasPermission(perm) {
  return employeeExists() &&
    getEmployee().data.permissions.hasAny([perm]);
}

function isAdmin() {
  return employeeExists() && (
    getEmployee().data.permissions.hasAny(['employees', 'settings'])
  );
}

// حماية المنتجات - يتطلب صلاحية inventory
match /products/{productId} {
  allow read: if isSignedIn();
  allow create, update: if isSignedIn() && hasPermission('inventory');
  allow delete: if isSignedIn() && hasPermission('inventory');
}

// حماية الموظفين - يتطلب صلاحية employees أو settings (admin)
match /employees/{employeeId} {
  allow read: if isSignedIn();
  allow create, update, delete: if isAdmin();
}

// حماية المبيعات - يتطلب صلاحية pos
match /sales/{saleId} {
  allow read: if isSignedIn();
  allow create, update: if isSignedIn() && hasPermission('pos');
  allow delete: if isSignedIn() && hasPermission('pos');
}
```

### الصلاحيات المتاحة (Permissions)

| الصلاحيات | الوصول |
|-----------|--------|
| `dashboard` | لوحة التحكم |
| `pos` | نقطة البيع + المبيعات |
| `invoices` | الفواتير |
| `inventory` | المخزون + المنتجات |
| `reports` | التقارير |
| `expenses` | المصاريف |
| `employees` | إدارة المستخدمين (admin) |
| `settings` | الإعدادات (admin) |

### Backend Authorization Middleware

```typescript
// TWO-tier auth model:

// 1. requireFirebaseAuth - full verification + employee lookup
//    Used for: all authenticated endpoints (proxy, admin, clockout, Gemini)
//    Verifies: Firebase ID token
//    Sets: req.uid, req.employee

// 2. requireAdmin - permission check (must follow requireFirebaseAuth)
//    Used for: admin endpoints
//    Checks: employee has 'employees' or 'settings' permission

app.post("/api/admin/create-user", adminLimiter, requireFirebaseAuth, requireAdmin, handler);
app.post("/api/proxy/set", requireFirebaseAuth, handler);
```

## إدارة الأسرار (Secrets Management)

### ما هو سري؟

| المتغير | سري؟ | السبب |
|---------|------|-------|
| `GOOGLE_CLIENT_SECRET` | ✅ نعم | يُستخدم للحصول على Access Token |
| `GOOGLE_REFRESH_TOKEN` | ✅ نعم | يُستخدم لتحديث Access Token |
| `FIREBASE_APPLET_CONFIG` | ✅ نعم | Firebase config للسيرفر |
| `BOOTSTRAP_PASSWORD` | ✅ نعم | كلمة مرور الإعداد الأولي (لا تظهر للعميل) |
| `VITE_FIREBASE_*` | ❌ لا | عامة في Firebase |

> **ملاحظة:** `PROXY_SECRET` لم يعد مستخدماً. جميع الطلبات تستخدم Firebase Auth.

### كيف تُدار الأسرار؟

#### في الإنتاج (Railway)
```bash
# أضف الأسرار عبر Railway Dashboard
GOOGLE_CLIENT_SECRET=<secret>
GOOGLE_REFRESH_TOKEN=<secret>
FIREBASE_APPLET_CONFIG={"apiKey":"...","authDomain":"...","projectId":"..."}
```

#### في التطوير المحلي
```bash
# ملف .env (لا يُضغط في Git)
GOOGLE_CLIENT_SECRET=<secret>
GOOGLE_REFRESH_TOKEN=<secret>
FIREBASE_APPLET_CONFIG={"apiKey":"...","authDomain":"...","projectId":"..."}
```

### ماذا تفعل إذا تم كشف سر؟

1. **GOOGLE_CLIENT_SECRET**: قم بتحديثه من Google Cloud Console
2. **GOOGLE_REFRESH_TOKEN**: قم بتحديثه من Google Cloud Console
3. **FIREBASE_APPLET_CONFIG**: قم بتحديثه من Firebase Console

## Firebase Security Rules

### القواعد الحالية (Role-based)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isSignedIn() { ... }
    function employeeExists() { ... }
    function hasPermission(perm) { ... }
    function isAdmin() { ... }
    
    // Products - inventory permission
    match /products/{productId} {
      allow read: if isSignedIn();
      allow create, update: if isSignedIn() && hasPermission('inventory');
      allow delete: if isSignedIn() && hasPermission('inventory');
    }
    
    // Employees - admin only
    match /employees/{employeeId} {
      allow read: if isSignedIn();
      allow create, update, delete: if isAdmin();
    }
    
    // Attendance - owner or admin
    match /attendance/{attendanceId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn();
      allow update: if isSignedIn() && (
        isAdmin() || existing().employeeId == request.auth.uid
      );
      allow delete: if isAdmin();
    }
    
    // Audit logs - admin read only, no client writes
    match /audit_logs/{logId} {
      allow read: if isAdmin();
      allow write: if false;
    }
  }
}
```

### اختبار القواعد

```bash
# Firebase Console > Firestore > Rules > Tester

# اختبار 1: قراءة بدون مصادقة
{
  "auth": null,
  "path": "/products/product1",
  "method": "get"
}
# النتيجة: Deny

# اختبار 2: قراءة مع مصادقة
{
  "auth": { "uid": "user123" },
  "path": "/products/product1",
  "method": "get"
}
# النتيجة: Allow

# اختبار 3: كتابة موظف بدون صلاحيات admin
{
  "auth": { "uid": "user123" },
  "path": "/employees/user456",
  "method": "write",
  "request": {
    "resource": { "data": { "salary": 999999 } }
  }
}
# النتيجة: Deny (يتطلب isAdmin())
```

## تسجيل الأحداث (Audit Logging)

### ما يُسجل حالياً

جميع الأحداث الإدارية تُسجل في `audit_logs` collection:

| الحدث | ما يُسجل | الأولوية |
|-------|----------|----------|
| `user_created` | المُنشئ, البريد الإلكتروني للجديد, UID | عالية |
| `user_deleted` | المُحذِّف, UID المُحذَّف, الأخطاء | عالية |
| `password_reset_requested` | المُطلب, البريد الإلكتروني المستهدف | عالية |
| `users_migrated` | المُشغِّل, عدد المُ migrated, skipped, errors | متوسطة |

### هيكل Audit Log

```typescript
interface AuditLog {
  id: string;           // timestamp-random
  timestamp: string;    // ISO string
  eventType: string;    // 'user_created', 'user_deleted', etc.
  userId: string;       // Firebase Auth UID of the actor
  userEmail: string;    // Email of the actor
  targetUid?: string;   // Target user UID (for user operations)
  targetEmail?: string; // Target email (for password reset)
  details?: Record<string, any>;
}
```

### الوصول لـ Audit Logs

```bash
# فقطadmins يمكنهم قراءة audit_logs
# الكتابة عبر Server REST API فقط (لا يمكن للعميل الكتابة)
```

## نسخ احتياطي وأمان البيانات

### النسخ الاحتياطية

```typescript
// ما يُنسخ:
{
  products: [...],      // ✅ من Firestore
  sales: [...],         // ✅ من Firestore
  employees: [...],     // ✅ من Firestore (بدون كلمات المرور)
  attendance: [...],    // ✅ من Firestore
  // ...
}

// ما لا يُنسخ:
// ❌ كلمات المرور (في Firebase Auth)
// ❌ Google OAuth Credentials
// ❌ Audit logs
```

### الاستعادة

```typescript
// ما يحدث:
1. حذف جميع البيانات الحالية
2. كتابة البيانات من النسخة الاحتياطية
3. إعادة تحميل الصفحة

// ⚠️ تحذير:
// - لا يمكن التراجع بعد الاستعادة
// - خذ نسخة احتياطية أولاً
// - إذا كانت النسخة الاحتياطية تحتوي على موظفين ما تم ترحيلهم، قد لا تتطابق المعرفات
```

## اختبار الأمان

### اختبارات يجب تنفيذها

#### 1. اختبار المصادقة - بدون Token
```bash
curl -X POST https://your-app.railway.app/api/admin/create-user \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}'

# النتيجة: 401 Unauthorized
```

#### 2. اختبار المصادقة - Token غير صالح
```bash
curl -X POST https://your-app.railway.app/api/admin/create-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"email":"test@test.com","password":"123456"}'

# النتيجة: 401 Unauthorized
```

#### 3. اختبار التفويض - مستخدم بدون صلاحيات admin
```bash
# (استخدم token من مستخدم عادي - ليس admin)
curl -X POST https://your-app.railway.app/api/admin/create-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <regular-user-token>" \
  -d '{"email":"test@test.com","password":"123456"}'

# النتيجة: 403 Forbidden (Admin access required)
```

#### 4. اختبار Rate Limiting
```bash
# إرسال طلبات كثيرة
for i in {1..15}; do
  curl -X POST https://your-app.railway.app/api/admin/create-user \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <valid-token>" \
    -d '{"email":"test@test.com","password":"123456"}'
done

# النتيجة: 429 Too Many Requests (بعد 10 طلبات)
```

#### 5. اختبار حذف المستخدم - منع الذات
```bash
# محاولة حذف نفسك
curl -X POST https://your-app.railway.app/api/admin/delete-user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"uid":"<your-uid>"}'

# النتيجة: 400 (Cannot delete your own account)
```

## أفضل الممارسات

### للمطورين

1. **لا تضغط الأسرار في Git**
2. **استخدم Environment Variables**
3. **اختبر الأمان قبل النشر**
4. **راجع القواعد بانتظام**
5. **حدّث المكتبات بانتظام**
6. **تأكد من أن `VITE_PROXY_SECRET` غير موجود في الكود**

### لمديري النظام

1. **استخدم كلمات مرور قوية**
2. **لا تشارك الأسرار**
3. **راقب Audit Logs**
4. **خذ نسخ احتياطية بانتظام**
5. **أبلغ عن الثغرات فوراً**

### للمستخدمين

1. **استخدم كلمات مرور مختلفة لكل حساب**
2. **لا تشارك كلمة المرور مع أي شخص**
3. **سجّل خروج عند الانتهاء**
4. **أبلغ عن أي نشاط غير عادي**

## المراجع

- [Firebase Security Rules](https://firebase.google.com/docs/rules)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [Firebase Console](https://console.firebase.google.com)
- [Google Cloud Console](https://console.cloud.google.com)
