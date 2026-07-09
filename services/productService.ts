import { Product } from '../types';
import { db } from './firebase';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { COLLECTIONS, getAll, setData, subscribeToCollection, sanitizeData } from './base';

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

  updateStock: async (items: {id: string, quantity: number}[], mode: 'increase' | 'decrease'): Promise<void> => {
    const batch = writeBatch(db);
    for (const item of items) {
      const productRef = doc(db, COLLECTIONS.PRODUCTS, item.id);
      const productSnap = await getDoc(productRef);
      if (productSnap.exists()) {
        const product = productSnap.data() as Product;
        if (mode === 'increase') product.stock += item.quantity;
        else product.stock = Math.max(0, product.stock - item.quantity);
        batch.set(productRef, sanitizeData(product));
      }
    }
    await batch.commit();
  },
};
