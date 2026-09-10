// Server-side authorization and validation functions
// Extracted for testability and single-responsibility.
import crypto from 'crypto';

// Allowed collections whitelist - prevents writing to arbitrary collections
export const ALLOWED_COLLECTIONS = new Set([
  'products', 'sales', 'expenses', 'employees', 'customers',
  'suppliers', 'categories', 'seasons', 'attendance', 'metadata', 'audit_logs'
]);

export function isValidCollection(name: string): boolean {
  return typeof name === 'string' && ALLOWED_COLLECTIONS.has(name);
}

export function isValidDocumentId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 1000) / 1000;
}

// Server-side permission mapping (mirrors Firestore rules)
// Maps collection name to the permission required for WRITE operations.
// 'admin' = requires 'employees' or 'settings' permission
// 'any' = any authenticated user
export const WRITE_PERMISSIONS: Record<string, string> = {
  'products': 'inventory',
  'sales': 'pos',
  'expenses': 'expenses',
  'employees': 'admin',
  'customers': 'pos',
  'suppliers': 'pos',
  'attendance': 'any',
  'categories': 'settings',
  'seasons': 'settings',
  'metadata': 'admin',
  'audit_logs': 'admin',
};

export function hasWritePermission(employee: any, collection: string): boolean {
  const required = WRITE_PERMISSIONS[collection];
  if (!required) return false;
  if (!employee || typeof employee !== 'object' || !Array.isArray(employee.permissions)) return false;
  const perms: string[] = employee.permissions;
  if (required === 'any') return true;
  if (required === 'admin') {
    return perms.includes('employees') || perms.includes('settings');
  }
  return perms.includes(required) || (required === 'settings' && (perms.includes('settings') || perms.includes('employees')));
}

export interface NormalizedStockItem {
  productId: string;
  totalQuantity: number;
}

// Normalizes cart items by summing quantities for duplicate product entries and validating integers
export function normalizeCartStockItems(items: any[]): { items?: NormalizedStockItem[]; error?: string } {
  if (!Array.isArray(items)) {
    return { error: 'Missing or invalid items array' };
  }
  const stockItems = items.filter((i: any) => !i?.isManualItem);
  const map = new Map<string, number>();

  for (const item of stockItems) {
    if (!item || typeof item !== 'object') {
      return { error: 'Cart item must be an object' };
    }
    const id = item.id;
    if (!id || typeof id !== 'string' || !isValidDocumentId(id)) {
      return { error: `Invalid product ID in cart: ${id}` };
    }
    const qty = item.quantity;
    if (
      typeof qty !== 'number' ||
      !Number.isFinite(qty) ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      qty > 10000
    ) {
      return { error: `Invalid quantity for product ${id}: must be a positive integer <= 10000` };
    }
    map.set(id, (map.get(id) || 0) + qty);
  }

  const result: NormalizedStockItem[] = [];
  for (const [productId, totalQuantity] of map.entries()) {
    result.push({ productId, totalQuantity });
  }
  return { items: result };
}

// Canonical Request Fingerprinting for Idempotency (AUDIT-014)
export interface CanonicalCartItem {
  productId: string;
  quantity: number;
}

export interface CanonicalManualItem {
  name: string;
  sellingPrice: number;
  purchasePrice: number;
  quantity: number;
}

