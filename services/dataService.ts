import { ProductService } from './productService';
import { SaleService } from './saleService';
import { CustomerService } from './customerService';
import { ExpenseService } from './expenseService';
import { EmployeeService, AttendanceService } from './employeeService';
import { SupplierService } from './supplierService';
import { CategoryService } from './categoryService';
import { BackupService } from './backupService';

export { ProductService } from './productService';
export { SaleService } from './saleService';
export { CustomerService } from './customerService';
export { ExpenseService } from './expenseService';
export { EmployeeService, AttendanceService } from './employeeService';
export { SupplierService } from './supplierService';
export { CategoryService } from './categoryService';
export { BackupService } from './backupService';

export const DataService = {
  // Product methods
  getProducts: ProductService.getProducts,
  subscribeToProducts: ProductService.subscribeToProducts,
  saveProduct: ProductService.saveProduct,
  deleteProduct: ProductService.deleteProduct,
  updateStock: ProductService.updateStock,

  // Sale methods
  getSales: SaleService.getSales,
  subscribeToSales: SaleService.subscribeToSales,
  createSale: SaleService.createSale,
  updateSale: SaleService.updateSale,
  deleteSale: SaleService.deleteSale,
  settleDebt: SaleService.settleDebt,
  rescheduleDebt: SaleService.rescheduleDebt,
  getOverdueSales: SaleService.getOverdueSales,
  getUnpaidSalesByCustomer: SaleService.getUnpaidSalesByCustomer,
  processReturn: SaleService.processReturn,

  // Customer methods
  getCustomers: CustomerService.getCustomers,
  subscribeToCustomers: CustomerService.subscribeToCustomers,
  saveCustomer: CustomerService.saveCustomer,
  deleteCustomer: CustomerService.deleteCustomer,
  updateCustomerPurchase: CustomerService.updateCustomerPurchase,

  // Expense methods
  getExpenses: ExpenseService.getExpenses,
  subscribeToExpenses: ExpenseService.subscribeToExpenses,
  addExpense: ExpenseService.addExpense,
  deleteExpense: ExpenseService.deleteExpense,

  // Employee methods
  getEmployees: EmployeeService.getEmployees,
  subscribeToEmployees: EmployeeService.subscribeToEmployees,
  saveEmployee: EmployeeService.saveEmployee,
  deleteEmployee: EmployeeService.deleteEmployee,

  // Attendance methods
  getAttendance: AttendanceService.getAttendance,
  subscribeToAttendance: AttendanceService.subscribeToAttendance,
  clockIn: AttendanceService.clockIn,
  clockOut: AttendanceService.clockOut,

  // Supplier methods
  getSuppliers: SupplierService.getSuppliers,
  subscribeToSuppliers: SupplierService.subscribeToSuppliers,

  // Category and Season methods
  getCategories: CategoryService.getCategories,
  addCategory: CategoryService.addCategory,
  deleteCategory: CategoryService.deleteCategory,
  getSeasons: CategoryService.getSeasons,
  addSeason: CategoryService.addSeason,
  deleteSeason: CategoryService.deleteSeason,

  // Backup & Migration methods
  migrateFromLocalStorage: BackupService.migrateFromLocalStorage,
  getAllData: BackupService.getAllData,
  restoreData: BackupService.restoreData,
  clearAllData: BackupService.clearAllData,
};
