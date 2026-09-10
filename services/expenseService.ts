import { Expense } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection, ClientQueryOptions } from './base';

export const ExpenseService = {
  getExpenses: async (options?: ClientQueryOptions): Promise<Expense[]> => {
    return await getAll<Expense>(COLLECTIONS.EXPENSES, options);
  },

  subscribeToExpenses: (callback: (expenses: Expense[]) => void, options?: ClientQueryOptions) => {
    return subscribeToCollection<Expense>(COLLECTIONS.EXPENSES, callback, options);
  },

  subscribeToRecentExpenses: (callback: (expenses: Expense[]) => void, limitCount = 50) => {
    return subscribeToCollection<Expense>(COLLECTIONS.EXPENSES, callback, {
      orderByField: 'date',
      orderDirection: 'desc',
      limit: limitCount,
    });
  },

  getExpensesByDateRange: async (from: string, to: string): Promise<Expense[]> => {
    return await getAll<Expense>(COLLECTIONS.EXPENSES, {
      where: [
        { field: 'date', op: '>=', value: from },
        { field: 'date', op: '<=', value: to },
      ],
      orderByField: 'date',
      orderDirection: 'desc',
    });
  },

  addExpense: async (expense: Expense): Promise<void> => {
    await setData(COLLECTIONS.EXPENSES, expense.id, expense);
  },

  deleteExpense: async (id: string): Promise<void> => {
    await deleteData(COLLECTIONS.EXPENSES, id);
  },

  getExpensesTotal: async (from?: string, to?: string): Promise<number> => {
    try {
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      const { db } = await import('./firebase');
      let q = query(collection(db, COLLECTIONS.EXPENSES));
      if (from && to) {
        q = query(collection(db, COLLECTIONS.EXPENSES), where('date', '>=', from), where('date', '<=', to));
      }
      const snap = await getDocs(q);
      return snap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);
    } catch {
      return 0;
    }
  },
};
