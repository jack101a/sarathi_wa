import React, { useState } from 'react';
import { ScrollText, Filter, ReceiptText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchActivity, fetchUserCreditHistory } from '../../api/queries.js';
import { SkeletonTableRow } from './Skeleton.jsx';

function CommandActivityTab({ isDark }) {
  const [filters, setFilters] = useState({ user_id: '', category: '' });
  const [activeFilters, setActiveFilters] = useState({ user_id: '', category: '' });
  
  const { data, isLoading } = useQuery({
    queryKey: ['activity', activeFilters],
    queryFn: () => fetchActivity(activeFilters),
    staleTime: 5000,
  });

  const activity = data?.activity || [];
  const uniqueUsers = new Set(activity.map(a => a.user_id)).size;

  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const inputStyle = { padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem' };
  
  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <input type="text" placeholder="User Phone..." style={inputStyle} value={filters.user_id} onChange={e => setFilters({ ...filters, user_id: e.target.value })} />
        <select style={inputStyle} value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All Categories</option>
          <option value="light">Light</option>
          <option value="medium">Medium</option>
          <option value="heavy">Heavy</option>
        </select>
        <button 
          onClick={() => setActiveFilters(filters)} 
          style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Filter size={14} /> Apply Filter
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', background: isDark ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)', borderRadius: '0.5rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isDark ? '#818cf8' : '#4f46e5' }}>{activity.length} records</span>
        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: isDark ? '#6b7280' : '#9ca3af' }} />
        <span style={{ fontSize: '0.85rem', color: isDark ? '#9ca3af' : '#6b7280' }}>{uniqueUsers} unique users</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              {['Timestamp', 'User ID', 'Command', 'Category'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} cols={4} />)
              : activity.map(act => (
                <tr key={act.id} className="hover-row" style={{ borderBottom: `1px solid ${trBorder}` }}>
                  <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{new Date(act.timestamp).toLocaleString()}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace' }}>{act.user_id}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontWeight: 500 }}>{act.command}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}><span className={`badge badge-${act.category}`}>{act.category}</span></td>
                </tr>
              ))
            }
            {!isLoading && activity.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No activity found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CreditHistoryTab({ users, isDark }) {
  const [selectedPhone, setSelectedPhone] = useState('');
  
  const { data, isLoading } = useQuery({
    queryKey: ['creditHistory', selectedPhone],
    queryFn: () => fetchUserCreditHistory(selectedPhone),
    enabled: !!selectedPhone,
    staleTime: 0,
  });

  const history = data?.history || [];

  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const inputStyle = { padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem' };
  
  function getActionBadge(action) {
    if (action === 'add') return <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>➕ ADD</span>;
    if (action === 'deduct') return <span style={{ background: 'rgba(244,63,94,0.15)', color: '#f43f5e', padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>➖ DED</span>;
    if (action === 'set') return <span style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4', padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>🔵 SET</span>;
    return <span>{action}</span>;
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827', fontWeight: 500 }}>Select User:</span>
        <select style={inputStyle} value={selectedPhone} onChange={e => setSelectedPhone(e.target.value)}>
          <option value="">-- Choose User --</option>
          {users.map(u => (
            <option key={u.canonical_phone} value={u.canonical_phone}>{u.canonical_phone} {u.name ? `(${u.name})` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedPhone ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: thText }}>
          <ReceiptText size={32} style={{ marginBottom: '1rem', opacity: 0.3 }} />
          <p style={{ margin: 0, fontSize: '0.9rem' }}>Select a user to view their credit transaction history.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['Time', 'Action', 'Amount', 'Balance', 'Note', 'By'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
                : history.map(tx => (
                  <tr key={tx.id} className="hover-row" style={{ borderBottom: `1px solid ${trBorder}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{new Date(tx.created_at).toLocaleString()}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{getActionBadge(tx.action)}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tx.action === 'deduct' ? '#f43f5e' : '#10b981', fontWeight: 700, fontFamily: 'monospace' }}>
                      {tx.action === 'deduct' ? '-' : (tx.action === 'add' ? '+' : '')}{tx.amount}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontWeight: 600 }}>{tx.balance_after}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{tx.note || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText, fontSize: '0.7rem' }}>{tx.triggered_by}</td>
                  </tr>
                ))
              }
              {!isLoading && history.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No credit history found for this user</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ActivityPanel({ users, isDark, showToast }) {
  const [activeTab, setActiveTab] = useState('commands');

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };
  const thText = isDark ? '#9ca3af' : '#6b7280';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
          <ScrollText size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: '#6366f1' }} />
          Activity Log
        </h2>
      </div>

      <div style={panelStyle}>
        <div style={{ display: 'flex', gap: '1rem', borderBottom: `1px solid ${trBorder}`, marginBottom: '1.5rem' }}>
          <button
            className={`tab-btn ${activeTab === 'commands' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('commands')}
            style={{ color: activeTab === 'commands' ? '#6366f1' : thText }}
          >
            Command Activity
          </button>
          <button
            className={`tab-btn ${activeTab === 'credits' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('credits')}
            style={{ color: activeTab === 'credits' ? '#6366f1' : thText }}
          >
            Credit Transactions
          </button>
        </div>

        {activeTab === 'commands' && <CommandActivityTab isDark={isDark} />}
        {activeTab === 'credits' && <CreditHistoryTab users={users} isDark={isDark} />}
      </div>
    </div>
  );
}
