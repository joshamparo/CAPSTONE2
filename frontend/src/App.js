import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';

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

function AppShell() {
  const location = useLocation();
  const pathname = location.pathname || '/';
  const hideAssistant = ['/login', '/otp', '/recovery', '/reset-password'].includes(pathname);

  return (
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
