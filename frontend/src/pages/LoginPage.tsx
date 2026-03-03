import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../api';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('owner@example.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem('bt_logged_in', '1');
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card" onSubmit={onSubmit}>
        <h2>Local Budget Tracker</h2>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Login</button>
      </form>
    </div>
  );
}
