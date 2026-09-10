import { db } from './firebase';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  WhereFilterOp,
} from 'firebase/firestore';

// Proactive legacy localStorage cleanup on initialization
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.removeItem('taiba_auth_token');
  } catch {}
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    });
  } catch {}
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem('taiba_auth_token');
    } catch {}
  }
}

async function doFetch(url: string, body: any): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
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
    const res = await fetch('/api/proxy/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ path }),
    });
    return res.ok ? (await res.json() as T) : null;
  } catch { return null; }
}
export async function proxyBatchSet(writes: { collection: string; id: string; data: any }[]): Promise<boolean> {
  return doFetch('/api/proxy/batch', { writes: writes.map(w => ({ type: "set", collection: w.collection, id: w.id, data: w.data })) });
}

export interface ClientQueryConstraint {
  field: string;
  op: WhereFilterOp;
  value: any;
}

export interface ClientQueryOptions {
  limit?: number;
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
  where?: ClientQueryConstraint[];
  startAfterDoc?: any;
}

export async function queryServerCollection<T>(options: {
  collection: string;
  limit?: number;
  cursor?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
  orderByField?: string;
  orderDirection?: 'ASC' | 'DESC';
  filterField?: string;
  filterValue?: any;
}): Promise<{ ok: boolean; items: T[]; nextCursor: string | null; hasMore: boolean; totalReturned: number }> {
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Server query failed: ${res.status} ${txt}`);
  }
  return res.json();
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
  METADATA: 'metadata',
  AUDIT_LOGS: 'audit_logs',
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

export async function getAll<T>(collectionName: string, options?: ClientQueryOptions): Promise<T[]> {
  try {
    let q: any = collection(db, collectionName);
    if (options) {
      const constraints: any[] = [];
      if (options.where) {
        for (const w of options.where) {
          constraints.push(where(w.field, w.op, w.value));
        }
      }
      if (options.orderByField) {
        constraints.push(orderBy(options.orderByField, options.orderDirection || 'desc'));
      }
      if (options.startAfterDoc) {
        constraints.push(startAfter(options.startAfterDoc));
      }
      if (options.limit && options.limit > 0) {
        constraints.push(limit(options.limit));
      }
      if (constraints.length > 0) {
        q = query(q, ...constraints);
      }
    }
    const querySnapshot = await getDocs(q);
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

export function subscribeToCollection<T>(
  collectionName: string,
  callback: (data: T[]) => void,
  options?: ClientQueryOptions
) {
  let q: any = collection(db, collectionName);
  if (options) {
    const constraints: any[] = [];
    if (options.where) {
      for (const w of options.where) {
        constraints.push(where(w.field, w.op, w.value));
      }
    }
    if (options.orderByField) {
      constraints.push(orderBy(options.orderByField, options.orderDirection || 'desc'));
    }
    if (options.startAfterDoc) {
      constraints.push(startAfter(options.startAfterDoc));
    }
    if (options.limit && options.limit > 0) {
      constraints.push(limit(options.limit));
    }
    if (constraints.length > 0) {
      q = query(q, ...constraints);
    }
  }

  return onSnapshot(q, (snapshot: any) => {
    callback(snapshot.docs.map((doc: any) => doc.data() as T));
  }, (error: any) => {
    handleFirestoreError(error, OperationType.LIST, collectionName);
  });
}

