import React from 'react';
import { Users, MapPin, Activity, Clock, BarChart3, CheckCircle2, XCircle, Timer, IndianRupee, TrendingUp, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { useThemeContext } from '../context/ThemeContext.jsx';
import { SkeletonCard, SkeletonTableRow } from './Skeleton.jsx';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client.js';

function StatCard({ label, value, icon: Icon, color, isDark, subtitle }) {
  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }
    : { background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };
  return (
    <div style={panelStyle}>
      <div>
        <p style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
        <p style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.025em', color: isDark ? '#e6edf3' : '#111827', margin: 0 }}>{value}</p>
        {subtitle && <p style={{ fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280', marginTop: '0.25rem', margin: '0.25rem 0 0 0' }}>{subtitle}</p>}
      </div>
      <div style={{ padding: '0.75rem', borderRadius: '0.75rem', alignSelf: 'flex-end', background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color }}>
        <Icon size={22} />
      </div>
    </div>
  );
}

function BackupHealthCard({ isDark }) {
  const { data, isLoading } = useQuery({
    queryKey: ['backupHealth'],
    queryFn: () => apiGet('/admin/api/backups/health'),
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
  });

  const health = data?.health || (isLoading ? null : 'critical');
  const healthConfig = {
    healthy: { Icon: ShieldCheck, color: '#10b981', label: 'Healthy', bg: 'rgba(16,185,129,0.12)' },
    warning: { Icon: ShieldAlert, color: '#fbbf24', label: 'Warning', bg: 'rgba(251,191,36,0.12)' },
    critical: { Icon: ShieldX, color: '#f43f5e', label: 'Critical', bg: 'rgba(244,63,94,0.12)' },
  };
  const cfg = healthConfig[health] || healthConfig.critical;
  const Icon = cfg.Icon;

  let lastStr = '—';
  if (data?.lastBackupAgoMinutes != null) {
    const mins = data.lastBackupAgoMinutes;
    if (mins < 60) lastStr = `${mins}m ago`;
    else lastStr = `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  } else if (data?.lastBackup === null) {
    lastStr = 'Never';
  }

  let nextStr = '';
  if (data?.nextScheduledAt) {
    const diffMs = new Date(data.nextScheduledAt) - Date.now();
    if (diffMs > 0) {
      const diffH = Math.floor(diffMs / 1000 / 60 / 60);
      const diffM = Math.floor((diffMs / 1000 / 60) % 60);
      nextStr = `Next in ~${diffH > 0 ? `${diffH}h ` : ''}${diffM}m`;
    } else {
      nextStr = 'Due soon';
    }
  }

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.04)', border: `1px solid ${cfg.color}30`, borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }
    : { background: 'rgba(255,255,255,0.8)', border: `1px solid ${cfg.color}40`, borderRadius: '1rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };

  return (
    <div style={panelStyle}>
      <div>
        <p style={{ fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          DB Backup
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '1.4rem', fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
          <span style={{ fontSize: '0.7rem', background: cfg.bg, color: cfg.color, padding: '0.15rem 0.5rem', borderRadius: '999px', fontWeight: 700 }}>
            {isLoading ? '…' : `${data?.totalBackups ?? 0} files`}
          </span>
        </div>
        <p style={{ fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280', margin: 0 }}>
          Last: {isLoading ? '…' : lastStr}
          {nextStr && ` · ${nextStr}`}
        </p>
      </div>
      <div style={{ padding: '0.75rem', borderRadius: '0.75rem', alignSelf: 'flex-end', background: cfg.bg, color: cfg.color }}>
        <Icon size={22} />
      </div>
    </div>
  );
}

function CreditsSpentTodayCard({ isDark }) {
  const { data, isLoading } = useQuery({
    queryKey: ['creditsBreakdown'],
    queryFn: () => apiGet('/admin/api/stats/credits'),
    staleTime: 60_000,
    refetchInterval: 2 * 60 * 1000,
  });

  const value = isLoading ? '…' : (data?.creditsSpentToday != null ? `₹${data.creditsSpentToday}` : '₹0');
  const subtitle = data?.topSpenders?.length > 0
    ? `Top: ${data.topSpenders[0].name || data.topSpenders[0].phone}`
    : undefined;

  return <StatCard label="Spent Today" value={value} icon={TrendingUp} color="#f97316" isDark={isDark} subtitle={subtitle} />;
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

function getCategory(cmd, services = []) {
  if (services && services.length > 0) {
    const srv = services.find(s => s.id === cmd);
    if (srv) return srv.category || 'light';
    return 'light'; // default if not found
  }
  // Fallback if services not loaded
  const HEAVY_COMMANDS = ['lledit_start','dl_renewal_start','apply_dl_start'];
  const MEDIUM_COMMANDS = ['llprint_start','fee_print_start','pay_fee_start','slot_booking_start','resend_otp'];
  if (HEAVY_COMMANDS.includes(cmd)) return 'heavy';
  if (MEDIUM_COMMANDS.includes(cmd)) return 'medium';
  return 'light';
}

export function DashboardPanel({ stats, recentJobs, services, loading, isDark }) {
  const cards = [
    { label: 'Total Users',    value: stats.activeUsers  ?? stats.totalUsers ?? '—', icon: Users,       color: '#6366f1' },
    { label: 'Tracked Apps',  value: (Number(stats.sarathiTracked || 0) + Number(stats.vahanTracked || 0)) || '—', icon: MapPin, color: '#10b981' },
    { label: 'Pending Jobs',  value: stats.pendingJobs  ?? '—',                        icon: Activity,    color: '#fbbf24', subtitle: stats.jobsToday != null ? `${stats.jobsToday} today` : undefined },
    { label: 'Uptime',        value: stats.uptime ? formatUptime(stats.uptime) : '—',   icon: Clock,       color: '#06b6d4' },
    { label: 'Credits Pool',  value: stats.totalCredits != null ? `₹${stats.totalCredits}` : '—', icon: IndianRupee, color: '#a855f7', subtitle: stats.activeUsers ? `across ${stats.activeUsers} users` : undefined },
    { label: 'Credits Spent', value: stats.totalCreditsSpent != null ? `₹${stats.totalCreditsSpent}` : '—', icon: TrendingUp, color: '#ec4899', subtitle: 'all time' },
    { label: 'Success Rate',  value: stats.successRate != null ? `${stats.successRate}%` : '—', icon: TrendingUp, color: '#f97316' },
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
          : <>
              {cards.map((c) => <StatCard key={c.label} {...c} isDark={isDark} />)}
              <BackupHealthCard isDark={isDark} />
              <CreditsSpentTodayCard isDark={isDark} />
            </>
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
                {['ID', 'User Phone', 'Command', 'Category', 'Queue', 'Status', 'Created'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
                : (recentJobs || []).slice(0, 20).map((job, i) => {
                  const cat = getCategory(job.command, services);
                  return (
                  <tr key={job.id || i} style={{ borderBottom: `1px solid ${trBorder}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.7rem' }}>{String(job.id || '').slice(0, 8)}…</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.75rem' }}>{job.user_phone || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontWeight: 500 }}>{job.command || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}><span className={`badge badge-${cat}`}>{cat}</span></td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{job.queue_type || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{statusBadge(job.status)}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText, whiteSpace: 'nowrap' }}>{job.created_at ? new Date(job.created_at).toLocaleString() : '—'}</td>
                  </tr>
                  );
                })
              }
              {!loading && (!recentJobs || recentJobs.length === 0) && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No recent jobs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
