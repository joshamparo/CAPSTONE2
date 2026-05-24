import React from 'react';
import { useNavigate } from 'react-router-dom';

function StaffDashboard() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Staff Dashboard</h1>
      <p>Welcome to the Staff Portal.</p>
      <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#fdf2f8', borderRadius: '8px' }}>
        <h3>Today's Tasks</h3>
        <p>No tasks assigned yet.</p>
      </div>
      <button 
        onClick={handleLogout}
        style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#ea580c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        Logout
      </button>
    </div>
  );
}

export default StaffDashboard;