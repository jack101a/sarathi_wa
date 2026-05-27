import React, { useState } from 'react';
import { useThemeContext } from '../context/ThemeContext';
import { Shield, Plus, Edit2, Trash2, X, Check, CheckSquare, Square } from 'lucide-react';
import { apiPostJson, apiPut, apiDelete } from '../../api/client';

const ALL_SERVICES = [
  'track', 'track_rc', 'track_status', 'add_track', 'remove_track', 'list_track', 
  'form1', 'form1a', 'form2', 'formset', 'alive',
  'llprint_start', 'fee_print_start', 'pay_fee_start', 'slot_booking_start', 'resend_otp',
  'lledit_start', 'dl_renewal_start', 'apply_dl_start'
];

export function PlansPanel({ plans, services: dbServices = [], refresh, showToast }) {
  const { isDark } = useThemeContext();
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  // Form state
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [services, setServices] = useState(['*']);
  const [lightDay, setLightDay] = useState(20);
  const [lightMonth, setLightMonth] = useState(300);
  const [medDay, setMedDay] = useState(5);
  const [medMonth, setMedMonth] = useState(60);
  const [isActive, setIsActive] = useState(true);

  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  const btnPrimary = {
    padding: '0.45rem 1rem', borderRadius: '0.5rem',
    background: 'linear-gradient(135deg, #a855f7, #9333ea)',
    color: '#fff', border: 'none', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem'
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

  function openCreate() {
    setEditingPlan(null);
    setId(''); setName(''); setDescription(''); setServices(['*']);
    setLightDay(20); setLightMonth(300); setMedDay(5); setMedMonth(60);
    setIsActive(true);
    setShowModal(true);
  }

  function openEdit(plan) {
    setEditingPlan(plan);
    setId(plan.id); setName(plan.name); setDescription(plan.description);
    
    try { setServices(JSON.parse(plan.services_json || '["*"]')); } catch(e) { setServices(['*']); }
    
    let lim = { light: {perDay: 20, perMonth: 300}, medium: {perDay: 5, perMonth: 60} };
    try { lim = { ...lim, ...JSON.parse(plan.limits_json || '{}') }; } catch(e) {}
    
    setLightDay(lim.light?.perDay ?? 20); setLightMonth(lim.light?.perMonth ?? 300);
    setMedDay(lim.medium?.perDay ?? 5); setMedMonth(lim.medium?.perMonth ?? 60);
    setIsActive(plan.is_active === 1);
    
    setShowModal(true);
  }

  async function handleSave() {
    if (!id || !name) return showToast('ID and Name are required', 'error');

    const payload = {
      id, name, description,
      services: services.includes('*') ? ['*'] : services,
      limits: {
        light: { perDay: Number(lightDay), perMonth: Number(lightMonth) },
        medium: { perDay: Number(medDay), perMonth: Number(medMonth) }
      },
      is_active: isActive
    };

    try {
      if (editingPlan) {
        await apiPut(`/admin/api/plans/${id}`, payload);
        showToast('Plan updated successfully', 'success');
      } else {
        await apiPostJson('/admin/api/plans', payload);
        showToast('Plan created successfully', 'success');
      }
      setShowModal(false);
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete(planId) {
    if (!confirm(`Are you sure you want to delete plan '${planId}'?`)) return;
    try {
      await apiDelete(`/admin/api/plans/${planId}`);
      showToast('Plan deleted', 'success');
      refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function toggleService(srv) {
    if (srv === '*') {
      if (services.includes('*')) setServices([]);
      else setServices(['*']);
      return;
    }

    let newSrv = services.filter(s => s !== '*'); // if we pick specific, remove *
    if (newSrv.includes(srv)) newSrv = newSrv.filter(s => s !== srv);
    else newSrv.push(srv);
    
    setServices(newSrv);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shield size={22} color="#a855f7" /> Subscription Plans
        </h2>
        <button style={btnPrimary} onClick={openCreate}>
          <Plus size={16} /> Create Plan
        </button>
      </div>

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
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Plan ID</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Name</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Services</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>Limits (Light/Med)</th>
                <th style={{ padding: '1rem', color: thText, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: thText }}>No plans created yet.</td>
                </tr>
              )}
              {plans.map(plan => {
                let srv = [];
                let lim = {};
                try { srv = JSON.parse(plan.services_json || '[]'); } catch(e){}
                try { lim = JSON.parse(plan.limits_json || '{}'); } catch(e){}

                return (
                  <tr key={plan.id} style={{ borderBottom: `1px solid ${trBorder}` }}>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.85rem', fontWeight: 600 }}>{plan.id}</td>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.85rem' }}>
                      {plan.name}
                      <div style={{ fontSize: '0.75rem', color: thText, marginTop: '0.2rem' }}>{plan.description}</div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 600,
                        background: plan.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)',
                        color: plan.is_active ? '#10b981' : '#6b7280'
                      }}>
                        {plan.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', color: tdText, fontSize: '0.8rem' }}>
                      {srv.includes('*') ? 'All Services' : `${srv.length} selected`}
                    </td>
                    <td style={{ padding: '1rem', color: thText, fontSize: '0.8rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0.5rem', columnGap: '1rem' }}>
                        <span>Light: {lim.light?.perDay ?? 0}/d · {lim.light?.perMonth ?? 0}/m</span>
                        <span>Med: {lim.medium?.perDay ?? 0}/d · {lim.medium?.perMonth ?? 0}/m</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button style={btnEdit} onClick={() => openEdit(plan)}><Edit2 size={14}/></button>
                      <button style={btnDanger} onClick={() => handleDelete(plan.id)}><Trash2 size={14}/></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div style={{
            background: isDark ? '#1f2937' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            borderRadius: '1rem', width: '600px', maxWidth: '95%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ padding: '1.25rem', borderBottom: `1px solid ${trBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: tdText }}>{editingPlan ? 'Edit Plan' : 'Create Plan'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: thText, cursor: 'pointer' }}><X size={20}/></button>
            </div>
            
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Plan ID (no spaces)</label>
                  <input style={inputStyle} value={id} onChange={e => setId(e.target.value)} disabled={!!editingPlan} placeholder="e.g. enterprise" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Plan Name</label>
                  <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Enterprise Plan" />
                </div>
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: thText, marginBottom: '0.3rem' }}>Description</label>
                <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
              </div>

              <div style={{ borderTop: `1px solid ${trBorder}`, paddingTop: '1rem', marginTop: '0.5rem' }}>
                <h4 style={{ margin: '0 0 1rem 0', color: tdText, fontSize: '0.9rem' }}>Included Services</h4>
                
                <div style={{ 
                  display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', 
                  padding: '0.5rem', background: isDark ? 'rgba(255,255,255,0.05)' : '#f3f4f6', borderRadius: '0.5rem', cursor: 'pointer' 
                }} onClick={() => toggleService('*')}>
                  {services.includes('*') ? <CheckSquare size={18} color="#10b981" /> : <Square size={18} color={thText} />}
                  <span style={{ color: tdText, fontSize: '0.85rem', fontWeight: 600 }}>All Services (*)</span>
                </div>

                {!services.includes('*') && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                    {(dbServices.length > 0 ? dbServices : ALL_SERVICES.map(id => ({ id, display_name: id }))).map(srv => (
                      <div key={srv.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => toggleService(srv.id)}>
                        {services.includes(srv.id) ? <CheckSquare size={16} color="#3b82f6" /> : <Square size={16} color={thText} />}
                        <span style={{ color: tdText, fontSize: '0.8rem' }}>
                          {srv.display_name} <span style={{ fontSize: '0.70rem', color: thText }}>({srv.id})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: `1px solid ${trBorder}`, paddingTop: '1rem', marginTop: '0.5rem' }}>
                <h4 style={{ margin: '0 0 1rem 0', color: tdText, fontSize: '0.9rem' }}>Rate Limits</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb', padding: '1rem', borderRadius: '0.5rem', border: `1px solid ${trBorder}` }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: tdText, marginBottom: '0.8rem' }}>Light Commands</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: thText, width: '50px' }}>Daily</span>
                        <input type="number" style={{...inputStyle, padding: '0.4rem'}} value={lightDay} onChange={e => setLightDay(e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: thText, width: '50px' }}>Monthly</span>
                        <input type="number" style={{...inputStyle, padding: '0.4rem'}} value={lightMonth} onChange={e => setLightMonth(e.target.value)} />
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f9fafb', padding: '1rem', borderRadius: '0.5rem', border: `1px solid ${trBorder}` }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: tdText, marginBottom: '0.8rem' }}>Medium Commands</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: thText, width: '50px' }}>Daily</span>
                        <input type="number" style={{...inputStyle, padding: '0.4rem'}} value={medDay} onChange={e => setMedDay(e.target.value)} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: thText, width: '50px' }}>Monthly</span>
                        <input type="number" style={{...inputStyle, padding: '0.4rem'}} value={medMonth} onChange={e => setMedMonth(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} id="planActive" />
                <label htmlFor="planActive" style={{ color: tdText, fontSize: '0.85rem' }}>Plan is active and available to users</label>
              </div>
            </div>
            
            <div style={{ padding: '1.25rem', borderTop: `1px solid ${trBorder}`, display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', background: 'transparent', color: thText, border: `1px solid ${trBorder}`, cursor: 'pointer' }} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={handleSave}><Check size={16} /> Save Plan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
