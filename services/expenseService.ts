import { Expense } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection } from './base';

export const ExpenseService = {
  getExpenses: async (): Promise<Expense[]> => {
    return await getAll<Expense>(COLLECTIONS.EXPENSES);
  },

  subscribeToExpenses: (callback: (expenses: Expense[]) => void) => {
    return subscribeToCollection<Expense>(COLLECTIONS.EXPENSES, callback);
  },

  addExpense: async (expense: Expense): Promise<void> => {
    await setData(COLLECTIONS.EXPENSES, expense.id, expense);
  },

  deleteExpense: async (id: string): Promise<void> => {
    await deleteData(COLLECTIONS.EXPENSES, id);
  },
};
