import { COLLECTIONS, sanitizeData } from './base';
import { db } from './firebase';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { ProductService } from './productService';
import { SaleService } from './saleService';
import { ExpenseService } from './expenseService';
import { EmployeeService } from './employeeService';
import { CustomerService } from './customerService';
import { SupplierService } from './supplierService';
import { AttendanceService } from './employeeService';
import { CategoryService } from './categoryService';

export const BackupService = {
  migrateFromLocalStorage: async (): Promise<boolean> => {
    try {
      const metadataRef = doc(db, COLLECTIONS.METADATA, 'migration_status');
      const docSnap = await getDoc(metadataRef);
      if (docSnap.exists() && docSnap.data().migrated) {
        return false;
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

  getAllData: async (): Promise<string> => {
    const data = {
      products: await ProductService.getProducts(),
      sales: await SaleService.getSales(),
      expenses: await ExpenseService.getExpenses(),
      employees: await EmployeeService.getEmployees(),
      customers: await CustomerService.getCustomers(),
      attendance: await AttendanceService.getAttendance(),
      suppliers: await SupplierService.getSuppliers(),
      categories: await CategoryService.getCategories(),
      seasons: await CategoryService.getSeasons(),
      timestamp: new Date().toISOString()
    };
    return JSON.stringify(data, null, 2);
  },

  restoreData: async (jsonString: string): Promise<boolean> => {
    return false;
  },

  clearAllData: async (): Promise<void> => {
    console.warn("Clear all data is disabled in cloud mode.");
  },
};
