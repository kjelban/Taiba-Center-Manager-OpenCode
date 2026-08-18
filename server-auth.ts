// Server-side authorization and validation functions
// Extracted for testability and single-responsibility.

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
