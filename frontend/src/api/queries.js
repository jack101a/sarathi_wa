import { apiGet } from './client.js';

export const queryKeys = {
  bootstrap:       ['bootstrap'],
  jobs:            ['jobs'],
  queues:          ['queues'],
  health:          ['health'],
  rateLimitConfig: ['rateLimitConfig'],
  statsSummary:    ['statsSummary'],
  groups:          ['groups'],
  activity:        ['activity'],
  plans:           ['plans'],
  backups:         ['backups'],
  services:        ['services'],
  pricingOverrides:['pricingOverrides'],
};

export async function fetchBootstrap() { return apiGet('/admin/api/bootstrap'); }
export async function fetchJobs(limit = 100) { return apiGet(`/admin/api/jobs?limit=${limit}`); }
export async function fetchQueues() { return apiGet('/admin/api/queues'); }
export async function fetchHealth() { return apiGet('/admin/api/health'); }
export async function fetchRateLimitConfig() { return apiGet('/admin/api/rate-limits/config'); }
export async function fetchUserRateUsage(userId) { return apiGet(`/admin/api/rate-limits/usage/${encodeURIComponent(userId)}`); }
export async function fetchUserCreditHistory(phone) { return apiGet(`/admin/api/users/${encodeURIComponent(phone)}/credit-history`); }
export async function fetchJobDetail(jobId) { return apiGet(`/admin/api/jobs/${encodeURIComponent(jobId)}`); }
export async function fetchGroups() { return apiGet('/admin/api/groups'); }
export async function fetchStatsSummary() { return apiGet('/admin/api/stats/summary'); }
export async function fetchPlans() { 
  const res = await apiGet('/admin/api/plans');
  return res.plans || [];
}

export async function fetchFilteredJobs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.user_id) params.set('user_id', filters.user_id);
  if (filters.command) params.set('command', filters.command);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', String(filters.limit || 100));
  return apiGet(`/admin/api/jobs?${params.toString()}`);
}

export async function fetchActivity(filters = {}) {
  const params = new URLSearchParams();
  if (filters.user_id) params.set('user_id', filters.user_id);
  if (filters.category) params.set('category', filters.category);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('limit', String(filters.limit || 200));
  return apiGet(`/admin/api/activity?${params.toString()}`);
}

export async function fetchBackups() { return apiGet('/admin/api/backups'); }

export async function fetchServices() {
  const res = await apiGet('/admin/api/services');
  return res.services || [];
}

export async function fetchPricingOverrides() {
  const res = await apiGet('/admin/api/pricing-overrides');
  return res.overrides || [];
}
