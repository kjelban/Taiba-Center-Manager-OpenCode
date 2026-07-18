import { db } from './firebase';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';

// Server session token (set after login via /api/auth/login)
let serverSessionToken: string | null = null;

export function setServerSessionToken(token: string | null) {
  serverSessionToken = token;
}

export function getServerSessionToken(): string | null {
  return serverSessionToken;
}

async function getIdToken(): Promise<string> {
  if (serverSessionToken) return serverSessionToken;
  throw new Error('Not authenticated');
}

async function doFetch(url: string, body: any): Promise<boolean> {
  try {
    const token = await getIdToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`Proxy ${url} returned ${res.status}: ${txt}`);
    }
    return res.ok;
  } catch (e) {
    console.warn(`Proxy ${url} threw:`, e);
    return false;
  }
}

async function proxySet(collectionName: string, id: string, data: any): Promise<boolean> {
  return doFetch('/api/proxy/set', { collection: collectionName, id, data });
}
async function proxyDelete(collectionName: string, id: string): Promise<boolean> {
  return doFetch('/api/proxy/delete', { collection: collectionName, id });
}
export async function proxyGet<T>(path: string): Promise<T | null> {
  try {
    const token = await getIdToken();
    const res = await fetch('/api/proxy/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path }),
    });
    return res.ok ? (await res.json() as T) : null;
  } catch { return null; }
}
export async function proxyBatchSet(writes: { collection: string; id: string; data: any }[]): Promise<boolean> {
  return doFetch('/api/proxy/batch', { writes: writes.map(w => ({ type: "set", collection: w.collection, id: w.id, data: w.data })) });
}


export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Firestore Error [${operationType}] at ${path}: ${errorMessage}`);
  throw new Error(`Firestore operation failed: ${errorMessage}`);
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
  const ok = await proxySet(collectionName, id, data);
  if (!ok) {
    throw new Error(`Write to ${collectionName}/${id} failed: proxy returned error`);
  }
}

export async function deleteData(collectionName: string, id: string): Promise<void> {
  const ok = await proxyDelete(collectionName, id);
  if (!ok) {
    throw new Error(`Delete of ${collectionName}/${id} failed: proxy returned error`);
  }
}

export function subscribeToCollection<T>(collectionName: string, callback: (data: T[]) => void) {
  return onSnapshot(collection(db, collectionName), (snapshot) => {
    callback(snapshot.docs.map(doc => doc.data() as T));
  }, (error) => {
    handleFirestoreError(error, OperationType.LIST, collectionName);
  });
}
