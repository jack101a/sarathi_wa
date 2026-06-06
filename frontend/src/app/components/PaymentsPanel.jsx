import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CreditCard, TrendingUp, Users, AlertCircle } from 'lucide-react';
import { apiGet } from '../../api/client.js';

export function PaymentsPanel({ isDark }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['credits-stats'],
    queryFn: () => apiGet('/admin/api/stats/credits'),
    refetchInterval: 30000, // Refresh every 30s
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <div style={{
          width: '2rem', height: '2rem', borderRadius: '50%',
          border: `2px solid ${isDark ? '#818cf8' : '#6366f1'}`,
          borderTopColor: 'transparent',
          animation: 'spin 1s linear infinite'
        }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#f43f5e' }}>
        <AlertCircle size={32} style={{ margin: '0 auto 1rem' }} />
        <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Failed to load billing data</h3>
        <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>{error.message}</p>
      </div>
    );
  }

  const { totalCredits = 0, totalCreditsSpent = 0, creditsSpentToday = 0, topSpenders = [] } = data || {};

  const cardStyle = {
    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.85)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: '1rem',
    padding: '1.5rem',
    boxShadow: isDark ? 'none' : '0 1px 8px rgba(0,0,0,0.06)'
  };

  const statLabelStyle = { fontSize: '0.85rem', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const statValueStyle = { fontSize: '2rem', fontWeight: 800, color: isDark ? '#e6edf3' : '#111827', margin: 0 };
  const thStyle = { padding: '1rem', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`, color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const tdStyle = { padding: '1rem', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`, color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CreditCard size={20} style={{ color: '#6366f1' }} />
          Billing & Credits
        </h2>
      </div>

      <div className="responsive-grid">
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={statLabelStyle}>Total Credits Circulating</div>
            <div style={{ padding: '0.5rem', borderRadius: '0.5rem', background: 'rgba(99,102,241,0.1)' }}><CreditCard size={18} color="#6366f1" /></div>
          </div>
          <p style={statValueStyle}>{totalCredits.toLocaleString()}</p>
        </div>
        
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={statLabelStyle}>All-Time Credits Spent</div>
            <div style={{ padding: '0.5rem', borderRadius: '0.5rem', background: 'rgba(245,158,11,0.1)' }}><TrendingUp size={18} color="#f59e0b" /></div>
          </div>
          <p style={statValueStyle}>{totalCreditsSpent.toLocaleString()}</p>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={statLabelStyle}>Credits Spent Today</div>
            <div style={{ padding: '0.5rem', borderRadius: '0.5rem', background: 'rgba(16,185,129,0.1)' }}><Activity size={18} color="#10b981" /></div>
          </div>
          <p style={statValueStyle}>{creditsSpentToday.toLocaleString()}</p>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Users size={18} color="#8b5cf6" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>Top Users by Usage</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Current Balance</th>
                <th style={thStyle}>Total Spent</th>
              </tr>
            </thead>
            <tbody>
              {topSpenders.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.9rem' }}>
                    No billing activity recorded yet.
                  </td>
                </tr>
              ) : (
                topSpenders.map(u => (
                  <tr key={u.phone} style={{ transition: 'background 0.2s', ':hover': { background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' } }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{u.name || 'Unknown'}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: isDark ? '#9ca3af' : '#6b7280' }}>{u.phone}</td>
                    <td style={{ ...tdStyle, color: '#10b981', fontWeight: 600 }}>{Number(u.credits || 0).toLocaleString()}</td>
                    <td style={{ ...tdStyle }}>{Number(u.credits_spent || 0).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
