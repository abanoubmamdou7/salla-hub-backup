import { useState, useEffect } from 'react';
import Overview   from './pages/Overview';
import Dashboard  from './pages/Dashboard';
import BrandsPage from './pages/BrandsPage';
import ClientsPage from './pages/ClientsPage';
import LogsPage    from './pages/LogsPage';
import LoginPage   from './pages/LoginPage';
import './App.css';

const NAV = [
  {
    section: null,
    items: [
      {
        key: 'overview',
        label: 'Overview',
        icon: (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
        ),
      },
    ],
  },
  {
    section: 'Operations',
    items: [
      {
        key: 'orders',
        label: 'Orders',
        icon: (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
        ),
      },
      {
        key: 'brands',
        label: 'Brands',
        icon: (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
            <line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
        ),
      },
      {
        key: 'logs',
        label: 'Server Logs',
        icon: (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/>
          </svg>
        ),
      },
    ],
  },
  {
    section: 'Admin',
    items: [
      {
        key: 'clients',
        label: 'Clients',
        icon: (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        ),
      },
    ],
  },
];

function getInitialTheme() {
  const saved = localStorage.getItem('salla_hub_theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const IconSun = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
  </svg>
);
const IconMoon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
);

export default function App() {
  const [page, setPage]   = useState('overview');
  const [theme, setTheme] = useState(getInitialTheme);
  const [token, setToken] = useState(() => localStorage.getItem('salla_hub_token') || '');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('salla_hub_theme', theme);
  }, [theme]);

  function toggleTheme() { setTheme(t => (t === 'dark' ? 'light' : 'dark')); }

  function handleLogout() {
    localStorage.removeItem('salla_hub_token');
    setToken('');
  }

  // Auth gate — require login before showing the dashboard.
  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
          </div>
          <div className="sidebar-brand">
            <span className="sidebar-brand-name">Salla Hub</span>
            <span className="sidebar-brand-sub">Integration Platform</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {NAV.map(({ section, items }) => (
            <div key={section ?? '__root'} className="sidebar-group">
              {section && <span className="sidebar-section-label">{section}</span>}
              {items.map((item) => (
                <button
                  key={item.key}
                  className={`sidebar-link${page === item.key ? ' sidebar-link-active' : ''}`}
                  onClick={() => setPage(item.key)}
                >
                  <span className="sidebar-link-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Theme toggle */}
        <button
          className="sidebar-theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="sidebar-theme-icon">{theme === 'dark' ? <IconMoon /> : <IconSun />}</span>
          <span className="sidebar-theme-label">{theme === 'dark' ? 'Dark' : 'Light'} mode</span>
          <span className={`sidebar-theme-switch${theme === 'dark' ? ' on' : ''}`}>
            <span className="sidebar-theme-knob" />
          </span>
        </button>

        {/* Logout */}
        <button className="sidebar-link" onClick={handleLogout} title="Sign out">
          <span className="sidebar-link-icon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </span>
          Sign out
        </button>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-footer-dot" />
          <span className="sidebar-footer-text">Connected to Salla API</span>
        </div>
      </aside>

      <main className="main-content">
        {page === 'overview' && <Overview />}
        {page === 'orders'   && <Dashboard />}
        {page === 'brands'   && <BrandsPage />}
        {page === 'logs'     && <LogsPage />}
        {page === 'clients'  && <ClientsPage />}
      </main>
    </div>
  );
}
