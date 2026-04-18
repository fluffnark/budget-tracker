import http from 'node:http';

import { createServer as createViteServer } from 'vite';

function normalizeViteBase(raw) {
  const value = (raw ?? '/').trim();
  if (!value || value === '/') return '/';
  const withLeading = value.charAt(0) === '/' ? value : `/${value}`;
  return withLeading.charAt(withLeading.length - 1) === '/'
    ? withLeading
    : `${withLeading}/`;
}

const host = process.env.FRONTEND_BIND_IP || '0.0.0.0';
const port = Number(process.env.FRONTEND_PORT || '5173');
const basePath = normalizeViteBase(process.env.VITE_BASE_PATH);
const trimmedBase =
  basePath.charAt(basePath.length - 1) === '/' ? basePath.slice(0, -1) : basePath;

const httpServer = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end('Missing request URL');
    return;
  }

  const parts = req.url.split('?', 2);
  const pathname = parts[0];
  const search = parts[1] ?? '';

  if (basePath !== '/' && pathname === trimmedBase) {
    res.statusCode = 301;
    res.setHeader('Location', `${basePath}${search ? `?${search}` : ''}`);
    res.end();
    return;
  }

  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end('Not Found');
  });
});

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: {
      server: httpServer
    },
    host,
    port
  }
});

httpServer.listen(port, host, () => {
  const visibleHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`  Local:   http://${visibleHost}:${port}${basePath}`);
});
