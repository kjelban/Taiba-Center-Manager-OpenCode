import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['firestore.rules.test.ts', 'node_modules/**'],
    testTimeout: 15000,
  },
});
