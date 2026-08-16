import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ServerCrash, X, Clock } from 'lucide-react';
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
      <AppShell />
    </Router>
  );
}

export default App;
