import { Supplier } from '../types';
import { COLLECTIONS, getAll, subscribeToCollection } from './base';

export const SupplierService = {
  getSuppliers: async (): Promise<Supplier[]> => {
    return await getAll<Supplier>(COLLECTIONS.SUPPLIERS);
  },

  subscribeToSuppliers: (callback: (suppliers: Supplier[]) => void) => {
    return subscribeToCollection<Supplier>(COLLECTIONS.SUPPLIERS, callback);
  },
};
