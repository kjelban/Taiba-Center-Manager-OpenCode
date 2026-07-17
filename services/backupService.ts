import { ProductService } from './productService';
import { SaleService } from './saleService';
import { ExpenseService } from './expenseService';
import { EmployeeService } from './employeeService';
import { CustomerService } from './customerService';
import { SupplierService } from './supplierService';
import { AttendanceService } from './employeeService';
import { CategoryService } from './categoryService';

async function getIdToken(): Promise<string> {
  const { auth } = await import('./firebase');
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

async function post(endpoint: string, body: any): Promise<any> {
  const token = await getIdToken();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${endpoint} returned ${res.status}: ${txt}`);
  }
  return res.json();
}

export const BackupService = {
  migrateFromLocalStorage: async (): Promise<boolean> => {
    try {
      const collectionsToMigrate = [
        { key: 'taiba_products', name: 'products' },
        { key: 'taiba_sales', name: 'sales' },
        { key: 'taiba_expenses', name: 'expenses' },
        { key: 'taiba_employees', name: 'employees' },
        { key: 'taiba_customers', name: 'customers' },
        { key: 'taiba_suppliers', name: 'suppliers' },
        { key: 'taiba_attendance', name: 'attendance' },
      ];

      const migrationData: Record<string, any[]> = {};

      for (const coll of collectionsToMigrate) {
        const stored = localStorage.getItem(coll.key);
        if (stored) {
          const data = JSON.parse(stored);
          if (Array.isArray(data)) {
            migrationData[coll.name] = data.filter((item: any) => item && item.id);
          }
        }
      }

      const categoriesStored = localStorage.getItem('taiba_categories');
      if (categoriesStored) {
        migrationData.categories = JSON.parse(categoriesStored);
      }

      const seasonsStored = localStorage.getItem('taiba_seasons');
      if (seasonsStored) {
        migrationData.seasons = JSON.parse(seasonsStored);
      }

      const hasData = Object.keys(migrationData).some(k => {
        const v = migrationData[k];
        return Array.isArray(v) ? v.length > 0 : v !== undefined;
      });
      if (!hasData) return false;

      const result = await post('/api/backup/migrate', { data: migrationData });
      return result.ok === true;
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
      const hasPreMigrationEmployees = Array.isArray(backupData.employees) &&
        backupData.employees.some((e: any) => e.password);

      if (hasPreMigrationEmployees) {
        console.warn("Backup contains pre-migration employees with password fields. Employee IDs may not match Firebase Auth UIDs after restore.");
      }

      await post('/api/backup/restore', { data: backupData });
      console.log("Data restored successfully from backup");
      return true;
    } catch (error) {
      console.error("Restore failed", error);
      return false;
    }
  },

  clearAllData: async (): Promise<void> => {
    try {
      await post('/api/backup/clear', {});
      console.log("All data cleared successfully");
    } catch (error) {
      console.error("Clear all data failed", error);
      throw error;
    }
  },
};
