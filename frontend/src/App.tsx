import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { apiMaybe } from './api';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { WorkspacePage } from './pages/WorkspacePage';
import type { AuthStatus } from './types';

function RequireAuth({ children }: { children: JSX.Element }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiMaybe<AuthStatus>('/api/auth/status')
      .then((next) => setStatus(next))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="auth-splash">Checking session…</div>;
  }

  if (!status?.is_authenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path=":sectionId" element={<WorkspacePage />} />
        <Route path="workspace" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function App() {
  return <AppRoutes />;
}
