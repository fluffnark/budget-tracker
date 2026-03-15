import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

declare const process: {
  env: Record<string, string | undefined>;
};

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000';

function normalizeViteBase(raw: string | undefined): string {
  const value = (raw ?? '/').trim();
  if (!value || value === '/') return '/';
  const withLeading = value.charAt(0) === '/' ? value : `/${value}`;
  return withLeading.charAt(withLeading.length - 1) === '/'
    ? withLeading
    : `${withLeading}/`;
}

const basePath = normalizeViteBase(process.env.VITE_BASE_PATH);

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    allowedHosts: ['harmony.local'],
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false
      },
      '/budget/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/budget/, '')
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts'
  }
});
