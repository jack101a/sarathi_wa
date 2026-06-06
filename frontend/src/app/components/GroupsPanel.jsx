import React, { useState } from 'react';
import { UsersRound, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchGroups } from '../../api/queries.js';
import { apiPostJson, apiDelete } from '../../api/client.js';
import { useThemeContext } from '../context/ThemeContext.jsx';
import { SkeletonTableRow } from './Skeleton.jsx';

export function GroupsPanel({ isDark, showToast }) {
  const [activeTab, setActiveTab] = useState('wa');
  const [showAdd, setShowAdd] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: fetchGroups,
    staleTime: 10_000,
  });

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };

  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem', boxSizing: 'border-box' };
  const btnPrimary = { padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' };

  const groups = activeTab === 'wa' ? (data?.wa || []) : (data?.tg || []);

  async function handleAddGroup(e) {
    e.preventDefault();
    if (!groupId.trim()) return;
    setSubmitting(true);
    try {
      await apiPostJson('/admin/api/groups', { group_id: groupId.trim(), channel: activeTab });
      showToast('Group added successfully', 'success');
      setGroupId('');
      setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteGroup(id) {
    if (!confirm(`Remove group ${id}?`)) return;
    try {
      await apiDelete(`/admin/api/groups/${encodeURIComponent(id)}?channel=${activeTab}`);
      showToast('Group removed', 'success');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
          <UsersRound size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: '#6366f1' }} />
          Groups
        </h2>
        <button onClick={() => setShowAdd(!showAdd)} style={btnPrimary}>
          <Plus size={14} /> Add Group
        </button>
      </div>

      <div style={panelStyle}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', borderBottom: `1px solid ${trBorder}`, marginBottom: '1rem' }}>
          <button
            className={`tab-btn ${activeTab === 'wa' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('wa')}
            style={{ color: activeTab === 'wa' ? '#6366f1' : thText }}
          >
            WhatsApp
          </button>
          <button
            className={`tab-btn ${activeTab === 'tg' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('tg')}
            style={{ color: activeTab === 'tg' ? '#6366f1' : thText }}
          >
            Telegram
          </button>
        </div>

        {/* Add Form */}
        {showAdd && (
          <form onSubmit={handleAddGroup} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', padding: '1rem', background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderRadius: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                placeholder={activeTab === 'wa' ? 'e.g. 1203631234567@g.us' : 'e.g. -1001234567'}
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
                style={inputStyle}
                disabled={submitting}
              />
            </div>
            <button type="submit" style={{ ...btnPrimary, padding: '0 1.25rem', opacity: submitting ? 0.7 : 1 }} disabled={submitting || !groupId.trim()}>
              {submitting ? 'Adding...' : 'Create'}
            </button>
          </form>
        )}

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['#', 'Group ID', 'Created By', 'Created At', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => <SkeletonTableRow key={i} cols={5} />)
                : groups.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: thText }}>
                      <p style={{ margin: '0 0 1rem', fontSize: '0.9rem' }}>No groups found.</p>
                      <button onClick={() => setShowAdd(true)} style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>Create your first group</button>
                    </td>
                  </tr>
                ) : groups.map((g, i) => (
                  <tr key={g.group_id || i} className="hover-row" style={{ borderBottom: `1px solid ${trBorder}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{i + 1}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.8rem' }}>{g.group_id}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{g.created_by || 'admin'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{g.created_at ? new Date(g.created_at).toLocaleString() : '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <button
                        onClick={() => handleDeleteGroup(g.group_id)}
                        style={{ padding: '0.3rem 0.6rem', borderRadius: '0.5rem', background: 'rgba(244,63,94,0.12)', color: '#f43f5e', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}
                        title="Remove Group"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