export function generateSaleRequestFingerprint(sale: any): string {
  if (!sale || typeof sale !== 'object') return '';

  const customerId = (typeof sale.customerId === 'string') ? sale.customerId.trim() : '';
  const paymentMethod = (typeof sale.paymentMethod === 'string') ? sale.paymentMethod.trim() : '';
  const dueDate = (typeof sale.dueDate === 'string') ? sale.dueDate.trim().split('T')[0] : '';
  const createdBy = (typeof sale.createdBy === 'string') ? sale.createdBy.trim() : '';

  const rawItems = Array.isArray(sale.items) ? sale.items : [];

  // Group and normalize physical inventory products by productId
  const productMap = new Map<string, number>();
  const manualItemsList: CanonicalManualItem[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    if (item.isManualItem) {
      manualItemsList.push({
        name: (item.name || '').toString().trim().toLowerCase(),
        sellingPrice: roundMoney(Number(item.sellingPrice) || 0),
        purchasePrice: roundMoney(Number(item.purchasePrice) || 0),
        quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      });
    } else if (item.id && typeof item.id === 'string') {
      const pid = item.id.trim();
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      productMap.set(pid, (productMap.get(pid) || 0) + qty);
    }
  }

  // Sort physical products canonically by productId
  const sortedPhysicalProducts: CanonicalCartItem[] = Array.from(productMap.entries())
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  // Sort manual items canonically
  manualItemsList.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    if (a.sellingPrice !== b.sellingPrice) return a.sellingPrice - b.sellingPrice;
    return a.quantity - b.quantity;
  });

  const canonicalObj = {
    c: customerId,
    p: paymentMethod,
    d: dueDate,
    u: createdBy,
    i: sortedPhysicalProducts,
    m: manualItemsList,
  };

  const canonicalJson = JSON.stringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

// Comprehensive validation for sales payloads
export function validateSalePayload(sale: any): string | null {
  if (!sale || typeof sale !== 'object') return 'Missing sale data';
  if (!sale.id || !isValidDocumentId(sale.id)) return 'Invalid sale ID';
  if (!sale.type || typeof sale.type !== 'string' || (sale.type !== 'بيع' && sale.type !== 'مرتجع')) return 'Missing or invalid type';
  if (!sale.date || typeof sale.date !== 'string') return 'Missing or invalid date';
  if (!Array.isArray(sale.items) || sale.items.length === 0) return 'Missing or empty items';
  if (typeof sale.totalAmount !== 'number' || !Number.isFinite(sale.totalAmount)) return 'Missing or invalid totalAmount';
  if (typeof sale.profit !== 'number' || !Number.isFinite(sale.profit)) return 'Missing or invalid profit';
  if (!sale.paymentMethod || typeof sale.paymentMethod !== 'string') return 'Missing or invalid paymentMethod';
  if (!sale.createdBy || typeof sale.createdBy !== 'string') return 'Missing or invalid createdBy';
  if (typeof sale.isPaid !== 'boolean') return 'Missing or invalid isPaid';
  if (sale.customerId && !isValidDocumentId(sale.customerId)) return 'Invalid customerId format';

  // Validate individual item structures
  for (const item of sale.items) {
    if (!item || typeof item !== 'object') return 'Invalid cart item structure';
    if (!item.id || typeof item.id !== 'string') return 'Missing item id';
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return `Invalid item quantity for ${item.id}`;
    }
    if (item.isManualItem) {
      if (!item.name || typeof item.name !== 'string') return 'Missing name for manual item';
      if (typeof item.sellingPrice !== 'number' || !Number.isFinite(item.sellingPrice) || item.sellingPrice <= 0) {
        return 'Invalid sellingPrice for manual item';
      }
      if (typeof item.purchasePrice !== 'number' || !Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) {
        return 'Invalid purchasePrice for manual item';
      }
    }
  }

  return null;
}

