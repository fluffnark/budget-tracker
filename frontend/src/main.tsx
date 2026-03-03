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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
