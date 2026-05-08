import { apiGet } from './client.js';

export const queryKeys = {
  bootstrap: ['bootstrap'],
  jobs:      ['jobs'],
  queues:    ['queues'],
  health:    ['health'],
};

export async function fetchBootstrap() {
  return apiGet('/admin/api/bootstrap');
}

export async function fetchJobs(limit = 100) {
  return apiGet(`/admin/api/jobs?limit=${limit}`);
}

export async function fetchQueues() {
  return apiGet('/admin/api/queues');
}

export async function fetchHealth() {
  return apiGet('/admin/api/health');
}