// Schema validation for proxy writes
export function validateProxyPayload(collection: string, id: string, data: any): string | null {
  if (!data || typeof data !== 'object') return 'Data must be an object';
  if (!data.id) return 'Missing required field: id';
  if (data.id !== id) return 'Document ID mismatch';

  switch (collection) {
    case 'products':
      if (!data.name || typeof data.name !== 'string') return 'Missing or invalid: name';
      if (typeof data.sellingPrice !== 'number' || data.sellingPrice < 0) return 'Missing or invalid: sellingPrice';
      if (typeof data.stock !== 'number' || data.stock < 0) return 'Missing or invalid: stock';
      break;
    case 'sales':
      return validateSalePayload(data);
    case 'expenses':
      if (!data.description || typeof data.description !== 'string') return 'Missing or invalid: description';
      if (typeof data.amount !== 'number' || data.amount <= 0) return 'Missing or invalid: amount';
      if (!data.date || typeof data.date !== 'string') return 'Missing or invalid: date';
      if (!data.category || typeof data.category !== 'string') return 'Missing or invalid: category';
      break;
    case 'employees':
      if (!data.name || typeof data.name !== 'string') return 'Missing or invalid: name';
      if (!data.email || typeof data.email !== 'string') return 'Missing or invalid: email';
      if (typeof data.salary !== 'number' || data.salary < 0) return 'Missing or invalid: salary';
      if (!Array.isArray(data.permissions)) return 'Missing or invalid: permissions (must be array)';
      break;
    case 'customers':
      if (!data.name || typeof data.name !== 'string') return 'Missing or invalid: name';
      break;
    case 'suppliers':
      if (!data.name || typeof data.name !== 'string') return 'Missing or invalid: name';
      break;
    case 'attendance':
      if (!data.employeeId || typeof data.employeeId !== 'string') return 'Missing or invalid: employeeId';
      if (!data.employeeName || typeof data.employeeName !== 'string') return 'Missing or invalid: employeeName';
      if (!data.date || typeof data.date !== 'string') return 'Missing or invalid: date';
      if (!data.checkInTime || typeof data.checkInTime !== 'string') return 'Missing or invalid: checkInTime';
      break;
    case 'audit_logs':
      return 'Direct writes to audit_logs are not allowed';
    case 'metadata':
      if (typeof data.migrated !== 'boolean') return 'Missing or invalid: migrated';
      break;
  }
  return null; // valid
}

// Server-side permission mapping (mirrors Firestore rules)
// Maps collection name to the permission required for READ operations.
export const READ_PERMISSIONS: Record<string, string> = {
  products: 'any',
  categories: 'any',
  seasons: 'any',
  suppliers: 'any',
  customers: 'pos',
  sales: 'pos',
  attendance: 'any',
  expenses: 'expenses',
  employees: 'any',
  metadata: 'admin',
  audit_logs: 'admin',
};

export function hasReadPermission(employee: any, collection: string): boolean {
  const required = READ_PERMISSIONS[collection];
  if (!required) return false;
  if (!employee || typeof employee !== 'object' || !Array.isArray(employee.permissions)) return false;
  const perms: string[] = employee.permissions;
  const isAdmin = perms.includes('employees') || perms.includes('settings') || employee.role === 'مدير' || employee.role === 'المدير العام';
  if (isAdmin) return true;
  if (required === 'any') return true;
  if (required === 'admin') return false;
  return perms.includes(required);
}

// ── Query / Pagination Validation (AUDIT-007) ──

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface CollectionQueryPolicy {
  allowedSortFields: string[];
  allowedDateFields: string[];
  allowedFilterFields: string[];
}

export const PER_COLLECTION_QUERY_POLICY: Record<string, CollectionQueryPolicy> = {
  sales: {
    allowedSortFields: ['date', 'totalAmount', 'createdAt', 'id'],
    allowedDateFields: ['date', 'createdAt'],
    allowedFilterFields: ['customerId', 'createdBy', 'isPaid', 'paymentMethod', 'type'],
  },
  expenses: {
    allowedSortFields: ['date', 'amount', 'id'],
    allowedDateFields: ['date'],
    allowedFilterFields: ['category'],
  },
  attendance: {
    allowedSortFields: ['checkInTime', 'checkOutTime', 'date', 'id'],
    allowedDateFields: ['checkInTime', 'checkOutTime', 'date'],
    allowedFilterFields: ['employeeId', 'date'],
  },
  audit_logs: {
    allowedSortFields: ['timestamp', 'id'],
    allowedDateFields: ['timestamp'],
    allowedFilterFields: ['action', 'performedBy'],
  },
  products: {
    allowedSortFields: ['name', 'sellingPrice', 'stock', 'id', 'category'],
    allowedDateFields: [],
    allowedFilterFields: ['category', 'barcode'],
  },
  customers: {
    allowedSortFields: ['name', 'totalPurchases', 'totalDebt', 'id'],
    allowedDateFields: [],
    allowedFilterFields: ['phone'],
  },
  employees: {
    allowedSortFields: ['name', 'id'],
    allowedDateFields: [],
    allowedFilterFields: ['role', 'type'],
  },
  suppliers: {
    allowedSortFields: ['name', 'id'],
    allowedDateFields: [],
    allowedFilterFields: [],
  },
  categories: {
    allowedSortFields: ['id'],
    allowedDateFields: [],
    allowedFilterFields: [],
  },
  seasons: {
    allowedSortFields: ['id'],
    allowedDateFields: [],
    allowedFilterFields: [],
  },
  metadata: {
    allowedSortFields: ['id'],
    allowedDateFields: [],
    allowedFilterFields: [],
  },
};

