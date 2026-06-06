import React, { useState } from 'react';
import { useThemeContext } from '../context/ThemeContext.jsx';
import { Layers, Plus, Edit2, Trash2, X, Check, Cpu, CheckSquare, Square, Shield } from 'lucide-react';
import { apiPostJson, apiPut, apiDelete } from '../../api/client';

export function ServicesPanel({ services = [], users = [], plans = [], priceOverrides = [], refresh, showToast }) {
  const { isDark } = useThemeContext();
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [pricingForm, setPricingForm] = useState({
    scope_type: 'plan',
    scope_id: '',
    service_id: '',
    credit_cost: '',
    note: '',
    is_active: true,
  });

  // Form State
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('light');
  const [queueType, setQueueType] = useState('api');
  const [creditCost, setCreditCost] = useState(0);
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  // Styling tokens matching existing dashboards
  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  const btnPrimary = {
    padding: '0.45rem 1rem', borderRadius: '0.5rem',
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    color: '#fff', border: 'none', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem',
    transition: 'opacity 0.2s',
  };

  const btnDanger = {
    padding: '0.3rem 0.6rem', borderRadius: '0.3rem',
    background: 'rgba(239,68,68,0.1)', color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer',
    fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem'
  };

  const btnEdit = {
    padding: '0.3rem 0.6rem', borderRadius: '0.3rem',
    background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
    border: '1px solid rgba(59,130,246,0.2)', cursor: 'pointer',
    fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem'
  };

  const inputStyle = {
    width: '100%', padding: '0.6rem', borderRadius: '0.5rem',
    background: isDark ? 'rgba(0,0,0,0.2)' : '#fff',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#d1d5db'}`,
    color: isDark ? '#fff' : '#000', outline: 'none', fontSize: '0.85rem'
  };

  const selectStyle = {
    ...inputStyle,
    cursor: 'pointer',
    padding: '0.6rem 0.5rem'
  };

  // Metrics
  const lightCount = services.filter(s => s.category === 'light').length;
  const mediumCount = services.filter(s => s.category === 'medium').length;
  const heavyCount = services.filter(s => s.category === 'heavy').length;
  const inactiveCount = services.filter(s => !s.is_active).length;
  const heavyServices = services.filter(s => s.category === 'heavy');

  function openCreate() {
    setEditingService(null);
    setId('');
    setDisplayName('');
    setDescription('');
    setCategory('light');
    setQueueType('api');
    setCreditCost(0);
    setSortOrder((services.length + 1) * 10);
    setIsActive(true);
    setShowModal(true);
  }

  function openEdit(srv) {
    setEditingService(srv);
    setId(srv.id);
    setDisplayName(srv.display_name);
    setDescription(srv.description || '');
    setCategory(srv.category || 'light');
    setQueueType(srv.queue_type || 'api');
    setCreditCost(srv.credit_cost || 0);
    setSortOrder(srv.sort_order || 0);
    setIsActive(srv.is_active === 1);
    setShowModal(true);
  }

  async function handleSave() {
    if (!id || !displayName) return showToast('Service ID and Display Name are required', 'error');
    if (!/^[a-z0-9_]+$/.test(id)) return showToast('Service ID must be lowercase letters, numbers, and underscores only', 'error');

    const payload = {
      id,
      display_name: displayName,
      description,
      category,
      queue_type: queueType,
      credit_cost: Number(creditCost),
      sort_order: Number(sortOrder),
      is_active: isActive ? 1 : 0
    };

    try {
      if (editingService) {
        await apiPut(`/admin/api/services/${id}`, payload);
        showToast('Service updated successfully', 'success');
      } else {
        await apiPostJson('/admin/api/services', payload);
        showToast('Service created successfully', 'success');
      }
      setShowModal(false);
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(srvId) {
    if (!confirm(`Are you sure you want to delete service '${srvId}'?`)) return;
    try {
      await apiDelete(`/admin/api/services/${srvId}`);
      showToast('Service deleted successfully', 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleStatus(srv) {
    try {
      const nextActive = srv.is_active === 1 ? 0 : 1;
      await apiPut(`/admin/api/services/${srv.id}`, { is_active: nextActive });
      showToast(`Service '${srv.display_name}' ${nextActive ? 'enabled' : 'disabled'}`, 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleSavePricingOverride() {
    if (!pricingForm.scope_id || !pricingForm.service_id) {
      return showToast('Select a target and service for custom pricing', 'error');
    }
    const cost = Number(pricingForm.credit_cost);
    if (!Number.isFinite(cost) || cost < 0) return showToast('Custom price must be 0 or higher', 'error');

    try {
      await apiPostJson('/admin/api/pricing-overrides', {
        ...pricingForm,
        credit_cost: cost,
      });
      showToast('Custom price saved', 'success');
      setPricingForm((prev) => ({ ...prev, credit_cost: '', note: '' }));
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDeletePricingOverride(id) {
    if (!confirm('Delete this custom price?')) return;
    try {
      await apiDelete(`/admin/api/pricing-overrides/${id}`);
      showToast('Custom price deleted', 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function describePricingTarget(row) {
    if (row.scope_type === 'plan') return row.plan_name ? `${row.plan_name} (${row.scope_id})` : row.scope_id;
    return row.user_name || row.user_phone || row.scope_id;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Layers size={22} color="#6366f1" /> Service Registry
        </h2>
        <button style={btnPrimary} onClick={openCreate}>
          <Plus size={16} /> Add Service
        </button>
      </div>

      {/* Metrics Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        
        {/* Light */}
        <div style={{
          background: isDark ? 'rgba(16,185,129,0.03)' : '#f0fdf4',
          border: `1px solid ${isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.2)'}`,
          borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem'
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#10b981', textTransform: 'uppercase' }}>Light Services</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{lightCount}</span>
          <span style={{ fontSize: '0.7rem', color: thText }}>Quota-based, lightweight fetches</span>
        </div>

        {/* Medium */}
        <div style={{
          background: isDark ? 'rgba(245,158,11,0.03)' : '#fffbeb',
          border: `1px solid ${isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.2)'}`,
          borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem'
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f59e0b', textTransform: 'uppercase' }}>Medium Services</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{mediumCount}</span>
          <span style={{ fontSize: '0.7rem', color: thText }}>Quota-based, browser workflows</span>
        </div>

        {/* Heavy */}
        <div style={{
          background: isDark ? 'rgba(239,68,68,0.03)' : '#fef2f2',
          border: `1px solid ${isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.2)'}`,
          borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem'
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', textTransform: 'uppercase' }}>Heavy Services</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{heavyCount}</span>
          <span style={{ fontSize: '0.7rem', color: thText }}>Credit-deducted, professional writes</span>
        </div>

        {/* System Health */}
        <div style={{
          background: isDark ? 'rgba(255,255,255,0.02)' : '#f9fafb',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
          borderRadius: '0.75rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem'
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: thText, textTransform: 'uppercase' }}>Offline / Disabled</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: inactiveCount > 0 ? '#ef4444' : tdText }}>{inactiveCount}</span>
          <span style={{ fontSize: '0.7rem', color: thText }}>Commands blocked globally</span>
        </div>

      </div>

      {/* Custom Pricing Overrides */}
      <div style={{
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.85)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
        borderRadius: '1rem', overflow: 'hidden',
        boxShadow: isDark ? 'none' : '0 1px 8px rgba(0,0,0,0.06)'
      }}>
        <div style={{ padding: '1rem', borderBottom: `1px solid ${trBorder}`, display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, color: tdText, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Shield size={17} color="#f59e0b" /> Custom Pricing
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: thText, fontSize: '0.75rem' }}>
              Priority: user price → plan price → global service price.
            </p>
          </div>
        </div>

        <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '0.8fr 1.4fr 1.4fr 0.8fr 1.2fr auto', gap: '0.65rem', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: thText, marginBottom: '0.25rem' }}>Scope</label>
            <select
              style={selectStyle}
              value={pricingForm.scope_type}
              onChange={e => setPricingForm(f => ({ ...f, scope_type: e.target.value, scope_id: '' }))}
            >
              <option value="plan">Plan</option>
              <option value="user">User</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: thText, marginBottom: '0.25rem' }}>Target</label>
            <select
              style={selectStyle}
              value={pricingForm.scope_id}
              onChange={e => setPricingForm(f => ({ ...f, scope_id: e.target.value }))}
            >
              <option value="">Select...</option>
              {pricingForm.scope_type === 'plan'
                ? plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)
                : users.map(u => <option key={u.id} value={u.id}>{u.name || u.canonical_phone} ({u.canonical_phone})</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: thText, marginBottom: '0.25rem' }}>Heavy Service</label>
            <select
              style={selectStyle}
              value={pricingForm.service_id}
              onChange={e => setPricingForm(f => ({ ...f, service_id: e.target.value }))}
            >
              <option value="">Select service...</option>
              {heavyServices.map(s => <option key={s.id} value={s.id}>{s.display_name || s.name} ({s.id})</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: thText, marginBottom: '0.25rem' }}>Price</label>
            <input
              type="number"
              min="0"
              style={inputStyle}
              value={pricingForm.credit_cost}
              onChange={e => setPricingForm(f => ({ ...f, credit_cost: e.target.value }))}
              placeholder="50"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', color: thText, marginBottom: '0.25rem' }}>Note</label>
            <input
              style={inputStyle}
              value={pricingForm.note}
              onChange={e => setPricingForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <button style={btnPrimary} onClick={handleSavePricingOverride}>
            <Plus size={15} /> Save
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderTop: `1px solid ${trBorder}`, borderBottom: `1px solid ${trBorder}`, background: isDark ? 'rgba(0,0,0,0.18)' : '#f9fafb' }}>
                {['Scope', 'Target', 'Service', 'Custom Price', 'Status', 'Note', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '0.75rem 1rem', color: thText, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {priceOverrides.length === 0 && (
                <tr><td colSpan="7" style={{ padding: '1rem', textAlign: 'center', color: thText }}>No custom pricing yet. Global service price is used.</td></tr>
              )}
              {priceOverrides.map(row => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${trBorder}` }}>
                  <td style={{ padding: '0.75rem 1rem', color: tdText, textTransform: 'capitalize', fontSize: '0.8rem' }}>{row.scope_type}</td>
                  <td style={{ padding: '0.75rem 1rem', color: tdText, fontSize: '0.8rem' }}>{describePricingTarget(row)}</td>
                  <td style={{ padding: '0.75rem 1rem', color: tdText, fontSize: '0.8rem' }}>{row.service_name || row.service_id}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#f59e0b', fontWeight: 700, fontSize: '0.85rem' }}>{row.credit_cost} credits</td>
                  <td style={{ padding: '0.75rem 1rem', color: row.is_active ? '#10b981' : '#6b7280', fontSize: '0.8rem' }}>{row.is_active ? 'Active' : 'Inactive'}</td>
                  <td style={{ padding: '0.75rem 1rem', color: thText, fontSize: '0.8rem' }}>{row.note || '—'}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <button style={btnDanger} onClick={() => handleDeletePricingOverride(row.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Services Table */}
      <div style={{
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.85)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
        borderRadius: '1rem', overflow: 'hidden',
        boxShadow: isDark ? 'none' : '0 1px 8px rgba(0,0,0,0.06)'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${trBorder}`, background: isDark ? 'rgba(0,0,0,0.2)' : '#f9fafb' }}>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', width: '60px' }}>Order</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Service ID</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Display Name</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Category</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Queue Type</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Credit Cost</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', color: thText }}>No services registered.</td>
                </tr>
              )}
              {services.map(srv => {
                let catBg = 'rgba(16,185,129,0.1)';
                let catColor = '#10b981';
                if (srv.category === 'medium') {
                  catBg = 'rgba(245,158,11,0.1)';
                  catColor = '#f59e0b';
                } else if (srv.category === 'heavy') {
                  catBg = 'rgba(239,68,68,0.1)';
                  catColor = '#ef4444';
                }

                return (
                  <tr key={srv.id} style={{ borderBottom: `1px solid ${trBorder}`, opacity: srv.is_active ? 1 : 0.6 }}>
                    <td style={{ padding: '1rem', color: thText, fontSize: '0.85rem' }}>{srv.sort_order}</td>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.85rem', fontWeight: 600 }}><code>{srv.id}</code></td>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.85rem' }}>
                      {srv.display_name}
                      {srv.description && (
                        <div style={{ fontSize: '0.75rem', color: thText, marginTop: '0.2rem' }}>{srv.description}</div>
                      )}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 600, background: catBg, color: catColor, textTransform: 'capitalize' }}>
                        {srv.category}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.8rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Cpu size={14} color={srv.queue_type === 'browser' ? '#818cf8' : thText} />
                        {srv.queue_type === 'browser' ? 'Browser Workers' : 'Instant API'}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.85rem', fontWeight: 600 }}>
                      {srv.category === 'heavy' ? (
                        srv.credit_cost > 0 ? `${srv.credit_cost} credits` : 'Use Plan Cost (Heavy)'
                      ) : (
                        <span style={{ color: thText, fontSize: '0.75rem' }}>Quota Managed</span>
                      )}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <button
                        onClick={() => toggleStatus(srv)}
                        style={{
                          padding: '0.25rem 0.6rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 600,
                          border: 'none', cursor: 'pointer',
                          background: srv.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)',
                          color: srv.is_active ? '#10b981' : '#6b7280',
                        }}
                        title={`Click to ${srv.is_active ? 'Disable' : 'Enable'}`}
                      >
                        {srv.is_active ? '🟢 Active' : '🔴 Inactive'}
                      </button>
                    </td>
                    <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button style={btnEdit} onClick={() => openEdit(srv)} title="Edit"><Edit2 size={14} /></button>
                      <button style={btnDanger} onClick={() => handleDelete(srv.id)} title="Delete"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div style={{
            background: isDark ? '#1f2937' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            borderRadius: '1rem', width: '550px', maxWidth: '95%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '1.25rem', borderBottom: `1px solid ${trBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: tdText, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Layers size={18} color="#6366f1" /> {editingService ? 'Edit Service' : 'Add Service'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: thText, cursor: 'pointer' }}><X size={20} /></button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* Service ID */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Service ID (unique, lowercase, no spaces)</label>
                <input
                  style={inputStyle}
                  value={id}
                  onChange={e => setId(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  disabled={!!editingService}
                  placeholder="e.g. tracking_v2"
                />
              </div>

              {/* Display Name */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Display Name</label>
                <input
                  style={inputStyle}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="e.g. DL Dynamic Tracking"
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Description / Tooltip</label>
                <input
                  style={inputStyle}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Query live status from Sarathi portal"
                />
              </div>

              {/* Category & Queue Type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Category Tier</label>
                  <select style={selectStyle} value={category} onChange={e => setCategory(e.target.value)}>
                    <option value="light">Light Tier (Quota-based)</option>
                    <option value="medium">Medium Tier (Quota-based)</option>
                    <option value="heavy">Heavy Tier (Credit-based)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Queue Worker Engine</label>
                  <select style={selectStyle} value={queueType} onChange={e => setQueueType(e.target.value)}>
                    <option value="api">API Queue (Instant fetch)</option>
                    <option value="browser">Browser Queue (Puppeteer slot)</option>
                  </select>
                </div>
              </div>

              {/* Pricing Override & Sort Order */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>
                    Credit Cost Override {category !== 'heavy' && '(Heavy only)'}
                  </label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={creditCost}
                    onChange={e => setCreditCost(e.target.value)}
                    disabled={category !== 'heavy'}
                    placeholder="0 = default (50)"
                  />
                  <div style={{ fontSize: '0.65rem', color: thText, marginTop: '0.2rem' }}>
                    Set to 0 to fallback to category default credit cost.
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Sort Order</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={sortOrder}
                    onChange={e => setSortOrder(e.target.value)}
                    placeholder="10, 20, 30..."
                  />
                </div>
              </div>

              {/* Status checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                    id="srvActive"
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="srvActive" style={{ color: tdText, fontSize: '0.85rem', cursor: 'pointer' }}>
                    Service is globally active and enabled for users
                  </label>
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div style={{ padding: '1.25rem', borderTop: `1px solid ${trBorder}`, display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'transparent', color: thText, border: `1px solid ${trBorder}`, cursor: 'pointer' }}
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button style={btnPrimary} onClick={handleSave}>
                <Check size={16} /> Save Service
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
