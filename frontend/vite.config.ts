import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

declare const process: {
  env: Record<string, string | undefined>;
};

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000';
const defaultAllowedHosts = [
  'harmony.local',
  'budget.great-kettle.ts.net',
  '127.0.0.1',
  'localhost'
];

function normalizeViteBase(raw: string | undefined): string {
  const value = (raw ?? '/').trim();
  if (!value || value === '/') return '/';
  const withLeading = value.charAt(0) === '/' ? value : `/${value}`;
  return withLeading.charAt(withLeading.length - 1) === '/'
    ? withLeading
    : `${withLeading}/`;
}

function resolveAllowedHosts(raw: string | undefined): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : defaultAllowedHosts;
}

const basePath = normalizeViteBase(process.env.VITE_BASE_PATH);

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    allowedHosts: resolveAllowedHosts(process.env.VITE_ALLOWED_HOSTS),
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
