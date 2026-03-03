var _a;
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
var proxyTarget = (_a = process.env.VITE_PROXY_TARGET) !== null && _a !== void 0 ? _a : 'http://127.0.0.1:8000';
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
