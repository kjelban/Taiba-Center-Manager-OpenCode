import { Sale, PaymentMethod, SaleType } from '../types';
import { db } from './firebase';
import { collection, doc, getDoc, getDocs, query, where, writeBatch, increment } from 'firebase/firestore';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection, handleFirestoreError, OperationType, sanitizeData } from './base';
import { CustomerService } from './customerService';

function getStockItems(items: { id: string; quantity: number; isManualItem?: boolean }[]): { id: string; quantity: number }[] {
  return items.filter(i => !i.isManualItem).map(i => ({ id: i.id, quantity: i.quantity }));
}

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

    const batch = writeBatch(db);
    batch.set(doc(db, COLLECTIONS.SALES, sale.id), sanitizeData(sale));

    const stockItems = getStockItems(sale.items);
    for (const item of stockItems) {
      batch.update(doc(db, COLLECTIONS.PRODUCTS, item.id), { stock: increment(-item.quantity) });
    }

    if (sale.customerId) {
      const isDebt = sale.paymentMethod === PaymentMethod.DEBT;
      CustomerService.addCustomerUpdateToBatch(batch, sale.customerId, sale.totalAmount, isDebt);
    }

    await batch.commit();
  },

  updateSale: async (updatedSale: Sale): Promise<void> => {
    const oldSaleSnap = await getDoc(doc(db, COLLECTIONS.SALES, updatedSale.id));
    if (!oldSaleSnap.exists()) return;
    const oldSale = oldSaleSnap.data() as Sale;
    const oldStockItems = getStockItems(oldSale.items);
    const newStockItems = getStockItems(updatedSale.items);

    const batch = writeBatch(db);
    batch.set(doc(db, COLLECTIONS.SALES, updatedSale.id), sanitizeData(updatedSale));

    for (const item of oldStockItems) {
      batch.update(doc(db, COLLECTIONS.PRODUCTS, item.id), { stock: increment(item.quantity) });
    }
    for (const item of newStockItems) {
      batch.update(doc(db, COLLECTIONS.PRODUCTS, item.id), { stock: increment(-item.quantity) });
    }

    await batch.commit();
  },

  deleteSale: async (id: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, id));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;

    const batch = writeBatch(db);
    batch.delete(doc(db, COLLECTIONS.SALES, id));

    const stockMultiplier = sale.type === SaleType.RETURN ? -1 : 1;
    const stockItems = getStockItems(sale.items);
    for (const item of stockItems) {
      batch.update(doc(db, COLLECTIONS.PRODUCTS, item.id), { stock: increment(item.quantity * stockMultiplier) });
    }

    if (sale.customerId) {
      let debtAdjustment = 0;
      if (sale.paymentMethod === PaymentMethod.DEBT && !sale.isPaid) {
        debtAdjustment = -sale.totalAmount;
      }
      CustomerService.addCustomerUpdateToBatch(batch, sale.customerId, -sale.totalAmount, false, debtAdjustment);
    }

    await batch.commit();
  },

  settleDebt: async (saleId: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, saleId));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;
    if (sale.isPaid) return;
    sale.isPaid = true;
    sale.paidAt = new Date().toISOString();

    const batch = writeBatch(db);
    batch.set(doc(db, COLLECTIONS.SALES, saleId), sanitizeData(sale));

    if (sale.customerId) {
      CustomerService.addCustomerUpdateToBatch(batch, sale.customerId, 0, false, -sale.totalAmount);
    }

    await batch.commit();
  },

  rescheduleDebt: async (saleId: string, newDate: string): Promise<void> => {
    const saleSnap = await getDoc(doc(db, COLLECTIONS.SALES, saleId));
    if (!saleSnap.exists()) return;
    const sale = saleSnap.data() as Sale;
    sale.dueDate = new Date(newDate).toISOString();
    await setData(COLLECTIONS.SALES, saleId, sale);
  },

  // NOTE: requires composite index on (isPaid ASC, dueDate ASC) — see firestore.indexes.json
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

  // NOTE: requires composite index on (customerId ASC, isPaid ASC) — see firestore.indexes.json
  getUnpaidSalesByCustomer: async (customerId: string): Promise<Sale[]> => {
    try {
      const q = query(collection(db, COLLECTIONS.SALES), where('customerId', '==', customerId), where('isPaid', '==', false));
      const querySnapshot = await getDocs(q);
      const sales = querySnapshot.docs.map(doc => doc.data() as Sale);
      return sales.filter(s => s.paymentMethod === PaymentMethod.DEBT);
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

    const batch = writeBatch(db);
    batch.set(doc(db, COLLECTIONS.SALES, returnSale.id), sanitizeData(returnSale));

    const stockItems = getStockItems(originalSale.items);
    for (const item of stockItems) {
      batch.update(doc(db, COLLECTIONS.PRODUCTS, item.id), { stock: increment(item.quantity) });
    }

    if (originalSale.customerId) {
      let debtAdjustment = 0;
      if (originalSale.paymentMethod === PaymentMethod.DEBT && !originalSale.isPaid) {
        debtAdjustment = -originalSale.totalAmount;
      }
      CustomerService.addCustomerUpdateToBatch(batch, originalSale.customerId, -originalSale.totalAmount, false, debtAdjustment);
    }

    await batch.commit();
  },
};
