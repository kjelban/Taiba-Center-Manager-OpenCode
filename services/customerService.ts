import { Customer } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection } from './base';

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
};
