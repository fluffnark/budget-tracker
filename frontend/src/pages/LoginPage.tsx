import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { apiFetch } from '../api';
import type { AuthStatus } from '../types';

export function LoginPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<AuthStatus>('/api/auth/status')
      .then((next) => {
        setStatus(next);
        setEmail(next.owner_email ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load auth status'))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (!status?.is_setup) {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        await apiFetch('/api/auth/setup', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
      } else {
        await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="auth-splash">Loading…</div>;
  }

  if (status?.is_authenticated) {
    return <Navigate to="/" replace />;
  }

  const isSetup = Boolean(status?.is_setup);

  return (
    <div className="login-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <p className="auth-eyebrow">{isSetup ? 'Sign In' : 'First-Time Setup'}</p>
        <h2>{isSetup ? 'Local Budget Tracker' : 'Set Up Your Budget Tracker'}</h2>
        <p className="category-editor-note">
          {isSetup
            ? 'Single-user local app. Sign in with the owner account on this machine.'
            : 'Create the single owner account for this local installation. Passwords are stored with secure Argon2 hashes.'}
        </p>
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
          />
        </label>
        {!isSetup && (
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}
        {!isSetup && (
          <div className="auth-note">
            <strong>After setup:</strong> open `Settings`, paste your SimpleFIN setup token, then run an initial sync.
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting
            ? isSetup
              ? 'Signing in...'
              : 'Creating account...'
            : isSetup
              ? 'Sign in'
              : 'Create owner account'}
        </button>
      </form>
    </div>
  );
}
