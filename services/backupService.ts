import { COLLECTIONS, sanitizeData } from './base';
import { db } from './firebase';
import { doc, getDoc, getDocs, collection, writeBatch } from 'firebase/firestore';
import { ProductService } from './productService';
import { SaleService } from './saleService';
import { ExpenseService } from './expenseService';
import { EmployeeService } from './employeeService';
import { CustomerService } from './customerService';
import { SupplierService } from './supplierService';
import { AttendanceService } from './employeeService';
import { CategoryService } from './categoryService';

const MAX_BATCH_SIZE = 450;

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
    try {
      const backupData = JSON.parse(jsonString);
      
      // Clear existing data first
      await BackupService.clearAllData();
      
      let batch = writeBatch(db);
      let operationCount = 0;

      const commitBatchIfNeeded = async () => {
        if (operationCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      };

      // Helper to write array data
      const writeArrayData = async (items: any[], collectionName: string) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (item && item.id) {
            const docRef = doc(db, collectionName, item.id);
            batch.set(docRef, sanitizeData(item));
            operationCount++;
            await commitBatchIfNeeded();
          }
        }
      };

      // Restore collections
      await writeArrayData(backupData.products, COLLECTIONS.PRODUCTS);
      await writeArrayData(backupData.sales, COLLECTIONS.SALES);
      await writeArrayData(backupData.expenses, COLLECTIONS.EXPENSES);
      await writeArrayData(backupData.employees, COLLECTIONS.EMPLOYEES);
      await writeArrayData(backupData.customers, COLLECTIONS.CUSTOMERS);
      await writeArrayData(backupData.attendance, COLLECTIONS.ATTENDANCE);
      await writeArrayData(backupData.suppliers, COLLECTIONS.SUPPLIERS);

      // Restore categories (single document)
      if (backupData.categories && Array.isArray(backupData.categories)) {
        batch.set(doc(db, COLLECTIONS.CATEGORIES, 'all'), { items: backupData.categories });
        operationCount++;
        await commitBatchIfNeeded();
      }

      // Restore seasons (single document)
      if (backupData.seasons && Array.isArray(backupData.seasons)) {
        batch.set(doc(db, COLLECTIONS.SEASONS, 'all'), { items: backupData.seasons });
        operationCount++;
        await commitBatchIfNeeded();
      }

      // Commit any remaining operations
      if (operationCount > 0) {
        await batch.commit();
      }

      console.log("Data restored successfully from backup");
      return true;
    } catch (error) {
      console.error("Restore failed", error);
      return false;
    }
  },

  clearAllData: async (): Promise<void> => {
    try {
      const collectionsToClear = [
        COLLECTIONS.PRODUCTS,
        COLLECTIONS.SALES,
        COLLECTIONS.EXPENSES,
        COLLECTIONS.EMPLOYEES,
        COLLECTIONS.CUSTOMERS,
        COLLECTIONS.SUPPLIERS,
        COLLECTIONS.ATTENDANCE,
        COLLECTIONS.CATEGORIES,
        COLLECTIONS.SEASONS,
        COLLECTIONS.METADATA,
      ];

      let batch = writeBatch(db);
      let operationCount = 0;

      const commitBatchIfNeeded = async () => {
        if (operationCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      };

      for (const collectionName of collectionsToClear) {
        const snapshot = await getDocs(collection(db, collectionName));
        for (const docSnap of snapshot.docs) {
          batch.delete(doc(db, collectionName, docSnap.id));
          operationCount++;
          await commitBatchIfNeeded();
        }
      }

      if (operationCount > 0) {
        await batch.commit();
      }

      console.log("All data cleared successfully");
    } catch (error) {
      console.error("Clear all data failed", error);
      throw error;
    }
  },
};
