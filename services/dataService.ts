import { Product, Sale, Expense, Employee, Supplier, EmployeeType, PaymentMethod, Attendance, Customer, SaleType } from '../types';
import { db, auth } from './firebase';
import { collection, doc, getDocs, getDoc, setDoc, deleteDoc, writeBatch, onSnapshot, query, where } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const COLLECTIONS = {
  PRODUCTS: 'products',
  SALES: 'sales',
  EXPENSES: 'expenses',
  EMPLOYEES: 'employees',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  CATEGORIES: 'categories',
  SEASONS: 'seasons',
  ATTENDANCE: 'attendance',
  METADATA: 'metadata'
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeData = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeData);
  }
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeData(v)])
  );
};

export const DataService = {
  // Migration logic
  migrateFromLocalStorage: async (): Promise<boolean> => {
    try {
      const metadataRef = doc(db, COLLECTIONS.METADATA, 'migration_status');
      const docSnap = await getDoc(metadataRef);
      if (docSnap.exists() && docSnap.data().migrated) {
        return false; // Already migrated
      }

      let batch = writeBatch(db);
      let operationCount = 0;
      const MAX_BATCH_SIZE = 450;
      
      const commitBatchIfNeeded = async () => {
        if (operationCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      };
      
      const collectionsToMigrate = [
        { key: 'taiba_products', name: COLLECTIONS.PRODUCTS },
        { key: 'taiba_sales', name: COLLECTIONS.SALES },
        { key: 'taiba_expenses', name: COLLECTIONS.EXPENSES },
        { key: 'taiba_employees', name: COLLECTIONS.EMPLOYEES },
        { key: 'taiba_customers', name: COLLECTIONS.CUSTOMERS },
        { key: 'taiba_suppliers', name: COLLECTIONS.SUPPLIERS },
        { key: 'taiba_attendance', name: COLLECTIONS.ATTENDANCE }
      ];

      for (const coll of collectionsToMigrate) {
        const stored = localStorage.getItem(coll.key);
        if (stored) {
          const data = JSON.parse(stored);
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item && item.id) {
                const docRef = doc(db, coll.name, item.id);
                batch.set(docRef, sanitizeData(item));
                operationCount++;
                await commitBatchIfNeeded();
              }
            }
          }
        }
      }

      // Arrays like categories and seasons
      const categoriesStored = localStorage.getItem('taiba_categories');
      if (categoriesStored) {
        batch.set(doc(db, COLLECTIONS.CATEGORIES, 'all'), { items: JSON.parse(categoriesStored) });
        operationCount++;
        await commitBatchIfNeeded();
      }
      
      const seasonsStored = localStorage.getItem('taiba_seasons');
      if (seasonsStored) {
        batch.set(doc(db, COLLECTIONS.SEASONS, 'all'), { items: JSON.parse(seasonsStored) });
        operationCount++;
        await commitBatchIfNeeded();
      }

      batch.set(metadataRef, { migrated: true, timestamp: new Date().toISOString() });
      await batch.commit();
      return true;
    } catch (error) {
      console.error("Migration failed", error);
      return false;
    }
  },

  // Generic Get All
  _getAll: async <T>(collectionName: string): Promise<T[]> => {
    try {
      const querySnapshot = await getDocs(collection(db, collectionName));
      return querySnapshot.docs.map(doc => doc.data() as T);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, collectionName);
      return [];
    }
  },

  // Generic Set
  _set: async (collectionName: string, id: string, data: any): Promise<void> => {
    try {
      const sanitizedData = sanitizeData(data);
      await setDoc(doc(db, collectionName, id), sanitizedData);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${id}`);
    }
  },

  // Generic Delete
  _delete: async (collectionName: string, id: string): Promise<void> => {
    try {
      await deleteDoc(doc(db, collectionName, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
    }
  },

  // Generic Subscribe
  _subscribe: <T>(collectionName: string, callback: (data: T[]) => void) => {
    return onSnapshot(collection(db, collectionName), (snapshot) => {
      callback(snapshot.docs.map(doc => doc.data() as T));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, collectionName);
    });
  },

  // Products
  getProducts: async (): Promise<Product[]> => {
    return await DataService._getAll<Product>(COLLECTIONS.PRODUCTS);
  },

  subscribeToProducts: (callback: (products: Product[]) => void) => {
    return DataService._subscribe<Product>(COLLECTIONS.PRODUCTS, callback);
  },

  saveProduct: async (product: Product): Promise<void> => {
    await DataService._set(COLLECTIONS.PRODUCTS, product.id, product);
  },

  updateStock: async (items: {id: string, quantity: number}[], mode: 'increase' | 'decrease'): Promise<void> => {
    const batch = writeBatch(db);
    
    for (const item of items) {
      const productRef = doc(db, COLLECTIONS.PRODUCTS, item.id);
      const productSnap = await getDoc(productRef);
      if (productSnap.exists()) {
        const product = productSnap.data() as Product;
        if (mode === 'increase') product.stock += item.quantity;
        else product.stock = Math.max(0, product.stock - item.quantity);
        batch.set(productRef, sanitizeData(product));
      }
    }
    
    await batch.commit();
  },

  // Sales
  getSales: async (): Promise<Sale[]> => {
    return await DataService._getAll<Sale>(COLLECTIONS.SALES);
  },

  getUnpaidSalesByCustomer: async (customerId: string): Promise<Sale[]> => {
    try {
      const q = query(
        collection(db, COLLECTIONS.SALES), 
        where('customerId', '==', customerId)
      );
      const querySnapshot = await getDocs(q);
      const sales = querySnapshot.docs.map(doc => doc.data() as Sale);
      return sales.filter(s => s.paymentMethod === PaymentMethod.DEBT && s.isPaid === false);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, COLLECTIONS.SALES);
      return [];
    }
  },

  subscribeToSales: (callback: (sales: Sale[]) => void) => {
    return DataService._subscribe<Sale>(COLLECTIONS.SALES, callback);
  },

  createSale: async (sale: Sale): Promise<void> => {
    if (sale.paymentMethod === PaymentMethod.DEBT) {
        sale.isPaid = false;
    } else {
        sale.isPaid = true;
    }
    
    await DataService._set(COLLECTIONS.SALES, sale.id, sale);
    await DataService.updateStock(sale.items.map(i => ({ id: i.id, quantity: i.quantity })), 'decrease');
    
    if (sale.customerId) {
        const isDebt = sale.paymentMethod === PaymentMethod.DEBT;
        await DataService.updateCustomerPurchase(sale.customerId, sale.totalAmount, isDebt);
    }
  },

  updateSale: async (updatedSale: Sale): Promise<void> => {
    const oldSaleSnap = await getDoc(doc(db, COLLECTIONS.SALES, updatedSale.id));
    if (!oldSaleSnap.exists()) return;
    const oldSale = oldSaleSnap.data() as Sale;

    await DataService.updateStock(oldSale.items.map(i => ({ id: i.id, quantity: i.quantity })), 'increase');
    await DataService.updateStock(updatedSale.items.map(i => ({ id: i.id, quantity: i.quantity })), 'decrease');
    
    await DataService._set(COLLECTIONS.SALES, updatedSale.id, updatedSale);
  },

  settleDebt: async (saleId: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, saleId));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;

    if (sale.isPaid) return;

    sale.isPaid = true;
    sale.paidAt = new Date().toISOString();
    await DataService._set(COLLECTIONS.SALES, saleId, sale);

    if (sale.customerId) {
        await DataService.updateCustomerPurchase(sale.customerId, 0, false, -sale.totalAmount);
    }
  },

  rescheduleDebt: async (saleId: string, newDate: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, saleId));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;
    sale.dueDate = new Date(newDate).toISOString();
    await DataService._set(COLLECTIONS.SALES, saleId, sale);
  },

  getOverdueSales: async (): Promise<Sale[]> => {
    try {
      const q = query(
        collection(db, COLLECTIONS.SALES),
        where('isPaid', '==', false)
      );
      const querySnapshot = await getDocs(q);
      const now = new Date().toISOString();
      const sales = querySnapshot.docs.map(doc => doc.data() as Sale);
      return sales.filter(s => s.dueDate && s.dueDate <= now);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, COLLECTIONS.SALES);
      return [];
    }
  },

  deleteSale: async (id: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, id));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;

    await DataService.updateStock(sale.items.map(i => ({ id: i.id, quantity: i.quantity })), 'increase');

    if (sale.paymentMethod === PaymentMethod.DEBT && !sale.isPaid && sale.customerId) {
        await DataService.updateCustomerPurchase(sale.customerId, -sale.totalAmount, false, -sale.totalAmount);
    } else if (sale.customerId) {
        await DataService.updateCustomerPurchase(sale.customerId, -sale.totalAmount, false, 0);
    }

    await DataService._delete(COLLECTIONS.SALES, id);
  },

  processReturn: async (originalSale: Sale, user: string): Promise<void> => {
    const returnSale: Sale = {
        id: `R-${Date.now()}`,
        type: SaleType.RETURN,
        date: new Date().toISOString(),
        items: originalSale.items,
        totalAmount: -Math.abs(originalSale.totalAmount),
        profit: -Math.abs(originalSale.profit),
        paymentMethod: originalSale.paymentMethod,
        createdBy: user,
        customerId: originalSale.customerId,
        customerName: originalSale.customerName,
        originalSaleId: originalSale.id,
        isPaid: true
    };

    await DataService._set(COLLECTIONS.SALES, returnSale.id, returnSale);
    await DataService.updateStock(originalSale.items.map(i => ({ id: i.id, quantity: i.quantity })), 'increase');

    if (originalSale.customerId) {
        let debtAdjustment = 0;
        if (originalSale.paymentMethod === PaymentMethod.DEBT && !originalSale.isPaid) {
             debtAdjustment = -originalSale.totalAmount;
        }
        await DataService.updateCustomerPurchase(originalSale.customerId, -originalSale.totalAmount, false, debtAdjustment);
    }
  },

  // Customers
  getCustomers: async (): Promise<Customer[]> => {
    return await DataService._getAll<Customer>(COLLECTIONS.CUSTOMERS);
  },

  subscribeToCustomers: (callback: (customers: Customer[]) => void) => {
    return DataService._subscribe<Customer>(COLLECTIONS.CUSTOMERS, callback);
  },

  saveCustomer: async (customer: Customer): Promise<void> => {
    await DataService._set(COLLECTIONS.CUSTOMERS, customer.id, customer);
  },

  deleteCustomer: async (id: string): Promise<void> => {
    await DataService._delete(COLLECTIONS.CUSTOMERS, id);
  },

  updateCustomerPurchase: async (id: string, purchaseAmount: number, isDebt: boolean = false, debtAdjustment: number = 0): Promise<void> => {
    const custSnap = await getDoc(doc(db, COLLECTIONS.CUSTOMERS, id));
    if (!custSnap.exists()) return;
    const customer = custSnap.data() as Customer;
    
    customer.totalPurchases = (customer.totalPurchases || 0) + purchaseAmount;
    if (isDebt) {
        customer.totalDebt = (customer.totalDebt || 0) + purchaseAmount;
    }
    if (debtAdjustment !== 0) {
        customer.totalDebt = (customer.totalDebt || 0) + debtAdjustment;
    }
    if (purchaseAmount > 0) {
        customer.lastPurchaseDate = new Date().toISOString();
    }
    
    await DataService._set(COLLECTIONS.CUSTOMERS, id, customer);
  },

  // Expenses
  getExpenses: async (): Promise<Expense[]> => {
    return await DataService._getAll<Expense>(COLLECTIONS.EXPENSES);
  },

  subscribeToExpenses: (callback: (expenses: Expense[]) => void) => {
    return DataService._subscribe<Expense>(COLLECTIONS.EXPENSES, callback);
  },

  addExpense: async (expense: Expense): Promise<void> => {
    await DataService._set(COLLECTIONS.EXPENSES, expense.id, expense);
  },

  deleteExpense: async (id: string): Promise<void> => {
    await DataService._delete(COLLECTIONS.EXPENSES, id);
  },

  // Employees
  getEmployees: async (): Promise<Employee[]> => {
    return await DataService._getAll<Employee>(COLLECTIONS.EMPLOYEES);
  },

  subscribeToEmployees: (callback: (employees: Employee[]) => void) => {
    return DataService._subscribe<Employee>(COLLECTIONS.EMPLOYEES, callback);
  },

  saveEmployee: async (employee: Employee): Promise<void> => {
    await DataService._set(COLLECTIONS.EMPLOYEES, employee.id, employee);
  },

  deleteEmployee: async (id: string): Promise<void> => {
    await DataService._delete(COLLECTIONS.EMPLOYEES, id);
  },

  // Attendance Management
  getAttendance: async (): Promise<Attendance[]> => {
    return await DataService._getAll<Attendance>(COLLECTIONS.ATTENDANCE);
  },

  subscribeToAttendance: (callback: (attendance: Attendance[]) => void) => {
    return DataService._subscribe<Attendance>(COLLECTIONS.ATTENDANCE, callback);
  },

  clockIn: async (employee: Employee): Promise<Attendance> => {
    const now = new Date();
    const newRecord: Attendance = {
      id: Date.now().toString(),
      employeeId: employee.id,
      employeeName: employee.name,
      date: now.toISOString().split('T')[0],
      checkInTime: now.toISOString(),
    };
    await DataService._set(COLLECTIONS.ATTENDANCE, newRecord.id, newRecord);
    return newRecord;
  },

  clockOut: async (recordId: string): Promise<void> => {
    const attSnap = await getDoc(doc(db, COLLECTIONS.ATTENDANCE, recordId));
    if (!attSnap.exists()) return;
    const record = attSnap.data() as Attendance;
    
    const now = new Date();
    const diffMs = now.getTime() - new Date(record.checkInTime).getTime();
    const diffMins = Math.round(diffMs / 60000);

    record.checkOutTime = now.toISOString();
    record.durationMinutes = diffMins;
    
    await DataService._set(COLLECTIONS.ATTENDANCE, recordId, record);
  },

  // Suppliers
  getSuppliers: async (): Promise<Supplier[]> => {
    return await DataService._getAll<Supplier>(COLLECTIONS.SUPPLIERS);
  },

  subscribeToSuppliers: (callback: (suppliers: Supplier[]) => void) => {
    return DataService._subscribe<Supplier>(COLLECTIONS.SUPPLIERS, callback);
  },

  // Categories Management
  getCategories: async (): Promise<string[]> => {
    const catSnap = await getDoc(doc(db, COLLECTIONS.CATEGORIES, 'all'));
    if (catSnap.exists()) {
      return catSnap.data().items || [];
    }
    return [];
  },

  addCategory: async (category: string): Promise<void> => {
    const categories = await DataService.getCategories();
    if (!categories.includes(category)) {
      categories.push(category);
      await DataService._set(COLLECTIONS.CATEGORIES, 'all', { items: categories });
    }
  },

  deleteCategory: async (category: string): Promise<void> => {
    const categories = await DataService.getCategories();
    const newCategories = categories.filter(c => c !== category);
    await DataService._set(COLLECTIONS.CATEGORIES, 'all', { items: newCategories });
  },

  // Seasons Management
  getSeasons: async (): Promise<string[]> => {
    const seasSnap = await getDoc(doc(db, COLLECTIONS.SEASONS, 'all'));
    if (seasSnap.exists()) {
      return seasSnap.data().items || [];
    }
    return [];
  },

  addSeason: async (season: string): Promise<void> => {
    const seasons = await DataService.getSeasons();
    if (!seasons.includes(season)) {
      seasons.push(season);
      await DataService._set(COLLECTIONS.SEASONS, 'all', { items: seasons });
    }
  },

  deleteSeason: async (season: string): Promise<void> => {
    const seasons = await DataService.getSeasons();
    const newSeasons = seasons.filter(s => s !== season);
    await DataService._set(COLLECTIONS.SEASONS, 'all', { items: newSeasons });
  },

  // Backup & Restore
  getAllData: async (): Promise<string> => {
    const data = {
      products: await DataService.getProducts(),
      sales: await DataService.getSales(),
      expenses: await DataService.getExpenses(),
      employees: await DataService.getEmployees(),
      customers: await DataService.getCustomers(),
      attendance: await DataService.getAttendance(),
      suppliers: await DataService.getSuppliers(),
      categories: await DataService.getCategories(),
      seasons: await DataService.getSeasons(),
      timestamp: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  },

  restoreData: async (jsonString: string): Promise<boolean> => {
     // Needs implementation for Firestore batch restore if necessary
     return false;
  },

  clearAllData: async (): Promise<void> => {
    // For safety, not implemented to delete all from Firestore in one click without backend admin
    console.warn("Clear all data is disabled in cloud mode.");
  }
};
