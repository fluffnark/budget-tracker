import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { WorkspacePage } from './pages/WorkspacePage';

function RequireAuth({ children }: { children: JSX.Element }) {
  if (localStorage.getItem('bt_logged_in') !== '1') {
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
        <Route index element={<WorkspacePage />} />
        <Route path="workspace" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return <AppRoutes />;
}
