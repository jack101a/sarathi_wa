import React from 'react';
import { Server, Cpu, HardDrive, Settings, Database, Download, RefreshCw, ShieldCheck, ShieldAlert, ShieldX, RotateCcw, AlertTriangle, Cloud, Send, CheckCircle2, XCircle, Loader } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPostJson, apiPut } from '../../api/client.js';

function mb(bytes) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '—';
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function InfoRow({ label, value, isDark }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
      <span style={{ fontSize: '0.8rem', color: isDark ? '#9ca3af' : '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isDark ? '#e6edf3' : '#111827', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, isDark, accentColor, span = 1 }) {
  return (
    <div style={{
      gridColumn: span > 1 ? `span ${span}` : 'auto',
      background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.85)',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
      borderRadius: '1rem', padding: '1.25rem',
      boxShadow: isDark ? 'none' : '0 1px 8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
        <div style={{ width: '2rem', height: '2rem', borderRadius: '0.5rem', background: `${accentColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} style={{ color: accentColor }} />
        </div>
        <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function BackupTypeBadge({ type, isDark }) {
  const map = {
    manual:           { color: '#6366f1', bg: 'rgba(99,102,241,0.15)',  label: 'Manual' },
    scheduled:        { color: '#10b981', bg: 'rgba(16,185,129,0.15)', label: 'Scheduled' },
    startup:          { color: '#06b6d4', bg: 'rgba(6,182,212,0.15)',  label: 'Startup' },
    shutdown:         { color: '#a855f7', bg: 'rgba(168,85,247,0.15)', label: 'Shutdown' },
    'restore-safety': { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', label: 'Safety' },
  };
  const cfg = map[type] || { color: '#9ca3af', bg: 'rgba(156,163,175,0.12)', label: type || '?' };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

function RestoreModal({ backup, isDark, onConfirm, onCancel, isRestoring }) {
  const overlay = { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const modal   = { background: isDark ? '#1e2434' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, borderRadius: '1rem', padding: '2rem', maxWidth: '480px', width: '90%', boxShadow: '0 25px 60px rgba(0,0,0,0.4)' };
  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ padding: '0.6rem', borderRadius: '0.6rem', background: 'rgba(244,63,94,0.15)' }}>
            <AlertTriangle size={22} style={{ color: '#f43f5e' }} />
          </div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>Restore Database?</h3>
        </div>
        <div style={{ fontSize: '0.85rem', color: isDark ? '#9ca3af' : '#6b7280', lineHeight: 1.7, marginBottom: '1.5rem' }}>
          <p style={{ margin: '0 0 0.75rem' }}>You are about to restore from backup:</p>
          <code style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', padding: '0.4rem 0.6rem', borderRadius: '0.4rem', fontSize: '0.75rem', display: 'block', wordBreak: 'break-all', color: isDark ? '#e6edf3' : '#334155' }}>{backup?.fileName}</code>
          <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem' }}>
            <li>A <strong>safety backup</strong> of the current database will be created first.</li>
            <li>The database connection will briefly restart (~2–3 seconds).</li>
            <li>All data written after this backup point will be <strong>lost</strong>.</li>
          </ul>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={isRestoring} style={{ padding: '0.55rem 1.2rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, background: 'transparent', color: isDark ? '#9ca3af' : '#6b7280', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Cancel</button>
          <button onClick={onConfirm} disabled={isRestoring} style={{ padding: '0.55rem 1.2rem', borderRadius: '0.5rem', border: 'none', background: 'linear-gradient(135deg,#f43f5e,#e11d48)', color: '#fff', cursor: isRestoring ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: isRestoring ? 0.7 : 1 }}>
            {isRestoring ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Restoring…</> : <><RotateCcw size={14} /> Confirm Restore</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cloud Backup ─────────────────────────────────────────────────────────────

const PROVIDER_META = {
  telegram: {
    label: 'Telegram', icon: '📱', color: '#229ED9',
    description: 'Send backups as documents to a Telegram chat or channel.',
    fields: [{ key: 'chatId', label: 'Chat ID', type: 'text', placeholder: '-100123456789', hint: 'Use a group/channel ID (starts with -100) or your user ID. Send /start to @userinfobot to get yours.' }],
  },
  rclone: {
    label: 'Google Drive (rclone)', icon: '☁️', color: '#4285F4',
    description: 'Upload to Google Drive via rclone. Rclone must be installed and configured on the server.',
    fields: [
      { key: 'remote',     label: 'Remote Name',   type: 'text', placeholder: 'gdrive',          hint: 'The rclone remote name (from `rclone listremotes`)' },
      { key: 'remotePath', label: 'Remote Folder',  type: 'text', placeholder: 'SarathiBackups',  hint: 'Folder path on the remote (will be created if missing)' },
    ],
  },
  r2: {
    label: 'Cloudflare R2', icon: '🔶', color: '#F6821F',
    description: 'Upload to Cloudflare R2 object storage (S3-compatible, free egress).',
    fields: [
      { key: 'accountId',       label: 'Account ID',        type: 'text',     placeholder: 'abc123def456...' },
      { key: 'accessKeyId',     label: 'Access Key ID',     type: 'text',     placeholder: 'your-access-key-id' },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', placeholder: '••••••••••••••••' },
      { key: 'bucketName',      label: 'Bucket Name',       type: 'text',     placeholder: 'sarathi-backups' },
    ],
  },
};

function ProviderConfigModal({ provider, isDark, savedConfig, onSave, onClose }) {
  const meta = PROVIDER_META[provider];
  const [form, setForm] = React.useState(() => {
    const d = {};
    (meta?.fields || []).forEach(f => { d[f.key] = savedConfig?.[f.key] || ''; });
    return d;
  });
  const [testing,    setTesting]    = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);
  const [saving,     setSaving]     = React.useState(false);

  const overlay    = { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const modal      = { background: isDark ? '#1e2434' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, borderRadius: '1rem', padding: '2rem', maxWidth: '480px', width: '90%', boxShadow: '0 25px 60px rgba(0,0,0,0.4)', maxHeight: '90vh', overflowY: 'auto' };
  const inputStyle = { width: '100%', padding: '0.55rem 0.75rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc', color: isDark ? '#e6edf3' : '#111827', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const res = await apiPostJson(`/admin/api/cloud-backup/test/${provider}`, { config: form });
      setTestResult({ ok: true, message: res.result });
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally { setTesting(false); }
  }

  async function handleSave() {
    setSaving(true);
    try { await onSave(form); onClose(); } finally { setSaving(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '1.5rem' }}>{meta.icon}</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>{meta.label}</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: isDark ? '#9ca3af' : '#6b7280' }}>{meta.description}</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          {meta.fields.map(f => (
            <div key={f.key}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.35rem' }}>{f.label}</label>
              <input type={f.type || 'text'} value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} style={inputStyle} />
              {f.hint && <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: isDark ? '#6b7280' : '#9ca3af' }}>{f.hint}</p>}
            </div>
          ))}
        </div>
        {testResult && (
          <div style={{ padding: '0.65rem 0.85rem', borderRadius: '0.5rem', marginBottom: '1rem', background: testResult.ok ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', border: `1px solid ${testResult.ok ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}`, fontSize: '0.8rem', color: testResult.ok ? '#10b981' : '#f43f5e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {testResult.message}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onClose} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, background: 'transparent', color: isDark ? '#9ca3af' : '#6b7280', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600 }}>Cancel</button>
          <button onClick={handleTest} disabled={testing} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: isDark ? '#e6edf3' : '#374151', cursor: testing ? 'not-allowed' : 'pointer', fontSize: '0.83rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: testing ? 0.7 : 1 }}>
            {testing ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.83rem', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloudBackupSection({ isDark, showToast }) {
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['cloudProviders'],
    queryFn: () => apiGet('/admin/api/cloud-backup/providers'),
    staleTime: 30_000,
  });

  const [configModal,   setConfigModal]   = React.useState(null);
  const [uploadingNow,  setUploadingNow]  = React.useState(false);
  const [uploadResults, setUploadResults] = React.useState(null);

  const providers = data?.providers || [];
  const rclone    = data?.rclone    || {};

  async function handleToggle(provider, currentEnabled) {
    try {
      await apiPut(`/admin/api/cloud-backup/providers/${provider}`, { enabled: !currentEnabled });
      refetch();
      showToast && showToast(`${PROVIDER_META[provider].label} ${!currentEnabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) { showToast && showToast(`Failed: ${err.message}`, 'error'); }
  }

  async function handleSaveConfig(provider, config) {
    await apiPut(`/admin/api/cloud-backup/providers/${provider}`, { config });
    refetch();
    showToast && showToast(`${PROVIDER_META[provider].label} configuration saved`, 'success');
  }

  async function handleUploadNow() {
    setUploadingNow(true); setUploadResults(null);
    try {
      const res = await apiPostJson('/admin/api/cloud-backup/upload-now');
      setUploadResults(res.results || []);
      showToast && showToast(`Upload triggered for ${res.fileName}`, 'success');
    } catch (err) {
      showToast && showToast(`Upload failed: ${err.message}`, 'error');
    } finally { setUploadingNow(false); }
  }

  return (
    <div style={{ gridColumn: 'span 2', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.85)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`, borderRadius: '1rem', padding: '1.25rem', boxShadow: isDark ? 'none' : '0 1px 8px rgba(0,0,0,0.06)' }}>
      {configModal && (
        <ProviderConfigModal
          provider={configModal} isDark={isDark}
          savedConfig={providers.find(p => p.provider === configModal)?.config || {}}
          onSave={config => handleSaveConfig(configModal, config)}
          onClose={() => setConfigModal(null)}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ width: '2rem', height: '2rem', borderRadius: '0.5rem', background: 'rgba(6,182,212,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Cloud size={16} style={{ color: '#06b6d4' }} />
          </div>
          <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>Cloud Backup</h3>
        </div>
        <button onClick={handleUploadNow} disabled={uploadingNow} style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', color: '#fff', border: 'none', cursor: uploadingNow ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: uploadingNow ? 0.7 : 1 }}>
          {uploadingNow ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
          {uploadingNow ? 'Uploading…' : 'Upload Latest Now'}
        </button>
      </div>

      {/* Upload results */}
      {uploadResults && uploadResults.length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {uploadResults.map(r => (
            <div key={r.provider} style={{ padding: '0.5rem 0.75rem', borderRadius: '0.5rem', background: r.ok ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)', border: `1px solid ${r.ok ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}`, fontSize: '0.8rem', color: r.ok ? '#10b981' : '#f43f5e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              <strong>{PROVIDER_META[r.provider]?.label || r.provider}:</strong> {r.ok ? r.result : r.error}
            </div>
          ))}
        </div>
      )}

      {/* Provider cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem' }}>
        {isLoading
          ? ['telegram', 'rclone', 'r2'].map(p => <div key={p} style={{ height: '130px', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: '0.75rem' }} />)
          : providers.map(p => {
            const meta = PROVIDER_META[p.provider];
            if (!meta) return null;
            const isConfigured = p.config && Object.values(p.config).some(v => v && !String(v).startsWith('••'));
            const statusColor = p.enabled && p.lastUploadStatus === 'success' ? '#10b981'
              : p.enabled && p.lastUploadStatus === 'failed' ? '#f43f5e'
              : isDark ? '#9ca3af' : '#6b7280';
            const statusLabel = p.enabled && p.lastUploadStatus === 'success' ? 'Connected'
              : p.enabled && p.lastUploadStatus === 'failed' ? 'Error'
              : isConfigured ? 'Configured' : 'Not set up';
            let lastUploadStr = 'Never';
            if (p.lastUploadAt) {
              const diffMs = Date.now() - new Date(p.lastUploadAt).getTime();
              const dh = Math.floor(diffMs / 3600000), dm = Math.floor((diffMs % 3600000) / 60000);
              lastUploadStr = dh > 0 ? `${dh}h ${dm}m ago` : `${dm}m ago`;
            }
            return (
              <div key={p.provider} style={{ padding: '1rem', borderRadius: '0.75rem', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: `1px solid ${p.enabled ? `${meta.color}35` : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`, transition: 'border-color 0.2s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>{meta.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: isDark ? '#e6edf3' : '#111827' }}>{meta.label}</span>
                  </div>
                  <button onClick={() => handleToggle(p.provider, p.enabled)} title={p.enabled ? 'Disable' : 'Enable'} style={{ width: '38px', height: '20px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: p.enabled ? meta.color : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                    <span style={{ position: 'absolute', top: '2px', left: p.enabled ? '20px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                  {p.lastUploadAt && <span style={{ fontSize: '0.72rem', color: isDark ? '#6b7280' : '#9ca3af', marginLeft: 'auto' }}>Last: {lastUploadStr}</span>}
                </div>
                {p.enabled && p.lastError && <div style={{ fontSize: '0.72rem', color: '#f43f5e', marginBottom: '0.5rem', padding: '0.3rem 0.5rem', background: 'rgba(244,63,94,0.08)', borderRadius: '0.35rem', wordBreak: 'break-word' }}>{p.lastError}</div>}
                {p.provider === 'rclone' && <div style={{ fontSize: '0.72rem', color: rclone.installed ? '#10b981' : '#f43f5e', marginBottom: '0.5rem' }}>{rclone.installed ? `✓ rclone ${rclone.version}` : '✗ rclone not installed'}</div>}
                <button onClick={() => setConfigModal(p.provider)} style={{ width: '100%', padding: '0.4rem', borderRadius: '0.45rem', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, background: 'transparent', color: isDark ? '#9ca3af' : '#6b7280', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, textAlign: 'center' }}>
                  ⚙ Configure
                </button>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ─── Main SettingsPanel ───────────────────────────────────────────────────────

export function SettingsPanel({ health, isDark, showToast }) {
  const mem   = health?.memory       || {};
  const sess  = health?.sessions     || [];
  const pages = health?.browserPages || {};
  const uptimeH = Math.floor((health?.uptime || 0) / 3600);
  const uptimeM = Math.floor(((health?.uptime || 0) % 3600) / 60);

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['systemConfig'],
    queryFn: () => apiGet('/admin/api/config'),
    staleTime: 60_000,
  });

  const { data: backupsData, refetch: refetchBackups, isFetching: isFetchingBackups } = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiGet('/admin/api/backups'),
    staleTime: 30_000,
  });

  const { data: healthData, refetch: refetchHealth } = useQuery({
    queryKey: ['backupHealth'],
    queryFn: () => apiGet('/admin/api/backups/health'),
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  const [backingUp,     setBackingUp]     = React.useState(false);
  const [restoreTarget, setRestoreTarget] = React.useState(null);
  const [isRestoring,   setIsRestoring]   = React.useState(false);

  async function handleTriggerBackup() {
    setBackingUp(true);
    try {
      await apiPostJson('/admin/api/backup');
      showToast && showToast('Manual database backup created and verified.', 'success');
      refetchBackups(); refetchHealth();
    } catch (err) { showToast && showToast(`Backup failed: ${err.message}`, 'error'); }
    finally { setBackingUp(false); }
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setIsRestoring(true);
    try {
      await apiPostJson(`/admin/api/backups/${encodeURIComponent(restoreTarget.fileName)}/restore`);
      showToast && showToast(`Database restored from ${restoreTarget.fileName}.`, 'success');
      setRestoreTarget(null); refetchBackups(); refetchHealth();
    } catch (err) { showToast && showToast(`Restore failed: ${err.message}`, 'error'); }
    finally { setIsRestoring(false); }
  }

  const bHealth = healthData?.health || 'critical';
  const healthCfg = {
    healthy:  { Icon: ShieldCheck, color: '#10b981', label: 'Healthy',  bg: 'rgba(16,185,129,0.12)' },
    warning:  { Icon: ShieldAlert, color: '#fbbf24', label: 'Warning',  bg: 'rgba(251,191,36,0.12)' },
    critical: { Icon: ShieldX,     color: '#f43f5e', label: 'Critical', bg: 'rgba(244,63,94,0.12)'  },
  };
  const hCfg  = healthCfg[bHealth] || healthCfg.critical;
  const HIcon = hCfg.Icon;

  let lastBackupStr = 'Never';
  if (healthData?.lastBackupAgoMinutes != null) {
    const m = healthData.lastBackupAgoMinutes;
    lastBackupStr = m < 60 ? `${m} minutes ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
  }
  let nextStr = '';
  if (healthData?.nextScheduledAt) {
    const diffMs = new Date(healthData.nextScheduledAt) - Date.now();
    if (diffMs > 0) {
      const dh = Math.floor(diffMs / 3600000), dm = Math.floor((diffMs % 3600000) / 60000);
      nextStr = `Next in ~${dh > 0 ? `${dh}h ` : ''}${dm}m`;
    } else { nextStr = 'Due soon'; }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {restoreTarget && (
        <RestoreModal backup={restoreTarget} isDark={isDark} onConfirm={handleRestore} onCancel={() => !isRestoring && setRestoreTarget(null)} isRestoring={isRestoring} />
      )}

      <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>System Settings & Health</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>

        {/* Process */}
        <SectionCard title="Process" icon={Server} isDark={isDark} accentColor="#6366f1">
          <InfoRow label="Uptime"     value={`${uptimeH}h ${uptimeM}m`} isDark={isDark} />
          <InfoRow label="Heap Used"  value={mb(mem.heapUsed)}           isDark={isDark} />
          <InfoRow label="Heap Total" value={mb(mem.heapTotal)}          isDark={isDark} />
          <InfoRow label="RSS"        value={mb(mem.rss)}                isDark={isDark} />
          <InfoRow label="External"   value={mb(mem.external)}           isDark={isDark} />
        </SectionCard>

        {/* Puppeteer */}
        <SectionCard title="Puppeteer" icon={Cpu} isDark={isDark} accentColor="#06b6d4">
          <InfoRow label="Active Pages" value={`${pages.activePages ?? '—'} / ${pages.maxPages ?? '—'}`} isDark={isDark} />
          <InfoRow label="Waiting"      value={pages.waiting ?? '—'} isDark={isDark} />
        </SectionCard>

        {/* Session Pool */}
        <SectionCard title="Session Pool" icon={HardDrive} isDark={isDark} accentColor="#10b981">
          {sess.length === 0 && <p style={{ color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.8rem' }}>No session data</p>}
          {sess.map(s => (
            <div key={s.index} style={{ marginBottom: '0.5rem' }}>
              <InfoRow label={`Slot ${s.index}`} value={s.hasSession ? `${s.requestCount} reqs · ${Math.round(s.ageMs / 1000)}s old ${s.refreshing ? '⟳' : '✓'}` : 'No session'} isDark={isDark} />
            </div>
          ))}
        </SectionCard>

        {/* Local DB Backups */}
        <SectionCard title="Database Backups" icon={Database} isDark={isDark} accentColor="#fbbf24" span={2}>
          {/* Health banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '0.75rem', background: hCfg.bg, border: `1px solid ${hCfg.color}30`, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <HIcon size={20} style={{ color: hCfg.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: hCfg.color }}>{hCfg.label}</div>
              <div style={{ fontSize: '0.75rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Last backup: {lastBackupStr}{nextStr ? ` · ${nextStr}` : ''}</div>
            </div>
            <span style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#9ca3af' : '#6b7280', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600 }}>{healthData?.totalBackups ?? '—'} backups</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: isDark ? '#9ca3af' : '#6b7280' }}>Keeps 5 recent + 1 daily for 7 days. Auto backup every 6 hours.</span>
            <button onClick={handleTriggerBackup} disabled={backingUp} style={{ padding: '0.45rem 1rem', borderRadius: '0.5rem', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', color: '#fff', border: 'none', cursor: backingUp ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: backingUp ? 0.7 : 1 }}>
              {backingUp ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={14} />}
              {backingUp ? 'Backing up...' : 'Backup Now'}
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
                  {['File Name', 'Type', 'Verified', 'Size', 'Created At', 'Actions'].map(h => <th key={h} style={{ padding: '0.5rem 0.75rem', color: isDark ? '#9ca3af' : '#6b7280', fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {isFetchingBackups && !backupsData && <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: isDark ? '#9ca3af' : '#6b7280' }}>Loading…</td></tr>}
                {!isFetchingBackups && (!backupsData?.backups || backupsData.backups.length === 0) && <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: isDark ? '#9ca3af' : '#6b7280' }}>No backups found.</td></tr>}
                {backupsData?.backups?.map(b => (
                  <tr key={b.fileName} style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isDark ? '#e6edf3' : '#111827' }}>{b.fileName}</td>
                    <td style={{ padding: '0.6rem 0.75rem' }}><BackupTypeBadge type={b.type} isDark={isDark} /></td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{b.verified === true ? <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.75rem' }}>✓ OK</span> : b.verified === false ? <span style={{ color: '#f43f5e', fontWeight: 700, fontSize: '0.75rem' }}>✗ Failed</span> : <span style={{ color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.75rem' }}>—</span>}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: isDark ? '#e6edf3' : '#111827' }}>{formatSize(b.sizeBytes)}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: isDark ? '#9ca3af' : '#6b7280', whiteSpace: 'nowrap' }}>{new Date(b.createdAt).toLocaleString()}</td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => setRestoreTarget(b)} style={{ padding: '0.3rem 0.6rem', borderRadius: '0.4rem', background: isDark ? 'rgba(244,63,94,0.12)' : 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.25)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><RotateCcw size={11} /> Restore</button>
                        <a href={`/admin/api/backups/${encodeURIComponent(b.fileName)}/download`} target="_blank" rel="noopener noreferrer" style={{ padding: '0.3rem 0.6rem', borderRadius: '0.4rem', background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#fbbf24' : '#d97706', border: 'none', fontSize: '0.72rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><Download size={11} /> Download</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Backup history */}
          {healthData?.history && healthData.history.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: isDark ? '#9ca3af' : '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent Backup History</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {healthData.history.slice(0, 8).map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.75rem', padding: '0.35rem 0.5rem', borderRadius: '0.4rem', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                    {h.success ? <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span> : <span style={{ color: '#f43f5e', fontWeight: 700 }}>✗</span>}
                    <BackupTypeBadge type={h.type} isDark={isDark} />
                    <span style={{ color: isDark ? '#9ca3af' : '#6b7280', flex: 1 }}>{new Date(h.timestamp).toLocaleString()}</span>
                    {h.sizeBytes && <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>{formatSize(h.sizeBytes)}</span>}
                    {!h.success && h.error && <span style={{ color: '#f43f5e', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Cloud Backup */}
        <CloudBackupSection isDark={isDark} showToast={showToast} />

        {/* Backend Config */}
        <SectionCard title="Backend Configuration" icon={Settings} isDark={isDark} accentColor="#a855f7" span={2}>
          {configLoading ? (
            <div style={{ color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.85rem' }}>Loading configuration...</div>
          ) : (
            <pre style={{ margin: 0, padding: '1rem', background: isDark ? 'rgba(0,0,0,0.3)' : '#f1f5f9', borderRadius: '0.5rem', fontSize: '0.75rem', color: isDark ? '#e6edf3' : '#334155', overflowX: 'auto', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
              {JSON.stringify(configData?.config || {}, null, 2)}
            </pre>
          )}
        </SectionCard>

      </div>
    </div>
  );
}
