import { describe, it, expect } from 'vitest';
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

    it('allows cashier to write customers', () => {
      expect(hasWritePermission(cashierEmployee, 'customers')).toBe(true);
    });

    it('allows cashier to write suppliers', () => {
      expect(hasWritePermission(cashierEmployee, 'suppliers')).toBe(true);
    });

    it('allows expenses user to write expenses', () => {
      expect(hasWritePermission(expensesEmployee, 'expenses')).toBe(true);
    });

    it('denies cashier from writing expenses', () => {
      expect(hasWritePermission(cashierEmployee, 'expenses')).toBe(false);
    });

    it('allows settings user to write categories and seasons', () => {
      expect(hasWritePermission(adminEmployee, 'categories')).toBe(true);
      expect(hasWritePermission(adminEmployee, 'seasons')).toBe(true);
    });

    it('denies cashier from writing categories and seasons', () => {
      expect(hasWritePermission(cashierEmployee, 'categories')).toBe(false);
      expect(hasWritePermission(cashierEmployee, 'seasons')).toBe(false);
    });

    it('allows any authenticated user to write attendance', () => {
      expect(hasWritePermission(cashierEmployee, 'attendance')).toBe(true);
      expect(hasWritePermission(inventoryEmployee, 'attendance')).toBe(true);
    });
  });
});

// ── validateProxyPayload ──

describe('validateProxyPayload', () => {
  it('validates products payload correctly', () => {
    const valid = { id: 'p1', name: 'قميص أطفال', sellingPrice: 25, stock: 10 };
    expect(validateProxyPayload('products', 'p1', valid)).toBeNull();

    expect(validateProxyPayload('products', 'p1', { id: 'p2' })).toBe('Document ID mismatch');
    expect(validateProxyPayload('products', 'p1', { id: 'p1', name: '' })).toBe('Missing or invalid: name');
    expect(validateProxyPayload('products', 'p1', { id: 'p1', name: 'قميص', sellingPrice: -5 })).toBe('Missing or invalid: sellingPrice');
    expect(validateProxyPayload('products', 'p1', { id: 'p1', name: 'قميص', sellingPrice: 25, stock: -1 })).toBe('Missing or invalid: stock');
  });

  it('validates expenses payload correctly', () => {
    const valid = { id: 'e1', description: 'فاتورة كهرباء', amount: 150, date: '2024-01-01', category: 'فواتير' };
    expect(validateProxyPayload('expenses', 'e1', valid)).toBeNull();

    expect(validateProxyPayload('expenses', 'e1', { id: 'e1', description: '', amount: 10 })).toBe('Missing or invalid: description');
    expect(validateProxyPayload('expenses', 'e1', { id: 'e1', description: 'دفع', amount: 0 })).toBe('Missing or invalid: amount');
  });

  it('blocks direct writes to audit_logs', () => {
    expect(validateProxyPayload('audit_logs', 'log1', { id: 'log1' })).toBe('Direct writes to audit_logs are not allowed');
  });
});

// ── AUDIT-005 Concurrency & Sales Normalization Tests ──

describe('AUDIT-005: normalizeCartStockItems', () => {
  it('TEST-005-01: normalizes valid cart items with unique products', () => {
    const cart = [
      { id: 'p1', quantity: 2 },
      { id: 'p2', quantity: 3 },
    ];
    const res = normalizeCartStockItems(cart);
    expect(res.error).toBeUndefined();
    expect(res.items).toEqual([
      { productId: 'p1', totalQuantity: 2 },
      { productId: 'p2', totalQuantity: 3 },
    ]);
  });

  it('TEST-005-02: groups and sums duplicate product entries in the same cart', () => {
    const cart = [
      { id: 'p1', quantity: 2 },
      { id: 'p2', quantity: 1 },
      { id: 'p1', quantity: 3 }, // duplicate row for p1
    ];
    const res = normalizeCartStockItems(cart);
    expect(res.error).toBeUndefined();
    expect(res.items).toEqual([
      { productId: 'p1', totalQuantity: 5 }, // 2 + 3 = 5
      { productId: 'p2', totalQuantity: 1 },
    ]);
  });

  it('TEST-005-03: filters out manual/non-inventory items', () => {
    const cart = [
      { id: 'p1', quantity: 2 },
      { id: 'manual-1', quantity: 10, isManualItem: true },
    ];
    const res = normalizeCartStockItems(cart);
    expect(res.error).toBeUndefined();
    expect(res.items).toEqual([
      { productId: 'p1', totalQuantity: 2 },
    ]);
  });

  it('TEST-005-04: rejects zero, negative, fractional, NaN, and infinite quantities', () => {
    expect(normalizeCartStockItems([{ id: 'p1', quantity: 0 }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: 'p1', quantity: -2 }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: 'p1', quantity: 1.5 }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: 'p1', quantity: NaN }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: 'p1', quantity: Infinity }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: 'p1', quantity: 10001 }]).error).toBeDefined();
  });

  it('TEST-005-05: rejects invalid or malicious product IDs in cart', () => {
    expect(normalizeCartStockItems([{ id: '../etc/passwd', quantity: 1 }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: '', quantity: 1 }]).error).toBeDefined();
    expect(normalizeCartStockItems([{ id: 'p1/sub', quantity: 1 }]).error).toBeDefined();
  });
});

describe('AUDIT-005: validateSalePayload', () => {
  const validSale = {
    id: 'sale-001',
    type: 'بيع',
    date: '2024-01-01T10:00:00.000Z',
    items: [{ id: 'p1', quantity: 2, sellingPrice: 20, purchasePrice: 10 }],
    totalAmount: 40,
    profit: 20,
    paymentMethod: 'نقدي',
    createdBy: 'كاشير 1',
    isPaid: true,
  };

  it('TEST-005-06: accepts complete valid sale object', () => {
    expect(validateSalePayload(validSale)).toBeNull();
  });

  it('TEST-005-07: rejects missing or non-finite totalAmount and profit', () => {
    expect(validateSalePayload({ ...validSale, totalAmount: undefined })).toBe('Missing or invalid totalAmount');
    expect(validateSalePayload({ ...validSale, totalAmount: NaN })).toBe('Missing or invalid totalAmount');
    expect(validateSalePayload({ ...validSale, profit: Infinity })).toBe('Missing or invalid profit');
  });

  it('TEST-005-08: rejects invalid sale type (must be بيع or مرتجع)', () => {
    expect(validateSalePayload({ ...validSale, type: 'شراء' })).toBe('Missing or invalid type');
    expect(validateSalePayload({ ...validSale, type: 'مرتجع' })).toBeNull();
  });

  it('TEST-005-09: validates customerId format if provided', () => {
    expect(validateSalePayload({ ...validSale, customerId: 'cust-123' })).toBeNull();
    expect(validateSalePayload({ ...validSale, customerId: 'cust/../hack' })).toBe('Invalid customerId format');
  });

  it('TEST-005-10: rejects empty items array in sale', () => {
    expect(validateSalePayload({ ...validSale, items: [] })).toBe('Missing or empty items');
  });
});
