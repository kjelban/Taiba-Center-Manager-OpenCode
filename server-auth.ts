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
      if (!data.type || typeof data.type !== 'string') return 'Missing or invalid: type';
      if (!data.date || typeof data.date !== 'string') return 'Missing or invalid: date';
      if (!Array.isArray(data.items)) return 'Missing or invalid: items (must be array)';
      if (typeof data.totalAmount !== 'number') return 'Missing or invalid: totalAmount';
      if (typeof data.profit !== 'number') return 'Missing or invalid: profit';
      if (!data.paymentMethod || typeof data.paymentMethod !== 'string') return 'Missing or invalid: paymentMethod';
      if (!data.createdBy || typeof data.createdBy !== 'string') return 'Missing or invalid: createdBy';
      if (typeof data.isPaid !== 'boolean') return 'Missing or invalid: isPaid';
      break;
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
