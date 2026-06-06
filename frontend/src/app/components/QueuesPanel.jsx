import React, { useState } from 'react';
import { Activity, Layers, Play, Pause, Trash2 } from 'lucide-react';
import { apiPostJson } from '../../api/client.js';

function QueueCard({ queueId, name, stats, color, isDark, refresh, showToast }) {
  const [processing, setProcessing] = useState(false);

  const cardStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem', padding: '1.5rem', flex: 1 }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.5rem', flex: 1, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };

  const rows = [
    { label: 'Pending',   value: stats.pending   ?? 0, color: '#fbbf24' },
    { label: 'Running',   value: stats.running   ?? 0, color: color },
    { label: 'Completed', value: stats.completed ?? 0, color: '#10b981' },
    { label: 'Failed',    value: stats.failed    ?? 0, color: '#f43f5e' },
  ];

  const handleAction = async (action) => {
    if (action === 'flush' && !confirm(`Are you sure you want to flush all pending jobs in ${name}?`)) return;
    setProcessing(true);
    try {
      await apiPostJson(`/admin/api/queues/${queueId}/${action}`);
      showToast && showToast(`Queue ${name} ${action}d successfully.`, 'success');
      refresh && refresh();
    } catch (err) {
      showToast && showToast(`Failed to ${action} queue: ${err.message}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const btnStyle = { padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: 'none', fontSize: '0.75rem', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', opacity: processing ? 0.6 : 1 };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.75rem', background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={18} style={{ color }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Queue</p>
              {stats.isPaused && <span style={{ background: 'rgba(244,63,94,0.1)', color: '#f43f5e', fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '999px' }}>PAUSED</span>}
            </div>
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{name}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {stats.isPaused ? (
            <button disabled={processing} onClick={() => handleAction('resume')} style={{ ...btnStyle, background: 'rgba(16,185,129,0.15)', color: '#10b981' }}><Play size={14}/> Resume</button>
          ) : (
            <button disabled={processing} onClick={() => handleAction('pause')} style={{ ...btnStyle, background: 'rgba(245,158,11,0.15)', color: '#d97706' }}><Pause size={14}/> Pause</button>
          )}
          <button disabled={processing} onClick={() => handleAction('flush')} style={{ ...btnStyle, background: 'rgba(244,63,94,0.15)', color: '#f43f5e' }}><Trash2 size={14}/> Flush</button>
        </div>
      </div>

      <div className="responsive-grid" style={{ gap: '0.75rem' }}>
        {rows.map(r => (
          <div key={r.label} style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: '0.5rem', padding: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.25rem' }}>{r.label}</p>
            <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: r.color }}>{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QueuesPanel({ queues, isDark, refresh, showToast }) {
  const api     = queues?.api     || {};
  const browser = queues?.browser || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
        Queue Monitor
      </h2>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <QueueCard queueId="api" name="API Queue" stats={api} color="#6366f1" isDark={isDark} refresh={refresh} showToast={showToast} />
        <QueueCard queueId="browser" name="Browser Queue" stats={browser} color="#06b6d4" isDark={isDark} refresh={refresh} showToast={showToast} />
      </div>

      {/* Total throughput summary */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem',
        padding: '1rem', borderRadius: '0.75rem',
        background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
      }}>
        {[
          { label: 'Total Pending',   value: (api.pending || 0) + (browser.pending || 0),    color: '#fbbf24' },
          { label: 'Total Running',   value: (api.running || 0) + (browser.running || 0),    color: '#818cf8' },
          { label: 'Total Completed', value: (api.completed || 0) + (browser.completed || 0), color: '#10b981' },
          { label: 'Total Failed',    value: (api.failed || 0) + (browser.failed || 0),       color: '#f43f5e' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.3rem' }}>{s.label}</p>
            <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
