import React, { useState } from 'react';
import { Bot, Eye, EyeOff } from 'lucide-react';
import { apiPostJson } from '../../api/client.js';

export function LoginPage({ isDark }) {
  const [form, setForm]       = useState({ username: '', token: '' });
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const bg = isDark
    ? { background: 'radial-gradient(circle at top left, #1a2333 0%, #0d1117 45%, #070a0f 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }
    : { background: 'radial-gradient(circle at top left, #eef2ff 0%, #f8fafc 45%, #f1f5f9 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' };

  const card = {
    width: '100%', maxWidth: '22rem',
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.9)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
    borderRadius: '1.25rem', padding: '2rem',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
  };

  const inputStyle = {
    width: '100%', padding: '0.65rem 0.875rem', borderRadius: '0.625rem',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.14)'}`,
    background: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
    color: isDark ? '#e6edf3' : '#111827', fontSize: '0.9rem', boxSizing: 'border-box',
    outline: 'none',
  };

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiPostJson('/admin/api/login', form);
      window.location.assign('/admin/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={bg}>
      {/* Background blobs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '50vw', height: '50vw', borderRadius: '50%', filter: 'blur(100px)', opacity: 0.4, background: isDark ? '#1e1b4b' : '#c7d2fe', mixBlendMode: isDark ? 'screen' : 'multiply' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '40vw', height: '40vw', borderRadius: '50%', filter: 'blur(100px)', opacity: 0.4, background: isDark ? '#164e63' : '#a5f3fc', mixBlendMode: isDark ? 'screen' : 'multiply' }} />
      </div>

      <div style={{ ...card, position: 'relative', zIndex: 10 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ width: '3rem', height: '3rem', borderRadius: '1rem', background: 'linear-gradient(135deg,#6366f1,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.875rem', boxShadow: '0 8px 24px rgba(99,102,241,0.35)' }}>
            <Bot size={22} color="white" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: isDark ? '#e6edf3' : '#111827' }}>
            sarathi<span style={{ color: '#6366f1' }}>admin</span>
          </h1>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Sign in to the admin dashboard</p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Username</label>
            <input
              id="admin-username"
              autoComplete="username"
              required
              style={inputStyle}
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="admin"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Admin Token</label>
            <div style={{ position: 'relative' }}>
              <input
                id="admin-token"
                type={showToken ? 'text' : 'password'}
                autoComplete="current-password"
                required
                style={{ ...inputStyle, paddingRight: '2.5rem' }}
                value={form.token}
                onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowToken(v => !v)}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280', display: 'flex' }}>
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <p style={{ margin: 0, padding: '0.6rem 0.875rem', borderRadius: '0.5rem', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)', color: '#f43f5e', fontSize: '0.8rem' }}>
              {error}
            </p>
          )}

          <button
            id="admin-login-btn"
            type="submit"
            disabled={loading}
            style={{ marginTop: '0.5rem', padding: '0.7rem', borderRadius: '0.625rem', background: loading ? 'rgba(99,102,241,0.5)' : 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.02em', transition: 'opacity 0.15s' }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
