import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, MapPin, Activity,
  Settings, Sun, Moon, LogOut, Menu, X, Bot,
  Gauge, Briefcase, UsersRound, ScrollText, Shield, Layers,
  CreditCard,
} from 'lucide-react';
import { useThemeContext } from '../context/ThemeContext.jsx';

const NAV_ITEMS = [
  { path: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { path: '/users',       label: 'Users',       icon: Users },
  { path: '/plans',       label: 'Plans',       icon: Shield },
  { path: '/services',    label: 'Services',    icon: Layers },
  { path: '/jobs',        label: 'Jobs',        icon: Briefcase },
  { path: '/queues',      label: 'Queues',      icon: Activity },
  { path: '/groups',      label: 'Groups',      icon: UsersRound },
  { path: '/activity',    label: 'Activity',    icon: ScrollText },
  { path: '/payments',    label: 'Billing',     icon: CreditCard },
  { path: '/settings',    label: 'Settings',    icon: Settings },
];

export function Sidebar({ handleLogout }) {
  const { isDark, toggleDark, t_textHeading, t_textMuted, glassNav, glassPanel } = useThemeContext();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const closeMobile = () => setMobileMenuOpen(false);

  const navClass = ({ isActive }) =>
    `text-sm font-medium transition-colors flex items-center gap-2 rounded px-1 py-0.5 ${
      isActive ? t_textHeading : `${t_textMuted} hover:text-indigo-500`
    }`;

  const navStyle = isDark
    ? { background: 'rgba(13,17,23,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)' }
    : { background: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(0,0,0,0.06)', backdropFilter: 'blur(20px)' };

  return (
    <>
      <nav className="sticky top-0 z-50 transition-colors duration-500" style={navStyle}>
        <div className="max-w-7xl mx-auto px-4" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div className="flex items-center justify-between" style={{ height: '4rem' }}>
            {/* Logo */}
            <NavLink to="/dashboard" className="flex items-center gap-3" aria-label="Sarathi Admin Home">
              <div style={{
                width: '2rem', height: '2rem', borderRadius: '0.5rem',
                background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
              }}>
                <Bot size={16} color="white" />
              </div>
              <span className="text-xl font-bold tracking-tight" style={{ color: isDark ? '#e6edf3' : '#111827' }}>
                sarathi<span style={{ color: '#6366f1' }}>admin</span>
              </span>
            </NavLink>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-6">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} to={path} className={navClass}>
                  <Icon size={16} /> {label}
                </NavLink>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button onClick={toggleDark}
                aria-label="Toggle theme"
                style={{ padding: '0.5rem', borderRadius: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#fbbf24' : '#475569' }}
                title="Toggle theme">
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <button onClick={handleLogout}
                aria-label="Logout"
                style={{ padding: '0.5rem', borderRadius: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280' }}
                title="Logout">
                <LogOut size={20} />
              </button>
              <button onClick={() => setMobileMenuOpen(true)}
                aria-label="Open mobile menu"
                className="md:hidden"
                style={{ padding: '0.5rem', borderRadius: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280' }}>
                <Menu size={20} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={closeMobile} />
          <div className="fixed top-0 right-0 z-50 h-full" style={{
            width: '16rem',
            background: isDark ? 'rgba(13,17,23,0.98)' : 'rgba(255,255,255,0.98)',
            borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
            backdropFilter: 'blur(20px)',
            overflowY: 'auto',
          }}>
            <div className="flex items-center justify-between p-4" style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
              <span className="text-sm font-bold" style={{ color: isDark ? '#e6edf3' : '#111827' }}>Navigation</span>
              <button onClick={closeMobile} aria-label="Close mobile menu" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280' }}>
                <X size={20} />
              </button>
            </div>
            <div className="p-2 space-y-1">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
                const active = location.pathname === path;
                return (
                  <NavLink key={path} to={path} onClick={closeMobile}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.625rem 0.75rem', borderRadius: '0.5rem',
                      fontSize: '0.875rem', fontWeight: 500,
                      textDecoration: 'none',
                      background: active ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
                      color: active ? (isDark ? '#e6edf3' : '#111827') : (isDark ? '#9ca3af' : '#6b7280'),
                    }}>
                    <Icon size={18} /> {label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
