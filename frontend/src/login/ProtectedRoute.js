import { useEffect } from 'react';
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

const ProtectedRoute = ({ children, allowedRoles }) => {
  const user = safeGetUser();
  const userRole = safeNormalizeRole(user?.role);
  const normalizedRoles = safeNormalizeArray(allowedRoles);

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
        await fetch(`${API_BASE}/api/staff/heartbeat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-role': userRole,
            ...(email ? { 'x-user-email': email } : {})
          },
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    };

    ping();
    const t = setInterval(ping, 20000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [user, userRole]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (normalizedRoles.length > 0 && !normalizedRoles.includes(userRole)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
