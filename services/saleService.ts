import { Sale } from '../types';
import { COLLECTIONS, getAll, subscribeToCollection, handleFirestoreError, OperationType, ClientQueryOptions } from './base';

async function post(endpoint: string, body: any): Promise<any> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${endpoint} returned ${res.status}: ${txt}`);
  }
  return res.json();
}

export const SaleService = {
  getSales: async (options?: ClientQueryOptions): Promise<Sale[]> => {
    return await getAll<Sale>(COLLECTIONS.SALES, options);
  },

  subscribeToSales: (callback: (sales: Sale[]) => void, options?: ClientQueryOptions) => {
    return subscribeToCollection<Sale>(COLLECTIONS.SALES, callback, options);
  },

  subscribeToRecentSales: (callback: (sales: Sale[]) => void, limitCount = 50) => {
    return subscribeToCollection<Sale>(COLLECTIONS.SALES, callback, {
      orderByField: 'date',
      orderDirection: 'desc',
      limit: limitCount,
    });
  },

  getSalesByDateRange: async (from: string, to: string): Promise<Sale[]> => {
    return await getAll<Sale>(COLLECTIONS.SALES, {
      where: [
        { field: 'date', op: '>=', value: from },
        { field: 'date', op: '<=', value: to },
      ],
      orderByField: 'date',
      orderDirection: 'desc',
    });
  },

  getTodaySales: async (): Promise<Sale[]> => {
    const today = new Date().toISOString().split('T')[0];
    const from = `${today}T00:00:00.000Z`;
    const to = `${today}T23:59:59.999Z`;
    return await SaleService.getSalesByDateRange(from, to);
  },

  getSaleById: async (id: string): Promise<Sale | null> => {
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('./firebase');
      const docSnap = await getDoc(doc(db, COLLECTIONS.SALES, id));
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...(docSnap.data() as any) } as Sale;
    } catch {
      return null;
    }
  },

  getSalesByCustomer: async (customerId: string): Promise<Sale[]> => {
    return await getAll<Sale>(COLLECTIONS.SALES, {
      where: [{ field: 'customerId', op: '==', value: customerId }],
      orderByField: 'date',
      orderDirection: 'desc',
    });
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
