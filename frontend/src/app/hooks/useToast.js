import { useState, useCallback } from 'react';

export function useToast() {
  const [toast, setToast] = useState({ message: '', type: 'success' });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: 'success' }), 3000);
  }, []);

  return { toast, showToast };
}
