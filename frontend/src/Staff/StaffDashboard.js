import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountHeaderActions from '../components/AccountHeaderActions';

function StaffDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    try {
      setUser(JSON.parse(localStorage.getItem('currentUser') || 'null'));
    } catch (_) {
      setUser(null);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  return (
    <div style={{ padding: 'clamp(14px, 3vw, 26px)', fontFamily: 'Arial, sans-serif', width: '100%', margin: '0 auto', maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <img src="/images/pgh%20logo.png" alt="PASCUALINGA" style={{ width: 34, height: 34, objectFit: 'contain' }} />
            <div style={{ fontWeight: 1000, letterSpacing: '-0.02em', fontSize: 16, lineHeight: 1 }}>PASCUALINGA</div>
          </div>
          <h1 style={{ margin: 0 }}>Staff Dashboard</h1>
          <p style={{ margin: '6px 0 0', color: '#64748b' }}>Welcome to the Staff Portal.</p>
        </div>
        <AccountHeaderActions user={user} roleLabel="Staff" onSignOut={handleLogout} />
      </div>
      <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#fdf2f8', borderRadius: '8px' }}>
        <h3>Today's Tasks</h3>
        <p>No tasks assigned yet.</p>
      </div>
    </div>
  );
}

export default StaffDashboard;
