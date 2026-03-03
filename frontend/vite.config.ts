import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

declare const process: {
  env: Record<string, string | undefined>;
};

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['harmony.local'],
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts'
  }
});
