import React from 'react';
import { Activity, Layers } from 'lucide-react';

function QueueCard({ name, stats, color, isDark }) {
  const cardStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem', padding: '1.5rem', flex: 1 }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.5rem', flex: 1, boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };

  const rows = [
    { label: 'Pending',   value: stats.pending   ?? 0, color: '#fbbf24' },
    { label: 'Running',   value: stats.running   ?? 0, color: color },
    { label: 'Completed', value: stats.completed ?? 0, color: '#10b981' },
    { label: 'Failed',    value: stats.failed    ?? 0, color: '#f43f5e' },
  ];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.75rem', background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Layers size={18} style={{ color }} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Queue</p>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{name}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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

export function QueuesPanel({ queues, isDark }) {
  const api     = queues?.api     || {};
  const browser = queues?.browser || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
        Queue Monitor
      </h2>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <QueueCard name="API Queue"     stats={api}     color="#6366f1" isDark={isDark} />
        <QueueCard name="Browser Queue" stats={browser} color="#06b6d4" isDark={isDark} />
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
