import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, 'firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('Firestore Security Rules - Authentication', () => {
  it('should deny read/write to unauthenticated users on all collections', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthedDb.collection('products').get());
    await assertFails(unauthedDb.collection('sales').get());
    await assertFails(unauthedDb.collection('employees').get());
    await assertFails(unauthedDb.collection('attendance').get());
  });
});

describe('Firestore Security Rules - Employee Collection', () => {
  it('should allow authenticated users to read employees', async () => {
    const authedDb = testEnv.authenticatedContext('user1').firestore();
    await assertSucceeds(authedDb.collection('employees').get());
  });

  it('should deny non-admin users from writing employees', async () => {
    const authedDb = testEnv.authenticatedContext('user1').firestore();
    await assertFails(authedDb.collection('employees').doc('user1').set({
      id: 'user1', name: 'Test', email: 'test@test.com', role: 'user',
      type: 'دوام كامل', salary: 0, permissions: ['pos'],
    }));
  });
});

describe('Firestore Security Rules - Products Collection', () => {
  it('should deny non-inventory users from creating products', async () => {
    const authedDb = testEnv.authenticatedContext('user1').firestore();
    await assertFails(authedDb.collection('products').doc('prod1').set({
      id: 'prod1', name: 'Test Product', sellingPrice: 100, stock: 10,
    }));
  });
});

describe('Firestore Security Rules - Audit Logs', () => {
  it('should deny all client writes to audit_logs', async () => {
    const authedDb = testEnv.authenticatedContext('admin1').firestore();
    await assertFails(authedDb.collection('audit_logs').doc('log1').set({
      id: 'log1', timestamp: new Date().toISOString(), eventType: 'test', userId: 'admin1',
    }));
  });

  it('should deny unauthenticated reads to audit_logs', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthedDb.collection('audit_logs').get());
  });
});
