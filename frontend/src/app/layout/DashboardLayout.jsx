import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { Sidebar } from '../components/Sidebar.jsx';
import { useThemeContext } from '../context/ThemeContext.jsx';

export function DashboardLayout({ children, handleLogout, loading, toast }) {
  const { isDark, t_textMuted } = useThemeContext();

  const bgStyle = isDark
    ? { background: 'radial-gradient(circle at top left, #1a2333 0%, #0d1117 45%, #070a0f 100%)', minHeight: '100vh' }
    : { background: 'radial-gradient(circle at top left, #eef2ff 0%, #f8fafc 45%, #f1f5f9 100%)', minHeight: '100vh' };

  return (
    <div className="min-h-screen font-sans relative overflow-x-hidden transition-colors duration-500" style={bgStyle}>
      {/* Animated background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="animate-blob" style={{
          position: 'absolute', top: '-10%', left: '-10%',
          width: '50vw', height: '50vw', borderRadius: '50%',
          filter: 'blur(100px)', opacity: 0.5,
          background: isDark ? '#1e1b4b' : '#c7d2fe',
          mixBlendMode: isDark ? 'screen' : 'multiply',
        }} />
        <div className="animate-blob animation-delay-2000" style={{
          position: 'absolute', top: '0', right: '-10%',
          width: '40vw', height: '40vw', borderRadius: '50%',
          filter: 'blur(100px)', opacity: 0.5,
          background: isDark ? '#4c1d95' : '#e9d5ff',
          mixBlendMode: isDark ? 'screen' : 'multiply',
        }} />
        <div className="animate-blob animation-delay-4000" style={{
          position: 'absolute', bottom: '-10%', left: '10%',
          width: '60vw', height: '60vw', borderRadius: '50%',
          filter: 'blur(100px)', opacity: 0.5,
          background: isDark ? '#164e63' : '#a5f3fc',
          mixBlendMode: isDark ? 'screen' : 'multiply',
        }} />
      </div>

      <Sidebar handleLogout={handleLogout} />

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1rem', position: 'relative', zIndex: 10 }}>
        {/* Loading indicator */}
        {loading && (
          <div style={{
            position: 'fixed', top: '5rem', right: '1.5rem', zIndex: 40,
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', borderRadius: '0.75rem',
            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)',
            backdropFilter: 'blur(12px)',
          }}>
            <Loader2 size={16} style={{ color: '#818cf8', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280' }}>Syncing data...</span>
          </div>
        )}

        {/* Toast notification */}
        {toast.message && (
          <div role="alert" aria-live="polite" style={{
            position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 50,
            animation: 'slideInBottom 0.3s ease-out, fadeOut 0.3s ease-in 2.7s forwards',
          }}>
            <div style={{
              backdropFilter: 'blur(40px)', borderRadius: '1rem',
              padding: '0.75rem 1.25rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              background: toast.type === 'error' ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)',
              border: `1px solid ${toast.type === 'error' ? 'rgba(244,63,94,0.3)' : 'rgba(16,185,129,0.3)'}`,
              color: toast.type === 'error' ? '#f43f5e' : '#10b981',
            }}>
              {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
              <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{toast.message}</span>
            </div>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
