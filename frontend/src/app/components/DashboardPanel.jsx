import React from 'react';
import { Users, MapPin, Activity, Clock, BarChart3, CheckCircle2, XCircle, Timer } from 'lucide-react';
import { useThemeContext } from '../context/ThemeContext.jsx';
import { SkeletonCard, SkeletonTableRow } from './Skeleton.jsx';

function StatCard({ label, value, icon: Icon, color, isDark }) {
  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }
    : { background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };
  return (
    <div style={panelStyle}>
      <div>
        <p style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
        <p style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.025em', color: isDark ? '#e6edf3' : '#111827', margin: 0 }}>{value}</p>
      </div>
      <div style={{ padding: '0.75rem', borderRadius: '0.75rem', alignSelf: 'flex-end', background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color }}>
        <Icon size={22} />
      </div>
    </div>
  );
}

function statusBadge(status) {
  const map = {
    pending:   { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24', label: 'Pending' },
    running:   { bg: 'rgba(99,102,241,0.15)',   color: '#818cf8', label: 'Running' },
    completed: { bg: 'rgba(16,185,129,0.15)',   color: '#10b981', label: 'Done' },
    failed:    { bg: 'rgba(244,63,94,0.15)',    color: '#f43f5e', label: 'Failed' },
  };
  const s = map[status] || { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af', label: status };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function DashboardPanel({ stats, recentJobs, loading, isDark }) {
  const cards = [
    { label: 'Total Users',    value: stats.activeUsers  ?? stats.totalUsers ?? '—', icon: Users,       color: '#6366f1' },
    { label: 'Tracked Apps',  value: (Number(stats.sarathiTracked || 0) + Number(stats.vahanTracked || 0)) || '—', icon: MapPin, color: '#10b981' },
    { label: 'Pending Jobs',  value: stats.pendingJobs  ?? '—',                        icon: Activity,    color: '#fbbf24' },
    { label: 'Uptime',        value: stats.uptime ? formatUptime(stats.uptime) : '—',   icon: Clock,       color: '#06b6d4' },
  ];

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };

  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : cards.map((c) => <StatCard key={c.label} {...c} isDark={isDark} />)
        }
      </div>

      {/* Recent jobs */}
      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Recent Jobs
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['ID', 'Command', 'Queue', 'Status', 'Created'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} cols={5} />)
                : (recentJobs || []).slice(0, 20).map((job, i) => (
                  <tr key={job.id || i} style={{ borderBottom: `1px solid ${trBorder}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.7rem' }}>{String(job.id || '').slice(0, 8)}…</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontWeight: 500 }}>{job.command || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{job.queue_type || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{statusBadge(job.status)}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText, whiteSpace: 'nowrap' }}>{job.created_at ? new Date(job.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))
              }
              {!loading && (!recentJobs || recentJobs.length === 0) && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No recent jobs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
