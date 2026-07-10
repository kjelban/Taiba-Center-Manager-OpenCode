import { Sale, PaymentMethod, Customer, SaleType } from '../types';
import { db } from './firebase';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection, handleFirestoreError, OperationType } from './base';
import { ProductService } from './productService';
import { CustomerService } from './customerService';

export const SaleService = {
  getSales: async (): Promise<Sale[]> => {
    return await getAll<Sale>(COLLECTIONS.SALES);
  },

  subscribeToSales: (callback: (sales: Sale[]) => void) => {
    return subscribeToCollection<Sale>(COLLECTIONS.SALES, callback);
  },

  createSale: async (sale: Sale): Promise<void> => {
    if (sale.paymentMethod === PaymentMethod.DEBT) {
      sale.isPaid = false;
    } else {
      sale.isPaid = true;
    }
    await setData(COLLECTIONS.SALES, sale.id, sale);
    const stockItems = sale.items.filter(i => !i.isManualItem).map(i => ({ id: i.id, quantity: i.quantity }));
    if (stockItems.length > 0) await ProductService.updateStock(stockItems, 'decrease');
    if (sale.customerId) {
      const isDebt = sale.paymentMethod === PaymentMethod.DEBT;
      await CustomerService.updateCustomerPurchase(sale.customerId, sale.totalAmount, isDebt);
    }
  },

  updateSale: async (updatedSale: Sale): Promise<void> => {
    const oldSaleSnap = await getDoc(doc(db, COLLECTIONS.SALES, updatedSale.id));
    if (!oldSaleSnap.exists()) return;
    const oldSale = oldSaleSnap.data() as Sale;
    const oldStockItems = oldSale.items.filter(i => !i.isManualItem).map(i => ({ id: i.id, quantity: i.quantity }));
    const newStockItems = updatedSale.items.filter(i => !i.isManualItem).map(i => ({ id: i.id, quantity: i.quantity }));
    if (oldStockItems.length > 0) await ProductService.updateStock(oldStockItems, 'increase');
    if (newStockItems.length > 0) await ProductService.updateStock(newStockItems, 'decrease');
    await setData(COLLECTIONS.SALES, updatedSale.id, updatedSale);
  },

  deleteSale: async (id: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, id));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;
    await ProductService.updateStock(sale.items.map(i => ({ id: i.id, quantity: i.quantity })), 'increase');
    if (sale.paymentMethod === PaymentMethod.DEBT && !sale.isPaid && sale.customerId) {
      await CustomerService.updateCustomerPurchase(sale.customerId, -sale.totalAmount, false, -sale.totalAmount);
    } else if (sale.customerId) {
      await CustomerService.updateCustomerPurchase(sale.customerId, -sale.totalAmount, false, 0);
    }
    await deleteData(COLLECTIONS.SALES, id);
  },

  settleDebt: async (saleId: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, saleId));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;
    if (sale.isPaid) return;
    sale.isPaid = true;
    sale.paidAt = new Date().toISOString();
    await setData(COLLECTIONS.SALES, saleId, sale);
    if (sale.customerId) {
      await CustomerService.updateCustomerPurchase(sale.customerId, 0, false, -sale.totalAmount);
    }
  },

  rescheduleDebt: async (saleId: string, newDate: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, saleId));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;
    sale.dueDate = new Date(newDate).toISOString();
    await setData(COLLECTIONS.SALES, saleId, sale);
  },

  getOverdueSales: async (): Promise<Sale[]> => {
    try {
      const q = query(collection(db, COLLECTIONS.SALES), where('isPaid', '==', false));
      const querySnapshot = await getDocs(q);
      const now = new Date().toISOString();
      const sales = querySnapshot.docs.map(doc => doc.data() as Sale);
      return sales.filter(s => s.dueDate && s.dueDate <= now);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, COLLECTIONS.SALES);
      return [];
    }
  },

  getUnpaidSalesByCustomer: async (customerId: string): Promise<Sale[]> => {
    try {
      const q = query(collection(db, COLLECTIONS.SALES), where('customerId', '==', customerId));
      const querySnapshot = await getDocs(q);
      const sales = querySnapshot.docs.map(doc => doc.data() as Sale);
      return sales.filter(s => s.paymentMethod === PaymentMethod.DEBT && s.isPaid === false);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, COLLECTIONS.SALES);
      return [];
    }
  },

  processReturn: async (originalSale: Sale, user: string): Promise<void> => {
    const returnSale: Sale = {
      id: `R-${crypto.randomUUID()}`,
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
    await setData(COLLECTIONS.SALES, returnSale.id, returnSale);
    const stockItems = originalSale.items.filter(i => !i.isManualItem).map(i => ({ id: i.id, quantity: i.quantity }));
    if (stockItems.length > 0) await ProductService.updateStock(stockItems, 'increase');
    if (originalSale.customerId) {
      let debtAdjustment = 0;
      if (originalSale.paymentMethod === PaymentMethod.DEBT && !originalSale.isPaid) {
        debtAdjustment = -originalSale.totalAmount;
      }
      await CustomerService.updateCustomerPurchase(originalSale.customerId, -originalSale.totalAmount, false, debtAdjustment);
    }
  },
};
