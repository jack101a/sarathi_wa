import React, { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { apiPostJson, apiDelete } from '../../api/client.js';

function statusDot(snapshot) {
  if (!snapshot) return { color: '#9ca3af', label: 'Unknown' };
  try {
    const s = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    const text = [s.kind, s.stage, s.message].join(' ').toUpperCase();
    if (text.includes('DISPATCH')) return { color: '#10b981', label: 'Dispatched ✅' };
    if (text.includes('APPROV') || text.includes('CARD') || text.includes('PRINT')) return { color: '#818cf8', label: 'Approved ✅' };
    if (text.includes('SCRUTINY')) return { color: '#fbbf24', label: 'Scrutiny' };
    return { color: '#9ca3af', label: s.stage || s.kind || 'Pending' };
  } catch { return { color: '#9ca3af', label: 'Pending' }; }
}

export function TrackedPanel({ sarathiTracked, vahanTracked, isDark, onRefresh, showToast }) {
  const [refreshing, setRefreshing] = useState(false);

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem', marginBottom: '1.5rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', marginBottom: '1.5rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };
  const thText  = isDark ? '#9ca3af' : '#6b7280';
  const tdText  = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const btnDanger = { padding: '0.3rem 0.6rem', borderRadius: '0.5rem', background: 'rgba(244,63,94,0.12)', color: '#f43f5e', border: 'none', cursor: 'pointer', fontSize: '0.75rem' };
  const btnRefresh = { padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: refreshing ? 0.6 : 1 };

  async function handleRefreshAll() {
    setRefreshing(true);
    try {
      await apiPostJson('/admin/api/tracked/refresh', {});
      showToast('Refresh triggered in background', 'success');
      setTimeout(onRefresh, 3000);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setRefreshing(false); }
  }

  async function handleRemoveSarathi(appNo) {
    if (!confirm(`Remove tracking for ${appNo}?`)) return;
    try {
      await apiDelete(`/admin/api/tracked/sarathi/${encodeURIComponent(appNo)}`);
      showToast('Removed', 'success');
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleRemoveVahan(appNo) {
    if (!confirm(`Remove tracking for ${appNo}?`)) return;
    try {
      await apiDelete(`/admin/api/tracked/vahan/${encodeURIComponent(appNo)}`);
      showToast('Removed', 'success');
      onRefresh();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const SectionHeader = ({ label, count, color }) => (
    <div style={{ padding: '0.75rem 1rem', background: color, borderRadius: '0.5rem 0.5rem 0 0', marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.85rem' }}>{label}</span>
      <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem' }}>{count} apps</span>
    </div>
  );

  const cols = ['#', 'App No', 'Applicant', 'Service', 'Chat ID', 'Status', 'Actions'];

  const renderTable = (rows, type) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr>{cols.map(h => <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: thText }}>None tracked</td></tr>}
          {rows.map((item, i) => {
            const appNo = type === 'sarathi' ? item.appNo : item.applicationNumber;
            const { color, label } = statusDot(item.lastSnapshot);
            return (
              <tr key={appNo || i} style={{ borderBottom: `1px solid ${trBorder}` }}>
                <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{i + 1}</td>
                <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontWeight: 600, fontFamily: 'monospace', fontSize: '0.75rem' }}>{appNo}</td>
                <td style={{ padding: '0.6rem 0.75rem', color: tdText }}>{item.applicantName || item.tag || '—'}</td>
                <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{item.serviceName || '—'}</td>
                <td style={{ padding: '0.6rem 0.75rem', color: thText, fontFamily: 'monospace', fontSize: '0.7rem' }}>{item.chatId || '—'}</td>
                <td style={{ padding: '0.6rem 0.75rem' }}><span style={{ color, fontWeight: 600, fontSize: '0.75rem' }}>{label}</span></td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <button style={btnDanger} onClick={() => type === 'sarathi' ? handleRemoveSarathi(appNo) : handleRemoveVahan(appNo)} title="Remove tracking">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
          Tracked Applications <span style={{ color: '#6366f1' }}>({sarathiTracked.length + vahanTracked.length})</span>
        </h2>
        <button style={btnRefresh} onClick={handleRefreshAll} disabled={refreshing}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'Triggering…' : 'Refresh All'}
        </button>
      </div>

      {/* Sarathi */}
      <div style={panelStyle}>
        <SectionHeader label="Sarathi Applications" count={sarathiTracked.length} color="#1f6feb" />
        {renderTable(sarathiTracked, 'sarathi')}
      </div>

      {/* Vahan */}
      <div style={panelStyle}>
        <SectionHeader label="Vahan Applications" count={vahanTracked.length} color="#0f9d58" />
        {renderTable(vahanTracked, 'vahan')}
      </div>
    </div>
  );
}
