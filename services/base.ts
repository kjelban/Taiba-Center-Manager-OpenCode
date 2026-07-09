import { db, auth } from './firebase';
import { collection, doc, getDocs, getDoc, setDoc, deleteDoc, writeBatch, onSnapshot } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: { providerId?: string | null; email?: string | null }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const COLLECTIONS = {
  PRODUCTS: 'products',
  SALES: 'sales',
  EXPENSES: 'expenses',
  EMPLOYEES: 'employees',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  CATEGORIES: 'categories',
  SEASONS: 'seasons',
  ATTENDANCE: 'attendance',
  METADATA: 'metadata'
};

export const sanitizeData = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeData);
  }
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeData(v)])
  );
};

export async function getAll<T>(collectionName: string): Promise<T[]> {
  try {
    const querySnapshot = await getDocs(collection(db, collectionName));
    return querySnapshot.docs.map(doc => doc.data() as T);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collectionName);
    return [];
  }
}

export async function setData(collectionName: string, id: string, data: any): Promise<void> {
  try {
    const sanitizedData = sanitizeData(data);
    await setDoc(doc(db, collectionName, id), sanitizedData);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${id}`);
  }
}

export async function deleteData(collectionName: string, id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, collectionName, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
  }
}

export function subscribeToCollection<T>(collectionName: string, callback: (data: T[]) => void) {
  return onSnapshot(collection(db, collectionName), (snapshot) => {
    callback(snapshot.docs.map(doc => doc.data() as T));
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, collectionName);
  });
}

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
