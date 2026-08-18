import { describe, it, expect } from 'vitest';
import {
  ALLOWED_COLLECTIONS,
  isValidCollection,
  isValidDocumentId,
  WRITE_PERMISSIONS,
  hasWritePermission,
  validateProxyPayload,
} from './server-auth';

// ── isValidCollection ──

describe('isValidCollection', () => {
  it('allows all known collections', () => {
    for (const col of ALLOWED_COLLECTIONS) {
      expect(isValidCollection(col)).toBe(true);
    }
  });

  it('rejects unknown collections', () => {
    expect(isValidCollection('secret_data')).toBe(false);
    expect(isValidCollection('users')).toBe(false);
    expect(isValidCollection('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidCollection(null as any)).toBe(false);
    expect(isValidCollection(undefined as any)).toBe(false);
    expect(isValidCollection(123 as any)).toBe(false);
  });
});

// ── isValidDocumentId ──

describe('isValidDocumentId', () => {
  it('allows valid IDs', () => {
    expect(isValidDocumentId('abc123')).toBe(true);
    expect(isValidDocumentId('user-1')).toBe(true);
    expect(isValidDocumentId('doc_2024')).toBe(true);
    expect(isValidDocumentId('a')).toBe(true);
  });

  it('rejects empty IDs', () => {
    expect(isValidDocumentId('')).toBe(false);
  });

  it('rejects IDs exceeding 128 chars', () => {
    expect(isValidDocumentId('a'.repeat(129))).toBe(false);
    expect(isValidDocumentId('a'.repeat(128))).toBe(true);
  });

  it('rejects IDs with special characters', () => {
    expect(isValidDocumentId('doc/path')).toBe(false);
    expect(isValidDocumentId('doc name')).toBe(false);
    expect(isValidDocumentId('doc.dot')).toBe(false);
    expect(isValidDocumentId('doc@at')).toBe(false);
  });
});

// ── hasWritePermission ──

describe('hasWritePermission', () => {
  const adminEmployee = { permissions: ['employees', 'settings', 'dashboard', 'pos'] };
  const cashierEmployee = { permissions: ['pos', 'dashboard'] };
  const inventoryEmployee = { permissions: ['inventory', 'dashboard'] };
  const expensesEmployee = { permissions: ['expenses', 'dashboard'] };

  describe('admin collections', () => {
    it('allows admin to write employees', () => {
      expect(hasWritePermission(adminEmployee, 'employees')).toBe(true);
    });

    it('denies cashier from writing employees', () => {
      expect(hasWritePermission(cashierEmployee, 'employees')).toBe(false);
    });

    it('allows admin to write metadata', () => {
      expect(hasWritePermission(adminEmployee, 'metadata')).toBe(true);
    });

    it('denies non-admin from writing metadata', () => {
      expect(hasWritePermission(cashierEmployee, 'metadata')).toBe(false);
    });

    it('allows admin to write audit_logs', () => {
      expect(hasWritePermission(adminEmployee, 'audit_logs')).toBe(true);
    });

    it('denies non-admin from writing audit_logs', () => {
      expect(hasWritePermission(cashierEmployee, 'audit_logs')).toBe(false);
    });
  });

  describe('permission-gated collections', () => {
    it('allows inventory user to write products', () => {
      expect(hasWritePermission(inventoryEmployee, 'products')).toBe(true);
    });

    it('denies cashier from writing products', () => {
      expect(hasWritePermission(cashierEmployee, 'products')).toBe(false);
    });

    it('allows cashier to write sales', () => {
      expect(hasWritePermission(cashierEmployee, 'sales')).toBe(true);
    });

    it('denies inventory user from writing sales', () => {
      expect(hasWritePermission(inventoryEmployee, 'sales')).toBe(false);
    });

    it('allows expenses user to write expenses', () => {
      expect(hasWritePermission(expensesEmployee, 'expenses')).toBe(true);
    });

    it('allows cashier to write customers (pos permission)', () => {
      expect(hasWritePermission(cashierEmployee, 'customers')).toBe(true);
    });

    it('allows cashier to write suppliers (pos permission)', () => {
      expect(hasWritePermission(cashierEmployee, 'suppliers')).toBe(true);
    });
  });

  describe('any-authenticated collections', () => {
    it('allows any authenticated user to write attendance', () => {
      expect(hasWritePermission(cashierEmployee, 'attendance')).toBe(true);
    });

    it('allows settings/admin user to write categories', () => {
      expect(hasWritePermission(adminEmployee, 'categories')).toBe(true);
      expect(hasWritePermission(cashierEmployee, 'categories')).toBe(false);
    });

    it('allows settings/admin user to write seasons', () => {
      expect(hasWritePermission(adminEmployee, 'seasons')).toBe(true);
      expect(hasWritePermission(cashierEmployee, 'seasons')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('denies unknown collections', () => {
      expect(hasWritePermission(adminEmployee, 'unknown_collection')).toBe(false);
    });

    it('handles null/undefined employee', () => {
      expect(hasWritePermission(null, 'products')).toBe(false);
      expect(hasWritePermission(undefined, 'products')).toBe(false);
    });

    it('handles employee with no permissions', () => {
      expect(hasWritePermission({ permissions: [] }, 'products')).toBe(false);
    });

    it('handles employee with undefined permissions', () => {
      expect(hasWritePermission({}, 'products')).toBe(false);
    });
  });
});

// ── validateProxyPayload ──

describe('validateProxyPayload', () => {
  describe('common validation', () => {
    it('rejects null/undefined data', () => {
      expect(validateProxyPayload('products', 'id1', null)).toBe('Data must be an object');
      expect(validateProxyPayload('products', 'id1', undefined)).toBe('Data must be an object');
    });

    it('rejects non-object data', () => {
      expect(validateProxyPayload('products', 'id1', 'string')).toBe('Data must be an object');
      expect(validateProxyPayload('products', 'id1', 42)).toBe('Data must be an object');
    });

    it('rejects missing id field', () => {
      expect(validateProxyPayload('products', 'id1', { name: 'test' })).toBe('Missing required field: id');
    });

    it('rejects id mismatch', () => {
      expect(validateProxyPayload('products', 'id1', { id: 'id2', name: 'test' })).toBe('Document ID mismatch');
    });
  });

  describe('products validation', () => {
    const validProduct = { id: 'p1', name: 'Shirt', sellingPrice: 50, stock: 10 };

    it('accepts valid product', () => {
      expect(validateProxyPayload('products', 'p1', validProduct)).toBeNull();
    });

    it('rejects missing name', () => {
      expect(validateProxyPayload('products', 'p1', { ...validProduct, name: '' })).toContain('name');
    });

    it('rejects negative sellingPrice', () => {
      expect(validateProxyPayload('products', 'p1', { ...validProduct, sellingPrice: -1 })).toContain('sellingPrice');
    });

    it('rejects negative stock', () => {
      expect(validateProxyPayload('products', 'p1', { ...validProduct, stock: -1 })).toContain('stock');
    });
  });

  describe('sales validation', () => {
    const validSale = {
      id: 's1', type: 'بيع', date: '2024-01-01', items: [], totalAmount: 100,
      profit: 20, paymentMethod: 'نقدي', createdBy: 'admin', isPaid: true,
    };

    it('accepts valid sale', () => {
      expect(validateProxyPayload('sales', 's1', validSale)).toBeNull();
    });

    it('rejects missing type', () => {
      expect(validateProxyPayload('sales', 's1', { ...validSale, type: '' })).toContain('type');
    });

    it('rejects non-array items', () => {
      expect(validateProxyPayload('sales', 's1', { ...validSale, items: 'not-array' })).toContain('items');
    });

    it('rejects non-boolean isPaid', () => {
      expect(validateProxyPayload('sales', 's1', { ...validSale, isPaid: 'yes' })).toContain('isPaid');
    });
  });

  describe('expenses validation', () => {
    const validExpense = { id: 'e1', description: 'Rent', amount: 500, date: '2024-01-01', category: 'إيجار' };

    it('accepts valid expense', () => {
      expect(validateProxyPayload('expenses', 'e1', validExpense)).toBeNull();
    });

    it('rejects zero amount', () => {
      expect(validateProxyPayload('expenses', 'e1', { ...validExpense, amount: 0 })).toContain('amount');
    });

    it('rejects negative amount', () => {
      expect(validateProxyPayload('expenses', 'e1', { ...validExpense, amount: -10 })).toContain('amount');
    });
  });

  describe('employees validation', () => {
    const validEmployee = {
      id: 'emp1', name: 'Ali', email: 'ali@test.com', salary: 1000, permissions: ['pos'],
    };

    it('accepts valid employee', () => {
      expect(validateProxyPayload('employees', 'emp1', validEmployee)).toBeNull();
    });

    it('rejects missing email', () => {
      expect(validateProxyPayload('employees', 'emp1', { ...validEmployee, email: '' })).toContain('email');
    });

    it('rejects negative salary', () => {
      expect(validateProxyPayload('employees', 'emp1', { ...validEmployee, salary: -1 })).toContain('salary');
    });

    it('rejects non-array permissions', () => {
      expect(validateProxyPayload('employees', 'emp1', { ...validEmployee, permissions: 'admin' })).toContain('permissions');
    });
  });

  describe('customers validation', () => {
    it('accepts valid customer', () => {
      expect(validateProxyPayload('customers', 'c1', { id: 'c1', name: 'Ahmed' })).toBeNull();
    });

    it('rejects missing name', () => {
      expect(validateProxyPayload('customers', 'c1', { id: 'c1', name: '' })).toContain('name');
    });
  });

  describe('suppliers validation', () => {
    it('accepts valid supplier', () => {
      expect(validateProxyPayload('suppliers', 's1', { id: 's1', name: 'Supplier Co' })).toBeNull();
    });

    it('rejects missing name', () => {
      expect(validateProxyPayload('suppliers', 's1', { id: 's1', name: '' })).toContain('name');
    });
  });

  describe('attendance validation', () => {
    const validAttendance = {
      id: 'a1', employeeId: 'emp1', employeeName: 'Ali', date: '2024-01-01', checkInTime: '09:00',
    };

    it('accepts valid attendance', () => {
      expect(validateProxyPayload('attendance', 'a1', validAttendance)).toBeNull();
    });

    it('rejects missing employeeId', () => {
      expect(validateProxyPayload('attendance', 'a1', { ...validAttendance, employeeId: '' })).toContain('employeeId');
    });
  });

  describe('audit_logs (immutable)', () => {
    it('always rejects writes to audit_logs', () => {
      expect(validateProxyPayload('audit_logs', 'log1', { id: 'log1' })).toBe('Direct writes to audit_logs are not allowed');
    });
  });

  describe('metadata validation', () => {
    it('accepts valid metadata', () => {
      expect(validateProxyPayload('metadata', 'm1', { id: 'm1', migrated: true })).toBeNull();
    });

    it('rejects non-boolean migrated', () => {
      expect(validateProxyPayload('metadata', 'm1', { id: 'm1', migrated: 'yes' })).toContain('migrated');
    });
  });
});

// ── Security Architecture Tests ──

describe('Security: Client-side write elimination', () => {
  const posEmployee = { permissions: ['pos', 'dashboard'] };
  const cashierEmployee = { permissions: ['pos', 'dashboard'] };
  const inventoryEmployee = { permissions: ['inventory', 'dashboard'] };
  const adminEmployee = { permissions: ['employees', 'settings', 'dashboard'] };

  describe('Sales write permission enforcement', () => {
    it('POS user can write sales', () => {
      expect(hasWritePermission(posEmployee, 'sales')).toBe(true);
    });

    it('Non-POS user cannot write sales', () => {
      expect(hasWritePermission(inventoryEmployee, 'sales')).toBe(false);
    });

    it('Sales payload requires all mandatory fields', () => {
      const incomplete = { id: 's1', type: 'بيع' };
      expect(validateProxyPayload('sales', 's1', incomplete)).not.toBeNull();
    });

    it('Sales payload rejects type mismatch', () => {
      expect(validateProxyPayload('sales', 's1', { id: 's1', name: 'test' })).toContain('Missing or invalid');
    });
  });

  describe('Backup endpoint authorization', () => {
    it('admin has required permissions for backup operations', () => {
      expect(hasWritePermission(adminEmployee, 'metadata')).toBe(true);
    });

    it('POS user cannot write metadata (backup target)', () => {
      expect(hasWritePermission(posEmployee, 'metadata')).toBe(false);
    });

    it('cashier cannot write metadata (backup target)', () => {
      expect(hasWritePermission(cashierEmployee, 'metadata')).toBe(false);
    });

    it('non-admin cannot write audit_logs', () => {
      expect(hasWritePermission(posEmployee, 'audit_logs')).toBe(false);
      expect(hasWritePermission(inventoryEmployee, 'audit_logs')).toBe(false);
    });
  });

  describe('Sensitive collection write permissions', () => {
    it('employees collection requires admin', () => {
      expect(hasWritePermission(adminEmployee, 'employees')).toBe(true);
      expect(hasWritePermission(posEmployee, 'employees')).toBe(false);
      expect(hasWritePermission(inventoryEmployee, 'employees')).toBe(false);
    });

    it('products collection requires inventory permission', () => {
      expect(hasWritePermission(inventoryEmployee, 'products')).toBe(true);
      expect(hasWritePermission(posEmployee, 'products')).toBe(false);
      expect(hasWritePermission(adminEmployee, 'products')).toBe(false);
    });

    it('expenses collection requires expenses permission', () => {
      const expensesEmployee = { permissions: ['expenses'] };
      expect(hasWritePermission(expensesEmployee, 'expenses')).toBe(true);
      expect(hasWritePermission(posEmployee, 'expenses')).toBe(false);
      expect(hasWritePermission(inventoryEmployee, 'expenses')).toBe(false);
    });
  });

  describe('Authentication requirement', () => {
    it('rejects null employee', () => {
      expect(hasWritePermission(null, 'sales')).toBe(false);
      expect(hasWritePermission(null, 'products')).toBe(false);
      expect(hasWritePermission(null, 'employees')).toBe(false);
    });

    it('rejects undefined employee', () => {
      expect(hasWritePermission(undefined, 'sales')).toBe(false);
    });

    it('rejects empty permissions', () => {
      expect(hasWritePermission({ permissions: [] }, 'sales')).toBe(false);
    });

    it('rejects unknown collection', () => {
      expect(hasWritePermission(adminEmployee, 'unknown')).toBe(false);
      expect(hasWritePermission(posEmployee, 'users')).toBe(false);
    });
  });

  describe('Document ID validation (prevents injection)', () => {
    it('rejects path traversal attempts', () => {
      expect(isValidDocumentId('../etc/passwd')).toBe(false);
      expect(isValidDocumentId('admin/../employees')).toBe(false);
      expect(isValidDocumentId('sales/../../metadata')).toBe(false);
    });

    it('rejects SQL injection patterns', () => {
      expect(isValidDocumentId("'; DROP TABLE--")).toBe(false);
      expect(isValidDocumentId('1 OR 1=1')).toBe(false);
    });

    it('rejects XSS patterns in IDs', () => {
      expect(isValidDocumentId('<script>alert(1)</script>')).toBe(false);
      expect(isValidDocumentId('javascript:void(0)')).toBe(false);
    });

    it('rejects empty and oversized IDs', () => {
      expect(isValidDocumentId('')).toBe(false);
      expect(isValidDocumentId('a'.repeat(129))).toBe(false);
    });

    it('accepts valid alphanumeric IDs', () => {
      expect(isValidDocumentId('abc123')).toBe(true);
      expect(isValidDocumentId('sale-2024-001')).toBe(true);
      expect(isValidDocumentId('R-550e8400-e29b')).toBe(true);
    });
  });
});
