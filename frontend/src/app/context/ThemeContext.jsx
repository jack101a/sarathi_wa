import { createContext, useContext } from 'react';
import { useTheme } from '../hooks/useTheme.js';

const ThemeContext = createContext(null);

export function ThemeProvider({ isDark, setIsDark, children }) {
  const themeClasses = useTheme(isDark);
  const toggleDark = () => setIsDark(!isDark);
  return (
    <ThemeContext.Provider value={{ isDark, toggleDark, ...themeClasses }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}
