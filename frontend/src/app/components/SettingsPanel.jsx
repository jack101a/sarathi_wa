import React from 'react';
import { Server, Cpu, HardDrive, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client.js';

function mb(bytes) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '—';
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

export function SettingsPanel({ health, isDark }) {
  const mem  = health?.memory  || {};
  const sess = health?.sessions || [];
  const pages = health?.browserPages || {};

  const uptimeH = Math.floor((health?.uptime || 0) / 3600);
  const uptimeM = Math.floor(((health?.uptime || 0) % 3600) / 60);

  const { data: configData, isLoading } = useQuery({
    queryKey: ['systemConfig'],
    queryFn: () => apiGet('/admin/api/config'),
    staleTime: 60_000,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: isDark ? '#e6edf3' : '#111827' }}>
        System Settings & Health
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        {/* Process info */}
        <SectionCard title="Process" icon={Server} isDark={isDark} accentColor="#6366f1">
          <InfoRow label="Uptime" value={`${uptimeH}h ${uptimeM}m`} isDark={isDark} />
          <InfoRow label="Heap Used"  value={mb(mem.heapUsed)}  isDark={isDark} />
          <InfoRow label="Heap Total" value={mb(mem.heapTotal)} isDark={isDark} />
          <InfoRow label="RSS"        value={mb(mem.rss)}        isDark={isDark} />
          <InfoRow label="External"   value={mb(mem.external)}   isDark={isDark} />
        </SectionCard>

        {/* Browser pages */}
        <SectionCard title="Puppeteer" icon={Cpu} isDark={isDark} accentColor="#06b6d4">
          <InfoRow label="Active Pages" value={`${pages.activePages ?? '—'} / ${pages.maxPages ?? '—'}`} isDark={isDark} />
          <InfoRow label="Waiting"      value={pages.waiting ?? '—'} isDark={isDark} />
        </SectionCard>

        {/* Session pool */}
        <SectionCard title="Session Pool" icon={HardDrive} isDark={isDark} accentColor="#10b981">
          {sess.length === 0 && <p style={{ color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.8rem' }}>No session data</p>}
          {sess.map(s => (
            <div key={s.index} style={{ marginBottom: '0.5rem' }}>
              <InfoRow label={`Slot ${s.index}`} value={
                s.hasSession
                  ? `${s.requestCount} reqs · ${Math.round(s.ageMs / 1000)}s old ${s.refreshing ? '⟳' : '✓'}`
                  : 'No session'
              } isDark={isDark} />
            </div>
          ))}
        </SectionCard>

        {/* Config Viewer */}
        <SectionCard title="Backend Configuration" icon={Settings} isDark={isDark} accentColor="#a855f7" span={2}>
          {isLoading ? (
            <div style={{ color: isDark ? '#9ca3af' : '#6b7280', fontSize: '0.85rem' }}>Loading configuration...</div>
          ) : (
            <pre style={{
              margin: 0, padding: '1rem',
              background: isDark ? 'rgba(0,0,0,0.3)' : '#f1f5f9',
              borderRadius: '0.5rem', fontSize: '0.75rem',
              color: isDark ? '#e6edf3' : '#334155',
              overflowX: 'auto',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
            }}>
              {JSON.stringify(configData?.config || {}, null, 2)}
            </pre>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
