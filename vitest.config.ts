import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // e2e/ uses @playwright/test's own test()/expect() - a different API
    // shape that vitest would otherwise try (and fail) to run directly.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
