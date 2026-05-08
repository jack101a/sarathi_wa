import { useCallback } from 'react';
import { apiPostJson } from '../../api/client.js';

export function useAuth() {
  const logout = useCallback(async () => {
    try {
      await apiPostJson('/admin/api/logout', {});
    } finally {
      window.location.assign('/admin/login');
    }
  }, []);

  return { logout };
}
