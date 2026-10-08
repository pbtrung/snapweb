import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { define } from './vite.config';

export default defineConfig({
  plugins: [react()],
  define,
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/vite-env.d.ts', 'src/main.tsx'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Talks to a real Snapserver, see tests/integration/README.md
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 15000,
          hookTimeout: 15000,
          // Tests change shared server state, so never run them in parallel
          fileParallelism: false,
        },
      },
    ],
  },
});
