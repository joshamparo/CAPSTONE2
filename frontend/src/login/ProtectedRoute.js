import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const ProtectedRoute = ({ children, allowedRoles }) => {
  let user = null;
  try {
    // Attempt to get the user session from localStorage
    user = JSON.parse(localStorage.getItem('currentUser'));
  } catch (error) {
    console.error("Failed to parse currentUser from localStorage", error);
  }

  useEffect(() => {
    const u = user || {};
    const role = String(u.role || '').toLowerCase();
    if (!role || role === 'patient') return undefined;
    const email = String(u.email || '').trim();

    const payload = {
      id: u.id || u._id || null,
      email: email || null,
      accountType: role
    };

    let stopped = false;

    const ping = async () => {
      if (stopped) return;
      try {
        await fetch(`${API_BASE}/api/staff/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': role, ...(email ? { 'x-user-email': email } : {}) },
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
  }, [user]);

  if (!user) {
    // If no user is logged in, redirect them to the login page.
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // If the user is logged in but doesn't have the required role, redirect them to the homepage.
    return <Navigate to="/" replace />;
  }

  // If the user is logged in and has the correct role, show them the page.
  return children;
};

export default ProtectedRoute;
