import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['tests/**/*', 'src/**/*.test.ts']
    },
    setupFiles: ['tests/setup.ts']
  },
  resolve: {
    alias: {
      'ponder:schema': path.resolve(__dirname, './ponder.schema.ts'),
      'ponder:api': path.resolve(__dirname, './src/api'),
      'ponder:registry': path.resolve(__dirname, './src/registry.mock.ts'),
      'ponder': path.resolve(__dirname, './src/ponder.mock.ts')
    }
  }
});
