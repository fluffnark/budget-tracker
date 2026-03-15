import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import './styles/theme.css';
import './styles.css';
import {
  applyThemeMode,
  readThemeMode,
  startSystemThemeWatcher
} from './themeMode';

applyThemeMode(readThemeMode());
startSystemThemeWatcher();

function normalizeBasename(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') return undefined;
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/')
    ? withLeading.slice(0, -1)
    : withLeading;
}

const routerBasename = normalizeBasename(import.meta.env.VITE_ROUTER_BASENAME);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
