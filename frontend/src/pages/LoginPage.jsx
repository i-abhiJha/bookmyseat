import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container narrow">
      <div className="card">
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <form onSubmit={submit} className="form">
          {mode === 'register' && (
            <input placeholder="Name" value={form.name} onChange={set('name')} required minLength={2} />
          )}
          <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
          <input
            type="password"
            placeholder="Password (min 8 chars)"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
          />
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
        <p className="muted">
          {mode === 'login' ? "No account?" : 'Already have one?'}{' '}
          <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Register' : 'Login'}
          </button>
        </p>
        <p className="hint">Demo: user@bookmyseat.dev / supersecret1</p>
      </div>
    </div>
  );
}
