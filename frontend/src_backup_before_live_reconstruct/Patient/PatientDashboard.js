import React from 'react';
import { useNavigate } from 'react-router-dom';

function PatientDashboard() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Patient Dashboard</h1>
      <p>Welcome to the Patient Portal.</p>
      <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#f0f9ff', borderRadius: '8px' }}>
        <h3>Your Appointments</h3>
        <p>No upcoming appointments.</p>
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

export default PatientDashboard;