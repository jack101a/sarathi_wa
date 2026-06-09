import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Check, Search, Coins, Power, PowerOff, RefreshCw, FileText } from 'lucide-react';
import { apiPostJson, apiPatchJson, apiDelete, apiPut, apiGet } from '../../api/client.js';

function badge(is_active, pending_otp) {
  if (pending_otp) {
    return <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>Pending Activation</span>;
  }
  return Number(is_active) === 1
    ? <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>Active</span>
    : <span style={{ background: 'rgba(244,63,94,0.15)',  color: '#f43f5e', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>Inactive</span>;
}

function planBadge(planId, plans = []) {
  const plan = plans.find(p => p.id === planId);
  const planName = plan ? plan.name : planId;
  const isPremium = planId !== 'free';
  return <span style={{ background: isPremium ? 'rgba(251,191,36,0.15)' : 'rgba(99,102,241,0.12)', color: isPremium ? '#fbbf24' : '#818cf8', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>{planName || 'free'}</span>;
}

function toDateInputValue(value) {
  if (!value) return '';
  const parsed = value instanceof Date ? value.toISOString() : String(value);
  return parsed.slice(0, 10);
}

function parseRateLimitOverrides(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function CreditModal({ phone, isDark, onClose, showToast, onRefresh }) {
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState('add');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem', boxSizing: 'border-box' };
  const labelStyle = { fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280', display: 'block', marginBottom: '0.3rem' };

  async function handleSave() {
    if (amount === '' || isNaN(Number(amount))) return;
    setSaving(true);
    try {
      await apiPostJson(`/admin/api/users/${encodeURIComponent(phone)}/credits`, { action, amount: Number(amount), note });
      showToast('Credits updated', 'success');
      onRefresh();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }} />
      <div className="modal-enter" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 50, width: '90%', maxWidth: '400px', background: isDark ? '#161b22' : '#fff', borderRadius: '1rem', padding: '1.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Coins size={18} color="#a855f7" /> Manage Credits for {phone}
        </h3>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}><input type="radio" checked={action === 'add'} onChange={() => setAction('add')} /> Add</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}><input type="radio" checked={action === 'deduct'} onChange={() => setAction('deduct')} /> Deduct</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}><input type="radio" checked={action === 'set'} onChange={() => setAction('set')} /> Set Exact</label>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="creditAmount" style={labelStyle}>Amount</label>
          <input id="creditAmount" type="number" style={inputStyle} value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 100" />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label htmlFor="creditNote" style={labelStyle}>Note (Optional)</label>
          <input id="creditNote" type="text" style={inputStyle} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for change" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={onClose} style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#9ca3af' : '#6b7280', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || amount === ''} style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, opacity: saving || amount === '' ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Apply'}</button>
        </div>
      </div>
    </>
  );
}

function UserLogsModal({ phone, isDark, onClose, showToast }) {
  const [logs, setLogs] = useState({ credits: [], jobs: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('jobs'); // 'jobs' or 'credits'

  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await apiGet(`/admin/api/users/${encodeURIComponent(phone)}/logs`);
        if (res.ok) {
          setLogs({ credits: res.credits || [], jobs: res.jobs || [] });
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, [phone]);

  const modalStyle = {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    zIndex: 50, width: '90%', maxWidth: '650px', maxHeight: '80vh',
    background: isDark ? '#161b22' : '#fff', borderRadius: '1rem',
    padding: '1.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    boxShadow: '0 25px 50px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column'
  };

  const headerStyle = {
    margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700,
    color: isDark ? '#e6edf3' : '#111827', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between'
  };

  const tabBtnStyle = (tab) => ({
    padding: '0.5rem 1rem', border: 'none', background: 'transparent',
    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
    color: activeTab === tab
      ? '#6366f1'
      : (isDark ? '#9ca3af' : '#6b7280'),
    borderBottom: activeTab === tab ? '2px solid #6366f1' : '2px solid transparent',
    transition: 'all 0.2s ease',
    outline: 'none'
  });

  const listContainerStyle = {
    flex: 1, overflowY: 'auto', marginTop: '1rem',
    maxHeight: '50vh', paddingRight: '0.25rem'
  };

  const logRowStyle = {
    padding: '0.75rem', borderRadius: '0.5rem',
    background: isDark ? 'rgba(255,255,255,0.02)' : '#f9fafb',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
    marginBottom: '0.5rem', fontSize: '0.8rem', display: 'flex',
    flexDirection: 'column', gap: '0.25rem', textAlign: 'left'
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }} />
      <div className="modal-enter" style={modalStyle}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={20} color="#6366f1" />
            <span>Activity Logs: {phone}</span>
          </div>
          <button onClick={onClose} aria-label="Close Logs" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
          <button style={tabBtnStyle('jobs')} onClick={() => setActiveTab('jobs')}>Job History ({logs.jobs.length})</button>
          <button style={tabBtnStyle('credits')} onClick={() => setActiveTab('credits')}>Credit Transactions ({logs.credits.length})</button>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: isDark ? '#9ca3af' : '#6b7280' }}>Loading logs...</div>
        ) : (
          <div style={listContainerStyle}>
            {activeTab === 'jobs' ? (
              logs.jobs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: isDark ? '#9ca3af' : '#6b7280' }}>No jobs run yet.</div>
              ) : (
                logs.jobs.map((job) => (
                  <div key={job.id} style={logRowStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span style={{ color: '#6366f1', fontFamily: 'monospace' }}>{job.command}</span>
                      <span style={{
                        padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.65rem',
                        background: job.status === 'completed'
                          ? 'rgba(16,185,129,0.15)'
                          : (job.status === 'failed' ? 'rgba(244,63,94,0.15)' : 'rgba(245,158,11,0.15)'),
                        color: job.status === 'completed'
                          ? '#10b981'
                          : (job.status === 'failed' ? '#f43f5e' : '#f59e0b')
                      }}>{job.status.toUpperCase()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8, fontSize: '0.7rem' }}>
                      <span>ID: <code style={{ fontFamily: 'monospace' }}>{job.id}</code> ({job.transport})</span>
                      <span>{new Date(job.created_at).toLocaleString()}</span>
                    </div>
                    {job.error_text && (
                      <div style={{ color: '#f43f5e', background: 'rgba(244,63,94,0.06)', padding: '0.4rem', borderRadius: '4px', marginTop: '0.25rem', fontFamily: 'monospace', fontSize: '0.75rem', border: '1px solid rgba(244,63,94,0.1)' }}>
                        Error: {job.error_text}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : (
              logs.credits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: isDark ? '#9ca3af' : '#6b7280' }}>No credit transactions yet.</div>
              ) : (
                logs.credits.map((tx) => (
                  <div key={tx.id} style={logRowStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span style={{
                        color: tx.action === 'add'
                          ? '#10b981'
                          : (tx.action === 'deduct' ? '#f43f5e' : '#a855f7'),
                        textTransform: 'uppercase'
                      }}>
                        {tx.action === 'add' ? '➕ Added' : (tx.action === 'deduct' ? '➖ Deducted' : '⚙️ Set Exact')}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {tx.action === 'add' ? `+${tx.amount}` : (tx.action === 'deduct' ? `-${tx.amount}` : `${tx.amount}`)} credits
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8, fontSize: '0.7rem' }}>
                      <span>Balance: {tx.balance_before} ➔ {tx.balance_after} credits (By {tx.triggered_by || 'system'})</span>
                      <span>{new Date(tx.created_at).toLocaleString()}</span>
                    </div>
                    {tx.note && (
                      <div style={{ fontStyle: 'italic', marginTop: '0.2rem', opacity: 0.8 }}>
                        Note: "{tx.note}"
                      </div>
                    )}
                  </div>
                ))
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}

// User Drawer Component for Add/Edit
function UserDrawer({ user, plans, isDark, sarathiTracked = [], vahanTracked = [], userOverrides = [], services = [], onClose, showToast, onRefresh }) {
  const isEditing = !!user;
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    phone: user?.canonical_phone || '',
    name: user?.name || '',
    channel: user?.channel || 'wa',
    plan: user?.subscription_plan || (plans.length > 0 ? plans[0].id : 'free'),
    expiry_date: toDateInputValue(user?.expiry_date)
  });

  // Overrides state
  let initialOverrides = { light: { perDay: '', perMonth: '' }, medium: { perDay: '', perMonth: '' } };
  if (isEditing && user.rate_limit_overrides) {
    const parsed = parseRateLimitOverrides(user.rate_limit_overrides);
    if (parsed.light) { initialOverrides.light.perDay = parsed.light.perDay ?? ''; initialOverrides.light.perMonth = parsed.light.perMonth ?? ''; }
    if (parsed.medium) { initialOverrides.medium.perDay = parsed.medium.perDay ?? ''; initialOverrides.medium.perMonth = parsed.medium.perMonth ?? ''; }
  }
  const [overrides, setOverrides] = useState(initialOverrides);
  const [pricingForm, setPricingForm] = useState({ service_id: '', credit_cost: '' });
  const [pricingSaving, setPricingSaving] = useState(false);

  // Tracked apps for this user
  const userSarathi = isEditing ? sarathiTracked.filter(t => t.chatId === user.canonical_phone) : [];
  const userVahan = isEditing ? vahanTracked.filter(t => t.chatId === user.canonical_phone) : [];

  const inputStyle = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.02)' : '#f9fafb', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem', boxSizing: 'border-box' };
  const labelStyle = { fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280', display: 'block', marginBottom: '0.4rem', fontWeight: 500 };

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEditing) {
        await apiPatchJson(`/admin/api/users/${encodeURIComponent(form.phone)}`, {
          name: form.name,
          subscription_plan: form.plan,
          expiry_date: form.expiry_date
        });

        // Save overrides if they have any value
        const overridePayload = { light: {}, medium: {} };
        let hasOverrides = false;
        if (overrides.light.perDay !== '') { overridePayload.light.perDay = Number(overrides.light.perDay); hasOverrides = true; }
        if (overrides.light.perMonth !== '') { overridePayload.light.perMonth = Number(overrides.light.perMonth); hasOverrides = true; }
        if (overrides.medium.perDay !== '') { overridePayload.medium.perDay = Number(overrides.medium.perDay); hasOverrides = true; }
        if (overrides.medium.perMonth !== '') { overridePayload.medium.perMonth = Number(overrides.medium.perMonth); hasOverrides = true; }

        if (hasOverrides) {
          await apiPatchJson(`/admin/api/users/${encodeURIComponent(form.phone)}/rate-overrides`, overridePayload);
        } else {
          await apiPatchJson(`/admin/api/users/${encodeURIComponent(form.phone)}/rate-overrides`, {}); // clear overrides
        }

        showToast('User updated', 'success');
      } else {
        const res = await apiPostJson('/admin/api/users', form);
        const msg = res.code
          ? `User created! Outbound activation code sent: ${res.code}`
          : 'User created successfully';
        showToast(msg, 'success');
      }
      onRefresh();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }} />
      <div className="drawer-right" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '450px', maxWidth: '100%',
        background: isDark ? '#1f2937' : '#ffffff', zIndex: 50,
        borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
        boxShadow: '-10px 0 30px rgba(0,0,0,0.1)',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '1.25rem', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: isDark ? '#e6edf3' : '#111827' }}>
            {isEditing ? 'Edit User' : 'New User'}
          </h3>
          <button onClick={onClose} aria-label="Close Drawer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280' }}><X size={20}/></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          <form id="user-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label htmlFor="userPhone" style={labelStyle}>Phone Number (ID)</label>
              <input id="userPhone" required style={inputStyle} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="919XXXXXXXXX" disabled={isEditing} />
              {isEditing && <div style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', marginTop: '0.3rem' }}>Phone number cannot be changed.</div>}
            </div>

            <div>
              <label htmlFor="userName" style={labelStyle}>Full Name</label>
              <input id="userName" style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Applicant Name" />
            </div>

            {!isEditing && (
              <div>
                <label htmlFor="userChannel" style={labelStyle}>Channel</label>
                <select id="userChannel" style={inputStyle} value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
                  <option value="wa">WhatsApp</option>
                  <option value="tg">Telegram</option>
                </select>
              </div>
            )}

            <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`, margin: '0.5rem 0' }}></div>

            <div>
              <label htmlFor="userPlan" style={labelStyle}>Subscription Plan</label>
              <select id="userPlan" style={inputStyle} value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
              </select>
              <div style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', marginTop: '0.3rem' }}>Plan determines which services are allowed and daily limits.</div>
            </div>

            <div>
              <label htmlFor="userExpiry" style={labelStyle}>Expiry Date (Optional)</label>
              <input id="userExpiry" type="date" style={inputStyle} value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </div>

            {isEditing && (
              <>
                <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`, margin: '0.5rem 0' }}></div>

                <div>
                  <label style={{...labelStyle, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827'}}>Custom Rate Limit Overrides</label>
                  <div style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.8rem' }}>Leave blank to inherit limits from the user's Subscription Plan.</div>

                  <div className="responsive-grid">
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb', padding: '0.8rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827', marginBottom: '0.6rem' }}>Light Commands</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label htmlFor="lightDaily" style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', width: '40px' }}>Daily</label>
                          <input id="lightDaily" type="number" style={{...inputStyle, padding: '0.4rem'}} placeholder="Inherit" value={overrides.light.perDay} onChange={e => setOverrides({...overrides, light: {...overrides.light, perDay: e.target.value}})} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label htmlFor="lightMonth" style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', width: '40px' }}>Month</label>
                          <input id="lightMonth" type="number" style={{...inputStyle, padding: '0.4rem'}} placeholder="Inherit" value={overrides.light.perMonth} onChange={e => setOverrides({...overrides, light: {...overrides.light, perMonth: e.target.value}})} />
                        </div>
                      </div>
                    </div>

                    <div style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb', padding: '0.8rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827', marginBottom: '0.6rem' }}>Medium Commands</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label htmlFor="mediumDaily" style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', width: '40px' }}>Daily</label>
                          <input id="mediumDaily" type="number" style={{...inputStyle, padding: '0.4rem'}} placeholder="Inherit" value={overrides.medium.perDay} onChange={e => setOverrides({...overrides, medium: {...overrides.medium, perDay: e.target.value}})} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label htmlFor="mediumMonth" style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', width: '40px' }}>Month</label>
                          <input id="mediumMonth" type="number" style={{...inputStyle, padding: '0.4rem'}} placeholder="Inherit" value={overrides.medium.perMonth} onChange={e => setOverrides({...overrides, medium: {...overrides.medium, perMonth: e.target.value}})} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`, margin: '0.5rem 0' }}></div>

                <div>
                  <label style={{...labelStyle, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827'}}>Custom Service Pricing</label>
                  <div style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.8rem' }}>Set specific credit costs for this user.</div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <select aria-label="Select Heavy Service" style={inputStyle} value={pricingForm.service_id} onChange={e => setPricingForm(f => ({ ...f, service_id: e.target.value }))}>
                      <option value="">Select heavy service...</option>
                      {services.filter(s => s.category === 'heavy').map(s => <option key={s.id} value={s.id}>{s.display_name || s.id}</option>)}
                    </select>
                    <input type="number" aria-label="Credit Cost" style={{...inputStyle, width: '100px'}} placeholder="Cost" value={pricingForm.credit_cost} onChange={e => setPricingForm(f => ({ ...f, credit_cost: e.target.value }))} />
                    <button type="button" disabled={pricingSaving || !pricingForm.service_id || pricingForm.credit_cost === ''} onClick={async () => {
                      setPricingSaving(true);
                      try {
                        await apiPostJson('/admin/api/pricing-overrides', { scope_type: 'user', scope_id: String(user.id), service_id: pricingForm.service_id, credit_cost: Number(pricingForm.credit_cost) });
                        showToast('Custom price added', 'success');
                        setPricingForm({ service_id: '', credit_cost: '' });
                        onRefresh();
                      } catch (err) { showToast(err.message, 'error'); } finally {
                        setPricingSaving(false);
                      }
                    }} style={{ padding: '0.4rem 0.8rem', borderRadius: '0.5rem', background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: (pricingSaving || !pricingForm.service_id || pricingForm.credit_cost === '') ? 0.6 : 1 }}>{pricingSaving ? '...' : 'Add'}</button>
                  </div>

                  {userOverrides.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {userOverrides.map(o => (
                        <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb', borderRadius: '0.4rem', fontSize: '0.75rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                          <span>{o.service_name || o.service_id}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>{o.credit_cost} cr</span>
                            <button type="button" onClick={async () => {
                              try {
                                await apiDelete(`/admin/api/pricing-overrides/${o.id}`);
                                onRefresh();
                              } catch (err) { showToast(err.message, 'error'); }
                            }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} aria-label="Delete Price Override"><Trash2 size={12} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`, margin: '0.5rem 0' }}></div>

                <div>
                  <label style={{...labelStyle, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827'}}>Tracked Applications</label>

                  {userSarathi.length === 0 && userVahan.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280', padding: '1rem', textAlign: 'center', background: isDark ? 'rgba(255,255,255,0.02)' : '#f9fafb', borderRadius: '0.5rem' }}>
                      No applications currently tracked by this user.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {userSarathi.map((t, idx) => (
                        <div key={`s-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0.8rem', background: isDark ? 'rgba(99,102,241,0.05)' : '#e0e7ff', borderRadius: '0.4rem', border: `1px solid ${isDark ? 'rgba(99,102,241,0.1)' : '#c7d2fe'}` }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#3730a3' }}>Sarathi: {t.appNo}</div>
                            <div style={{ fontSize: '0.65rem', color: isDark ? '#9ca3af' : '#4f46e5' }}>DOB: {t.dob}</div>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: isDark ? '#9ca3af' : '#4338ca', textAlign: 'right' }}>
                            {t.tag && <div>Tag: {t.tag}</div>}
                            <div>{t.createdAt.slice(0, 10)}</div>
                          </div>
                        </div>
                      ))}
                      {userVahan.map((t, idx) => (
                        <div key={`v-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0.8rem', background: isDark ? 'rgba(16,185,129,0.05)' : '#d1fae5', borderRadius: '0.4rem', border: `1px solid ${isDark ? 'rgba(16,185,129,0.1)' : '#a7f3d0'}` }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#065f46' }}>Vahan: {t.applicationNumber || t.appNo}</div>
                            <div style={{ fontSize: '0.65rem', color: isDark ? '#9ca3af' : '#059669' }}>State: {t.stateCode}</div>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: isDark ? '#9ca3af' : '#047857', textAlign: 'right' }}>
                            {t.tag && <div>Tag: {t.tag}</div>}
                            <div>{t.createdAt.slice(0, 10)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </form>
        </div>

        <div style={{ padding: '1.25rem', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button onClick={onClose} type="button" style={{ padding: '0.6rem 1rem', borderRadius: '0.5rem', background: 'transparent', border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, color: isDark ? '#e6edf3' : '#111827', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
          <button type="submit" form="user-form" disabled={loading} style={{ padding: '0.6rem 1.25rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: loading ? 0.7 : 1 }}>
            <Check size={16} /> {loading ? 'Saving...' : 'Save User'}
          </button>
        </div>
      </div>
    </>
  );
}

export function UsersPanel({ users, plans = [], sarathiTracked = [], vahanTracked = [], priceOverrides = [], services = [], isDark, onRefresh, showToast }) {
  const [drawerUser, setDrawerUser] = useState(null); // null = closed, {} = new, {phone: ...} = edit
  const [creditModalPhone, setCreditModalPhone] = useState(null);
  const [logsModalPhone, setLogsModalPhone] = useState(null);
  const [search, setSearch] = useState('');
  const [processingIds, setProcessingIds] = useState(new Set());

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };

  const thText  = isDark ? '#9ca3af' : '#6b7280';
  const tdText  = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const inputStyle = { padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem' };

  const btnPrimary = { padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' };
  const btnDanger  = { padding: '0.35rem 0.7rem', borderRadius: '0.5rem', background: 'rgba(244,63,94,0.12)', color: '#f43f5e', border: 'none', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' };
  const btnGhost   = { padding: '0.35rem 0.7rem', borderRadius: '0.5rem', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#9ca3af' : '#6b7280', border: 'none', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' };

  async function handleToggleActive(u) {
    const nextStatus = Number(u.is_active) === 1 ? 0 : 1;
    const actionName = nextStatus === 1 ? 'Activate' : 'Deactivate';
    if (!confirm(`${actionName} user ${u.canonical_phone}?`)) return;
    setProcessingIds(prev => new Set(prev).add(u.canonical_phone));
    try {
      await apiPatchJson(`/admin/api/users/${encodeURIComponent(u.canonical_phone)}`, { is_active: nextStatus });
      showToast(`User ${actionName.toLowerCase()}d`, 'success');
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(u.canonical_phone); return n; });
    }
  }

  async function handleResendActivation(u) {
    if (!confirm(`Resend activation WhatsApp message with a new OTP to ${u.canonical_phone}?`)) return;
    setProcessingIds(prev => new Set(prev).add(u.canonical_phone));
    try {
      const res = await apiPostJson(`/admin/api/users/${encodeURIComponent(u.canonical_phone)}/resend-activation`);
      if (res.ok) {
        showToast(res.warning ? `OTP generated: ${res.code}. ${res.warning}` : `Activation code resent: ${res.code}`, res.warning ? 'warning' : 'success');
        onRefresh();
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(u.canonical_phone); return n; });
    }
  }

  async function handleDeleteUser(u) {
    if (!confirm(`Are you sure you want to permanently delete user ${u.canonical_phone}? This action cannot be undone.`)) return;
    setProcessingIds(prev => new Set(prev).add(u.canonical_phone));
    try {
      await apiDelete(`/admin/api/users/${encodeURIComponent(u.canonical_phone)}`);
      showToast('User deleted successfully', 'success');
      onRefresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setProcessingIds(prev => { const n = new Set(prev); n.delete(u.canonical_phone); return n; });
    }
  }

  const filteredUsers = users.filter(u => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (u.canonical_phone || '').toLowerCase().includes(s) || (u.name || '').toLowerCase().includes(s);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
          Users <span style={{ color: '#6366f1', fontSize: '1rem', marginLeft: '0.2rem' }}>({filteredUsers.length})</span>
        </h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: thText }} />
            <input
              aria-label="Search users"
              type="text" placeholder="Search phone or name..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, paddingLeft: '2.25rem', width: '220px' }}
            />
          </div>
          <button style={btnPrimary} onClick={() => setDrawerUser({})}>
            <Plus size={14} /> Add User
          </button>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: isDark ? 'rgba(0,0,0,0.2)' : '#f9fafb', borderBottom: `1px solid ${trBorder}` }}>
                {['Phone', 'Name', 'Plan', 'Credits', 'Expiry', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '0.8rem 1rem', color: thText, fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No users found.</td></tr>}
              {filteredUsers.map(u => (
                <tr key={u.canonical_phone || u.id} className="hover-row" style={{ borderBottom: `1px solid ${trBorder}` }}>
                  <td style={{ padding: '0.8rem 1rem', color: tdText, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {u.canonical_phone}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.65rem', color: thText, textTransform: 'uppercase' }}>{u.channel}</span>
                      {u.pending_otp && (
                        <span
                          title="Click to copy pending activation OTP"
                          onClick={() => {
                            navigator.clipboard.writeText(u.pending_otp);
                            showToast(`OTP ${u.pending_otp} copied to clipboard!`, 'info');
                          }}
                          style={{ background: isDark ? 'rgba(245,158,11,0.1)' : '#fef3c7', color: '#d97706', padding: '0.05rem 0.3rem', borderRadius: '4px', fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'monospace', border: '1px solid rgba(245,158,11,0.2)' }}
                        >
                          OTP: {u.pending_otp}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '0.8rem 1rem', color: tdText, fontWeight: 500 }}>{u.name || '—'}</td>
                  <td style={{ padding: '0.8rem 1rem' }}>{planBadge(u.subscription_plan, plans)}</td>
                  <td style={{ padding: '0.8rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }} onClick={() => setCreditModalPhone(u.canonical_phone)} title="Manage Credits">
                      <span style={{ color: '#a855f7', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.9rem' }}>{u.credits || 0}</span>
                      <span style={{ fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', opacity: 0.8 }} title="Total credits spent">({u.credits_spent || 0} spent)</span>
                      <Plus size={12} color="#a855f7" />
                    </div>
                  </td>
                  <td style={{ padding: '0.8rem 1rem', color: thText, whiteSpace: 'nowrap' }}>{toDateInputValue(u.expiry_date) || 'Lifetime'}</td>
                  <td style={{ padding: '0.8rem 1rem' }}>{badge(u.is_active, u.pending_otp)}</td>
                  <td style={{ padding: '0.8rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button style={btnGhost} onClick={() => setDrawerUser(u)} aria-label="Edit User" title="Edit"><Pencil size={14} /></button>
                      <button style={btnGhost} onClick={() => setLogsModalPhone(u.canonical_phone)} aria-label="View Logs" title="View Logs"><FileText size={14} /></button>
                      <button disabled={processingIds.has(u.canonical_phone)} style={{...(Number(u.is_active) === 1 ? btnDanger : btnGhost), opacity: processingIds.has(u.canonical_phone) ? 0.5 : 1}} onClick={() => handleToggleActive(u)} aria-label={Number(u.is_active) === 1 ? "Deactivate" : "Activate"} title={Number(u.is_active) === 1 ? "Deactivate" : "Activate"}>
                        {Number(u.is_active) === 1 ? <PowerOff size={14} /> : <Power size={14} />}
                      </button>
                      {u.pending_otp && (
                        <button disabled={processingIds.has(u.canonical_phone)} style={{...btnGhost, opacity: processingIds.has(u.canonical_phone) ? 0.5 : 1}} onClick={() => handleResendActivation(u)} aria-label="Resend Activation Code" title="Resend Activation Code">
                          <RefreshCw size={14} color="#f59e0b" />
                        </button>
                      )}
                      <button disabled={processingIds.has(u.canonical_phone)} style={{...btnDanger, opacity: processingIds.has(u.canonical_phone) ? 0.5 : 1}} onClick={() => handleDeleteUser(u)} aria-label="Delete User" title="Delete User">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drawerUser && (
        <UserDrawer
          user={Object.keys(drawerUser).length > 0 ? drawerUser : null}
          plans={plans}
          sarathiTracked={sarathiTracked}
          vahanTracked={vahanTracked}
          userOverrides={priceOverrides.filter(o => o.scope_type === 'user' && String(o.scope_id) === String(drawerUser?.id))}
          services={services}
          isDark={isDark}
          onClose={() => setDrawerUser(null)}
          showToast={showToast}
          onRefresh={onRefresh}
        />
      )}

      {creditModalPhone && (
        <CreditModal
          phone={creditModalPhone}
          isDark={isDark}
          onClose={() => setCreditModalPhone(null)}
          showToast={showToast}
          onRefresh={onRefresh}
        />
      )}

      {logsModalPhone && (
        <UserLogsModal
          phone={logsModalPhone}
          isDark={isDark}
          onClose={() => setLogsModalPhone(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
