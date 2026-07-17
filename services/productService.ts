import { Product } from '../types';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection } from './base';

export const ProductService = {
  getProducts: async (): Promise<Product[]> => {
    return await getAll<Product>(COLLECTIONS.PRODUCTS);
  },

  subscribeToProducts: (callback: (products: Product[]) => void) => {
    return subscribeToCollection<Product>(COLLECTIONS.PRODUCTS, callback);
  },

  saveProduct: async (product: Product): Promise<void> => {
    await setData(COLLECTIONS.PRODUCTS, product.id, product);
  },

  deleteProduct: async (id: string): Promise<void> => {
    await deleteData(COLLECTIONS.PRODUCTS, id);
  },
};
