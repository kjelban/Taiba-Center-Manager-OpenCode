import { Customer } from '../types';
import { db } from './firebase';
import { doc, getDoc, WriteBatch, increment } from 'firebase/firestore';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection } from './base';

function getCustomerPurchaseUpdates(purchaseAmount: number, isDebt: boolean, debtAdjustment: number): Record<string, any> {
  const updates: Record<string, any> = {
    totalPurchases: increment(purchaseAmount),
  };
  if (isDebt) {
    updates.totalDebt = increment(purchaseAmount);
  }
  if (debtAdjustment !== 0) {
    updates.totalDebt = increment(debtAdjustment);
  }
  if (purchaseAmount > 0) {
    updates.lastPurchaseDate = new Date().toISOString();
  }
  return updates;
}

export const CustomerService = {
  getCustomers: async (): Promise<Customer[]> => {
    return await getAll<Customer>(COLLECTIONS.CUSTOMERS);
  },

  subscribeToCustomers: (callback: (customers: Customer[]) => void) => {
    return subscribeToCollection<Customer>(COLLECTIONS.CUSTOMERS, callback);
  },

  saveCustomer: async (customer: Customer): Promise<void> => {
    await setData(COLLECTIONS.CUSTOMERS, customer.id, customer);
  },

  deleteCustomer: async (id: string): Promise<void> => {
    await deleteData(COLLECTIONS.CUSTOMERS, id);
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
    await setData(COLLECTIONS.CUSTOMERS, id, customer);
  },

  addCustomerUpdateToBatch: (batch: WriteBatch, id: string, purchaseAmount: number, isDebt: boolean = false, debtAdjustment: number = 0): void => {
    const updates = getCustomerPurchaseUpdates(purchaseAmount, isDebt, debtAdjustment);
    batch.update(doc(db, COLLECTIONS.CUSTOMERS, id), updates);
  },
};
