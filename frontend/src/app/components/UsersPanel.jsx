import React, { useState } from 'react';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { apiPostJson, apiPatchJson, apiDelete } from '../../api/client.js';

const PLANS = ['free', 'premium'];
const CHANNELS = ['wa', 'tg'];

function badge(is_active) {
  return is_active
    ? <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>Active</span>
    : <span style={{ background: 'rgba(244,63,94,0.15)',  color: '#f43f5e', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>Inactive</span>;
}

function planBadge(plan) {
  const isPremium = String(plan).toLowerCase() === 'premium';
  return <span style={{ background: isPremium ? 'rgba(251,191,36,0.15)' : 'rgba(99,102,241,0.12)', color: isPremium ? '#fbbf24' : '#818cf8', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>{plan || 'free'}</span>;
}

export function UsersPanel({ users, isDark, onRefresh, showToast }) {
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState(null); // phone string
  const [form, setForm]         = useState({ phone: '', channel: 'wa', name: '', plan: 'free', monthly_limit: 50, expiry_date: '' });
  const [editForm, setEditForm] = useState({});
  const [loading, setLoading]   = useState(false);

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };
  const thText  = isDark ? '#9ca3af' : '#6b7280';
  const tdText  = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.875rem', boxSizing: 'border-box' };
  const btnPrimary = { padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' };
  const btnDanger  = { padding: '0.35rem 0.7rem', borderRadius: '0.5rem', background: 'rgba(244,63,94,0.12)', color: '#f43f5e', border: 'none', cursor: 'pointer', fontSize: '0.75rem' };
  const btnGhost   = { padding: '0.35rem 0.7rem', borderRadius: '0.5rem', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#9ca3af' : '#6b7280', border: 'none', cursor: 'pointer', fontSize: '0.75rem' };

  async function handleAdd(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiPostJson('/admin/api/users', form);
      showToast('User created', 'success');
      setShowAdd(false);
      setForm({ phone: '', channel: 'wa', name: '', plan: 'free', monthly_limit: 50, expiry_date: '' });
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  }

  async function handleSaveEdit(phone) {
    setLoading(true);
    try {
      await apiPatchJson(`/admin/api/users/${encodeURIComponent(phone)}`, editForm);
      showToast('User updated', 'success');
      setEditing(null);
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  }

  async function handleDeactivate(phone) {
    if (!confirm(`Deactivate user ${phone}?`)) return;
    try {
      await apiDelete(`/admin/api/users/${encodeURIComponent(phone)}`);
      showToast('User deactivated', 'success');
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
          Users <span style={{ color: '#6366f1' }}>({users.length})</span>
        </h2>
        <button style={btnPrimary} onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add User
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <div style={{ ...panelStyle, background: isDark ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h4 style={{ margin: 0, color: isDark ? '#e6edf3' : '#111827' }}>New User</h4>
            <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f43f5e' }}><X size={18} /></button>
          </div>
          <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
            <div><label style={{ fontSize: '0.75rem', color: thText, display: 'block', marginBottom: '0.3rem' }}>Phone / ID *</label><input required style={inputStyle} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="919XXXXXXXXX" /></div>
            <div><label style={{ fontSize: '0.75rem', color: thText, display: 'block', marginBottom: '0.3rem' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Applicant Name" /></div>
            <div><label style={{ fontSize: '0.75rem', color: thText, display: 'block', marginBottom: '0.3rem' }}>Channel</label>
              <select style={inputStyle} value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
                <option value="wa">WhatsApp</option><option value="tg">Telegram</option>
              </select>
            </div>
            <div><label style={{ fontSize: '0.75rem', color: thText, display: 'block', marginBottom: '0.3rem' }}>Plan</label>
              <select style={inputStyle} value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: '0.75rem', color: thText, display: 'block', marginBottom: '0.3rem' }}>Monthly Limit</label><input type="number" style={inputStyle} value={form.monthly_limit} onChange={e => setForm(f => ({ ...f, monthly_limit: Number(e.target.value) }))} /></div>
            <div><label style={{ fontSize: '0.75rem', color: thText, display: 'block', marginBottom: '0.3rem' }}>Expiry Date</label><input type="date" style={inputStyle} value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>
                <Check size={14} /> {loading ? 'Saving…' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div style={panelStyle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['Phone', 'Name', 'Channel', 'Plan', 'Monthly Limit', 'Expiry', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No users found</td></tr>}
              {users.map(u => (
                <tr key={u.canonical_phone || u.id} style={{ borderBottom: `1px solid ${trBorder}` }}>
                  {editing === u.canonical_phone ? (
                    <>
                      <td style={{ padding: '0.5rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.75rem' }}>{u.canonical_phone}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}><input style={{ ...inputStyle, padding: '0.3rem 0.5rem' }} value={editForm.name ?? ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></td>
                      <td style={{ padding: '0.5rem 0.75rem', color: thText }}>{u.channel === 'tg' ? 'Telegram' : 'WhatsApp'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        <select style={{ ...inputStyle, padding: '0.3rem 0.5rem' }} value={editForm.subscription_plan ?? 'free'} onChange={e => setEditForm(f => ({ ...f, subscription_plan: e.target.value }))}>
                          {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem' }}><input type="number" style={{ ...inputStyle, padding: '0.3rem 0.5rem', width: '80px' }} value={editForm.monthly_limit ?? 50} onChange={e => setEditForm(f => ({ ...f, monthly_limit: Number(e.target.value) }))} /></td>
                      <td style={{ padding: '0.4rem 0.5rem' }}><input type="date" style={{ ...inputStyle, padding: '0.3rem 0.5rem' }} value={editForm.expiry_date ?? ''} onChange={e => setEditForm(f => ({ ...f, expiry_date: e.target.value }))} /></td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{badge(u.is_active)}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button style={btnPrimary} onClick={() => handleSaveEdit(u.canonical_phone)} disabled={loading}><Check size={13} /></button>
                          <button style={btnGhost} onClick={() => setEditing(null)}><X size={13} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.75rem' }}>{u.canonical_phone}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontWeight: 500 }}>{u.name || '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{u.channel === 'tg' ? 'Telegram' : 'WhatsApp'}</td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>{planBadge(u.subscription_plan)}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: tdText }}>{u.monthly_limit ?? '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: thText, whiteSpace: 'nowrap' }}>{u.expiry_date || '∞'}</td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>{badge(u.is_active)}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button style={btnGhost} onClick={() => { setEditing(u.canonical_phone); setEditForm({ name: u.name || '', subscription_plan: u.subscription_plan || 'free', monthly_limit: u.monthly_limit || 50, expiry_date: u.expiry_date || '' }); }} title="Edit"><Pencil size={13} /></button>
                          {Number(u.is_active) === 1 && <button style={btnDanger} onClick={() => handleDeactivate(u.canonical_phone)} title="Deactivate"><Trash2 size={13} /></button>}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
