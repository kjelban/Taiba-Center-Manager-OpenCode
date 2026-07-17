import { Sale } from '../types';
import { COLLECTIONS, getAll, subscribeToCollection, handleFirestoreError, OperationType } from './base';

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

export const SaleService = {
  getSales: async (): Promise<Sale[]> => {
    return await getAll<Sale>(COLLECTIONS.SALES);
  },

  subscribeToSales: (callback: (sales: Sale[]) => void) => {
    return subscribeToCollection<Sale>(COLLECTIONS.SALES, callback);
  },

  createSale: async (sale: Sale): Promise<void> => {
    await post('/api/sales/create', { sale });
  },

  updateSale: async (updatedSale: Sale): Promise<void> => {
    await post('/api/sales/update', { sale: updatedSale });
  },

  deleteSale: async (id: string): Promise<void> => {
    await post('/api/sales/delete', { id });
  },

  settleDebt: async (saleId: string): Promise<void> => {
    await post('/api/sales/settle-debt', { saleId });
  },

  rescheduleDebt: async (saleId: string, newDate: string): Promise<void> => {
    await post('/api/sales/reschedule-debt', { saleId, newDate });
  },

  // NOTE: requires composite index on (isPaid ASC, dueDate ASC) — see firestore.indexes.json
  getOverdueSales: async (): Promise<Sale[]> => {
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('./firebase');
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
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('./firebase');
      const q = query(collection(db, COLLECTIONS.SALES), where('customerId', '==', customerId), where('isPaid', '==', false));
      const querySnapshot = await getDocs(q);
      const sales = querySnapshot.docs.map(doc => doc.data() as Sale);
      return sales.filter(s => s.paymentMethod === 'آجل (دين)');
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, COLLECTIONS.SALES);
      return [];
    }
  },

  processReturn: async (originalSale: Sale, user: string): Promise<void> => {
    await post('/api/sales/return', { originalSale, user });
  },
};
