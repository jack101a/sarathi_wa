import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBootstrap, fetchJobs, fetchQueues, fetchPlans, fetchServices, queryKeys } from '../../api/queries.js';
import { ApiError } from '../../api/client.js';

export function useAdminData(showToast) {
  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: fetchBootstrap,
    staleTime: 15_000,
    retry: (failureCount, err) => {
      // Don't retry on 401 — redirect immediately
      if (err instanceof ApiError && err.status === 401) return false;
      return failureCount < 1;
    },
  });

  const jobs = useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => fetchJobs(50),
    staleTime: 10_000,
    retry: 0,
  });

  const queues = useQuery({
    queryKey: queryKeys.queues,
    queryFn: fetchQueues,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 0,
  });

  const plansQuery = useQuery({
    queryKey: queryKeys.plans,
    queryFn: fetchPlans,
    staleTime: 60_000,
    retry: 0,
  });

  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: fetchServices,
    staleTime: 60_000,
    retry: 0,
  });

  // Handle 401 — redirect to login (React Query v5 removed onError option)
  useEffect(() => {
    if (bootstrap.isError) {
      const err = bootstrap.error;
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/admin/login');
      } else {
        showToast && showToast('Failed to load dashboard data — ' + (err?.message || 'unknown error'), 'error');
      }
    }
  }, [bootstrap.isError, bootstrap.error]);

  const loading = bootstrap.isLoading;
  const data = bootstrap.data || {};

  return {
    stats:          data.stats          || {},
    users:          data.users          || [],
    waGroups:       data.waGroups       || [],
    tgGroups:       data.tgGroups       || [],
    sarathiTracked: data.sarathiTracked || [],
    vahanTracked:   data.vahanTracked   || [],
    recentJobs:     (jobs.data && jobs.data.jobs) || data.recentJobs || [],
    queues:         (queues.data) || data.queues || { api: {}, browser: {} },
    plans:          plansQuery.data     || [],
    services:       servicesQuery.data  || data.services     || [],
    rateLimitConfig: data.rateLimitConfig || { plans: {}, creditCost: {} },
    loading,
    refresh() {
      bootstrap.refetch();
      jobs.refetch();
      queues.refetch();
      plansQuery.refetch();
      servicesQuery.refetch();
    },
  };
}