export const ALLOWED_SORT_FIELDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(PER_COLLECTION_QUERY_POLICY).map(([k, v]) => [k, v.allowedSortFields])
);

export const ALLOWED_DATE_FIELDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(PER_COLLECTION_QUERY_POLICY).map(([k, v]) => [k, v.allowedDateFields])
);

export interface ValidatedQueryOptions {
  collection: string;
  limit: number;
  cursor?: { primary: any; id: string };
  rawCursor?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
  orderByField: string;
  orderDirection: 'ASC' | 'DESC';
  filterField?: string;
  filterValue?: any;
}

export function encodeQueryCursor(primaryValue: any, docId: string): string {
  const payload = JSON.stringify({ v: primaryValue, id: docId });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeQueryCursor(cursorStr: string): { primary: any; id: string } | null {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v === undefined || typeof parsed.id !== 'string' || !isValidDocumentId(parsed.id)) {
      return null;
    }
    return { primary: parsed.v, id: parsed.id };
  } catch {
    return null;
  }
}

export function validateQueryParameters(params: any): { error?: string; options?: ValidatedQueryOptions } {
  if (!params || typeof params !== 'object') {
    return { error: 'Query parameters must be a valid JSON object' };
  }

  const { collection } = params;
  if (!collection || typeof collection !== 'string' || !isValidCollection(collection)) {
    return { error: `Invalid or unallowlisted collection: ${collection}` };
  }

  const policy = PER_COLLECTION_QUERY_POLICY[collection] || {
    allowedSortFields: ['id'],
    allowedDateFields: [],
    allowedFilterFields: [],
  };

  // Limit handling
  let limit = DEFAULT_PAGE_SIZE;
  if (params.limit !== undefined && params.limit !== null) {
    const num = Number(params.limit);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
      return { error: 'Limit must be a positive integer' };
    }
    limit = Math.min(num, MAX_PAGE_SIZE);
  }

  // Order By Field
  const allowedSorts = policy.allowedSortFields;
  let orderByField = allowedSorts[0];
  if (params.orderByField !== undefined && params.orderByField !== null) {
    if (typeof params.orderByField !== 'string' || !allowedSorts.includes(params.orderByField)) {
      return { error: `Invalid orderByField for collection '${collection}'. Allowed fields: ${allowedSorts.join(', ')}` };
    }
    orderByField = params.orderByField;
  }

  // Order Direction
  let orderDirection: 'ASC' | 'DESC' = 'DESC';
  if (params.orderDirection !== undefined && params.orderDirection !== null) {
    const dir = String(params.orderDirection).toUpperCase();
    if (dir !== 'ASC' && dir !== 'DESC') {
      return { error: "orderDirection must be either 'ASC' or 'DESC'" };
    }
    orderDirection = dir;
  }

  // Date Field and Range
  let dateField: string | undefined;
  let dateFrom: string | undefined;
  let dateTo: string | undefined;

  if (params.dateFrom || params.dateTo || params.dateField) {
    const allowedDates = policy.allowedDateFields;
    if (!allowedDates || allowedDates.length === 0) {
      return { error: `Collection '${collection}' does not support date filtering` };
    }
    dateField = params.dateField ? String(params.dateField) : allowedDates[0];
    if (!allowedDates.includes(dateField)) {
      return { error: `Invalid dateField for collection '${collection}'. Allowed date fields: ${allowedDates.join(', ')}` };
    }

    if (params.dateFrom) {
      if (typeof params.dateFrom !== 'string' || isNaN(Date.parse(params.dateFrom))) {
        return { error: `Invalid dateFrom format: must be a parseable ISO date string` };
      }
      dateFrom = params.dateFrom;
    }

    if (params.dateTo) {
      if (typeof params.dateTo !== 'string' || isNaN(Date.parse(params.dateTo))) {
        return { error: `Invalid dateTo format: must be a parseable ISO date string` };
      }
      dateTo = params.dateTo;
    }

    if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) {
      return { error: `dateFrom (${dateFrom}) cannot be after dateTo (${dateTo})` };
    }
  }

  // Cursor handling
  let cursor: { primary: any; id: string } | undefined;
  if (params.cursor !== undefined && params.cursor !== null && params.cursor !== '') {
    if (typeof params.cursor !== 'string') {
      return { error: 'Cursor must be a string' };
    }
    const decoded = decodeQueryCursor(params.cursor);
    if (!decoded) {
      return { error: 'Invalid or malformed pagination cursor' };
    }
    cursor = decoded;
  }

  // Filter Field (optional equality filter e.g. employeeId, isPaid)
  let filterField: string | undefined;
  let filterValue: any = undefined;
  if (params.filterField) {
    if (typeof params.filterField !== 'string' || !/^[a-zA-Z0-9_]{1,32}$/.test(params.filterField)) {
      return { error: 'Invalid filterField format' };
    }
    const allowedFilters = policy.allowedFilterFields;
    if (!allowedFilters.includes(params.filterField)) {
      return { error: `Invalid filterField for collection '${collection}'. Allowed filter fields: ${allowedFilters.join(', ')}` };
    }
    filterField = params.filterField;
    filterValue = params.filterValue;
  }

  return {
    options: {
      collection,
      limit,
      cursor,
      rawCursor: params.cursor || undefined,
      dateField,
      dateFrom,
      dateTo,
      orderByField,
      orderDirection,
      filterField,
      filterValue,
    }
  };
}

