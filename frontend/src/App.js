import React, { Component, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ServerCrash, X, Clock, RefreshCw, Home as HomeIcon } from 'lucide-react';
// Auth Wrapper
import ProtectedRoute from './login/ProtectedRoute';
// Import your components
import HomePage from './homepage/HomePage';
import Login from './login/Login';
import OtpPage from './login/OtpPage';
import AdminDashboard from './Admin/AdminDashboard';
import PatientDashboard from './Patient/PatientDashboard';
import StaffDashboard from './Staff/StaffDashboard';
import NurseDashboard from './Nurse/NurseDashboard';
import DoctorDashboard from './Doctor/DoctorDashboard';
import PharmacistDashboard from './Pharmacist/PharmacistDashboard';
import CashierDashboard from './Cashier/CashierDashboard';
import DoctorSecretaryDashboard from './DoctorSecretary/DoctorSecretaryDashboard';
import MedtechDashboard from './ClinicalStaff/MedtechDashboard';
import RadiographerDashboard from './ClinicalStaff/RadiographerDashboard';
import EcgOperatorDashboard from './ClinicalStaff/EcgOperatorDashboard';
import PhysicalTherapistDashboard from './ClinicalStaff/PhysicalTherapistDashboard';
import Recovery from './login/Recovery';
import ResetPassword from './login/ResetPassword';
import Appointment from './appointment/Appointment';
import AssistantWidget from './components/AssistantWidget';

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '', errorInfo: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || String(error || 'Unexpected error') };
  }

  componentDidCatch(error, info) {
    try {
      // eslint-disable-next-line no-console
      console.error('[AppErrorBoundary] caught:', error, info);
      this.setState({ errorInfo: info?.componentStack || '' });
    } catch (_) {}
  }

  handleReset() {
    try { window.sessionStorage.clear(); } catch (_) {}
    try { window.localStorage.removeItem('currentUser'); } catch (_) {}
    this.setState({ hasError: false, errorMessage: '', errorInfo: '' });
    setTimeout(() => { try { window.location.href = '/'; } catch (_) {} }, 250);
  }

  handleReload() {
    try { window.location.reload(); } catch (_) {}
  }

  render() {
    if (this.state.hasError) {
      const msg = String(this.state.errorMessage || 'Something went wrong while loading this page.').slice(0, 260);
      return (
        <div style={{
          minHeight: '100vh', background: '#f8fafc', color: '#0f172a',
          fontFamily: 'Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
        }}>
          <div style={{
            maxWidth: 560, width: '100%', borderRadius: 18, background: '#ffffff',
            boxShadow: '0 22px 70px rgba(15,23,42,.10)', border: '1px solid #e2e8f0', padding: 28
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{
                width: 44, height: 44, borderRadius: 12, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'rgba(234,88,12,0.12)', color: '#ea580c'
              }}><AlertTriangle size={20} /></span>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#9a3412', letterSpacing: '.2px' }}>
                  PASCUALINGA MEDICAL LINK
                </div>
                <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Something came up</h1>
              </div>
            </div>
            <p style={{ margin: '8px 0 14px', fontSize: '.92rem', color: '#334155', lineHeight: 1.6 }}>
              The page hit a temporary issue and stopped rendering. This usually fixes itself after a quick reset.
              Try the actions below in order.
            </p>
            <div style={{
              background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12,
              padding: '10px 12px', marginBottom: 18, fontSize: '.85rem', color: '#7c2d12'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Error details</div>
              <code style={{ wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                {msg}
              </code>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                onClick={() => this.handleReset()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg,#ea580c,#c2410c)', color: '#fff',
                  fontWeight: 600, fontSize: '.9rem', boxShadow: '0 10px 24px rgba(234,88,12,.22)'
                }}>
                <RefreshCw size={14} /> Reset session
              </button>
              <a href="/" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 10, textDecoration: 'none',
                background: '#f1f5f9', color: '#0f172a', fontWeight: 600, fontSize: '.9rem'
              }}>
                <HomeIcon size={14} /> Go to homepage
              </a>
              <button
                onClick={() => this.handleReload()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', borderRadius: 10, border: '1px solid #cbd5e1', cursor: 'pointer',
                  background: '#ffffff', color: '#0f172a', fontWeight: 600, fontSize: '.9rem'
                }}>
                Reload page
              </button>
            </div>
            <div style={{ marginTop: 18, fontSize: '.78rem', color: '#64748b' }}>
              If this keeps happening, please clear your browser storage and try logging in again.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const fetchJsonSimple = async (url, opts = {}) => {
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: opts.credentials !== false ? 'include' : 'omit'
    });
    if (!r.ok) return { __ok: false, status: r.status };
    const ctype = r.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const j = await r.json();
      return typeof j === 'object' && j ? Object.assign({ __ok: true, status: r.status }, j) : { __ok: true, status: r.status, data: j };
    }
    return { __ok: true, status: r.status, _text: await r.text().catch(() => '') };
  } catch (e) {
    return { __ok: false, __err: String(e?.message || 'Network error'), status: 0 };
  }
};

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname || '/';
  const hideAssistant = ['/login', '/otp', '/recovery', '/reset-password'].includes(pathname);
  const isAuthRoute = ['/', '/login', '/otp', '/recovery', '/reset-password'].includes(pathname);

  useEffect(() => {
    try {
      const key = 'pascualinga_404_restore_path';
      const pending = window.sessionStorage.getItem(key);
      if (pending && typeof pending === 'string' && pending !== '/') {
        window.sessionStorage.removeItem(key);
        if (pending !== pathname) {
          navigate(pending, { replace: true });
        }
        return;
      }
      const q = new URLSearchParams(window.location.search);
      if (q.get('p404') === '1') {
        const target = window.sessionStorage.getItem(key) || '/';
        window.sessionStorage.removeItem(key);
        if (target && target !== pathname) {
          navigate(target, { replace: true });
        }
      }
    } catch (_) {}
  }, [navigate, pathname]);

  const [backendDown, setBackendDown] = useState(() => {
    try { return localStorage.getItem('app_global_be_down') === '1'; } catch (_) { return false; }
  });
  const [backendError, setBackendError] = useState(() => {
    try { return localStorage.getItem('app_global_be_err') || ''; } catch (_) { return ''; }
  });
  const [maintenanceMode, setMaintenanceMode] = useState(() => {
    try { return localStorage.getItem('app_global_maint') === '1'; } catch (_) { return false; }
  });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [bannerDismissedForKey, setBannerDismissedForKey] = useState('');
  const [lastCheckedAt, setLastCheckedAt] = useState(0);

  // Auto-dismiss reset: if backend/maintenance combo CHANGES (maint→down or down→maint or state toggle on/off)
  // re-show banner (was hidden forever after user X before this fix)
  useEffect(() => {
    const currentKey = `${backendDown ? 'D' : '0'}${maintenanceMode ? 'M' : '0'}`;
    if (bannerDismissedForKey !== currentKey && bannerDismissedForKey) {
      setBannerDismissed(false);
      setBannerDismissedForKey(currentKey);
    } else if (!bannerDismissedForKey) {
      setBannerDismissedForKey(currentKey);
    }
  }, [backendDown, maintenanceMode, bannerDismissedForKey]);

  const runSystemHealthCheck = useMark => new Promise((resolve) => {
    const t0 = Date.now();
    const API_BASE = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) ? String(process.env.REACT_APP_API_URL).replace(/\/+$/, '') : '';
    const healUrl = API_BASE ? `${API_BASE}/api/health` : '/api/health';
    const settsUrl = API_BASE ? `${API_BASE}/api/system-settings/public` : '/api/system-settings/public';
    Promise.allSettled([fetchJsonSimple(healUrl, { credentials: false }), fetchJsonSimple(settsUrl, { credentials: false })]).then((arr) => {
      const [hr, sr] = arr;
      const hOk = hr.status === 'fulfilled' && hr.value && hr.value.__ok;
      const sOk = sr.status === 'fulfilled' && sr.value && sr.value.__ok;
      const beDown = !hOk && !sOk;
      const beErr = (hr.status === 'fulfilled' && hr.value && hr.value.__err) || (sr.status === 'fulfilled' && sr.value && sr.value.__err) || (hOk ? '' : 'Server unreachable.');
      const maint = Boolean(sr.status === 'fulfilled' && sr.value && (sr.value.maintenanceMode || sr.value.data?.maintenanceMode));
      try {
        localStorage.setItem('app_global_be_down', beDown ? '1' : '0');
        if (beErr) localStorage.setItem('app_global_be_err', String(beErr).slice(0, 220));
        else localStorage.removeItem('app_global_be_err');
        localStorage.setItem('app_global_maint', maint ? '1' : '0');
      } catch (_) {}
      setBackendDown(beDown);
      setBackendError(String(beErr || ''));
      setMaintenanceMode(maint);
      setLastCheckedAt(t0);
      if (typeof useMark === 'object' && useMark && useMark.current) useMark.current = t0;
      resolve({ beDown, maint, beErr });
    });
  });

  useEffect(() => {
    // First run immediately
    const mark = { current: 0 };
    runSystemHealthCheck(mark);
    // Poll every 15 seconds
    const intv = setInterval(() => {
      runSystemHealthCheck({ current: 0 });
    }, 15000);
    const onLine = () => runSystemHealthCheck({ current: 0 });
    try { window.addEventListener('online', onLine); } catch (_) {}
    return () => {
      clearInterval(intv);
      try { window.removeEventListener('online', onLine); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBanner = !bannerDismissed && !isAuthRoute && (maintenanceMode || backendDown);

  return (
    <div className="App">
      {showBanner && (
        <div
          role="alert"
          aria-live="polite"
          className={`app-global-status ${backendDown ? 'app-global-down' : 'app-global-maint'}`}
          style={{
            position: 'sticky', top: 0, zIndex: 99999,
            width: '100%',
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: '0.82rem', fontWeight: 600,
            color: backendDown ? '#7f1d1d' : '#78350f',
            background: backendDown ? 'linear-gradient(90deg,#fee2e2,#fecaca)' : 'linear-gradient(90deg,#fff7ed,#fed7aa)',
            borderBottom: `1px solid ${backendDown ? '#fca5a5' : '#fdba74'}`,
            boxShadow: '0 2px 12px rgba(15,23,42,0.06)'
          }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: 14,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: backendDown ? 'rgba(220,38,38,0.12)' : 'rgba(234,88,12,0.14)',
            color: backendDown ? '#dc2626' : '#ea580c',
            flex: '0 0 auto'
          }}>
            {backendDown ? <ServerCrash size={14} /> : <AlertTriangle size={14} />}
          </span>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 800, fontSize: '0.84rem' }}>
              {backendDown
                ? '⚠️ Hospital Backend Currently Unreachable'
                : '🛠 Maintenance Mode ACTIVE — IT is performing system updates'}
            </div>
            <div style={{ fontWeight: 500, opacity: 0.92, marginTop: 2 }}>
              {backendDown
                ? `${backendError || 'Network or server error.'} ${' '}Please wait 2-5 minutes, refresh once, or contact IT. DO NOT submit critical records right now — duplicates or data loss may occur until services are back online.`
                : 'Access to dashboards is read-only during this window. Please finish current tasks open then avoid submitting new records until the banner is removed. ETA: ~10-20 minutes.'}
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
            <span
              title={`Last checked ${lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : '—'}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: backendDown ? '#991b1b' : '#92400e', fontWeight: 700, opacity: 0.85 }}
            >
              <Clock size={10} /> {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
            </span>
            <button
              type="button"
              onClick={() => {
                setBannerDismissed(true);
                setBannerDismissedForKey(`${backendDown ? 'D' : '0'}${maintenanceMode ? 'M' : '0'}`);
              }}
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'transparent', border: 'none',
                cursor: 'pointer',
                color: backendDown ? '#991b1b' : '#92400e',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
              }}
              title="Dismiss banner (refreshes if status changes)"
              aria-label="Dismiss system status banner"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<Login />} />
        
        {/* Verification Route */}
        <Route path="/otp" element={<OtpPage />} />

        {/* Account Recovery */}
        <Route path="/recovery" element={<Recovery />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Admin Dashboard Route */}
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute allowedRoles={['admin', 'staff']}>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />

        {/* User Dashboards */}
        <Route 
          path="/patient" 
          element={
            <ProtectedRoute allowedRoles={['patient']}>
              <PatientDashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/staff" 
          element={
            <ProtectedRoute allowedRoles={['staff']}>
              <StaffDashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/nurse" 
          element={
            <ProtectedRoute allowedRoles={['nurse']}>
              <NurseDashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/doctor" 
          element={
            <ProtectedRoute allowedRoles={['doctor']}>
              <DoctorDashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/pharmacist" 
          element={
            <ProtectedRoute allowedRoles={['pharmacist']}>
              <PharmacistDashboard />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/cashier" 
          element={
            <ProtectedRoute allowedRoles={['cashier']}>
              <CashierDashboard />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/doctor-secretary" 
          element={
            <ProtectedRoute allowedRoles={['doctor_secretary']}>
              <DoctorSecretaryDashboard />
            </ProtectedRoute>
          } 
        />

        <Route
          path="/medtech"
          element={
            <ProtectedRoute allowedRoles={['medtech']}>
              <MedtechDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/radiographer"
          element={
            <ProtectedRoute allowedRoles={['radiographer']}>
              <RadiographerDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ecg"
          element={
            <ProtectedRoute allowedRoles={['ecg_operator']}>
              <EcgOperatorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pt"
          element={
            <ProtectedRoute allowedRoles={['physical_therapist']}>
              <PhysicalTherapistDashboard />
            </ProtectedRoute>
          }
        />


        {/* Redirect any unknown paths to Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!hideAssistant ? <AssistantWidget pathname={pathname} /> : null}
    </div>
  );
}


function App() {
  return (
    <Router>
      <AppErrorBoundary>
        <AppShell />
      </AppErrorBoundary>
    </Router>
  );
}

export default App;
