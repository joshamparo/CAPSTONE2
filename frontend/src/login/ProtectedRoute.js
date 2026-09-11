import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

const API_BASE = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE_URL) || 'http://localhost:5000';

function safeGetUser() {
  try {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (error) {
    try {
      // eslint-disable-next-line no-console
      console.error('Failed to parse currentUser from localStorage', error);
    } catch (_) {}
    try { localStorage.removeItem('currentUser'); } catch (_) {}
    return null;
  }
}

function safeNormalizeRole(value) {
  if (value == null) return '';
  const s = String(value);
  return s.trim().toLowerCase();
}

function safeNormalizeArray(value) {
  if (Array.isArray(value)) {
    return value.filter(v => typeof v === 'string' || typeof v === 'number').map(v => String(v).trim().toLowerCase());
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function isSessionTokenExpired(token, nowMs = Date.now()) {
  try {
    const encoded = String(token || '').trim().split('.')[0];
    if (!encoded) return true;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(padded));
    return !Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= Math.floor(nowMs / 1000);
  } catch (_) {
    return true;
  }
}

const ProtectedRoute = ({ children, allowedRoles }) => {
  const user = safeGetUser();
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const userRole = safeNormalizeRole(user?.role);
  const sessionToken = String(user?.sessionToken || '').trim();
  const tokenExpired = Boolean(sessionToken) && isSessionTokenExpired(sessionToken);
  const normalizedRoles = safeNormalizeArray(allowedRoles);

  useEffect(() => {
    if (!tokenExpired) return;
    try { localStorage.removeItem('currentUser'); } catch (_) {}
  }, [tokenExpired]);

  useEffect(() => {
    if (!userRole || userRole === 'patient') return undefined;
    const u = user || {};
    const email = String(u.email || '').trim();

    const payload = {
      id: u.id || u._id || null,
      email: email || null,
      accountType: userRole
    };

    let stopped = false;

    const ping = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`${API_BASE}/api/staff/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
            'x-user-role': userRole,
            ...(email ? { 'x-user-email': email } : {})
          },
          body: JSON.stringify(payload)
        });
        if (response.status === 401 || response.status === 403) {
          try { localStorage.removeItem('currentUser'); } catch (_) {}
          if (!stopped) setSessionInvalid(true);
        }
      } catch (_) {}
    };

    ping();
    const t = setInterval(ping, 20000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [user, userRole, sessionToken]);

  if (!user || !sessionToken || tokenExpired || sessionInvalid) {
    if (user && !sessionToken) {
      try { localStorage.removeItem('currentUser'); } catch (_) {}
    }
    return <Navigate to="/login" replace />;
  }

  if (normalizedRoles.length > 0 && !normalizedRoles.includes(userRole)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
