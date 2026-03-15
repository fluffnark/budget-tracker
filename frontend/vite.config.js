var _a;
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
var proxyTarget = (_a = process.env.VITE_PROXY_TARGET) !== null && _a !== void 0 ? _a : 'http://127.0.0.1:8000';
function normalizeViteBase(raw) {
    var value = (raw !== null && raw !== void 0 ? raw : '/').trim();
    if (!value || value === '/')
        return '/';
    var withLeading = value.charAt(0) === '/' ? value : "/".concat(value);
    return withLeading.charAt(withLeading.length - 1) === '/'
        ? withLeading
        : "".concat(withLeading, "/");
}
var basePath = normalizeViteBase(process.env.VITE_BASE_PATH);
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
                rewrite: function (path) { return path.replace(/^\/budget/, ''); }
            }
        }
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.ts'
    }
});
