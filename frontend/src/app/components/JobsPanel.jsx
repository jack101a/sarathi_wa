import React, { useState } from 'react';
import { Briefcase, Search, Filter, X, PlayCircle, Clock, RefreshCw, XCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchFilteredJobs, fetchJobDetail } from '../../api/queries.js';
import { apiDelete } from '../../api/client.js';
import { SkeletonCard, SkeletonTableRow } from './Skeleton.jsx';

const HEAVY_COMMANDS = ['lledit_start','dl_renewal_start','apply_dl_start'];
const MEDIUM_COMMANDS = ['llprint_start','fee_print_start','pay_fee_start','slot_booking_start','resend_otp'];
function getCategory(cmd) {
  if (HEAVY_COMMANDS.includes(cmd)) return 'heavy';
  if (MEDIUM_COMMANDS.includes(cmd)) return 'medium';
  return 'light';
}

function statusBadge(status) {
  const map = {
    pending:   { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24', label: 'Pending' },
    running:   { bg: 'rgba(99,102,241,0.15)',   color: '#818cf8', label: 'Running' },
    completed: { bg: 'rgba(16,185,129,0.15)',   color: '#10b981', label: 'Done' },
    failed:    { bg: 'rgba(244,63,94,0.15)',    color: '#f43f5e', label: 'Failed' },
    cancelled: { bg: 'rgba(156,163,175,0.15)',  color: '#9ca3af', label: 'Cancelled' },
  };
  const s = map[status] || { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af', label: status };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

function QueueCard({ title, stats, isDark }) {
  const panelBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.85)';
  const border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={{ background: panelBg, border: `1px solid ${border}`, borderRadius: '1rem', padding: '1.25rem', flex: 1, minWidth: '250px' }}>
      <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Pending</p>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#fbbf24' }}>{stats.pending}</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Running</p>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#818cf8' }}>{stats.running}</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Completed</p>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#10b981' }}>{stats.completed}</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Failed</p>
          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f43f5e' }}>{stats.failed}</p>
        </div>
      </div>
    </div>
  );
}

function JobDrawer({ jobId, isDark, onClose, onCancel, showToast }) {
  const { data, isLoading } = useQuery({
    queryKey: ['jobDetail', jobId],
    queryFn: () => fetchJobDetail(jobId),
    enabled: !!jobId,
  });

  const job = data?.job;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.4)' }} />
      <div className="drawer-enter" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: '500px', zIndex: 50,
        background: isDark ? '#0d1117' : '#fff', borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.1)', overflowY: 'auto', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '1.25rem', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isDark ? '#161b22' : '#f8fafc', position: 'sticky', top: 0, zIndex: 1 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>Job Detail</h3>
            <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280', fontFamily: 'monospace' }}>{jobId}</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280' }}><X size={20} /></button>
        </div>

        <div style={{ padding: '1.5rem', flex: 1 }}>
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}><SkeletonCard /><SkeletonCard /></div>
          ) : !job ? (
            <p style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Job not found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {statusBadge(job.status)}
                <span className={`badge badge-${getCategory(job.command)}`}>{getCategory(job.command)}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>User Phone</p>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827', fontFamily: 'monospace' }}>{job.user_phone}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Command</p>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827' }}>{job.command}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Queue Type</p>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827' }}>{job.queue_type}</p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Created</p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}>{new Date(job.created_at).toLocaleString()}</p>
                </div>
                {job.started_at && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Started</p>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}>{new Date(job.started_at).toLocaleString()}</p>
                  </div>
                )}
                {job.completed_at && (
                  <div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Completed</p>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}>{new Date(job.completed_at).toLocaleString()}</p>
                  </div>
                )}
              </div>

              {job.error_text && (
                <div style={{ padding: '1rem', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: '0.5rem' }}>
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.75rem', fontWeight: 700, color: '#f43f5e', textTransform: 'uppercase' }}>Error</p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: isDark ? '#fecdd3' : '#9f1239', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{job.error_text}</p>
                </div>
              )}

              <div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827' }}>Payload JSON</p>
                <pre style={{ margin: 0, padding: '1rem', background: isDark ? 'rgba(0,0,0,0.3)' : '#f1f5f9', borderRadius: '0.5rem', fontSize: '0.75rem', color: isDark ? '#e6edf3' : '#334155', overflowX: 'auto', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                  {JSON.stringify(JSON.parse(job.payload_json || '{}'), null, 2)}
                </pre>
              </div>

              <div>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827' }}>Result JSON</p>
                <pre style={{ margin: 0, padding: '1rem', background: isDark ? 'rgba(0,0,0,0.3)' : '#f1f5f9', borderRadius: '0.5rem', fontSize: '0.75rem', color: isDark ? '#e6edf3' : '#334155', overflowX: 'auto', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                  {JSON.stringify(JSON.parse(job.result_json || '{}'), null, 2)}
                </pre>
              </div>

            </div>
          )}
        </div>

        {job?.status === 'pending' && (
          <div style={{ padding: '1.25rem', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, background: isDark ? '#161b22' : '#f8fafc', display: 'flex', justifyContent: 'flex-end', position: 'sticky', bottom: 0 }}>
            <button onClick={() => onCancel(jobId)} style={{ padding: '0.6rem 1.25rem', borderRadius: '0.5rem', background: 'rgba(244,63,94,0.15)', color: '#f43f5e', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <XCircle size={16} /> Cancel Job
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function JobsPanel({ queues, isDark, showToast }) {
  const [filters, setFilters] = useState({ status: '', user_id: '', command: '' });
  const [activeFilters, setActiveFilters] = useState({ status: '', user_id: '', command: '' });
  const [selectedJobId, setSelectedJobId] = useState(null);
  
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['filteredJobs', activeFilters],
    queryFn: () => fetchFilteredJobs(activeFilters),
    staleTime: 5000,
  });

  const jobs = data?.jobs || [];

  const panelStyle = isDark
    ? { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1rem', padding: '1.25rem' }
    : { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '1rem', padding: '1.25rem', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' };
  const thText = isDark ? '#9ca3af' : '#6b7280';
  const tdText = isDark ? '#e6edf3' : '#111827';
  const trBorder = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const inputStyle = { padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem' };
  
  async function handleCancel(jobId) {
    if (!confirm('Cancel this pending job?')) return;
    try {
      await apiDelete(`/admin/api/jobs/${encodeURIComponent(jobId)}`);
      showToast('Job cancelled', 'success');
      setSelectedJobId(null);
      queryClient.invalidateQueries({ queryKey: ['filteredJobs'] });
      queryClient.invalidateQueries({ queryKey: ['queues'] });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
          <Briefcase size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: '#6366f1' }} />
          Jobs Monitoring
        </h2>
        <button onClick={() => queryClient.invalidateQueries({ queryKey: ['filteredJobs'] })} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <QueueCard title="API Queue" stats={queues.api} isDark={isDark} />
        <QueueCard title="Browser Queue" stats={queues.browser} isDark={isDark} />
      </div>

      <div style={panelStyle}>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <select style={inputStyle} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="text" placeholder="User Phone..." style={inputStyle} value={filters.user_id} onChange={e => setFilters({ ...filters, user_id: e.target.value })} />
          <input type="text" placeholder="Command..." style={inputStyle} value={filters.command} onChange={e => setFilters({ ...filters, command: e.target.value })} />
          <button 
            onClick={() => setActiveFilters(filters)} 
            style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Filter size={14} /> Apply Filter
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {['ID', 'Phone', 'Command', 'Cat', 'Queue', 'Status', 'Created'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: thText, fontWeight: 600, borderBottom: `1px solid ${trBorder}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
                : jobs.map(job => (
                  <tr key={job.id} onClick={() => setSelectedJobId(job.id)} className="hover-row" style={{ borderBottom: `1px solid ${trBorder}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace', fontSize: '0.75rem' }}>{job.id.slice(0,10)}...</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontFamily: 'monospace' }}>{job.user_phone || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: tdText, fontWeight: 500 }}>{job.command}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}><span className={`badge badge-${getCategory(job.command)}`}>{getCategory(job.command).substring(0,3)}</span></td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{job.queue_type}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{statusBadge(job.status)}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: thText }}>{new Date(job.created_at).toLocaleString()}</td>
                  </tr>
                ))
              }
              {!isLoading && jobs.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: thText }}>No jobs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedJobId && (
        <JobDrawer 
          jobId={selectedJobId} 
          isDark={isDark} 
          onClose={() => setSelectedJobId(null)} 
          onCancel={handleCancel}
          showToast={showToast}
        />
      )}
    </div>
  );
}