// ── Content Security Policy Directives (AUDIT-010) ──

export interface CspDirectives {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  fontSrc: string[];
  imgSrc: string[];
  connectSrc: string[];
  [key: string]: string[];
}

/**
 * Generates Helmet Content-Security-Policy directives.
 * In production mode, scriptSrc strictly enforces 'self' with NO 'unsafe-inline' or 'unsafe-eval'.
 * In development mode, 'unsafe-inline' and 'unsafe-eval' are retained to support Vite HMR.
 */
export function getCspDirectives(isProduction: boolean): CspDirectives {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: isProduction
      ? ["'self'"]
      : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
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
  };
}

// ── Timing-Safe Authentication & Sanitization (AUDIT-009) ──

/**
 * Pre-computed valid PBKDF2 hash structure to preserve execution timing
 * during authentication failures for nonexistent accounts (AUDIT-009).
 */
export const DUMMY_PBKDF2_HASH =
  'pbkdf2:sha512:100000:0123456789abcdef0123456789abcdef:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

/**
 * Validates a password while executing a constant-time dummy verification
 * if the account or storedHash does not exist, eliminating timing enumeration side-channels.
 */
export function timingSafePasswordVerify(
  password: string,
  storedHash: string | undefined | null,
  verifyFn: (pw: string, hash: string) => boolean
): boolean {
  if (storedHash) {
    return verifyFn(password, storedHash);
  }
  // Execute dummy verification to match timing
  verifyFn(password || 'dummy-password-value', DUMMY_PBKDF2_HASH);
  return false;
}

/**
 * Strips sensitive credentials (password, passwordHash) and administrative secrets
 * from employee objects before returning to clients.
 */
export function sanitizeEmployeeResponse(emp: any): any {
  if (!emp || typeof emp !== 'object') return null;
  const { password, passwordHash, ...safe } = emp;
  return safe;
}

