import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchBootstrap, fetchQueues, queryKeys } from '../../api/queries.js';
import { ApiError } from '../../api/client.js';

export function useAdminData(showToast) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Setup Server-Sent Events listener for real-time dashboard updates
  useEffect(() => {
    // Determine path, prefixing /admin if we are subrouted under it
    const ssePath = '/admin/api/events';
    const eventSource = new EventSource(ssePath);

    let debounceTimer = null;

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'job_created' || payload.event === 'job_updated') {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
            queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
            queryClient.invalidateQueries({ queryKey: ['filteredJobs'] });
            queryClient.invalidateQueries({ queryKey: queryKeys.queues });
          }, 500);
        }
      } catch (err) {
        console.error('[SSE] Failed parsing event data:', err);
      }
    };

    eventSource.onerror = () => {
      // EventSource automatically reconnects on error
    };

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      eventSource.close();
    };
  }, [queryClient]);
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

  const queues = useQuery({
    queryKey: queryKeys.queues,
    queryFn: fetchQueues,
    staleTime: 5_000,
    refetchInterval: 10_000,
    enabled: !!bootstrap.data,
    initialData: () => {
      const bData = queryClient.getQueryData(queryKeys.bootstrap);
      return bData ? bData.queues : undefined;
    },
    retry: 0,
  });

  // Handle 401 — redirect to login (React Query v5 removed onError option)
  useEffect(() => {
    if (bootstrap.isError) {
      const err = bootstrap.error;
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login', { replace: true });
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
    recentJobs:     data.recentJobs     || [],
    queues:         queues.data         || data.queues || { api: {}, browser: {} },
    plans:          data.plans          || [],
    services:       data.services       || [],
    priceOverrides: data.priceOverrides || [],
    rateLimitConfig: data.rateLimitConfig || { plans: {}, creditCost: {} },
    loading,
    refresh() {
      bootstrap.refetch();
      queues.refetch();
    },
  };
}
