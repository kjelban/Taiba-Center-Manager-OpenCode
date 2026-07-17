import { Product } from '../types';
import { db } from './firebase';
import { doc, getDoc, writeBatch, increment, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, getAll, setData, deleteData, subscribeToCollection, sanitizeData, proxyBatchSet, handleFirestoreError, OperationType } from './base';

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

  updateStock: async (items: {id: string, quantity: number}[], mode: 'increase' | 'decrease'): Promise<void> => {
    const writes: {collection: string; id: string; data: any}[] = [];
    for (const item of items) {
      const stockDelta = mode === 'increase' ? item.quantity : -item.quantity;
      writes.push({ collection: COLLECTIONS.PRODUCTS, id: item.id, data: { stock: increment(stockDelta) } });
    }
    // Proxy batch doesn't support atomic increment operations, so it falls back to
    // a read-modify-write pattern which is subject to race conditions under concurrency.
    const ok = await proxyBatchSet(writes);
    if (ok) return;
    try {
      const batch = writeBatch(db);
      for (const w of writes) batch.update(doc(db, w.collection, w.id), w.data);
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.PRODUCTS);
    }
  },
};
