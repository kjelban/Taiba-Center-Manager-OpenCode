
// Enums
export enum PaymentMethod {
  CASH = 'نقدي',
  CARD = 'بطاقة',
  MIXED = 'مختلط',
  DEBT = 'آجل (دين)'
}

export enum EmployeeType {
  FULL_TIME = 'دوام كامل',
  PART_TIME = 'نصف دوام'
}

export enum TransactionType {
  INCOME = 'إيراد',
  EXPENSE = 'مصروف'
}

export enum SaleType {
  SALE = 'بيع',
  RETURN = 'مرتجع'
}

// Interfaces

export interface Product {
  id: string;
  name: string;
  category: string;
  size: string;
  color: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  minStockAlert: number;
  season: string;
  barcode?: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  notes?: string;
  totalPurchases: number; // calculated field
  totalDebt: number; // New: Total unpaid debt
  lastPurchaseDate?: string;
}

export interface Sale {
  id: string;
  type: SaleType; // sale or return
  date: string; // ISO String (Creation Date)
  items: CartItem[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  profit: number;
  createdBy: string; // Username
  customerId?: string;
  customerName?: string;
  updatedBy?: string; // Username of last editor
  updatedAt?: string; // ISO String of last edit
  originalSaleId?: string; // If return, link to original
  
  // Debt specific fields
  dueDate?: string; // Date when debt must be paid
  isPaid?: boolean; // For debt sales
  paidAt?: string; // When the debt was settled
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  description: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
}

export interface PurchaseInvoice {
  id: string;
  supplierId: string;
  date: string;
  items: { productId: string; quantity: number; cost: number }[];
  totalCost: number;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  type: EmployeeType;
  salary: number;
  permissions: string[]; // List of page IDs allowed to access
  password?: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string | null;
  durationMinutes?: number | null;
}

export interface AppState {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  employees: Employee[];
  suppliers: Supplier[];
}
