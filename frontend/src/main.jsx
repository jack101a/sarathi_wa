import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App.jsx';
import { ThemeProvider } from './app/context/ThemeContext.jsx';
import './styles/globals.css';

const THEME_KEY = 'sarathi_admin_theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Root() {
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) !== 'light'; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light'); } catch {}
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  return (
    <ThemeProvider isDark={isDark} setIsDark={setIsDark}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/admin">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
