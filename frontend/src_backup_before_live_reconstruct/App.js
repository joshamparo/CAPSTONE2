import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Import your components
import HomePage from './homepage/HomePage';
import Login from './login/Login';
import OtpPage from './login/OtpPage';
import AdminDashboard from './Admin/AdminDashboard';
import PatientDashboard from './Patient/PatientDashboard';
import StaffDashboard from './Staff/StaffDashboard';
import NurseDashboard from './Nurse/NurseDashboard';
import DoctorDashboard from './Doctor/DoctorDashboard';
import Recovery from './login/Recovery';
import ResetPassword from './login/ResetPassword';
import Appointment from './appointment/Appointment';

function App() {
  return (
    <Router>
      <div className="App">
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
          <Route path="/admin" element={<AdminDashboard />} />

          {/* User Dashboards */}
          <Route path="/patient" element={<PatientDashboard />} />
          <Route path="/staff" element={<StaffDashboard />} />
          <Route path="/nurse" element={<NurseDashboard />} />
          <Route path="/doctor" element={<DoctorDashboard />} />

          {/* Redirect any unknown paths to Home */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
