import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { DashboardLayout } from './layout/DashboardLayout.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { LoginPage } from './components/LoginPage.jsx';
import { DashboardPanel } from './components/DashboardPanel.jsx';
import { UsersPanel } from './components/UsersPanel.jsx';
import { PlansPanel } from './components/PlansPanel.jsx';
import { JobsPanel } from './components/JobsPanel.jsx';
import { GroupsPanel } from './components/GroupsPanel.jsx';
import { ActivityPanel } from './components/ActivityPanel.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { QueuesPanel } from './components/QueuesPanel.jsx';
import { ServicesPanel } from './components/ServicesPanel.jsx';

import { useToast } from './hooks/useToast.js';
import { useAdminData } from './hooks/useAdminData.js';
import { useAuth } from './hooks/useAuth.js';
import { useThemeContext } from './context/ThemeContext.jsx';
import { apiGet, ApiError } from '../api/client.js';

// ─── Shared spinner ──────────────────────────────────────────────────────────

function Spinner({ isDark }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem' }}>
      <div style={{
        width: '2rem', height: '2rem', borderRadius: '50%',
        border: `2px solid ${isDark ? '#818cf8' : '#6366f1'}`,
        borderTopColor: 'transparent',
        animation: 'spin 1s linear infinite',
      }} />
    </div>
  );
}

// ─── Auth gate ───────────────────────────────────────────────────────────────
// Calls /admin/api/verify BEFORE rendering any protected content.
// If the session cookie is invalid → redirects to /login immediately.
// Lives inside the /*  route so it never runs when on /login.

function AuthGate({ children, isDark }) {
  const location = useLocation();
  const { isLoading, isError } = useQuery({
    queryKey: ['session-verify'],
    queryFn: () => apiGet('/admin/api/verify'),
    staleTime: 60_000,
    retry: 0,
  });

  if (isLoading) return <Spinner isDark={isDark} />;
  if (isError)   return <Navigate to="/login" state={{ from: location }} replace />;

  return children;
}

// ─── Protected interior ───────────────────────────────────────────────────────
// All data hooks live HERE — so they only fire after AuthGate confirms the session.
// This prevents the 401 → redirect → reload loop on the /login page.

function ProtectedApp({ isDark }) {
  const { toast, showToast } = useToast();
  const { logout: handleLogout } = useAuth();

  const {
    stats, users, waGroups, tgGroups,
    sarathiTracked, vahanTracked,
    recentJobs, queues, plans, services,
    loading, refresh,
  } = useAdminData(showToast);

  // Live health data — polls every 15 seconds
  const { data: healthData } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/admin/api/health'),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 0,
  });

  return (
    <DashboardLayout handleLogout={handleLogout} loading={loading} toast={toast}>
      <Suspense fallback={<Spinner isDark={isDark} />}>
        <Routes>
          <Route path="/"          element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPanel stats={stats} recentJobs={recentJobs} loading={loading} isDark={isDark} />} />
          <Route path="/users"     element={<UsersPanel users={users} plans={plans} sarathiTracked={sarathiTracked} vahanTracked={vahanTracked} isDark={isDark} onRefresh={refresh} showToast={showToast} />} />
          <Route path="/plans"     element={<PlansPanel plans={plans} services={services} isDark={isDark} refresh={refresh} showToast={showToast} />} />
          <Route path="/services"  element={<ServicesPanel services={services} isDark={isDark} refresh={refresh} showToast={showToast} />} />
          <Route path="/jobs"      element={<JobsPanel queues={queues} isDark={isDark} showToast={showToast} />} />
          <Route path="/groups"    element={<GroupsPanel isDark={isDark} showToast={showToast} />} />
          <Route path="/activity"  element={<ActivityPanel users={users} isDark={isDark} showToast={showToast} />} />
          <Route path="/queues"    element={<Navigate to="/jobs" replace />} />
          <Route path="/settings"  element={<SettingsPanel health={healthData} isDark={isDark} showToast={showToast} />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}

// ─── Root app ─────────────────────────────────────────────────────────────────

export function App() {
  const { isDark } = useThemeContext();

  return (
    <ErrorBoundary>
      <Routes>
        {/* Public route — no auth check */}
        <Route path="/login" element={<LoginPage isDark={isDark} />} />

        {/* All other routes — verified by AuthGate, then rendered by ProtectedApp */}
        <Route path="/*" element={
          <AuthGate isDark={isDark}>
            <ProtectedApp isDark={isDark} />
          </AuthGate>
        } />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
