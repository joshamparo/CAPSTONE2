import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountHeaderActions from '../components/AccountHeaderActions';
import { checkBackendHealth, fetchJson } from '../utils/api';
import { supabase } from '../lib/supabaseClient'; // Added Supabase import for video calls

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function PatientDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });
  const [patientProfile, setPatientProfile] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState('');
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingMode, setBookingMode] = useState('choose');
  const [bookingSpecialization, setBookingSpecialization] = useState('');
  const [bookingDoctorId, setBookingDoctorId] = useState('');
  const [bookingDoctorName, setBookingDoctorName] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingSlots, setBookingSlots] = useState([]);
  const [bookingLoadingSlots, setBookingLoadingSlots] = useState(false);
  const [bookingSelectedSlot, setBookingSelectedSlot] = useState(null);
  const [bookingError, setBookingError] = useState('');
  const [bookingCheckoutUrl, setBookingCheckoutUrl] = useState('');
  const [bookingDoctors, setBookingDoctors] = useState([]);
  const [bookingLoadingDoctors, setBookingLoadingDoctors] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoMeetingUrl, setVideoMeetingUrl] = useState('');
  const [videoMeetingTitle, setVideoMeetingTitle] = useState('');
  const [onsiteOpen, setOnsiteOpen] = useState(false);
  const [onsiteSpecialization, setOnsiteSpecialization] = useState('');
  const [onsiteQuery, setOnsiteQuery] = useState('');
  const [onsiteDoctors, setOnsiteDoctors] = useState([]);
  const [onsiteLoadingDoctors, setOnsiteLoadingDoctors] = useState(false);
  const [onsiteDoctorId, setOnsiteDoctorId] = useState('');
  const [onsiteDoctorName, setOnsiteDoctorName] = useState('');
  const [onsiteMonth, setOnsiteMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [onsiteMonthDays, setOnsiteMonthDays] = useState(new Map());
  const [onsiteLoadingMonth, setOnsiteLoadingMonth] = useState(false);
  const [onsiteSelectedDate, setOnsiteSelectedDate] = useState('');
  const [onsiteSlots, setOnsiteSlots] = useState([]);
  const [onsiteLoadingSlots, setOnsiteLoadingSlots] = useState(false);
  const [onsiteSelectedTime, setOnsiteSelectedTime] = useState('');
  const [onsiteTimePreference, setOnsiteTimePreference] = useState('any');
  const [onsiteReason, setOnsiteReason] = useState('');
  const [onsitePhone, setOnsitePhone] = useState('');
  const [onsiteSubmitting, setOnsiteSubmitting] = useState(false);
  const [onsiteError, setOnsiteError] = useState('');
  const [onsiteSuccess, setOnsiteSuccess] = useState('');
  const [labResults, setLabResults] = useState([]);
  const [expandedLabResultId, setExpandedLabResultId] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [recordsError, setRecordsError] = useState('');

  useEffect(() => {
    try {
      setUser(JSON.parse(localStorage.getItem('currentUser') || 'null'));
    } catch (_) {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const r = await checkBackendHealth(API_BASE);
      if (cancelled) return;
      setBackendHealth({ checked: true, ok: r.ok, error: r.ok ? '' : (r.error || 'Backend offline') });
    };
    run();
    const t = setInterval(run, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const resolvedPatientId = useMemo(() => {
    const candidates = [
      patientProfile?.id,
      patientId,
      user?.patientId,
      user?.id,
      user?._id
    ];
    return candidates.find((value) => UUID_PATTERN.test(String(value || '').trim())) || null;
  }, [patientProfile?.id, patientId, user]);

  const getAuthHeaders = () => {
    const email = String(user?.email || '').trim();
    const name = String(user?.name || '').trim();
    return {
      'x-user-role': 'patient',
      ...(email ? { 'x-user-email': email } : {}),
      ...(name ? { 'x-user-name': name } : {}),
      ...(resolvedPatientId ? { 'x-patient-id': resolvedPatientId } : {})
    };
  };

  const resetBooking = () => {
    setBookingMode('choose');
    setBookingSpecialization('');
    setBookingDoctorId('');
    setBookingDoctorName('');
    setBookingDate('');
    setBookingSlots([]);
    setBookingSelectedSlot(null);
    setBookingError('');
    setBookingCheckoutUrl('');
  };

  const resetOnsite = () => {
    setOnsiteSpecialization('');
    setOnsiteQuery('');
    setOnsiteDoctors([]);
    setOnsiteDoctorId('');
    setOnsiteDoctorName('');
    setOnsiteMonth(new Date().toISOString().slice(0, 7));
    setOnsiteMonthDays(new Map());
    setOnsiteSelectedDate('');
    setOnsiteSlots([]);
    setOnsiteSelectedTime('');
    setOnsiteTimePreference('any');
    setOnsiteReason('');
    setOnsitePhone('');
    setOnsiteSubmitting(false);
    setOnsiteError('');
  };

  const openBooking = () => {
    resetBooking();
    setBookingOpen(true);
  };

  const closeBooking = () => {
    setBookingOpen(false);
    resetBooking();
  };

  const openOnsite = () => {
    resetOnsite();
    setOnsiteSuccess('');
    setOnsiteOpen(true);
  };

  const closeOnsite = () => {
    setOnsiteOpen(false);
    resetOnsite();
  };

  const toDateKey = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  };

  const getMonthRange = (yyyyMm) => {
    const raw = String(yyyyMm || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    if (!Number.isFinite(y) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
    const from = new Date(Date.UTC(y, monthIndex, 1));
    const to = new Date(Date.UTC(y, monthIndex + 1, 0));
    const daysInMonth = to.getUTCDate();
    const firstDow = from.getUTCDay();
    return { fromKey: toDateKey(from), toKey: toDateKey(to), daysInMonth, firstDow, year: y, monthIndex };
  };

  const fetchDoctorsForBooking = async (specialization) => {
    setBookingLoadingDoctors(true);
    setBookingError('');
    try {
      const url = `${API_BASE}/api/video-consults/doctors${specialization ? `?specialization=${encodeURIComponent(specialization)}` : ''}`;
      const res = await fetch(url, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setBookingDoctors([]);
        setBookingError(data?.message || 'Unable to load doctors.');
        return;
      }
      setBookingDoctors(Array.isArray(data) ? data : []);
    } catch (e) {
      setBookingDoctors([]);
      setBookingError(String(e?.message || 'Unable to load doctors.'));
    } finally {
      setBookingLoadingDoctors(false);
    }
  };

  const fetchDoctorsForOnsite = async ({ specialization, q }) => {
    setOnsiteLoadingDoctors(true);
    setOnsiteError('');
    try {
      const qs = new URLSearchParams();
      if (specialization) qs.set('specialization', specialization);
      if (q) qs.set('q', q);
      qs.set('take', '120');
      const url = `${API_BASE}/api/doctors?${qs.toString()}`;
      const res = await fetch(url, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setOnsiteDoctors([]);
        setOnsiteError(data?.message || 'Unable to load doctors.');
        return;
      }
      setOnsiteDoctors(Array.isArray(data) ? data : []);
    } catch (e) {
      setOnsiteDoctors([]);
      setOnsiteError(String(e?.message || 'Unable to load doctors.'));
    } finally {
      setOnsiteLoadingDoctors(false);
    }
  };

  const fetchOnsiteMonthAvailability = async ({ doctorId, month }) => {
    const range = getMonthRange(month);
    if (!range) return;
    setOnsiteLoadingMonth(true);
    setOnsiteError('');
    setOnsiteMonthDays(new Map());
    setOnsiteSelectedDate('');
    setOnsiteSlots([]);
    setOnsiteSelectedTime('');
    try {
      const url = `${API_BASE}/api/doctors/${encodeURIComponent(String(doctorId))}/availability?from=${encodeURIComponent(
        range.fromKey
      )}&to=${encodeURIComponent(range.toKey)}&mode=onsite`;
      const res = await fetch(url, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOnsiteMonthDays(new Map());
        setOnsiteError(data?.message || 'Unable to load availability.');
        return;
      }
      const map = new Map();
      (Array.isArray(data?.days) ? data.days : []).forEach((d) => {
        const key = String(d?.date || '').trim();
        if (!key) return;
        map.set(key, { isAvailable: Boolean(d?.isAvailable), availableSlots: Number(d?.availableSlots || 0) || 0 });
      });
      setOnsiteMonthDays(map);
    } catch (e) {
      setOnsiteMonthDays(new Map());
      setOnsiteError(String(e?.message || 'Unable to load availability.'));
    } finally {
      setOnsiteLoadingMonth(false);
    }
  };

  const fetchOnsiteSlots = async ({ doctorId, date }) => {
    setOnsiteLoadingSlots(true);
    setOnsiteError('');
    setOnsiteSlots([]);
    setOnsiteSelectedTime('');
    try {
      const url = `${API_BASE}/api/doctors/${encodeURIComponent(String(doctorId))}/availability/slots?date=${encodeURIComponent(
        date
      )}&mode=onsite`;
      const res = await fetch(url, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setOnsiteSlots([]);
        setOnsiteError(data?.message || 'Unable to load time slots.');
        return;
      }
      setOnsiteSlots(Array.isArray(data?.slots) ? data.slots : []);
    } catch (e) {
      setOnsiteSlots([]);
      setOnsiteError(String(e?.message || 'Unable to load time slots.'));
    } finally {
      setOnsiteLoadingSlots(false);
    }
  };

  const getNameParts = () => {
    const first = String(patientProfile?.first_name || patientProfile?.firstName || '').trim();
    const last = String(patientProfile?.last_name || patientProfile?.lastName || '').trim();
    if (first || last) return { firstName: first || null, lastName: last || null };
    const raw = String(user?.name || '').trim();
    if (!raw) return { firstName: null, lastName: null };
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: parts[0], lastName: null };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts.slice(-1).join(' ') };
  };

  const submitOnsiteBooking = async () => {
    if (!onsiteDoctorId) {
      setOnsiteError('Choose a doctor first.');
      return;
    }
    if (!onsiteSelectedDate) {
      setOnsiteError('Choose a date first.');
      return;
    }
    setOnsiteSubmitting(true);
    setOnsiteError('');
    setOnsiteSuccess('');
    try {
      const { firstName, lastName } = getNameParts();
      const phone =
        String(onsitePhone || '').trim() ||
        String(patientProfile?.contactNumber || patientProfile?.phone || '').trim() ||
        null;
      const reason = String(onsiteReason || '').trim() || 'Onsite Consultation';

      const data = await fetchJson(`/api/appointments/onsite`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          doctorId: onsiteDoctorId,
          date: onsiteSelectedDate,
          timePreference: onsiteTimePreference,
          reason,
          firstName,
          lastName,
          phone
        })
      });

      const pref =
        data?.time
          ? String(data.time)
          : data?.timePreference
            ? `Preferred: ${String(data.timePreference)}`
            : `Preferred: ${String(onsiteTimePreference)}`;
      setOnsiteSuccess(`Request sent: ${data?.date || onsiteSelectedDate} • ${pref}`);
      closeOnsite();
      try {
        const next = await fetchJson(`/api/appointments/mine?take=50`, { apiBase: API_BASE, headers: { ...getAuthHeaders() } });
        setAppointments(Array.isArray(next) ? next : []);
      } catch (_) {}
    } catch (e) {
      setOnsiteError(String(e?.message || 'Unable to book appointment.'));
    } finally {
      setOnsiteSubmitting(false);
    }
  };

  const fetchSlotsForBooking = async ({ date, doctorId, doctorName, specialization, autoAssign }) => {
    setBookingLoadingSlots(true);
    setBookingError('');
    setBookingSlots([]);
    setBookingSelectedSlot(null);
    try {
      const qs = new URLSearchParams();
      qs.set('date', date);
      if (autoAssign) {
        qs.set('autoAssign', 'true');
        if (specialization) qs.set('specialization', specialization);
      } else {
        qs.set('autoAssign', 'false');
        if (doctorId) qs.set('doctorId', doctorId);
        if (doctorName) qs.set('doctorName', doctorName);
      }
      const data = await fetchJson(`/api/video-consults/slots?${qs.toString()}`, {
        apiBase: API_BASE,
        headers: { ...getAuthHeaders() }
      });
      setBookingSlots(Array.isArray(data) ? data : []);
    } catch (e) {
      setBookingError(String(e?.message || 'Unable to load slots.'));
      setBookingSlots([]);
    } finally {
      setBookingLoadingSlots(false);
    }
  };

  const startCheckoutForSlot = async () => {
    if (!bookingSelectedSlot?.date || !bookingSelectedSlot?.time) {
      setBookingError('Pick a slot first.');
      return;
    }
    const autoAssign = bookingMode === 'auto';
    const doctorId = String(bookingSelectedSlot?.doctorId || bookingDoctorId || '').trim();
    const doctorName = String(bookingSelectedSlot?.doctorName || bookingDoctorName || '').trim();
    if (!autoAssign && !doctorId) {
      setBookingError('Pick a doctor first.');
      return;
    }
    setBookingError('');
    try {
      const holdJson = await fetchJson(`/api/video-consults/holds`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          patientId: resolvedPatientId,
          patientEmail: String(user?.email || '').trim() || null,
          patientName: String(user?.name || '').trim() || null,
          doctorName: doctorName || null,
          doctorId: doctorId || null,
          specialization: bookingSpecialization || null,
          serviceType: 'Video Consultation',
          date: bookingSelectedSlot.date,
          time: bookingSelectedSlot.time,
          autoAssign
        })
      });

      const checkoutJson = await fetchJson(`/api/video-consults/checkout`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ bookingRef: holdJson.bookingRef })
      });
      const url = String(checkoutJson?.checkoutUrl || '').trim();
      if (!url) {
        setBookingError('Missing checkout URL.');
        return;
      }
      setBookingCheckoutUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setBookingError(String(e?.message || 'Unable to start payment.'));
    }
  };

  useEffect(() => {
    if (!user?.email) return;
    setLoadingProfile(true);
    setRecordsError('');
    (async () => {
      try {
        const data = await fetchJson(`/api/patients?email=${encodeURIComponent(user.email)}&take=1`, {
          apiBase: API_BASE,
          headers: { ...getAuthHeaders() }
        });
        const row = Array.isArray(data) ? data[0] : null;
        setPatientProfile(row || null);
        setPatientId(row?.id || null);
      } catch (_) {
        setPatientProfile(null);
        setPatientId(null);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [user?.email]);

  const isVideoConsult = (apt) => {
    const mode = String(apt?.consultationMode || apt?.consultation_mode || '').trim().toLowerCase();
    if (mode === 'video') return true;
    const reason = String(apt?.reason || '').trim().toLowerCase();
    return reason.includes('video consultation') || reason.startsWith('video:') || reason.includes('(online)');
  };

  const openVideoMeeting = (url, title) => {
    setVideoMeetingUrl(String(url || '').trim());
    setVideoMeetingTitle(String(title || '').trim());
    setVideoModalOpen(true);
  };

  const getAppointmentStartAt = (apt) => {
    const dateRaw = apt?.appointmentDate || apt?.appointment_date || null;
    const timeRaw = apt?.appointmentTime || apt?.appointment_time || null;
    const d = dateRaw ? new Date(dateRaw) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    const tStr = String(timeRaw || '').trim();
    if (!tStr) return d;
    const hm = tStr.match(/(\d{1,2}):(\d{2})/);
    if (!hm) return d;
    const hh = Math.min(23, Math.max(0, Number(hm[1])));
    const mm = Math.min(59, Math.max(0, Number(hm[2])));
    const out = new Date(d);
    out.setHours(hh, mm, 0, 0);
    return out;
  };

  const getJoinGate = (apt) => {
    const startAt = getAppointmentStartAt(apt);
    if (!startAt) return { allowed: false, reason: 'Missing schedule' };
    const now = new Date();
    const diffMin = (now.getTime() - startAt.getTime()) / 60000;
    if (diffMin < -10) return { allowed: false, reason: 'You can join 10 mins before schedule' };
    // Align join window with doctor start window (12 hours / 720 minutes) for testing flexibility
    if (diffMin > 720) return { allowed: false, reason: 'Join window ended' };
    return { allowed: true, reason: '' };
  };

  useEffect(() => {
    if (!user?.email) return;
    setLoadingAppointments(true);
    setAppointmentsError('');
    (async () => {
      try {
        const data = await fetchJson(`/api/appointments/mine?take=50`, {
          apiBase: API_BASE,
          headers: { ...getAuthHeaders() }
        });
        setAppointments(Array.isArray(data) ? data : []);
      } catch (e) {
        setAppointments([]);
        setAppointmentsError(String(e?.message || 'Unable to load appointments.'));
      } finally {
        setLoadingAppointments(false);
      }
    })();
  }, [user?.email]);

  const joinVideoCall = async (apt) => {
    if (!apt?.id) return;
    try {
      console.log(`[PatientDashboard] Attempting to join video call for appointment ${apt.id}...`);
      
      if (!supabase) {
        throw new Error('Supabase client not initialized. Please check your configuration.');
      }

      // Use the same daily-create-room edge function as the mobile app and doctor web
      const sourceTable = String(apt?.sourceTable || apt?.source_table || 'appointments').trim() || 'appointments';
      const { data, error } = await supabase.functions.invoke('daily-create-room', {
        body: {
          appointmentId: Number(apt.id),
          action: 'join',
          sourceTable
        }
      });

      if (error) {
        throw new Error(error.message || 'Error joining video room.');
      }

      const meetingUrl = String(data?.url || data?.roomUrl || data?.meetingUrl || '').trim();
      if (!meetingUrl) {
        throw new Error(data?.message || data?.error || 'Failed to retrieve video room URL. The doctor may not have started the call yet.');
      }

      console.log(`[PatientDashboard] Successfully retrieved meeting URL: ${meetingUrl}`);
      openVideoMeeting(meetingUrl, `Video Consultation • ${apt.doctor ? `Dr. ${apt.doctor}` : 'Doctor'}`);
    } catch (e) {
      console.error('[PatientDashboard] joinVideoCall error:', e);
      setAppointmentsError(String(e?.message || 'Unable to join call.'));
    }
  };

  const videoAppointments = useMemo(() => {
    return (appointments || []).filter((a) => {
      const mode = String(a?.consultationMode || a?.consultation_mode || '').trim().toLowerCase();
      if (mode === 'video') return true;
      const reason = String(a?.reason || '').trim().toLowerCase();
      return reason.includes('video consultation') || reason.startsWith('video:') || reason.includes('(online)');
    });
  }, [appointments]);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    const load = async ({ silent = false } = {}) => {
      if (!silent) setLoadingResults(true);
      setRecordsError('');
      try {
        const data = await fetchJson(`/api/lab-results/mine?take=50&includeRejected=true`, {
          apiBase: API_BASE,
          headers: { ...getAuthHeaders() }
        });
        if (cancelled) return;
        setLabResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled) return;
        setLabResults([]);
        setRecordsError(String(e?.message || 'Unable to load lab results.'));
      } finally {
        if (!silent) setLoadingResults(false);
      }
    };

    load();
    const t = setInterval(() => load({ silent: true }), 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.email]);

  const handleLogout = () => {
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  return (
    <div style={{ padding: 'clamp(14px, 3vw, 26px)', fontFamily: 'Arial, sans-serif', width: '100%', margin: '0 auto', maxWidth: 1200 }}>
      {backendHealth.checked && !backendHealth.ok ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 12px', fontWeight: 800, borderRadius: 10, marginBottom: 12 }}>
          Backend offline: {backendHealth.error}. Please start the backend server (port 5000).
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <img src="/images/pgh%20logo.png" alt="PASCUALINGA" style={{ width: 34, height: 34, objectFit: 'contain' }} />
            <div style={{ fontWeight: 1000, letterSpacing: '-0.02em', fontSize: 16, lineHeight: 1 }}>PASCUALINGA</div>
          </div>
          <h1 style={{ margin: 0 }}>Patient Dashboard</h1>
          <p style={{ margin: '6px 0 0', color: '#64748b' }}>Welcome to the Patient Portal.</p>
        </div>
        <AccountHeaderActions user={user} roleLabel="Patient" onSignOut={handleLogout} />
      </div>
      <div style={{ marginTop: '20px', padding: '20px', backgroundColor: '#f0f9ff', borderRadius: '8px' }}>
        <h3>Your Appointments</h3>
        {appointmentsError ? <div style={{ marginTop: 10, color: '#ef4444' }}>{appointmentsError}</div> : null}
        {loadingAppointments ? (
          <div style={{ color: '#64748b' }}>Loading appointments...</div>
        ) : appointments.length === 0 ? (
          <div style={{ color: '#64748b' }}>No appointments yet.</div>
        ) : videoAppointments.length === 0 ? (
          <div style={{ color: '#64748b' }}>No video consultations yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {videoAppointments
              .slice(0, 10)
              .map((a) => {
                const when = a.appointmentDate ? new Date(a.appointmentDate).toLocaleDateString() : '';
                const time = a.appointmentTime || '';
                const active = !!a.meetingActive;
                const gate = getJoinGate(a);
                const canJoin = gate.allowed && active;
                return (
                  <div
                    key={a.id}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '12px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      background: '#fff',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>{a.reason || 'Video Consultation'}</div>
                      <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
                        {(when ? `${when}` : '—') + (time ? ` • ${time}` : '')}
                        {a.doctor ? ` • Dr. ${a.doctor}` : ''}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: active ? '#16a34a' : '#f59e0b' }}>
                        {active ? 'Doctor started the call' : gate.allowed ? 'Waiting for doctor to start' : gate.reason}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => joinVideoCall(a)}
                      disabled={!canJoin}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        background: canJoin ? '#0ea5e9' : '#f8fafc',
                        cursor: canJoin ? 'pointer' : 'not-allowed',
                        opacity: canJoin ? 1 : 0.6,
                        fontWeight: 900,
                        color: canJoin ? '#fff' : '#94a3b8',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%'
                      }}
                    >
                      Join Call
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div style={{ marginTop: '16px', padding: '20px', backgroundColor: '#fff7ed', borderRadius: '8px', border: '1px solid #fed7aa' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Book a Video Consultation</h3>
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>
              Select a doctor (or auto-assign by specialization), choose a slot, then pay via PayMongo.
            </div>
          </div>
          <button
            type="button"
            onClick={openBooking}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #fb923c',
              background: '#f97316',
              cursor: 'pointer',
              fontWeight: 900,
              color: '#fff',
              whiteSpace: 'nowrap'
            }}
          >
            Book Now
          </button>
        </div>
      </div>

      {bookingOpen ? (
        <div
          onClick={closeBooking}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 60
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(760px, 96vw)',
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              overflow: 'hidden'
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 1000 }}>Video Consultation Booking</div>
              <button type="button" onClick={closeBooking} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18 }}>
                ×
              </button>
            </div>

            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => {
                    setBookingMode('choose');
                    setBookingDoctorId('');
                    setBookingDoctorName('');
                    setBookingSpecialization('');
                    setBookingDate('');
                    setBookingSlots([]);
                    setBookingSelectedSlot(null);
                    setBookingError('');
                    setBookingCheckoutUrl('');
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: bookingMode === 'choose' ? '#0ea5e9' : '#f8fafc',
                    color: bookingMode === 'choose' ? '#fff' : '#0f172a',
                    fontWeight: 900,
                    cursor: 'pointer'
                  }}
                >
                  Choose Doctor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingMode('auto');
                    setBookingDoctorId('');
                    setBookingDoctorName('');
                    setBookingDate('');
                    setBookingSlots([]);
                    setBookingSelectedSlot(null);
                    setBookingError('');
                    setBookingCheckoutUrl('');
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: bookingMode === 'auto' ? '#0ea5e9' : '#f8fafc',
                    color: bookingMode === 'auto' ? '#fff' : '#0f172a',
                    fontWeight: 900,
                    cursor: 'pointer'
                  }}
                >
                  Auto-Assign
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Department / Specialization</label>
                  <input
                    value={bookingSpecialization}
                    onChange={(e) => setBookingSpecialization(e.target.value)}
                    placeholder="e.g. Surgery, Pediatrics"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const spec = String(bookingSpecialization || '').trim();
                        if (!spec) {
                          setBookingError('Choose a department/specialization first.');
                          return;
                        }
                        setBookingDoctorId('');
                        setBookingDoctorName('');
                        fetchDoctorsForBooking(spec);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        background: '#f8fafc',
                        cursor: 'pointer',
                        fontWeight: 900
                      }}
                    >
                      Load Available Doctors
                    </button>
                    {bookingLoadingDoctors ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading...</div> : null}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>
                    Doctor {bookingMode === 'auto' ? '(auto)' : ''}
                  </label>
                  <select
                    disabled={bookingMode === 'auto'}
                    value={bookingDoctorId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setBookingDoctorId(id);
                      const picked = (bookingDoctors || []).find((d) => String(d?.id || '') === String(id));
                      setBookingDoctorName(String(picked?.name || '').trim());
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      background: bookingMode === 'auto' ? '#f8fafc' : '#fff'
                    }}
                  >
                    <option value="">{bookingMode === 'auto' ? 'Auto-selected by slot' : 'Select an available doctor'}</option>
                    {bookingDoctors.map((d) => {
                      const status = String(d?.status || '').trim().toLowerCase();
                      const isOnline = status === 'online';
                      const label = `${d.name}${d.specialization ? ` • ${d.specialization}` : ''}${status ? ` • ${isOnline ? 'Online' : 'Offline'}` : ''}`;
                      return (
                        <option key={d.id || d.email || d.name} value={String(d.id || '')} disabled={!isOnline}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Date</label>
                  <input
                    type="date"
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!bookingDate) {
                        setBookingError('Choose a date first.');
                        return;
                      }
                      if (bookingMode !== 'auto' && !bookingDoctorId) {
                        setBookingError('Choose a doctor first.');
                        return;
                      }
                      fetchSlotsForBooking({
                        date: bookingDate,
                        doctorId: bookingDoctorId,
                        doctorName: bookingDoctorName,
                        specialization: bookingSpecialization,
                        autoAssign: bookingMode === 'auto'
                      });
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #0ea5e9',
                      background: '#0ea5e9',
                      color: '#fff',
                      cursor: 'pointer',
                      fontWeight: 900
                    }}
                  >
                    Show Slots
                  </button>
                  {bookingLoadingSlots ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading...</div> : null}
                </div>
              </div>

              {bookingError ? <div style={{ marginTop: 12, color: '#ef4444', fontWeight: 800 }}>{bookingError}</div> : null}
              {bookingCheckoutUrl ? (
                <div style={{ marginTop: 10, color: '#0f172a', fontSize: 13 }}>
                  Payment started. If the checkout did not open, use this link: <a href={bookingCheckoutUrl} target="_blank" rel="noreferrer">PayMongo Checkout</a>
                </div>
              ) : null}

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Available Slots</div>
                {bookingSlots.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 13 }}>No slots loaded yet.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                    {bookingSlots.slice(0, 24).map((s) => {
                      const selected = bookingSelectedSlot && bookingSelectedSlot.date === s.date && bookingSelectedSlot.time === s.time && bookingSelectedSlot.doctorName === s.doctorName;
                      return (
                        <button
                          key={`${s.date}_${s.time}_${s.doctorName || ''}_${s.doctorId || ''}`}
                          type="button"
                          onClick={() => setBookingSelectedSlot(s)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: selected ? '2px solid #16a34a' : '1px solid #e2e8f0',
                            background: selected ? '#ecfdf5' : '#fff',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                        >
                          <div style={{ fontWeight: 1000 }}>{s.time}</div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{bookingMode === 'auto' ? s.doctorName : bookingDoctorName}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={closeBooking}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontWeight: 900 }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={startCheckoutForSlot}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #fb923c', background: '#f97316', color: '#fff', cursor: 'pointer', fontWeight: 900 }}
                >
                  Pay & Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '16px', padding: '20px', backgroundColor: '#ecfeff', borderRadius: '8px', border: '1px solid #a5f3fc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Book an Onsite Consultation</h3>
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>
              Pick a doctor, then choose an available day. The clinic will confirm the exact time after review.
            </div>
          </div>
          <button
            type="button"
            onClick={openOnsite}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #06b6d4',
              background: '#0891b2',
              cursor: 'pointer',
              fontWeight: 900,
              color: '#fff',
              whiteSpace: 'nowrap'
            }}
          >
            Book Onsite
          </button>
        </div>
      </div>
      {onsiteSuccess ? <div style={{ marginTop: 10, color: '#16a34a', fontWeight: 900 }}>{onsiteSuccess}</div> : null}

      {onsiteOpen ? (
        <div
          onClick={closeOnsite}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 60
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(900px, 96vw)',
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              overflow: 'hidden'
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 1000 }}>Onsite Consultation Booking</div>
              <button type="button" onClick={closeOnsite} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18 }}>
                ×
              </button>
            </div>

            <div style={{ padding: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Department / Specialization (optional)</label>
                  <input
                    value={onsiteSpecialization}
                    onChange={(e) => setOnsiteSpecialization(e.target.value)}
                    placeholder="e.g. Surgery, Pediatrics"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Search (optional)</label>
                  <input
                    value={onsiteQuery}
                    onChange={(e) => setOnsiteQuery(e.target.value)}
                    placeholder="Doctor name..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setOnsiteDoctorId('');
                    setOnsiteDoctorName('');
                    setOnsiteMonthDays(new Map());
                    setOnsiteSelectedDate('');
                    setOnsiteSlots([]);
                    setOnsiteSelectedTime('');
                    setOnsiteTimePreference('any');
                    fetchDoctorsForOnsite({ specialization: String(onsiteSpecialization || '').trim(), q: String(onsiteQuery || '').trim() });
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    cursor: 'pointer',
                    fontWeight: 900
                  }}
                >
                  Load Doctors
                </button>
                {onsiteLoadingDoctors ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div> : null}
                <div style={{ color: '#64748b', fontSize: 13 }}>
                  {onsiteDoctors.length ? `${onsiteDoctors.length} found` : ''}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Doctor</label>
                <select
                  value={onsiteDoctorId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setOnsiteDoctorId(id);
                    const picked = (onsiteDoctors || []).find((d) => String(d?.id || '') === String(id));
                    setOnsiteDoctorName(String(picked?.name || '').trim());
                    setOnsiteSuccess('');
                    if (id) fetchOnsiteMonthAvailability({ doctorId: id, month: onsiteMonth });
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#fff'
                  }}
                >
                  <option value="">Select a doctor</option>
                  {onsiteDoctors.map((d) => {
                    const label = `${d.name}${d.specialization ? ` • ${d.specialization}` : ''}${d.status ? ` • ${d.status}` : ''}`;
                    return (
                      <option key={d.id} value={String(d.id)}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginTop: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Month</label>
                  <input
                    type="month"
                    value={onsiteMonth}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOnsiteMonth(v);
                      setOnsiteSelectedDate('');
                      setOnsiteSlots([]);
                      setOnsiteSelectedTime('');
                      setOnsiteTimePreference('any');
                      setOnsiteSuccess('');
                      if (onsiteDoctorId) fetchOnsiteMonthAvailability({ doctorId: onsiteDoctorId, month: v });
                    }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                  {onsiteLoadingMonth ? <div style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>Loading calendar…</div> : null}
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Pick a Day</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      {onsiteDoctorName ? onsiteDoctorName : 'Select a doctor to load availability'}
                    </div>
                  </div>
                  {(() => {
                    const range = getMonthRange(onsiteMonth);
                    if (!range) return <div style={{ marginTop: 10, color: '#64748b', fontSize: 13 }}>Pick a valid month.</div>;
                    const todayKey = new Date().toISOString().slice(0, 10);
                    const cells = [];
                    for (let i = 0; i < range.firstDow; i += 1) cells.push({ kind: 'pad', label: '' });
                    for (let day = 1; day <= range.daysInMonth; day += 1) {
                      const date = toDateKey(new Date(Date.UTC(range.year, range.monthIndex, day)));
                      const meta = onsiteMonthDays.get(date);
                      const isAvailable = Boolean(meta?.isAvailable);
                      const isPast = date < todayKey;
                      cells.push({ kind: 'day', date, label: String(day), isAvailable, isPast, slots: meta?.availableSlots || 0 });
                    }
                    const weeks = [];
                    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, fontSize: 12, color: '#64748b', fontWeight: 900 }}>
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                            <div key={d} style={{ textAlign: 'center' }}>
                              {d}
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                          {weeks.flat().map((c, idx) => {
                            if (c.kind === 'pad') {
                              return <div key={`pad_${idx}`} style={{ height: 44 }} />;
                            }
                            const disabled = !onsiteDoctorId || c.isPast || !c.isAvailable;
                            const selected = onsiteSelectedDate === c.date;
                            return (
                              <button
                                key={c.date}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  setOnsiteSelectedDate(c.date);
                                  setOnsiteSuccess('');
                                  setOnsiteSelectedTime('');
                                }}
                                style={{
                                  height: 44,
                                  borderRadius: 10,
                                  border: selected ? '2px solid #16a34a' : '1px solid #e2e8f0',
                                  background: disabled ? '#f8fafc' : selected ? '#ecfdf5' : '#fff',
                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                  fontWeight: 1000,
                                  color: disabled ? '#94a3b8' : '#0f172a',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 2
                                }}
                              >
                                <div style={{ lineHeight: 1 }}>{c.label}</div>
                                <div style={{ fontSize: 10, color: disabled ? '#cbd5e1' : '#64748b' }}>{c.isAvailable ? `${c.slots}` : '—'}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ fontWeight: 900 }}>Preferred Time</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{onsiteSelectedDate ? onsiteSelectedDate : 'Select a day'}</div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[
                    { id: 'morning', label: 'Morning (8AM–12PM)' },
                    { id: 'afternoon', label: 'Afternoon (1PM–5PM)' },
                    { id: 'any', label: 'Any time' }
                  ].map((opt) => {
                    const selected = onsiteTimePreference === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setOnsiteTimePreference(opt.id);
                          setOnsiteSuccess('');
                        }}
                        disabled={!onsiteSelectedDate}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: selected ? '2px solid #16a34a' : '1px solid #e2e8f0',
                          background: !onsiteSelectedDate ? '#f8fafc' : selected ? '#ecfdf5' : '#fff',
                          cursor: !onsiteSelectedDate ? 'not-allowed' : 'pointer',
                          fontWeight: 1000,
                          color: !onsiteSelectedDate ? '#94a3b8' : '#0f172a'
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>
                  The clinic will confirm the exact time after review.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Reason (optional)</label>
                  <input
                    value={onsiteReason}
                    onChange={(e) => setOnsiteReason(e.target.value)}
                    placeholder="e.g. Follow-up checkup"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#475569', fontWeight: 800, marginBottom: 6 }}>Phone (optional)</label>
                  <input
                    value={onsitePhone}
                    onChange={(e) => setOnsitePhone(e.target.value)}
                    placeholder="Contact number"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                </div>
              </div>

              {onsiteError ? <div style={{ marginTop: 12, color: '#ef4444', fontWeight: 800 }}>{onsiteError}</div> : null}
              {onsiteSuccess ? <div style={{ marginTop: 12, color: '#16a34a', fontWeight: 900 }}>{onsiteSuccess}</div> : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={closeOnsite}
                  style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontWeight: 900 }}
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={onsiteSubmitting}
                  onClick={submitOnsiteBooking}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #06b6d4',
                    background: onsiteSubmitting ? '#67e8f9' : '#0891b2',
                    color: '#fff',
                    cursor: onsiteSubmitting ? 'not-allowed' : 'pointer',
                    fontWeight: 900
                  }}
                >
                  Send Request
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {videoModalOpen ? (
        <div
          onClick={() => {
            setVideoModalOpen(false);
            setVideoMeetingUrl('');
            setVideoMeetingTitle('');
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 60
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1100px, 96vw)',
              height: 'min(720px, 92vh)',
              background: '#fff',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              padding: 12
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 1000, color: '#0f172a' }}>{videoMeetingTitle || 'Video Consultation'}</div>
                <button
                  type="button"
                  onClick={() => window.open(videoMeetingUrl, '_blank')}
                  style={{
                    background: '#e0f2fe',
                    color: '#0369a1',
                    border: '1px solid rgba(3,105,161,0.2)',
                    borderRadius: 10,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 700
                  }}
                  title="Troubleshooting: Open in new tab"
                >
                  Open in New Tab
                </button>
                <button
                  type="button"
                  onClick={() => window.open('https://test.webrtc.org/', '_blank')}
                  style={{
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid rgba(220,38,38,0.2)',
                    borderRadius: 10,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 700,
                    marginLeft: '8px'
                  }}
                  title="Test Camera/Mic Hardware"
                >
                  Test Hardware
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVideoModalOpen(false);
                  setVideoMeetingUrl('');
                  setVideoMeetingTitle('');
                }}
                style={{
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  borderRadius: 10,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  fontWeight: 900
                }}
              >
                Close
              </button>
            </div>
            <div style={{ flex: 1, marginTop: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              <iframe
                title="Video Consultation"
                src={videoMeetingUrl}
                style={{ width: '100%', height: '100%', border: 0 }}
                allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write; encrypted-media; speaker-selection; picture-in-picture; geolocation; midi; gyroscope; accelerometer; magnetometer"
              />
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '16px', padding: '20px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0 }}>Medical Records</h3>
            <p style={{ margin: '6px 0 0', color: '#64748b' }}>Lab and imaging results attached by your care team.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!user?.email) return;
              setLoadingResults(true);
              setRecordsError('');
              fetch(`${API_BASE}/api/lab-results/mine?take=50&includeRejected=true`, {
                headers: { ...getAuthHeaders() }
              })
                .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
                .then(({ ok, d }) => {
                  if (!ok) {
                    setLabResults([]);
                    setRecordsError(d?.message || 'Unable to load lab results.');
                    return;
                  }
                  setLabResults(Array.isArray(d) ? d : []);
                })
                .catch((e) => setRecordsError(String(e?.message || 'Unable to load lab results.')))
                .finally(() => setLoadingResults(false));
            }}
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              cursor: user?.email ? 'pointer' : 'not-allowed',
              opacity: user?.email ? 1 : 0.6,
              fontWeight: 700
            }}
            disabled={!user?.email}
          >
            Refresh
          </button>
        </div>

        {loadingProfile ? (
          <div style={{ marginTop: '14px', color: '#64748b' }}>Loading profile...</div>
        ) : patientProfile ? (
          <div style={{ marginTop: '14px', color: '#64748b', fontSize: 13 }}>
            {patientProfile.first_name ? `${patientProfile.first_name} ${patientProfile.last_name || ''}`.trim() : user?.name || user?.email}
            {resolvedPatientId ? ` • ID: ${String(resolvedPatientId).slice(0, 8)}…` : ''}
          </div>
        ) : (
          <div style={{ marginTop: '14px', color: '#ef4444', fontSize: 13 }}>
            Unable to load your patient profile. Medical records may be unavailable.
          </div>
        )}

        {recordsError ? (
          <div style={{ marginTop: '14px', color: '#ef4444' }}>{recordsError}</div>
        ) : null}

        <div style={{ marginTop: '16px' }}>
          {loadingResults ? (
            <div style={{ color: '#64748b' }}>Loading results...</div>
          ) : labResults.length === 0 ? (
            <div style={{ color: '#64748b' }}>No lab results yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {labResults.map((r) => (
                <div
                  key={r.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{r.title || 'Result'}</div>
                      {(() => {
                        const st = String(r.verificationStatus || r.verification_status || 'pending').toLowerCase();
                        const map = {
                          verified: { label: 'Verified', bg: '#dcfce7', fg: '#166534' },
                          pending: { label: 'Pending', bg: '#e0f2fe', fg: '#075985' },
                          flagged: { label: 'Flagged', bg: '#fef3c7', fg: '#92400e' },
                          rejected: { label: 'Rejected', bg: '#fee2e2', fg: '#991b1b' }
                        };
                        const meta = map[st] || map.pending;
                        return (
                          <span style={{ background: meta.bg, color: meta.fg, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 900 }}>
                            {meta.label}
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
                      {(r.type || 'Lab') + ((r.resultDate || r.result_date) ? ` • ${new Date(r.resultDate || r.result_date).toLocaleDateString()}` : '')}
                      {(r.uploadedBy || r.uploaded_by) ? ` • Uploaded by ${r.uploadedBy || r.uploaded_by}` : ''}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedLabResultId((prev) => (String(prev || '') === String(r.id) ? null : String(r.id)))}
                      style={{
                        marginTop: 8,
                        border: '1px solid #e2e8f0',
                        background: '#fff',
                        color: '#0f172a',
                        fontWeight: 800,
                        borderRadius: 8,
                        padding: '6px 10px',
                        cursor: 'pointer',
                        fontSize: 12
                      }}
                    >
                      {String(expandedLabResultId || '') === String(r.id) ? 'Hide details' : 'View details'}
                    </button>
                    {String(expandedLabResultId || '') === String(r.id) ? (
                      <div style={{ marginTop: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', color: '#334155', fontSize: 13 }}>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <div><strong>Score:</strong> {r.verificationScore ?? r.verification_score ?? '—'}</div>
                          <div><strong>Status:</strong> {String(r.verificationStatus || r.verification_status || 'pending')}</div>
                        </div>
                        {Array.isArray(r.verificationFlags || r.verification_flags) && (r.verificationFlags || r.verification_flags).length ? (
                          <div style={{ marginTop: 8 }}>
                            <strong>Flags:</strong>
                            <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
                              {(r.verificationFlags || r.verification_flags).slice(0, 12).map((f, i) => (
                                <li key={`${String(f)}-${i}`}>{String(f)}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div style={{ marginTop: 8 }}><strong>Flags:</strong> none</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  {String(r.verificationStatus || r.verification_status || 'pending').toLowerCase() === 'verified' ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: '#0ea5e9',
                        color: '#fff',
                        textDecoration: 'none',
                        fontWeight: 800,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Open File
                    </a>
                  ) : (
                    <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      Under review
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PatientDashboard;
