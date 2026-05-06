import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@config': resolve(__dirname, 'src/config'),
      '@controllers': resolve(__dirname, 'src/controllers'),
      '@middleware': resolve(__dirname, 'src/middleware'),
      '@models': resolve(__dirname, 'src/models'),
      '@routes': resolve(__dirname, 'src/routes'),
      '@services': resolve(__dirname, 'src/services'),
      '@fabric': resolve(__dirname, 'src/fabric'),
      '@polygon': resolve(__dirname, 'src/polygon'),
      '@validators': resolve(__dirname, 'src/validators'),
      '@errors': resolve(__dirname, 'src/errors'),
    },
  },
});
