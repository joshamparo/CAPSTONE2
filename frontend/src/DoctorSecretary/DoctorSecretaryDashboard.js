import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Download, Inbox, LayoutDashboard, Printer, RefreshCw, ShieldAlert, XCircle, User, Upload, Save, Eye, EyeOff, Search, CreditCard, WalletCards, Menu, X, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AccountHeaderActions from '../components/AccountHeaderActions';
import SignOutConfirmModal from '../components/SignOutConfirmModal';
import PatientFullRecordModal from '../components/PatientFullRecordModal';
import ModalShell from '../components/ModalShell';
import './DoctorSecretaryDashboard.css';
import { checkBackendHealth, fetchJson } from '../utils/api';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const safeJson = (v) => {
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
};

const norm = (v) => String(v || '').trim();

const getUser = () => safeJson(localStorage.getItem('currentUser') || 'null') || {};

const displayNameFor = (u) => {
  const first = norm(u.first_name || u.firstName);
  const last = norm(u.last_name || u.lastName);
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (u.name) return String(u.name);
  const email = norm(u.email);
  if (email) return email.split('@')[0];
  return 'Doctor Secretary';
};

const buildHeaders = (u) => {
  const headers = { 'Content-Type': 'application/json' };
  const role = norm(u.role || u.account_type || u.roles).toLowerCase();
  if (role) headers['x-user-role'] = role;
  const email = norm(u.email);
  if (email) headers['x-user-email'] = email;
  const name = displayNameFor(u);
  if (name) headers['x-user-name'] = name;
  const linked = norm(u.linked_doctor_id || u.linkedDoctorId || u.linked_doctor);
  if (linked) headers['x-linked-doctor-id'] = linked;
  return headers;
};

const fmtDate = (v) => {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
};

const fmtTime = (v) => {
  if (!v) return '—';
  const s = String(v);
  let d = null;
  if (s.includes('T')) {
    d = new Date(v);
  } else {
    // Handle HH:mm or HH:mm:ss
    const parts = s.split(':');
    if (parts.length >= 2) {
      d = new Date();
      d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    }
  }
  
  if (d && !Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return s.slice(0, 5);
};

const toMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const htmlCell = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const toDateInput = (d) => {
  const dt = d instanceof Date ? d : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const normalizeSpecKey = (value) => {
  const raw = norm(value).toLowerCase();
  if (!raw) return 'general';
  if (raw.includes('pedia')) return 'pediatrics';
  if (raw.includes('ob') || raw.includes('gyne')) return 'obgyn';
  if (raw.includes('surgery') || raw.includes('surge')) return 'surgery';
  if (raw.includes('ortho')) return 'orthopedics';
  if (raw.includes('ent') || raw.includes('otolaryn')) return 'ent';
  if (raw.includes('dental')) return 'dental';
  if (raw.includes('radio') || raw.includes('pathology') || raw.includes('imaging')) return 'diagnostics';
  if (raw.includes('physical therapy') || raw === 'pt' || raw.includes('rehab')) return 'rehab';
  if (raw.includes('cardio') || raw.includes('ecg')) return 'cardio';
  if (raw.includes('uro')) return 'urology';
  if (raw.includes('ophtha') || raw.includes('eye')) return 'ophthalmology';
  if (raw.includes('derma')) return 'dermatology';
  if (raw.includes('anesth')) return 'anesthesia';
  if (raw.includes('medicine') || raw.includes('internal')) return 'medicine';
  return 'general';
};

const SECRETARY_SPECIALIZATION_PROFILES = {
  pediatrics: {
    badge: 'Pediatrics Desk',
    title: 'Child-friendly scheduling and guardian coordination',
    summary: 'Prioritize follow-ups, vaccine-linked visits, and family-friendly reminders for every pediatric booking.',
    cues: ['Guardian confirmation', 'Follow-up reminders', 'Child checkup labeling'],
    serviceTags: ['Pediatric Consultation', 'Child Follow-up', 'Vaccination Review'],
    priorities: ['Confirm guardian contact details', 'Highlight repeat pediatric follow-ups', 'Prepare child-friendly visit notes']
  },
  obgyn: {
    badge: 'OB-GYN Desk',
    title: 'Prenatal and women’s clinic coordination',
    summary: 'Keep recurring prenatal visits, diagnostics, and return appointments organized around the linked doctor.',
    cues: ['Prenatal sequence tracking', 'Ultrasound / lab coordination', 'Return-visit reminders'],
    serviceTags: ['OB-GYN Consultation', 'Prenatal Follow-up', 'Women’s Health Review'],
    priorities: ['Watch recurring prenatal bookings', 'Flag diagnostics tied to the visit', 'Keep due-date and follow-up notes visible']
  },
  surgery: {
    badge: 'Surgery Desk',
    title: 'Procedure, clearance, and recovery support',
    summary: 'Focus on pre-op scheduling, post-op follow-ups, and clean coordination with the surgeon’s active queue.',
    cues: ['Pre-op checklist support', 'Post-op returns', 'Clearance-ready scheduling'],
    serviceTags: ['Surgical Consultation', 'Pre-op Clearance', 'Post-op Follow-up'],
    priorities: ['Separate pre-op and post-op visits clearly', 'Surface clearance-related appointments early', 'Keep recovery follow-ups easy to identify']
  },
  orthopedics: {
    badge: 'Orthopedics Desk',
    title: 'Mobility, imaging, and rehab-sensitive follow-ups',
    summary: 'Support the orthopedics workflow by keeping pain reviews, imaging returns, and rehab-linked consults easy to manage.',
    cues: ['Imaging-linked bookings', 'Pain follow-up labeling', 'Rehab coordination'],
    serviceTags: ['Orthopedic Consultation', 'Imaging Review', 'Rehab Follow-up'],
    priorities: ['Mark imaging review visits clearly', 'Track repeat pain-management visits', 'Coordinate rehab-related follow-ups']
  },
  ent: {
    badge: 'ENT Desk',
    title: 'Clinic procedure and revisit coordination',
    summary: 'Keep ENT procedure returns, hearing-related consults, and clinic follow-ups grouped cleanly for the linked doctor.',
    cues: ['Procedure revisit tags', 'ENT follow-up grouping', 'Clinic flow labeling'],
    serviceTags: ['ENT Consultation', 'Procedure Follow-up', 'Hearing Review'],
    priorities: ['Separate consults from procedure follow-ups', 'Keep revisit notes visible', 'Tag hearing and sinus-related bookings clearly']
  },
  dental: {
    badge: 'Dental Desk',
    title: 'Treatment-series and return-visit organization',
    summary: 'Make recurring dental procedures and aftercare bookings simple to follow for both secretary and doctor.',
    cues: ['Treatment-series tracking', 'Procedure return labeling', 'Aftercare follow-ups'],
    serviceTags: ['Dental Consultation', 'Procedure Return', 'Aftercare Review'],
    priorities: ['Group treatment-series visits', 'Label procedure returns consistently', 'Keep aftercare reminders visible']
  },
  diagnostics: {
    badge: 'Diagnostics Desk',
    title: 'Result-driven booking support',
    summary: 'Guide consult coordination around imaging, pathology, or result review appointments linked to the doctor.',
    cues: ['Result review bookings', 'Diagnostic follow-up', 'Exam-linked coordination'],
    serviceTags: ['Diagnostic Review', 'Result Follow-up', 'Exam Coordination'],
    priorities: ['Tag result-review visits clearly', 'Distinguish consults from diagnostic callbacks', 'Keep exam-linked notes visible']
  },
  rehab: {
    badge: 'Rehab Desk',
    title: 'Progress-visit and therapy follow-up support',
    summary: 'Organize frequent progress visits and follow-ups so recurring therapy-linked scheduling stays clear and friendly.',
    cues: ['Progress visit grouping', 'Recurring follow-up reminders', 'Recovery coordination'],
    serviceTags: ['Rehab Consultation', 'Progress Review', 'Follow-up Session'],
    priorities: ['Keep recurring sessions orderly', 'Highlight progress-review appointments', 'Track recovery follow-ups clearly']
  },
  cardio: {
    badge: 'Cardio Desk',
    title: 'Monitoring and return-visit coordination',
    summary: 'Support heart-related consults with clean repeat scheduling, test-linked reviews, and return-visit visibility.',
    cues: ['Test-linked reviews', 'Monitoring follow-ups', 'Cardio revisit labels'],
    serviceTags: ['Cardio Consultation', 'Test Review', 'Monitoring Follow-up'],
    priorities: ['Surface test-review appointments', 'Label monitoring return visits clearly', 'Track repeat cardio consults']
  },
  urology: {
    badge: 'Urology Desk',
    title: 'Specialty consult and results follow-up support',
    summary: 'Coordinate consults, diagnostics, and return appointments with more clarity for the linked doctor.',
    cues: ['Diagnostic revisit grouping', 'Procedure return support', 'Specialty consult clarity'],
    serviceTags: ['Urology Consultation', 'Result Review', 'Procedure Follow-up'],
    priorities: ['Keep consults and result reviews distinct', 'Track procedure-related returns', 'Label specialty follow-ups clearly']
  },
  ophthalmology: {
    badge: 'Ophthalmology Desk',
    title: 'Vision review and follow-up visit support',
    summary: 'Keep eye-care appointments, test reviews, and return visits easy to schedule and review.',
    cues: ['Vision test review', 'Return-visit coordination', 'Specialty follow-up tags'],
    serviceTags: ['Eye Consultation', 'Vision Review', 'Follow-up Visit'],
    priorities: ['Flag test review appointments', 'Keep return visits visible', 'Group vision-care follow-ups clearly']
  },
  dermatology: {
    badge: 'Dermatology Desk',
    title: 'Follow-up-heavy clinic coordination',
    summary: 'Support treatment progress reviews and repeat consults with clearer visit grouping and reminders.',
    cues: ['Progress revisit tracking', 'Repeat consult grouping', 'Clinic treatment follow-ups'],
    serviceTags: ['Dermatology Consultation', 'Treatment Follow-up', 'Progress Review'],
    priorities: ['Keep repeat consults organized', 'Highlight treatment follow-ups', 'Make progress reviews easy to spot']
  },
  anesthesia: {
    badge: 'Anesthesia Desk',
    title: 'Clearance and procedure-support scheduling',
    summary: 'Help the anesthesia workflow by keeping prep-related consults and procedure-linked coordination tidy.',
    cues: ['Procedure prep support', 'Clearance follow-up', 'Anesthesia-linked scheduling'],
    serviceTags: ['Anesthesia Consultation', 'Pre-procedure Review', 'Clearance Follow-up'],
    priorities: ['Separate prep reviews from routine consults', 'Highlight clearance-linked bookings', 'Keep procedure support notes visible']
  },
  medicine: {
    badge: 'Medicine Desk',
    title: 'Steady consult and follow-up management',
    summary: 'Support day-to-day internal medicine scheduling with cleaner follow-up grouping and payment readiness.',
    cues: ['General follow-up tracking', 'Consult queue clarity', 'Payment-ready scheduling'],
    serviceTags: ['General Consultation', 'Medicine Follow-up', 'Review Visit'],
    priorities: ['Keep repeat consults clear', 'Highlight follow-up visits', 'Watch payment-ready consultations']
  },
  general: {
    badge: 'Secretary Workbench',
    title: 'Linked-doctor scheduling and billing support',
    summary: 'Keep appointments, approvals, and onsite collection organized around the doctor assigned to this secretary account.',
    cues: ['Doctor-linked records', 'Onsite billing support', 'Approval routing'],
    serviceTags: ['General Consultation', 'Follow-up Visit', 'Clinic Review'],
    priorities: ['Track the linked doctor queue', 'Keep approvals moving', 'Prepare payment-ready visits clearly']
  }
};

export default function DoctorSecretaryDashboard() {
  const navigate = useNavigate();
  const user = useMemo(() => getUser(), []);
  const secretaryName = useMemo(() => displayNameFor(user), [user]);
  const linkedDoctorId = useMemo(
    () => norm(user.linkedDoctorId || user.linked_doctor_id),
    [user]
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profileMessage, setProfileMessage] = useState({ text: '', type: '' });
  const [profileBaseline, setProfileBaseline] = useState({ firstName: '', lastName: '' });
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });

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

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [approvalsPage, setApprovalsPage] = useState(1);
  const approvalsPerPage = 5;
  const approvalsPageCount = Math.max(1, Math.ceil(requests.length / approvalsPerPage));
  const paginatedRequests = useMemo(() => {
    const start = (approvalsPage - 1) * approvalsPerPage;
    return requests.slice(start, start + approvalsPerPage);
  }, [requests, approvalsPage]);

  useEffect(() => {
    setApprovalsPage((page) => Math.min(Math.max(1, page), approvalsPageCount));
  }, [approvalsPageCount]);

  const [recordsDate, setRecordsDate] = useState(() => toDateInput(new Date()));
  const [recordsQuery, setRecordsQuery] = useState('');
  const [recordsStatus, setRecordsStatus] = useState('All');
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [centralRecordOpen, setCentralRecordOpen] = useState(false);
  const [centralRecordPatientId, setCentralRecordPatientId] = useState(null);
  const [centralRecordPatientLabel, setCentralRecordPatientLabel] = useState('');

  const [salesSummary, setSalesSummary] = useState({
    totalConsults: 0,
    paidConsults: 0,
    unpaidConsults: 0,
    collectedAmount: '0.00'
  });
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');

  const [serviceFees, setServiceFees] = useState([]);
  const [serviceFeesLoading, setServiceFeesLoading] = useState(false);
  const [serviceFeesError, setServiceFeesError] = useState('');
  const [feesEdit, setFeesEdit] = useState({});
  const [feesSavingKey, setFeesSavingKey] = useState(null);
  const [newFee, setNewFee] = useState({ serviceKey: '', serviceName: '', defaultFee: '', active: true });

  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [chargeTarget, setChargeTarget] = useState(null);
  const [chargeForm, setChargeForm] = useState({ serviceKey: '', amount: '' });
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState('');

  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmForm, setConfirmForm] = useState({ time: '', status: 'Confirmed' });
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [welcomeShownKey, setWelcomeShownKey] = useState('');
  const [queueActionSavingId, setQueueActionSavingId] = useState('');

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => String(t.id) !== String(id)));
  };

  const pushToast = (t) => {
    const base = t || {};
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      type: String(base.type || 'success').toLowerCase() === 'success' ? 'success' : 'error',
      message: String(base.message || ''),
      durationMs: Number(base.durationMs) > 0 ? Number(base.durationMs) : 8000
    };
    setToasts((prev) => [...prev, payload]);
    if (payload.durationMs > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => String(x.id) !== String(id)));
      }, payload.durationMs);
    }
    return id;
  };

  const [onsiteInbox, setOnsiteInbox] = useState([]);
  const [onsiteInboxLoading, setOnsiteInboxLoading] = useState(false);
  const [onsiteInboxError, setOnsiteInboxError] = useState('');
  const [onsiteInboxPage, setOnsiteInboxPage] = useState(1);
  const onsiteInboxPerPage = 5;
  const onsiteInboxPageCount = Math.max(1, Math.ceil(onsiteInbox.length / onsiteInboxPerPage));
  const paginatedOnsiteInbox = useMemo(() => {
    const page = Math.min(onsiteInboxPage, onsiteInboxPageCount);
    return onsiteInbox.slice((page - 1) * onsiteInboxPerPage, page * onsiteInboxPerPage);
  }, [onsiteInbox, onsiteInboxPage, onsiteInboxPageCount]);

  useEffect(() => {
    setOnsiteInboxPage((page) => Math.min(Math.max(1, page), onsiteInboxPageCount));
  }, [onsiteInboxPageCount]);
  const [onsiteDoctors, setOnsiteDoctors] = useState([]);
  const [onsiteDoctorsLoading, setOnsiteDoctorsLoading] = useState(false);
  const [onsiteDoctorsError, setOnsiteDoctorsError] = useState('');

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignForm, setAssignForm] = useState({ doctorId: '', time: '', status: 'Confirmed' });
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSlotNotice, setAssignSlotNotice] = useState('');
  const [assignSlots, setAssignSlots] = useState([]);
  const [assignSlotsLoading, setAssignSlotsLoading] = useState(false);

  const [selected, setSelected] = useState(null);
  const [linkedDoctor, setLinkedDoctor] = useState(null);
  const [linkedDoctorLoading, setLinkedDoctorLoading] = useState(false);
  const [linkedDoctorError, setLinkedDoctorError] = useState('');
  const [note, setNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [availabilityRules, setAvailabilityRules] = useState([]);
  const [availabilityExceptions, setAvailabilityExceptions] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilityAddRule, setAvailabilityAddRule] = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', slotMinutes: 30, maxPerSlot: 1 });
  const [availabilityAddException, setAvailabilityAddException] = useState({ date: toDateInput(new Date()), startTime: '', endTime: '', note: '' });
  const [availabilityCalendarMonth, setAvailabilityCalendarMonth] = useState(toDateInput(new Date()).slice(0, 7));

  const headers = useMemo(() => buildHeaders({ ...user, role: 'doctor_secretary' }), [user]);

  const patientRecordRows = () => records.map((record) => ({
    date: fmtDate(record.appointmentDate || record.appointment_date),
    time: fmtTime(record.appointmentTime || record.appointment_time),
    patient: `${norm(record.firstName || record.first_name)} ${norm(record.lastName || record.last_name)}`.trim() || 'Patient',
    email: norm(record.email),
    service: norm(record.reason) || '—',
    status: norm(record.status) || '—',
    payment: norm(record.payment_status || record.paymentStatus) || '—'
  }));

  const exportPatientRecordsCsv = () => {
    const rows = patientRecordRows();
    if (!rows.length) return;
    const headings = ['Date', 'Time', 'Patient', 'Email', 'Service / Reason', 'Status', 'Payment'];
    const csv = [headings, ...rows.map((row) => Object.values(row))]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `patient-records-${recordsDate || toDateInput(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const printPatientRecords = () => {
    const rows = patientRecordRows();
    if (!rows.length) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      setRecordsError('Printing was blocked by the browser. Allow pop-ups and try again.');
      return;
    }
    popup.opener = null;
    const body = rows.map((row) => `<tr>${Object.values(row).map((value) => `<td>${htmlCell(value)}</td>`).join('')}</tr>`).join('');
    popup.document.write(`<!doctype html><html><head><title>Patient Records</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#0f172a}h1{font-size:20px}p{color:#64748b}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#f1f5f9}@media print{body{padding:0}}</style></head><body><h1>Pascual General Hospital — Patient Records</h1><p>${htmlCell(linkedDoctor?.name || 'Linked doctor')} • ${htmlCell(recordsDate || 'All available records')}</p><table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Email</th><th>Service / Reason</th><th>Status</th><th>Payment</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
    popup.document.close();
  };

  const refreshAvailability = async ({ silent } = {}) => {
    if (!linkedDoctorId) {
      setAvailabilityRules([]);
      setAvailabilityExceptions([]);
      setAvailabilityError('Your account is not linked to a doctor yet. Ask admin to set your linked doctor.');
      return;
    }
    if (!silent) setAvailabilityLoading(true);
    setAvailabilityError('');
    try {
      const now = new Date();
      const from = toDateInput(now);
      const to = toDateInput(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000));
      const [rules, exc] = await Promise.all([
        fetchJson(`/api/doctors/${encodeURIComponent(linkedDoctorId)}/availability/rules?mode=onsite`, { apiBase: API_BASE, headers }),
        fetchJson(
          `/api/doctors/${encodeURIComponent(linkedDoctorId)}/availability/exceptions?mode=onsite&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { apiBase: API_BASE, headers }
        )
      ]);
      setAvailabilityRules(Array.isArray(rules) ? rules : []);
      setAvailabilityExceptions(Array.isArray(exc) ? exc : []);
    } catch (e) {
      setAvailabilityRules([]);
      setAvailabilityExceptions([]);
      setAvailabilityError(String(e.message || 'Failed to load availability.'));
    } finally {
      if (!silent) setAvailabilityLoading(false);
    }
  };

  const saveAvailabilityRules = async () => {
    if (!linkedDoctorId) {
      const msg = 'Your account is not linked to a doctor yet. Ask admin to link your account first before saving availability.';
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    const rules = (Array.isArray(availabilityRules) ? availabilityRules : []);
    if (!rules.length) {
      const msg = 'Add at least one weekly clinic-hours rule before saving.';
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const d = Number(r.dayOfWeek);
      const start = String(r.startTime || '').trim();
      const end = String(r.endTime || '').trim();
      const slot = Number(r.slotMinutes || 0);
      const max = Number(r.maxPerSlot || 0);
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        const msg = `Rule #${i + 1}: Invalid day of week.`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(start)) {
        const msg = `Rule #${i + 1}: Enter a valid start time (HH:MM).`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(end)) {
        const msg = `Rule #${i + 1}: Enter a valid end time (HH:MM).`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      const [sh, sm] = start.split(':').map(v => parseInt(v, 10));
      const [eh, em] = end.split(':').map(v => parseInt(v, 10));
      if (sh > 23 || sm > 59 || eh > 23 || em > 59) {
        const msg = `Rule #${i + 1}: Invalid time value (hours 0-23, minutes 0-59).`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (endMin <= startMin) {
        const msg = `Rule #${i + 1}: End time must be later than start time.`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      if (!Number.isInteger(slot) || slot < 5 || slot > 180) {
        const msg = `Rule #${i + 1}: Slot minutes must be a whole number between 5 and 180.`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      if (!Number.isInteger(max) || max < 1 || max > 50) {
        const msg = `Rule #${i + 1}: Max per slot must be a whole number between 1 and 50.`;
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
    }
    setAvailabilitySaving(true);
    setAvailabilityError('');
    try {
      const payload = {
        mode: 'onsite',
        rules: rules.map((r) => ({
          dayOfWeek: Number(r.dayOfWeek),
          startTime: String(r.startTime || '').slice(0, 5),
          endTime: String(r.endTime || '').slice(0, 5),
          slotMinutes: Number(r.slotMinutes || 30),
          maxPerSlot: Number(r.maxPerSlot || 1),
          active: r.active === undefined ? true : Boolean(r.active)
        }))
      };
      await fetchJson(`/api/doctors/${encodeURIComponent(linkedDoctorId)}/availability/rules`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload)
      });
      await refreshAvailability({ silent: true });
      setAvailabilityError('');
      pushToast({ type: 'success', message: 'Weekly clinic schedule saved successfully.' });
    } catch (e) {
      const msg = String(e.message || 'Failed to save availability rules.');
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const addAvailabilityRule = () => {
    const rule = {
      id: `new-${Date.now()}`,
      dayOfWeek: Number(availabilityAddRule.dayOfWeek),
      startTime: String(availabilityAddRule.startTime || '').slice(0, 5),
      endTime: String(availabilityAddRule.endTime || '').slice(0, 5),
      slotMinutes: Number(availabilityAddRule.slotMinutes || 30),
      maxPerSlot: Number(availabilityAddRule.maxPerSlot || 1),
      active: true
    };
    setAvailabilityRules((prev) => [...(Array.isArray(prev) ? prev : []), rule]);
  };

  const removeAvailabilityRule = (id) => {
    setAvailabilityRules((prev) => (Array.isArray(prev) ? prev : []).filter((r) => String(r.id) !== String(id)));
  };

  const addAvailabilityException = async () => {
    if (!linkedDoctorId) {
      const msg = 'Your account is not linked to a doctor yet. Ask admin to link your account first before adding availability exceptions.';
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    const date = String(availabilityAddException.date || '').trim();
    if (!date) {
      const msg = 'Select a date for the availability exception.';
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      const msg = 'Enter a valid date for the availability exception.';
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    const startTime = String(availabilityAddException.startTime || '').trim();
    const endTime = String(availabilityAddException.endTime || '').trim();
    if (startTime || endTime) {
      if (!/^\d{2}:\d{2}$/.test(startTime)) {
        const msg = 'Enter a valid start time (HH:MM) or leave both start and end times blank to block the whole day.';
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(endTime)) {
        const msg = 'Enter a valid end time (HH:MM) or leave both start and end times blank to block the whole day.';
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      const [sh, sm] = startTime.split(':').map(v => parseInt(v, 10));
      const [eh, em] = endTime.split(':').map(v => parseInt(v, 10));
      if (sh > 23 || sm > 59 || eh > 23 || em > 59) {
        const msg = 'Invalid exception time value (hours 0-23, minutes 0-59).';
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
      if (eh * 60 + em <= sh * 60 + sm) {
        const msg = 'Exception end time must be later than start time.';
        setAvailabilityError(msg);
        pushToast({ type: 'error', message: msg });
        return;
      }
    }
    setAvailabilitySaving(true);
    setAvailabilityError('');
    try {
      await fetchJson(`/api/doctors/${encodeURIComponent(linkedDoctorId)}/availability/exceptions`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          mode: 'onsite',
          date,
          startTime: startTime ? String(startTime).slice(0, 5) : '',
          endTime: endTime ? String(endTime).slice(0, 5) : '',
          note: availabilityAddException.note ? String(availabilityAddException.note).trim() : ''
        })
      });
      setAvailabilityAddException({ date, startTime: '', endTime: '', note: '' });
      await refreshAvailability({ silent: true });
    } catch (e) {
      setAvailabilityError(String(e.message || 'Failed to add exception.'));
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const deleteAvailabilityException = async (id) => {
    if (!linkedDoctorId || !id) {
      const msg = !linkedDoctorId
        ? 'Your account is not linked to a doctor yet.'
        : 'Invalid exception id.';
      setAvailabilityError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    setAvailabilitySaving(true);
    setAvailabilityError('');
    try {
      await fetchJson(`/api/doctors/${encodeURIComponent(linkedDoctorId)}/availability/exceptions/${encodeURIComponent(String(id))}`, {
        apiBase: API_BASE,
        method: 'DELETE',
        headers
      });
      await refreshAvailability({ silent: true });
    } catch (e) {
      setAvailabilityError(String(e.message || 'Failed to delete exception.'));
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const serviceFeeMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(serviceFees) ? serviceFees : []).forEach((r) => {
      const key = norm(r.service_key || r.serviceKey).toLowerCase();
      if (!key) return;
      map.set(key, {
        serviceKey: key,
        serviceName: String(r.service_name || r.serviceName || '').trim(),
        defaultFee: Number(r.default_fee ?? r.defaultFee ?? 0) || 0,
        active: Boolean(r.active)
      });
    });
    return map;
  }, [serviceFees]);

  const activeServiceFees = useMemo(() => {
    return (Array.isArray(serviceFees) ? serviceFees : [])
      .map((r) => ({
        serviceKey: norm(r.service_key || r.serviceKey).toLowerCase(),
        serviceName: String(r.service_name || r.serviceName || '').trim(),
        defaultFee: Number(r.default_fee ?? r.defaultFee ?? 0) || 0,
        active: Boolean(r.active)
      }))
      .filter((r) => r.serviceKey && r.active)
      .sort((a, b) => String(a.serviceName).localeCompare(String(b.serviceName)));
  }, [serviceFees]);

  const inferServiceKeyForAppointment = (apt) => {
    const reason = String(apt?.reason || apt?.serviceType || apt?.service_type || '').trim().toLowerCase();
    if (!reason) {
      const general = activeServiceFees.find((f) => f.serviceKey.includes('general')) || activeServiceFees[0];
      return general ? general.serviceKey : '';
    }
    const matches = activeServiceFees.filter((f) => {
      const key = String(f.serviceKey || '').toLowerCase();
      const name = String(f.serviceName || '').toLowerCase();
      return (key && reason.includes(key.replace(/_/g, ' '))) || (name && reason.includes(name));
    });
    if (matches.length > 0) return matches[0].serviceKey;
    if (reason.includes('follow')) return 'follow_up';
    if (reason.includes('medical certificate') || reason.includes('med cert')) return 'med_cert';
    if (reason.includes('pedi')) return 'pediatrics_consultation';
    if (reason.includes('physical therapy') || reason.includes('physio') || reason === 'pt') return 'physical_therapy';
    if (reason.includes('ob-gyn') || reason.includes('obgyn') || reason === 'ob') return 'ob_gyn_consultation';
    const general = activeServiceFees.find((f) => f.serviceKey.includes('general')) || activeServiceFees[0];
    return general ? general.serviceKey : '';
  };

  const refreshServiceFees = async ({ silent } = {}) => {
    if (!linkedDoctorId) {
      setServiceFees([]);
      setServiceFeesError('Your account is not linked to a doctor yet. Ask admin to set your linked doctor.');
      return;
    }
    if (!silent) setServiceFeesLoading(true);
    setServiceFeesError('');
    try {
      const data = await fetchJson(`/api/billing/service-fees`, { apiBase: API_BASE, headers });
      setServiceFees(Array.isArray(data) ? data : []);
    } catch (e) {
      setServiceFees([]);
      setServiceFeesError(String(e.message || 'Failed to load service fees'));
    } finally {
      if (!silent) setServiceFeesLoading(false);
    }
  };

  const upsertServiceFee = async (fee) => {
    const key = norm(fee?.serviceKey || fee?.service_key).toLowerCase();
    if (!key) {
      const msg = 'Service key is missing. Refresh the page and try again.';
      setServiceFeesError(msg);
      pushToast({ type: 'error', message: msg });
      return false;
    }
    setFeesSavingKey(key);
    setServiceFeesError('');
    try {
      const body = {
        serviceKey: key,
        serviceName: String(fee?.serviceName || fee?.service_name || '').trim(),
        defaultFee: Number(fee?.defaultFee ?? fee?.default_fee ?? 0),
        active: fee?.active === undefined ? true : Boolean(fee.active)
      };
      if (!body.serviceName) throw new Error('Service name is required.');
      if (!Number.isFinite(Number(body.defaultFee)) || Number(body.defaultFee) < 0) throw new Error('Default fee must be >= 0.');
      await fetchJson(`/api/billing/service-fees`, { apiBase: API_BASE, method: 'PUT', headers, body: JSON.stringify(body) });
      await refreshServiceFees({ silent: true });
      pushToast({ type: 'success', message: 'Service fee saved.' });
      return true;
    } catch (e) {
      setServiceFeesError(String(e.message || 'Save failed'));
      pushToast({ type: 'error', message: String(e.message || 'Save failed') });
      return false;
    } finally {
      setFeesSavingKey(null);
    }
  };

  const refreshRecords = async ({ silent } = {}) => {
    if (!linkedDoctorId) {
      setRecords([]);
      setRecordsError('Your account is not linked to a doctor yet. Ask admin to set your linked doctor.');
      return;
    }
    if (!silent) setRecordsLoading(true);
    setRecordsError('');
    try {
      const params = new URLSearchParams();
      params.set('date', recordsDate || toDateInput(new Date()));
      params.set('consultationMode', 'onsite');
      if (recordsStatus && recordsStatus !== 'All') params.set('status', recordsStatus);
      if (recordsQuery.trim()) params.set('q', recordsQuery.trim());
      params.set('take', '300');
      const data = await fetchJson(`/api/appointments?${params.toString()}`, { apiBase: API_BASE, headers });
      const rows = Array.isArray(data) ? data : [];
      const onsite = rows.filter((r) => String(r.consultationMode || r.consultation_mode || '').toLowerCase() !== 'video');
      onsite.sort((a, b) => {
        const ad = a.appointmentDate || a.appointment_date || null;
        const bd = b.appointmentDate || b.appointment_date || null;
        const at = ad ? new Date(ad).getTime() : 0;
        const bt = bd ? new Date(bd).getTime() : 0;
        if (at !== bt) return at - bt;
        return String(a.appointmentTime || a.appointment_time || '').localeCompare(String(b.appointmentTime || b.appointment_time || ''));
      });
      setRecords(onsite);
    } catch (e) {
      setRecords([]);
      setRecordsError(String(e.message || 'Failed to load patient records'));
    } finally {
      if (!silent) setRecordsLoading(false);
    }
  };

  const refreshSales = async ({ silent } = {}) => {
    if (!linkedDoctorId) {
      setSalesSummary({ totalConsults: 0, paidConsults: 0, unpaidConsults: 0, collectedAmount: '0.00' });
      setSalesError('Your account is not linked to a doctor yet. Ask admin to set your linked doctor.');
      return;
    }
    if (!silent) setSalesLoading(true);
    setSalesError('');
    try {
      const params = new URLSearchParams();
      params.set('date', recordsDate || toDateInput(new Date()));
      const data = await fetchJson(`/api/billing/summary/doctor?${params.toString()}`, { apiBase: API_BASE, headers });
      setSalesSummary({
        totalConsults: Number(data.totalConsults || 0),
        paidConsults: Number(data.paidConsults || 0),
        unpaidConsults: Number(data.unpaidConsults || 0),
        collectedAmount: String(data.collectedAmount || '0.00')
      });
    } catch (e) {
      setSalesSummary({ totalConsults: 0, paidConsults: 0, unpaidConsults: 0, collectedAmount: '0.00' });
      setSalesError(String(e.message || 'Failed to load sales summary'));
    } finally {
      if (!silent) setSalesLoading(false);
    }
  };

  const openCharge = (apt) => {
    if (!apt?.id) return;
    setChargeTarget(apt);
    setChargeError('');
    const inferredKey = inferServiceKeyForAppointment(apt);
    const fee = inferredKey ? serviceFeeMap.get(String(inferredKey).toLowerCase()) : null;
    const existingAmount = apt.amount != null ? Number(apt.amount) : null;
    const suggested = fee ? Number(fee.defaultFee || 0) : 0;
    setChargeForm({
      serviceKey: inferredKey || '',
      amount: existingAmount && Number.isFinite(existingAmount) && existingAmount > 0 ? String(existingAmount) : (suggested > 0 ? String(suggested) : '1')
    });
    setChargeModalOpen(true);
  };

  const closeCharge = () => {
    setChargeModalOpen(false);
    setChargeTarget(null);
    setChargeError('');
    setChargeSaving(false);
  };

  const submitCharge = async () => {
    if (!chargeTarget?.id) {
      const msg = 'Select a patient appointment to charge first.';
      setChargeError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    setChargeSaving(true);
    setChargeError('');
    try {
      const amount = Number(chargeForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount greater than 0.');
      const serviceKey = String(chargeForm.serviceKey || '').trim();
      const service = serviceKey ? serviceFeeMap.get(serviceKey.toLowerCase()) : null;

      await fetchJson(`/api/billing/charge-onsite`, {
        apiBase: API_BASE,
        method: 'POST',
        headers,
        body: JSON.stringify({
          appointmentId: String(chargeTarget.id),
          amount,
          serviceKey: serviceKey || null,
          serviceName: service?.serviceName || null,
          description: service?.serviceName ? `Consultation Fee - ${service.serviceName}` : 'Consultation Fee'
        })
      });

      closeCharge();
      await refreshRecords({ silent: true });
      await refreshSales({ silent: true });
      pushToast({ type: 'success', message: 'Charge sent to cashier (Ready for payment).' });
    } catch (e) {
      setChargeError(String(e.message || 'Unable to set charge.'));
      pushToast({ type: 'error', message: String(e.message || 'Unable to set charge.') });
    } finally {
      setChargeSaving(false);
    }
  };

  const openConfirm = (apt) => {
    if (!apt?.id) return;
    setConfirmTarget(apt);
    setConfirmError('');
    setConfirmForm({
      time: String(apt.appointmentTime || apt.appointment_time || '').slice(0, 5),
      status: 'Confirmed'
    });
    setConfirmModalOpen(true);
  };

  const closeConfirm = () => {
    setConfirmModalOpen(false);
    setConfirmTarget(null);
    setConfirmError('');
    setConfirmSaving(false);
  };

  const submitConfirm = async () => {
    if (!confirmTarget?.id) {
      const msg = 'Select a patient appointment to confirm first.';
      setConfirmError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    setConfirmSaving(true);
    setConfirmError('');
    try {
      const time = String(confirmForm.time || '').trim();
      if (!time) throw new Error('Select a time.');
      if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Enter a valid time (HH:MM).');
      const status = String(confirmForm.status || '').trim() || 'Confirmed';
      await fetchJson(`/api/appointments/${encodeURIComponent(String(confirmTarget.id))}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers,
        body: JSON.stringify({ appointmentTime: time, status })
      });
      closeConfirm();
      await refreshRecords({ silent: true });
      await refreshSales({ silent: true });
      pushToast({ type: 'success', message: 'Patient schedule confirmed successfully.' });
    } catch (e) {
      setConfirmError(String(e.message || 'Unable to confirm schedule.'));
    } finally {
      setConfirmSaving(false);
    }
  };

  const refreshOnsiteDoctors = async ({ silent } = {}) => {
    if (!silent) setOnsiteDoctorsLoading(true);
    setOnsiteDoctorsError('');
    try {
      const spec = norm(linkedDoctor?.specialization);
      const params = new URLSearchParams();
      if (spec) params.set('specialization', spec);
      
      let list = await fetchJson(`/api/video-consults/doctors?${params.toString()}`, { apiBase: API_BASE, headers });
      
      // If no doctors found for this specialization, try fetching all doctors
      if (spec && (!Array.isArray(list) || list.length === 0)) {
        list = await fetchJson(`/api/video-consults/doctors`, { apiBase: API_BASE, headers });
      }

      const doctors = Array.isArray(list) ? list : [];
      const linkedOnly = doctors.filter((doctor) => String(doctor.id || doctor.uuid || '') === String(linkedDoctorId));
      if (!linkedOnly.length && linkedDoctorId && linkedDoctor) {
        linkedOnly.push({ id: linkedDoctorId, name: linkedDoctor.name, status: linkedDoctor.status, specialization: linkedDoctor.specialization });
      }
      setOnsiteDoctors(linkedOnly);
    } catch (e) {
      setOnsiteDoctors([]);
      setOnsiteDoctorsError(String(e.message || 'Failed to load doctors list'));
    } finally {
      if (!silent) setOnsiteDoctorsLoading(false);
    }
  };

  const refreshOnsiteInbox = async ({ silent } = {}) => {
    const spec = norm(linkedDoctor?.specialization);
    if (!spec) {
      setOnsiteInbox([]);
      setOnsiteInboxError('Missing linked doctor specialization. Ask admin to link this secretary to a department doctor.');
      return;
    }
    if (!silent) setOnsiteInboxLoading(true);
    setOnsiteInboxError('');
    try {
      const params = new URLSearchParams();
      params.set('specialization', spec);
      params.set('take', '200');
      const rows = await fetchJson(`/api/appointments/unassigned?${params.toString()}`, { apiBase: API_BASE, headers });
      setOnsiteInbox(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setOnsiteInbox([]);
      setOnsiteInboxError(String(e.message || 'Unable to load onsite booking inbox'));
    } finally {
      if (!silent) setOnsiteInboxLoading(false);
    }
  };

  const refreshAssignSlots = async (docUuid, date) => {
    if (!docUuid || !date) {
      setAssignSlots([]);
      return;
    }
    setAssignSlotsLoading(true);
    setAssignError('');
    try {
      const d = new Date(date);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dKey = `${y}-${m}-${day}`;
      const data = await fetchJson(`/api/doctors/${encodeURIComponent(docUuid)}/availability/slots?date=${encodeURIComponent(dKey)}&mode=onsite`, { apiBase: API_BASE, headers });
      setAssignSlots(Array.isArray(data?.slots) ? data.slots : []);
    } catch (e) {
      setAssignSlots([]);
      setAssignError(String(e?.message || 'Unable to load the linked doctor’s available slots.'));
    } finally {
      setAssignSlotsLoading(false);
    }
  };

  const openAssign = (apt) => {
    if (!apt?.id) return;
    setAssignTarget(apt);
    setAssignError('');
    setAssignSlotNotice('');
    setAssignSlots([]);

    let initialTime = '';
    const rawTime = apt.appointmentTime || apt.appointment_time;
    if (rawTime) {
      const s = String(rawTime);
      if (s.includes('T')) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) {
          initialTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      } else if (s.toLowerCase().includes('am') || s.toLowerCase().includes('pm')) {
        // Handle "05:00 PM" format
        try {
          const [timePart, modifier] = s.split(' ');
          let [hours, minutes] = timePart.split(':');
          if (hours === '12') hours = '00';
          if (modifier.toLowerCase() === 'pm') hours = parseInt(hours, 10) + 12;
          initialTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        } catch (_) {
          initialTime = s.slice(0, 5);
        }
      } else {
        initialTime = s.slice(0, 5);
      }
    }

    setAssignForm({
      doctorId: linkedDoctorId || '',
      time: initialTime,
      status: 'Confirmed'
    });
    setAssignModalOpen(true);
  };

  const closeAssign = () => {
    setAssignModalOpen(false);
    setAssignTarget(null);
    setAssignSaving(false);
    setAssignError('');
    setAssignSlotNotice('');
  };

  const submitAssign = async () => {
    if (!assignTarget?.id) {
      const msg = 'Select an appointment from the inbox first to assign a doctor and time.';
      setAssignError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    setAssignSaving(true);
    setAssignError('');
    try {
      const doctorId = norm(assignForm.doctorId);
      if (!doctorId) throw new Error('Select a doctor to assign.');
      const time = String(assignForm.time || '').trim();
      if (!time) throw new Error('Select a time.');
      if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Enter a valid time (HH:MM).');
      const availableTimes = (Array.isArray(assignSlots) ? assignSlots : []).map((slot) => String(slot?.time || '').slice(0, 5));
      if (!availableTimes.includes(time)) throw new Error('Select one of the linked doctor’s currently available time slots.');

      await fetchJson(`/api/appointments/${encodeURIComponent(String(assignTarget.id))}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          doctorId,
          status: String(assignForm.status || 'Confirmed'),
          appointmentTime: time,
          assignmentStatus: 'ASSIGNED',
          assignedBy: secretaryName
        })
      });

      const assignedPatientName = `${norm(assignTarget.firstName || assignTarget.first_name)} ${norm(assignTarget.lastName || assignTarget.last_name)}`.trim();
      closeAssign();
      await refreshOnsiteInbox({ silent: true });
      await refreshRecords({ silent: true });
      pushToast({
        type: 'success',
        message: `${assignedPatientName || 'Patient'} was assigned to the doctor successfully.`
      });
    } catch (e) {
      setAssignError(String(e.message || 'Unable to assign appointment'));
    } finally {
      setAssignSaving(false);
    }
  };

  const callPatientNow = async (apt) => {
    const id = String(apt?.id || '').trim();
    if (!id) {
      pushToast({ type: 'error', message: 'Select a checked-in patient first before calling.' });
      return;
    }
    setQueueActionSavingId(id);
    try {
      const nowIso = new Date().toISOString();
      await fetchJson(`/api/appointments/${encodeURIComponent(id)}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          patientWaitingAt: nowIso,
          patientWaitingName: secretaryName || null
        })
      });
      await refreshRecords({ silent: true });
      pushToast({ type: 'success', message: 'Patient called (Now serving).' });
    } catch (e) {
      pushToast({ type: 'error', message: String(e.message || 'Failed to call patient.') });
    } finally {
      setQueueActionSavingId('');
    }
  };

  const updateAppointmentStatus = async ({ apt, status, clearNowServing = false }) => {
    const id = String(apt?.id || '').trim();
    if (!id) {
      pushToast({ type: 'error', message: 'Select a patient first before updating the status.' });
      return false;
    }
    const statusClean = String(status || '').trim();
    if (!statusClean) {
      pushToast({ type: 'error', message: 'Status cannot be empty.' });
      return false;
    }
    setQueueActionSavingId(id);
    try {
      const payload = { status: statusClean };
      if (clearNowServing) {
        payload.patientWaitingAt = null;
        payload.patientWaitingName = null;
      } else if (statusClean && statusClean.toLowerCase().includes('consult')) {
        payload.patientWaitingName = secretaryName || null;
      }
      await fetchJson(`/api/appointments/${encodeURIComponent(id)}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload)
      });
      await refreshRecords({ silent: true });
      return true;
    } catch (e) {
      pushToast({ type: 'error', message: String(e.message || 'Failed to update appointment.') });
      return false;
    } finally {
      setQueueActionSavingId('');
    }
  };

  const refreshInbox = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('role', 'doctor_secretary');
      params.set('take', '80');
      const data = await fetchJson(`/api/approval-requests/inbox?${params.toString()}`, { apiBase: API_BASE, headers });
      setRequests(Array.isArray(data) ? data : []);
    } catch (e) {
      setRequests([]);
      setError(String(e.message || 'Failed to load approvals'));
    } finally {
      setLoading(false);
    }
  };

  const refreshLinkedDoctor = async () => {
    if (!linkedDoctorId) {
      setLinkedDoctor(null);
      setLinkedDoctorError('Your account is not linked to a doctor yet. Ask admin to set your linked doctor.');
      return;
    }
    setLinkedDoctorLoading(true);
    setLinkedDoctorError('');
    try {
      const data = await fetchJson(`/api/video-consults/doctors/${encodeURIComponent(linkedDoctorId)}`, { apiBase: API_BASE, headers });
      setLinkedDoctor(data);
    } catch (e) {
      setLinkedDoctor(null);
      setLinkedDoctorError(String(e.message || 'Failed to load linked doctor'));
    } finally {
      setLinkedDoctorLoading(false);
    }
  };

  useEffect(() => {
    refreshInbox();
    refreshLinkedDoctor();
    refreshRecords({ silent: true }).catch(() => {});
    refreshSales({ silent: true }).catch(() => {});
    refreshServiceFees({ silent: true }).catch(() => {});
    const t = setInterval(() => refreshInbox(), 20000);
    return () => clearInterval(t);
  }, [linkedDoctorId]);

  useEffect(() => {
    if (activeTab !== 'patient-records' && activeTab !== 'dashboard') return;
    refreshRecords({ silent: true }).catch(() => {});
    refreshSales({ silent: true }).catch(() => {});
  }, [recordsDate]);

  useEffect(() => {
    if (activeTab !== 'onsite-inbox') return;
    refreshOnsiteDoctors({ silent: true }).catch(() => {});
    refreshOnsiteInbox({ silent: true }).catch(() => {});
    const timer = setInterval(() => refreshOnsiteInbox({ silent: true }).catch(() => {}), 8000);
    return () => clearInterval(timer);
  }, [activeTab, linkedDoctor?.specialization]);

  useEffect(() => {
    if (activeTab !== 'patient-records') return;
    const t = setTimeout(() => {
      refreshRecords({ silent: true }).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [activeTab, recordsQuery, recordsStatus]);

  useEffect(() => {
    if (activeTab !== 'availability') return;
    refreshAvailability().catch(() => {});
    const t = setInterval(() => refreshAvailability({ silent: true }).catch(() => {}), 20000);
    return () => clearInterval(t);
  }, [activeTab, linkedDoctorId]);

  useEffect(() => {
    if (assignModalOpen && assignForm.doctorId && assignTarget?.appointmentDate) {
      refreshAssignSlots(assignForm.doctorId, assignTarget.appointmentDate).catch(() => {});
    }
  }, [assignModalOpen, assignForm.doctorId, assignTarget?.appointmentDate]);

  useEffect(() => {
    if (!assignModalOpen || assignSlotsLoading || !assignForm.doctorId) return;
    const availableTimes = (Array.isArray(assignSlots) ? assignSlots : []).map((slot) => String(slot?.time || '').slice(0, 5)).filter(Boolean);
    if (!availableTimes.length) {
      setAssignSlotNotice('The linked doctor has no available slots on this date. Update Doctor Availability or choose another booking date.');
      setAssignForm((current) => ({ ...current, time: '' }));
      return;
    }
    const requestedTime = String(assignForm.time || '').slice(0, 5);
    if (!availableTimes.includes(requestedTime)) {
      setAssignSlotNotice('The patient’s requested time is unavailable for the linked doctor. Select a replacement time below.');
      setAssignForm((current) => ({ ...current, time: availableTimes[0] }));
    } else {
      setAssignSlotNotice('The requested time is available for the linked doctor.');
    }
  }, [assignModalOpen, assignSlots, assignSlotsLoading, assignForm.doctorId]);

  useEffect(() => {
    if (user) {
      setProfileForm({
        firstName: user.firstName || user.first_name || '',
        lastName: user.lastName || user.last_name || '',
        email: user.email || '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setProfileBaseline({
        firstName: String(user.firstName || user.first_name || '').trim(),
        lastName: String(user.lastName || user.last_name || '').trim()
      });
      setProfileAvatarUrl(user.avatarUrl || user.profilePicture || user.avatar_url || null);
    }
  }, [user]);

  useEffect(() => {
    const sessionKey = `doctor_secretary_welcome_${String(user?.id || user?.email || 'anon')}_${new Date().toDateString().replace(/\s+/g, '_')}`;
    setWelcomeShownKey(sessionKey);
  }, [user]);

  useEffect(() => {
    if (!welcomeShownKey) return;
    try {
      const shown = localStorage.getItem(welcomeShownKey);
      if (shown) return;
    } catch (_) {}
    const cancelId = setTimeout(() => {
      const name = String(secretaryName || user?.name || user?.first_name || user?.firstName || 'Secretary').trim() || 'Secretary';
      const doctor = linkedDoctor?.name ? `Linked Doctor: ${linkedDoctor.name}${linkedDoctor?.specialization ? ` • ${linkedDoctor.specialization}` : ''}` : '⚠️ No linked doctor yet — ask your Admin to assign one.';
      pushToast({
        type: 'success',
        message: `👋 Welcome back, ${name}! ${doctor}`,
        durationMs: 18000
      });
      try {
        localStorage.setItem(welcomeShownKey, '1');
      } catch (_) {}
    }, 900);
    return () => clearTimeout(cancelId);
  }, [welcomeShownKey, linkedDoctor]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(String(file.type || '').toLowerCase())) {
      setProfileMessage({ text: 'Choose a JPG, PNG, or WebP image.', type: 'error' });
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileMessage({ text: 'Profile image must be 5 MB or smaller.', type: 'error' });
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('email', profileForm.email);
    formData.append('role', 'doctor_secretary');
    formData.append('id', user.id);

    setUploadingAvatar(true);
    setProfileMessage({ text: '', type: '' });
    try {
      const data = await fetchJson(`/api/staff/avatar`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: {
          'x-user-role': 'doctor_secretary',
          'x-user-email': profileForm.email
        },
        body: formData
      });
      setProfileAvatarUrl(data.avatarUrl);
      const updatedUser = { ...user, avatarUrl: data.avatarUrl, avatar_url: data.avatarUrl };
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setProfileMessage({ text: 'Profile picture updated!', type: 'success' });
    } catch (e) {
      setProfileMessage({ text: String(e?.message || 'Failed to upload image'), type: 'error' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    const fn = String(profileForm.firstName || '').trim();
    const ln = String(profileForm.lastName || '').trim();
    const errors = [];
    if (!fn) errors.push('First name is required.');
    else if (fn.length < 2) errors.push('First name is too short (min 2 characters).');
    else if (!/^[A-Za-zÑñ][A-Za-zÑñ' .-]*$/.test(fn)) errors.push('First name contains invalid characters.');
    if (!ln) errors.push('Last name is required.');
    else if (ln.length < 2) errors.push('Last name is too short (min 2 characters).');
    else if (!/^[A-Za-zÑñ][A-Za-zÑñ' .-]*$/.test(ln)) errors.push('Last name contains invalid characters.');
    const nameChanged = fn !== profileBaseline.firstName || ln !== profileBaseline.lastName;
    const passwordChanged = Boolean(profileForm.newPassword);
    if (!nameChanged && !passwordChanged) errors.push('No changes to save.');
    if ((nameChanged || passwordChanged) && !String(profileForm.currentPassword || '').trim()) {
      errors.push('Current password is required to save changes.');
    }
    if (profileForm.newPassword) {
      const np = String(profileForm.newPassword);
      if (np.length < 11) errors.push('New password must be at least 11 characters.');
      if (!/[0-9]/.test(np)) errors.push('New password must include a number.');
      if (!/[^A-Za-z0-9]/.test(np)) errors.push('New password must include a special character.');
      if (np !== profileForm.confirmPassword) errors.push('Passwords do not match.');
    }
    if (errors.length) {
      setProfileMessage({ text: errors.join('  '), type: 'error' });
      return;
    }
    setSavingProfile(true);
    setProfileMessage({ text: '', type: '' });
    try {
      const payload = {
        firstName: fn,
        lastName: ln,
        currentPassword: profileForm.currentPassword,
      };

      if (profileForm.newPassword) {
        payload.password = profileForm.newPassword;
      }

      const data = await fetchJson(`/api/staff/${user.id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });

      const updatedUser = { ...user, ...data.user };
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setProfileBaseline({ firstName: fn, lastName: ln });
      setProfileMessage({ text: 'Profile updated successfully!', type: 'success' });
      setProfileForm(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
    } catch (e) {
      setProfileMessage({ text: String(e.message), type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const openRequest = (r) => {
    setSelected(r);
    setNote('');
    setActionError('');
  };

  const approveAndForward = async () => {
    if (!selected?.id) {
      const msg = 'Select a request from the inbox first before approving.';
      setActionError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      if (!linkedDoctorId) throw new Error('Your account is not linked to a doctor yet. Ask admin to set your linked doctor.');
      await fetchJson(`/api/approval-requests/${selected.id}/secretary-finalize`, {
        apiBase: API_BASE,
        method: 'POST',
        headers,
        body: JSON.stringify({
          doctorId: linkedDoctorId,
          secretaryName,
          department: linkedDoctor?.specialization || null
        })
      });
      setSelected(null);
      setNote('');
      await refreshInbox();
    } catch (e) {
      setActionError(String(e.message || 'Approve failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const rejectRequest = async () => {
    if (!selected?.id) {
      const msg = 'Select a request from the inbox first before rejecting.';
      setActionError(msg);
      pushToast({ type: 'error', message: msg });
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      await fetchJson(`/api/approval-requests/${selected.id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'Rejected',
          role: 'doctor_secretary',
          actor: secretaryName,
          note: note || null
        })
      });
      setSelected(null);
      setNote('');
      await refreshInbox();
    } catch (e) {
      setActionError(String(e.message || 'Reject failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  const metrics = useMemo(() => {
    const all = Array.isArray(requests) ? requests : [];
    const pending = all.filter((r) => String(r.status || '').toLowerCase().includes('pending')).length;
    const approved = all.filter((r) => String(r.status || '').toLowerCase() === 'approved').length;
    const rejected = all.filter((r) => String(r.status || '').toLowerCase() === 'rejected').length;
    return { pending, approved, rejected, total: all.length };
  }, [requests]);

  const specializationProfile = useMemo(() => {
    const key = normalizeSpecKey(linkedDoctor?.specialization || '');
    return SECRETARY_SPECIALIZATION_PROFILES[key] || SECRETARY_SPECIALIZATION_PROFILES.general;
  }, [linkedDoctor?.specialization]);

  const dashboardFocusCards = useMemo(() => {
    const todayRows = Array.isArray(records) ? records : [];
    const pendingPayments = todayRows.filter((r) => {
      const paid = String(r.status || '').toLowerCase() === 'paid' || String(r.payment_status || r.paymentStatus || '').toLowerCase() === 'paid';
      return !paid;
    }).length;
    const confirmedToday = todayRows.filter((r) => String(r.status || '').toLowerCase() === 'confirmed').length;
    const checkedInToday = todayRows.filter((r) => String(r.status || '').toLowerCase().includes('checked')).length;
    const doctorStatus = String(linkedDoctor?.status || '').trim() || 'Unknown';

    return [
      {
        label: 'Linked Doctor',
        value: linkedDoctor?.name || 'Not linked',
        sub: linkedDoctor?.specialization || 'Needs linked doctor setup'
      },
      {
        label: 'Queue Today',
        value: String(todayRows.length),
        sub: `${confirmedToday} confirmed, ${checkedInToday} checked-in`
      },
      {
        label: 'Pending Collection',
        value: String(pendingPayments),
        sub: 'Onsite consults still waiting for payment'
      },
      {
        label: 'Doctor Status',
        value: doctorStatus,
        sub: 'Pulled from the linked doctor account'
      }
    ];
  }, [linkedDoctor?.name, linkedDoctor?.specialization, linkedDoctor?.status, records]);

  const quickServiceSuggestions = useMemo(() => {
    const preferred = specializationProfile.serviceTags || [];
    const live = activeServiceFees
      .filter((fee) => {
        const hay = `${String(fee.serviceName || '')} ${String(fee.serviceKey || '')}`.toLowerCase();
        return preferred.some((tag) => hay.includes(String(tag).toLowerCase().split(' ')[0]));
      })
      .slice(0, 3)
      .map((fee) => `${fee.serviceName} • ₱${toMoney(fee.defaultFee)}`);

    return live.length ? live : preferred;
  }, [activeServiceFees, specializationProfile.serviceTags]);

  return (
    <div className="sec-dashboard" style={{ paddingTop: backendHealth.checked && !backendHealth.ok ? 44 : 0 }}>
      {backendHealth.checked && !backendHealth.ok ? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#fee2e2',
            color: '#991b1b',
            padding: '10px 12px',
            fontWeight: 800,
            borderBottom: '1px solid #fecaca'
          }}
        >
          Backend offline: {backendHealth.error}
        </div>
      ) : null}
      <aside className={`sec-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sec-sidebar-header">
          <div className="sec-brand">
            <div className="sec-brand-badge">DS</div>
            <div className="sec-brand-text">Doctor Secretary</div>
          </div>
          <button className="sec-sidebar-toggle" onClick={() => setSidebarCollapsed((v) => !v)} type="button">
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <div className="sec-sidebar-body">
          <nav className="sec-nav">
            <div className="sidebar-section-label">MAIN</div>
            <button className={`sec-nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')} type="button">
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </button>
            <button className={`sec-nav-btn ${activeTab === 'approvals' ? 'active' : ''}`} onClick={() => setActiveTab('approvals')} type="button">
              <ClipboardList size={20} />
              <span>Approvals</span>
            </button>
            <button className={`sec-nav-btn ${activeTab === 'onsite-inbox' ? 'active' : ''}`} onClick={() => setActiveTab('onsite-inbox')} type="button">
              <Inbox size={20} />
              <span>Onsite Inbox</span>
            </button>

            <div className="sidebar-section-label">WORKFLOW</div>
            <button className={`sec-nav-btn ${activeTab === 'patient-records' ? 'active' : ''}`} onClick={() => setActiveTab('patient-records')} type="button">
              <Calendar size={20} />
              <span>Patient Records</span>
            </button>
            <button className={`sec-nav-btn ${activeTab === 'availability' ? 'active' : ''}`} onClick={() => setActiveTab('availability')} type="button">
              <Calendar size={20} />
              <span>Availability</span>
            </button>

            <div className="sidebar-section-label">SESSION</div>
            <button className="sec-nav-btn danger" onClick={() => setShowLogoutConfirm(true)} type="button">
              <XCircle size={20} />
              <span>Sign Out</span>
            </button>
          </nav>

          <div className="sec-sidebar-footer">
            <button
              type="button"
              className="sec-sidebar-help"
              onClick={() => setActiveTab('profile')}
              title="Help & Support"
            >
              <div className="sec-sidebar-help-icon">
                <HelpCircle size={16} />
              </div>
              <div className="sec-sidebar-help-body">
                <div className="sec-sidebar-help-title">Need Help?</div>
                <div className="sec-sidebar-help-sub">Contact IT or visit profile docs</div>
              </div>
            </button>
          </div>
        </div>
      </aside>

      <main className="sec-main">
        <header className="sec-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {sidebarCollapsed ? (
              <button type="button" className="app-mobile-menu-btn" onClick={() => setSidebarCollapsed(false)} aria-label="Open menu">
                <Menu size={18} />
              </button>
            ) : null}
            <div className="sec-topbar-title">
              {activeTab === 'dashboard'
                ? 'Dashboard'
                : activeTab === 'onsite-inbox'
                  ? 'Onsite Booking Inbox'
                : activeTab === 'patient-records'
                  ? 'Patient Records'
                : activeTab === 'availability'
                    ? 'Availability'
                    : activeTab === 'profile'
                      ? 'My Profile'
                      : 'Approvals'}
            </div>
          </div>
          <AccountHeaderActions user={user} roleLabel="Doctor Secretary" showChangePasswordMenu={false} onSignOut={() => setShowLogoutConfirm(true)} onMyProfile={() => setActiveTab('profile')} onOpenNotification={(n) => {
            if (n?.type === 'approval_request' || n?.meta?.requestId || String(n?.type || '').toLowerCase().includes('approval')) {
              setActiveTab('approvals');
            } else if (n?.type === 'onsite_booking' || String(n?.type || '').toLowerCase().includes('onsite') || String(n?.type || '').toLowerCase().includes('inbox')) {
              setActiveTab('onsite-inbox');
            } else {
              setActiveTab('dashboard');
            }
            pushToast({ type: 'success', message: `Opened: ${n?.title || 'Notification'}` });
          }} />
        </header>

        {Array.isArray(toasts) && toasts.length > 0 ? (
          <div style={{ margin: '10px 18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {toasts.map((t) => (
              <div
                key={String(t.id)}
                className={`sec-alert ${t.type === 'success' ? 'success' : 'error'}`}
                style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <ShieldAlert size={16} />
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: 'none',
                    background: 'rgba(15, 23, 42, 0.08)',
                    color: t.type === 'success' ? '#166534' : '#991b1b',
                    cursor: 'pointer',
                    flex: '0 0 auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  aria-label="Dismiss notification"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="sec-content">
          {activeTab === 'dashboard' ? (
            <div className="sec-metrics">
              <section className="sec-workbench">
                <div className="sec-workbench-copy">
                  <span className="sec-workbench-badge">{specializationProfile.badge}</span>
                  <h2 className="sec-workbench-title">{specializationProfile.title}</h2>
                  <p className="sec-workbench-sub">{specializationProfile.summary}</p>
                </div>
                <div className="sec-workbench-meta">
                  <div className="sec-workbench-meta-card">
                    <div className="sec-workbench-meta-label">Doctor Coordination</div>
                    <div className="sec-workbench-meta-value">{linkedDoctor?.name || 'No linked doctor yet'}</div>
                    <div className="sec-workbench-meta-sub">{linkedDoctor?.specialization || 'Ask admin to link this secretary to a doctor.'}</div>
                  </div>
                  <div className="sec-workbench-meta-card">
                    <div className="sec-workbench-meta-label">Today's Secretary Priorities</div>
                    <ul className="sec-workbench-list">
                      {specializationProfile.priorities.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>

              <section className="sec-focus-grid">
                {dashboardFocusCards.map((card) => (
                  <article className="sec-focus-card" key={card.label}>
                    <div className="sec-focus-label">{card.label}</div>
                    <div className="sec-focus-value">{card.value}</div>
                    <div className="sec-focus-sub">{card.sub}</div>
                  </article>
                ))}
              </section>

              <section className="sec-specialty-panel">
                <div className="sec-specialty-block">
                  <div className="sec-specialty-title">Workflow Cues</div>
                  <div className="sec-chip-row">
                    {specializationProfile.cues.map((cue) => (
                      <span className="sec-chip" key={cue}>{cue}</span>
                    ))}
                  </div>
                </div>
                <div className="sec-specialty-block">
                  <div className="sec-specialty-title">Suggested Service Labels</div>
                  <div className="sec-chip-row">
                    {quickServiceSuggestions.map((item) => (
                      <span className="sec-chip soft" key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              </section>
              <div className="sec-metric-card">
                <div className="sec-metric-label">Total Consultations</div>
                <div className="sec-metric-value">{salesLoading ? '—' : salesSummary.totalConsults}</div>
              </div>
              <div className="sec-metric-card">
                <div className="sec-metric-label">Collected Today</div>
                <div className="sec-metric-value">₱{salesLoading ? '—' : salesSummary.collectedAmount}</div>
              </div>
              <div className="sec-metric-card">
                <div className="sec-metric-label">Paid</div>
                <div className="sec-metric-value">{salesLoading ? '—' : salesSummary.paidConsults}</div>
              </div>
              <div className="sec-metric-card">
                <div className="sec-metric-label">Unpaid</div>
                <div className="sec-metric-value">{salesLoading ? '—' : salesSummary.unpaidConsults}</div>
              </div>
              <div className="sec-sales-panel">
                <div className="sec-sales-head">
                  <div>
                    <div className="sec-sales-title">Daily Sales Monitoring</div>
                    <div className="sec-sales-sub">Linked doctor: {linkedDoctor?.name || '—'}</div>
                  </div>
                  <div className="sec-sales-actions">
                    <input className="sec-date" type="date" value={recordsDate} onChange={(e) => setRecordsDate(e.target.value)} />
                    <button className="sec-btn ghost" type="button" onClick={() => refreshSales({ silent: false })} disabled={salesLoading}>
                      <RefreshCw size={16} className={salesLoading ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>
                {salesError ? <div className="sec-error">{salesError}</div> : null}
                <div className="sec-sales-foot">
                  <div className="sec-sales-pill">
                    <WalletCards size={16} />
                    <span>Collector: {secretaryName}</span>
                  </div>
                  <div className="sec-sales-pill">
                    <CreditCard size={16} />
                    <span>Mode: Onsite</span>
                  </div>
                </div>
              </div>

              <div className="sec-sales-panel">
                <div className="sec-sales-head">
                  <div>
                    <div className="sec-sales-title">Service Fees</div>
                    <div className="sec-sales-sub">Used to auto-suggest consultation fees by service.</div>
                  </div>
                  <div className="sec-sales-actions">
                    <button className="sec-btn ghost" type="button" onClick={() => refreshServiceFees({ silent: false })} disabled={serviceFeesLoading}>
                      <RefreshCw size={16} className={serviceFeesLoading ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>
                {serviceFeesError ? <div className="sec-error">{serviceFeesError}</div> : null}

                <div className="sec-form-grid" style={{ marginTop: 12 }}>
                  <div className="sec-field">
                    <label>Service Key</label>
                    <input className="sec-input" value={newFee.serviceKey} onChange={(e) => setNewFee((v) => ({ ...v, serviceKey: e.target.value }))} placeholder="e.g. general_consultation" />
                  </div>
                  <div className="sec-field">
                    <label>Service Name</label>
                    <input className="sec-input" value={newFee.serviceName} onChange={(e) => setNewFee((v) => ({ ...v, serviceName: e.target.value }))} placeholder="e.g. General Consultation" />
                  </div>
                  <div className="sec-field">
                    <label>Default Fee (₱)</label>
                    <input className="sec-input" type="number" min="0" step="0.01" value={newFee.defaultFee} onChange={(e) => setNewFee((v) => ({ ...v, defaultFee: e.target.value }))} placeholder="0.00" />
                  </div>
                  <div className="sec-field">
                    <label>Active</label>
                    <select className="sec-input" value={newFee.active ? '1' : '0'} onChange={(e) => setNewFee((v) => ({ ...v, active: e.target.value === '1' }))}>
                      <option value="1">Yes</option>
                      <option value="0">No</option>
                    </select>
                  </div>
                  <div className="sec-field sec-field-full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      className="sec-btn primary"
                      onClick={async () => {
                        const payload = {
                          serviceKey: newFee.serviceKey,
                          serviceName: newFee.serviceName,
                          defaultFee: Number(newFee.defaultFee || 0),
                          active: Boolean(newFee.active)
                        };
                        const saved = await upsertServiceFee(payload);
                        if (saved) setNewFee({ serviceKey: '', serviceName: '', defaultFee: '', active: true });
                      }}
                      disabled={feesSavingKey != null || !linkedDoctorId}
                    >
                      <Save size={16} />
                      Add / Update
                    </button>
                  </div>
                </div>

                <div className="sec-table-wrap" style={{ marginTop: 12 }}>
                  <table className="sec-table">
                    <thead>
                      <tr>
                        <th style={{ width: '220px' }}>Key</th>
                        <th>Service</th>
                        <th style={{ width: '160px' }}>Default Fee</th>
                        <th style={{ width: '120px' }}>Active</th>
                        <th style={{ width: '150px', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceFeesLoading ? (
                        <tr><td colSpan="5" className="sec-empty">Loading service fees…</td></tr>
                      ) : (Array.isArray(serviceFees) ? serviceFees.length : 0) === 0 ? (
                        <tr><td colSpan="5" className="sec-empty">No service fees configured yet.</td></tr>
                      ) : (
                        (Array.isArray(serviceFees) ? serviceFees : []).map((r) => {
                          const key = norm(r.service_key || r.serviceKey).toLowerCase();
                          const edit = feesEdit[key] || {};
                          const name = edit.serviceName ?? (r.service_name || r.serviceName || '');
                          const fee = edit.defaultFee ?? (r.default_fee ?? r.defaultFee ?? 0);
                          const active = edit.active ?? Boolean(r.active);
                          return (
                            <tr key={String(r.id || key)}>
                              <td className="sec-muted">{key || '—'}</td>
                              <td>
                                <input className="sec-input" value={String(name)} onChange={(e) => setFeesEdit((v) => ({ ...v, [key]: { ...(v[key] || {}), serviceName: e.target.value } }))} />
                              </td>
                              <td>
                                <input className="sec-input" type="number" min="0" step="0.01" value={String(fee)} onChange={(e) => setFeesEdit((v) => ({ ...v, [key]: { ...(v[key] || {}), defaultFee: e.target.value } }))} />
                              </td>
                              <td>
                                <select className="sec-input" value={active ? '1' : '0'} onChange={(e) => setFeesEdit((v) => ({ ...v, [key]: { ...(v[key] || {}), active: e.target.value === '1' } }))}>
                                  <option value="1">Yes</option>
                                  <option value="0">No</option>
                                </select>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  type="button"
                                  className="sec-btn ghost"
                                  onClick={() => upsertServiceFee({ serviceKey: key, serviceName: name, defaultFee: Number(fee || 0), active })}
                                  disabled={feesSavingKey === key}
                                >
                                  <Save size={16} />
                                  Save
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === 'onsite-inbox' ? (
            <div className="sec-records">
              <div className="sec-records-toolbar">
                <div className="sec-records-left">
                  <div className="sec-toolbar-title">Onsite Booking Inbox</div>
                  <div className="sec-toolbar-sub">Unassigned bookings for {linkedDoctor?.specialization || 'your department'} (secretary assigns a doctor).</div>
                </div>
                <div className="sec-records-right">
                  <div className="sec-pagination" aria-label="Onsite inbox pagination">
                    <button type="button" className="sec-pagination-btn" aria-label="Previous page" onClick={() => setOnsiteInboxPage((page) => Math.max(1, page - 1))} disabled={onsiteInboxPage <= 1 || onsiteInboxLoading}><ChevronLeft size={16} /></button>
                    <span className="sec-pagination-info">{Math.min(onsiteInboxPage, onsiteInboxPageCount)} / {onsiteInboxPageCount}</span>
                    <button type="button" className="sec-pagination-btn" aria-label="Next page" onClick={() => setOnsiteInboxPage((page) => Math.min(onsiteInboxPageCount, page + 1))} disabled={onsiteInboxPage >= onsiteInboxPageCount || onsiteInboxLoading}><ChevronRight size={16} /></button>
                  </div>
                  <button className="sec-btn ghost" type="button" onClick={() => refreshOnsiteInbox({ silent: false })} disabled={onsiteInboxLoading}>
                    <RefreshCw size={16} className={onsiteInboxLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>
              </div>

              {onsiteInboxError ? <div className="sec-error">{onsiteInboxError}</div> : null}
              {onsiteDoctorsError ? <div className="sec-error">{onsiteDoctorsError}</div> : null}

              <div className="sec-table-wrap">
                <table className="sec-table sec-patient-records-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Requested</th>
                      <th>Concern</th>
                      <th>Triage</th>
                      <th style={{ width: 140 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onsiteInboxLoading ? (
                      <tr><td colSpan={5} style={{ padding: 16, color: '#64748b' }}>Loading…</td></tr>
                    ) : onsiteInbox.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 16, color: '#64748b' }}>No pending onsite bookings for assignment.</td></tr>
                    ) : (
                      paginatedOnsiteInbox.map((apt) => {
                        const name = `${norm(apt.firstName || apt.first_name)} ${norm(apt.lastName || apt.last_name)}`.trim() || '—';
                        const dRaw = apt.appointmentDate || apt.appointment_date || null;
                        const d = dRaw ? new Date(dRaw) : null;
                        const dateLabel = d && !Number.isNaN(d.getTime())
                          ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
                          : '—';
                        const timeLabel = String(apt.appointmentTime || apt.appointment_time || '').slice(0, 5) || '—';
                        const triage = apt.triageLevel || apt.triage_level || null;
                        const triageLabel = triage ? `T${triage}` : (apt.triageStatus || apt.triage_status || 'Unassessed');
                        return (
                          <tr key={String(apt.id)}>
                            <td>
                              <div style={{ fontWeight: 800 }}>{name}</div>
                              <div style={{ fontSize: 12, color: '#64748b' }}>{norm(apt.email) || norm(apt.phone) || ''}</div>
                            </td>
                            <td>{dateLabel} • {timeLabel}</td>
                            <td style={{ maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{norm(apt.reason) || norm(apt.mainConcern || apt.main_concern) || '—'}</td>
                            <td>{triageLabel}</td>
                            <td>
                              <button className="sec-btn primary" type="button" onClick={() => openAssign(apt)}>
                                Assign
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === 'patient-records' ? (
            <div className="sec-records">
              <div className="sec-records-toolbar">
                <div className="sec-records-left">
                  <div className="sec-toolbar-title">Onsite Consultations</div>
                  <div className="sec-toolbar-sub">Records for the linked doctor. Payments are recorded here.</div>
                </div>
                <div className="sec-records-right">
                  <input className="sec-date" type="date" value={recordsDate} onChange={(e) => setRecordsDate(e.target.value)} />
                  <div className="sec-search">
                    <Search size={16} />
                    <input value={recordsQuery} onChange={(e) => setRecordsQuery(e.target.value)} placeholder="Search patient name / email / phone" />
                  </div>
                  <select className="sec-select" value={recordsStatus} onChange={(e) => setRecordsStatus(e.target.value)}>
                    <option value="All">All Status</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Checked-in">Checked-in</option>
                    <option value="Completed">Completed</option>
                    <option value="Paid">Paid</option>
                  </select>
                  <button className="sec-btn ghost" type="button" onClick={exportPatientRecordsCsv} disabled={recordsLoading || records.length === 0} title="Export the displayed patient records as a safe CSV file">
                    <Download size={16} /> CSV
                  </button>
                  <button className="sec-btn ghost" type="button" onClick={printPatientRecords} disabled={recordsLoading || records.length === 0}>
                    <Printer size={16} /> Print
                  </button>
                  <button className="sec-btn ghost" type="button" onClick={() => refreshRecords({ silent: false })} disabled={recordsLoading}>
                    <RefreshCw size={16} className={recordsLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>
              </div>

              {linkedDoctorError ? <div className="sec-error">{linkedDoctorError}</div> : null}
              {recordsError ? <div className="sec-error">{recordsError}</div> : null}

              <div className="sec-table-wrap">
                <table className="sec-table">
                  <thead>
                    <tr>
                      <th className="sec-record-date">Date</th>
                      <th className="sec-record-time">Time</th>
                      <th>Patient</th>
                      <th>Service / Reason</th>
                      <th className="sec-record-fee">Fee</th>
                      <th className="sec-record-status">Status</th>
                      <th className="sec-record-payment">Payment</th>
                      <th className="sec-record-actions-heading">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordsLoading ? (
                      <tr><td colSpan="8" className="sec-empty">Loading patient records…</td></tr>
                    ) : records.length === 0 ? (
                      <tr><td colSpan="8" className="sec-empty">No onsite bookings found for this date.</td></tr>
                    ) : (
                      records.map((r) => {
                        const name = `${norm(r.firstName || r.first_name)} ${norm(r.lastName || r.last_name)}`.trim() || 'Patient';
                        const paid = String(r.status || '').toLowerCase() === 'paid' || String(r.payment_status || r.paymentStatus || '').toLowerCase() === 'paid';
                        const payStatus = String(r.payment_status || r.paymentStatus || '').toLowerCase();
                        const billed = payStatus === 'unpaid' || payStatus === 'for_payment' || payStatus === 'for payment' || payStatus === 'ready';
                        const payLabel = paid ? 'Paid' : billed ? 'Billed' : 'Not billed';
                        const hasTime = !!String(r.appointmentTime || r.appointment_time || '').trim();
                        const statusLower = String(r.status || '').trim().toLowerCase();
                        const isCompleted = statusLower.includes('completed') || statusLower.includes('done');
                        const isConsulting = statusLower.includes('consult');
                        const called = Boolean(r.patientWaitingAt);
                        const busy = queueActionSavingId && queueActionSavingId === String(r.id);
                        const canConfirm = !paid && !hasTime && (statusLower === 'pending' || statusLower === 'approved' || statusLower === 'confirmed' || !statusLower);
                        const canQueueManage = hasTime && !paid && (statusLower === 'confirmed' || statusLower === 'checked-in' || isConsulting);
                        const serviceKey = inferServiceKeyForAppointment(r);
                        const fee = serviceKey ? serviceFeeMap.get(String(serviceKey).toLowerCase()) : null;
                        const suggestedFee = fee ? Number(fee.defaultFee || 0) : 0;
                        const serviceLabel = fee?.serviceName ? fee.serviceName : (norm(r.reason) || '—');
                        return (
                          <tr key={String(r.id)}>
                            <td>{fmtDate(r.appointmentDate || r.appointment_date)}</td>
                            <td>{fmtTime(r.appointmentTime || r.appointment_time)}</td>
                            <td>
                              <div className="sec-strong">{name}</div>
                              <div className="sec-muted">{norm(r.email) || norm(r.phone) || '—'}</div>
                            </td>
                            <td>{serviceLabel}</td>
                            <td>₱{suggestedFee > 0 ? toMoney(suggestedFee) : '—'}</td>
                            <td>
                              <span className={`sec-badge ${String(r.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                                {norm(r.status) || '—'}
                              </span>
                            </td>
                            <td>
                              <span className={`sec-badge ${paid ? 'paid' : 'unpaid'}`}>{payLabel}</span>
                            </td>
                            <td className="sec-record-actions-cell">
                              <div className="sec-record-actions">
                              <button
                                type="button"
                                className="sec-btn ghost"
                                onClick={() => {
                                  const pid = String(r.patientId || r.patient_id || '').trim();
                                  if (!pid) return;
                                  setCentralRecordPatientId(pid);
                                  setCentralRecordPatientLabel(name);
                                  setCentralRecordOpen(true);
                                }}
                                disabled={!String(r.patientId || r.patient_id || '').trim()}
                                title={!String(r.patientId || r.patient_id || '').trim() ? 'Missing patient id' : 'View central patient record'}
                              >
                                Record
                              </button>
                              {canConfirm ? (
                                <button
                                  type="button"
                                  className="sec-btn ghost"
                                  onClick={() => openConfirm(r)}
                                  disabled={!linkedDoctorId}
                                >
                                  <Calendar size={16} />
                                  Confirm
                                </button>
                              ) : null}
                              {canQueueManage ? (
                                <>
                                  <button
                                    type="button"
                                    className="sec-btn ghost"
                                    onClick={() => callPatientNow(r)}
                                    disabled={called || isCompleted || busy}
                                    title={called ? 'Patient already called' : 'Call patient now'}
                                  >
                                    Call
                                  </button>
                                  <button
                                    type="button"
                                    className="sec-btn ghost"
                                    onClick={() => updateAppointmentStatus({ apt: r, status: 'In Consultation' })}
                                    disabled={isConsulting || isCompleted || busy}
                                    title={isConsulting ? 'Consultation already started' : 'Start consultation'}
                                  >
                                    Start
                                  </button>
                                  <button
                                    type="button"
                                    className="sec-btn ghost"
                                    onClick={async () => {
                                      const ok = window.confirm('Mark this visit as Completed?');
                                      if (!ok) return;
                                      await updateAppointmentStatus({ apt: r, status: 'Completed', clearNowServing: true });
                                    }}
                                    disabled={isCompleted || busy}
                                    title={isCompleted ? 'Already completed' : 'Complete visit'}
                                  >
                                    Done
                                  </button>
                                </>
                              ) : null}
                              <button
                                type="button"
                                className={`sec-btn ${paid ? 'disabled' : 'primary'}`}
                                onClick={() => openCharge(r)}
                                disabled={paid || !linkedDoctorId}
                                title={paid ? 'Already paid' : 'Set consultation charge and send to cashier billing'}
                              >
                                <CreditCard size={16} />
                                {paid ? 'Paid' : billed ? 'Update Charge' : 'Charge'}
                              </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === 'availability' ? (
            <div className="sec-records">
              <div className="sec-records-toolbar">
                <div className="sec-records-left">
                  <div className="sec-toolbar-title">Doctor Availability</div>
                  <div className="sec-toolbar-sub">This controls which dates/times patients can book for onsite appointments.</div>
                </div>
                <div className="sec-records-right">
                  <button className="sec-btn ghost" type="button" onClick={() => refreshAvailability({ silent: false })} disabled={availabilityLoading}>
                    <RefreshCw size={16} className={availabilityLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                </div>
              </div>

              {availabilityError ? <div className="sec-error">{availabilityError}</div> : null}

              <div className="sec-sales-panel" style={{ marginBottom: 16 }}>
                <div className="sec-sales-head">
                  <div><div className="sec-sales-title">Weekly Clinic Hours</div><div className="sec-sales-sub">Recurring onsite hours, slot length, and patient capacity for your linked doctor.</div></div>
                  <button type="button" className="sec-btn primary" onClick={saveAvailabilityRules} disabled={availabilitySaving || !linkedDoctorId}><Save size={16} /> {availabilitySaving ? 'Saving Schedule…' : 'Save Schedule'}</button>
                </div>
                <div className="sec-form-grid" style={{ marginTop: 12 }}>
                  <div className="sec-field"><label>Day</label><select className="sec-input" value={availabilityAddRule.dayOfWeek} onChange={(e) => setAvailabilityAddRule((v) => ({ ...v, dayOfWeek: Number(e.target.value) }))}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></div>
                  <div className="sec-field"><label>Start</label><input className="sec-input" type="time" value={availabilityAddRule.startTime} onChange={(e) => setAvailabilityAddRule((v) => ({ ...v, startTime: e.target.value }))} /></div>
                  <div className="sec-field"><label>End</label><input className="sec-input" type="time" value={availabilityAddRule.endTime} onChange={(e) => setAvailabilityAddRule((v) => ({ ...v, endTime: e.target.value }))} /></div>
                  <div className="sec-field"><label>Slot Minutes</label><input className="sec-input" type="number" min="5" max="180" value={availabilityAddRule.slotMinutes} onChange={(e) => setAvailabilityAddRule((v) => ({ ...v, slotMinutes: e.target.value }))} /></div>
                  <div className="sec-field"><label>Max Patients / Slot</label><input className="sec-input" type="number" min="1" max="20" value={availabilityAddRule.maxPerSlot} onChange={(e) => setAvailabilityAddRule((v) => ({ ...v, maxPerSlot: e.target.value }))} /></div>
                  <div className="sec-field" style={{ justifyContent: 'flex-end' }}><button type="button" className="sec-btn ghost" onClick={addAvailabilityRule} disabled={availabilitySaving || !linkedDoctorId}>Add Weekly Rule</button></div>
                </div>
                <div className="sec-table-wrap" style={{ marginTop: 12 }}><table className="sec-table">
                  <thead><tr><th>Day</th><th>Start</th><th>End</th><th>Slot</th><th>Capacity</th><th>Action</th></tr></thead>
                  <tbody>{availabilityLoading ? <tr><td colSpan="6" className="sec-empty">Loading schedule…</td></tr> : availabilityRules.length === 0 ? <tr><td colSpan="6" className="sec-empty">No weekly clinic hours yet.</td></tr> : availabilityRules.map((rule) => (
                    <tr key={String(rule.id)}>
                      <td>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(rule.dayOfWeek)] || '—'}</td>
                      <td><input className="sec-input" type="time" value={String(rule.startTime || '').slice(0, 5)} onChange={(e) => setAvailabilityRules((rows) => rows.map((row) => String(row.id) === String(rule.id) ? { ...row, startTime: e.target.value } : row))} /></td>
                      <td><input className="sec-input" type="time" value={String(rule.endTime || '').slice(0, 5)} onChange={(e) => setAvailabilityRules((rows) => rows.map((row) => String(row.id) === String(rule.id) ? { ...row, endTime: e.target.value } : row))} /></td>
                      <td><input className="sec-input" type="number" min="5" max="180" value={rule.slotMinutes} onChange={(e) => setAvailabilityRules((rows) => rows.map((row) => String(row.id) === String(rule.id) ? { ...row, slotMinutes: e.target.value } : row))} /></td>
                      <td><input className="sec-input" type="number" min="1" max="20" value={rule.maxPerSlot} onChange={(e) => setAvailabilityRules((rows) => rows.map((row) => String(row.id) === String(rule.id) ? { ...row, maxPerSlot: e.target.value } : row))} /></td>
                      <td><button type="button" className="sec-btn ghost" onClick={() => removeAvailabilityRule(rule.id)} disabled={availabilitySaving}>Remove</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>

              <div className="sec-sales-panel">
                <div className="sec-sales-head">
                  <div>
                    <div className="sec-sales-title">Blocked Dates</div>
                    <div className="sec-sales-sub">Use the calendar to block dates (leave, holiday) or partial clinic hours.</div>
                  </div>
                </div>

                {(() => {
                  const safeExceptions = Array.isArray(availabilityExceptions) ? availabilityExceptions : [];
                  const sortedExceptions = [...safeExceptions].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
                  const blockedByDate = new Map(sortedExceptions.map((ex) => [String(ex?.date || '').slice(0, 10), ex]));

                  const calendarMonthRaw = String(availabilityCalendarMonth || toDateInput(new Date()).slice(0, 7));
                  const monthMatch = calendarMonthRaw.match(/^(\d{4})-(\d{2})$/);
                  const calYear = monthMatch ? Number(monthMatch[1]) : new Date().getFullYear();
                  const calMonth = monthMatch ? Math.max(1, Math.min(12, Number(monthMatch[2]))) : new Date().getMonth() + 1;
                  const monthStart = new Date(calYear, calMonth - 1, 1);
                  const monthEnd = new Date(calYear, calMonth, 0);
                  const monthLabel = monthStart.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
                  const monthDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                  const calendarCells = [];
                  const leading = monthStart.getDay();
                  for (let i = 0; i < leading; i += 1) calendarCells.push(null);
                  for (let d = 1; d <= monthEnd.getDate(); d += 1) calendarCells.push(new Date(calYear, calMonth - 1, d));
                  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

                  const selectedDateKey = String(availabilityAddException.date || '').slice(0, 10);
                  const selectedBlocked = blockedByDate.get(selectedDateKey) || null;

                  const prevMonth = () => {
                    const dt = new Date(calYear, calMonth - 2, 1);
                    setAvailabilityCalendarMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
                  };
                  const nextMonth = () => {
                    const dt = new Date(calYear, calMonth, 1);
                    setAvailabilityCalendarMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
                  };

                  return (
                    <>
                      <div style={{ marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                          <button type="button" className="sec-btn ghost" onClick={prevMonth} disabled={availabilitySaving}>
                            <ChevronLeft size={16} /> Prev
                          </button>
                          <div style={{ fontWeight: 900, color: '#0f172a' }}>{monthLabel}</div>
                          <button type="button" className="sec-btn ghost" onClick={nextMonth} disabled={availabilitySaving}>
                            Next <ChevronRight size={16} />
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                            <div key={day} style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textAlign: 'center', padding: '6px 0' }}>
                              {day}
                            </div>
                          ))}
                          {calendarCells.map((dt, idx) => {
                            if (!dt) return <div key={`blank-${idx}`} />;
                            const key = monthDateKey(dt);
                            const isBlocked = blockedByDate.has(key);
                            const isSelected = key === selectedDateKey;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setAvailabilityAddException((v) => ({ ...v, date: key }))}
                                disabled={!linkedDoctorId || availabilitySaving}
                                style={{
                                  borderRadius: 10,
                                  border: isSelected ? '2px solid #f97316' : '1px solid #cbd5e1',
                                  background: isBlocked ? '#fee2e2' : '#fff',
                                  color: '#0f172a',
                                  fontWeight: 800,
                                  minHeight: 40,
                                  cursor: linkedDoctorId ? 'pointer' : 'not-allowed',
                                  position: 'relative'
                                }}
                                title={isBlocked ? 'Blocked' : 'Available'}
                              >
                                {dt.getDate()}
                                {isBlocked ? <span style={{ position: 'absolute', top: 4, right: 6, fontSize: 10, color: '#b91c1c' }}>●</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="sec-form-grid" style={{ marginTop: 12 }}>
                        <div className="sec-field">
                          <label>Date</label>
                          <input className="sec-input" type="date" value={availabilityAddException.date} onChange={(e) => setAvailabilityAddException((v) => ({ ...v, date: e.target.value }))} />
                        </div>
                        <div className="sec-field">
                          <label>Start (optional)</label>
                          <input className="sec-input" type="time" value={availabilityAddException.startTime} onChange={(e) => setAvailabilityAddException((v) => ({ ...v, startTime: e.target.value }))} />
                        </div>
                        <div className="sec-field">
                          <label>End (optional)</label>
                          <input className="sec-input" type="time" value={availabilityAddException.endTime} onChange={(e) => setAvailabilityAddException((v) => ({ ...v, endTime: e.target.value }))} />
                        </div>
                        <div className="sec-field sec-field-full">
                          <label>Note</label>
                          <input className="sec-input" value={availabilityAddException.note} onChange={(e) => setAvailabilityAddException((v) => ({ ...v, note: e.target.value }))} placeholder="e.g. Leave / Holiday / Half-day clinic" />
                        </div>
                        <div className="sec-field sec-field-full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                          <button type="button" className="sec-btn primary" onClick={addAvailabilityException} disabled={availabilitySaving || !linkedDoctorId}>
                            <Save size={16} /> Block Selected Date
                          </button>
                          <button type="button" className="sec-btn ghost" onClick={() => selectedBlocked && deleteAvailabilityException(selectedBlocked.id)} disabled={availabilitySaving || !selectedBlocked}>
                            <XCircle size={16} /> Unblock
                          </button>
                        </div>
                      </div>

                      <div className="sec-table-wrap" style={{ marginTop: 12 }}>
                        <table className="sec-table">
                          <thead>
                            <tr>
                              <th style={{ width: '140px' }}>Date</th>
                              <th style={{ width: '120px' }}>Start</th>
                              <th style={{ width: '120px' }}>End</th>
                              <th>Note</th>
                              <th style={{ width: '130px', textAlign: 'right' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedExceptions.length === 0 ? (
                              <tr><td colSpan="5" className="sec-empty">No blocked dates yet.</td></tr>
                            ) : (
                              sortedExceptions.map((e) => (
                                <tr key={String(e.id)}>
                                  <td>{fmtDate(e.date)}</td>
                                  <td>{e.startTime ? String(e.startTime).slice(0, 5) : '—'}</td>
                                  <td>{e.endTime ? String(e.endTime).slice(0, 5) : '—'}</td>
                                  <td>{String(e.note || '').trim() || '—'}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button type="button" className="sec-btn ghost" onClick={() => deleteAvailabilityException(e.id)} disabled={availabilitySaving}>
                                      <XCircle size={16} /> Delete
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : activeTab === 'profile' ? (
            <div className="sec-profile-module">
              <div className="sec-profile-card-main">
                <div className="sec-profile-left">
                  <div className="sec-avatar-edit">
                    <div className="sec-avatar-large">
                      {profileAvatarUrl ? (
                        <img src={profileAvatarUrl} alt="Profile" />
                      ) : (
                        <span>{(profileForm.firstName[0] || 'U').toUpperCase()}</span>
                      )}
                      {uploadingAvatar && <div className="sec-avatar-loading"><RefreshCw size={24} className="animate-spin" /></div>}
                    </div>
                    <label className="sec-avatar-upload-label">
                      <Upload size={16} />
                      {uploadingAvatar ? 'Uploading...' : 'Change Photo'}
                      <input type="file" onChange={handleAvatarUpload} disabled={uploadingAvatar} hidden accept="image/*" />
                    </label>
                  </div>

                  <div className="sec-profile-info-static">
                    <h3>{profileForm.firstName} {profileForm.lastName}</h3>
                    <p>{profileForm.email}</p>
                    <div className="sec-badge-linked">Linked to: {linkedDoctor?.name || '—'}</div>
                  </div>
                </div>

                <div className="sec-profile-right">
                  <div className="sec-profile-form-grid">
                    <div className="sec-form-section">
                      <h4>Personal Information</h4>
                      <div className="sec-form-row-2">
                        <div className="sec-field">
                          <label>First Name</label>
                          <input 
                            type="text" 
                            className="sec-input" 
                            value={profileForm.firstName} 
                            onChange={(e) => setProfileForm(v => ({ ...v, firstName: e.target.value }))} 
                          />
                        </div>
                        <div className="sec-field">
                          <label>Last Name</label>
                          <input 
                            type="text" 
                            className="sec-input" 
                            value={profileForm.lastName} 
                            onChange={(e) => setProfileForm(v => ({ ...v, lastName: e.target.value }))} 
                          />
                        </div>
                      </div>
                      <div className="sec-field">
                        <label>Email Address (Not changeable)</label>
                        <input 
                          type="email" 
                          className="sec-input readonly" 
                          value={profileForm.email} 
                          readOnly 
                        />
                      </div>
                    </div>

                    <div className="sec-form-section">
                      <h4>Security</h4>
                      <div className="sec-field">
                        <label>Current Password</label>
                        <input
                          type={showPasswords ? 'text' : 'password'}
                          className="sec-input"
                          placeholder="Required to save any profile change"
                          value={profileForm.currentPassword}
                          onChange={(e) => setProfileForm(v => ({ ...v, currentPassword: e.target.value }))}
                          autoComplete="current-password"
                        />
                      </div>
                      <div className="sec-form-row-2">
                        <div className="sec-field">
                          <label>New Password</label>
                          <div className="sec-password-wrap">
                            <input 
                              type={showPasswords ? 'text' : 'password'} 
                              className="sec-input" 
                              placeholder="Leave blank to keep current"
                              value={profileForm.newPassword} 
                              onChange={(e) => setProfileForm(v => ({ ...v, newPassword: e.target.value }))} 
                            />
                            <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="sec-eye-btn">
                              {showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>
                        <div className="sec-field">
                          <label>Confirm Password</label>
                          <input 
                            type={showPasswords ? 'text' : 'password'} 
                            className="sec-input" 
                            placeholder="Re-type new password"
                            value={profileForm.confirmPassword} 
                            onChange={(e) => setProfileForm(v => ({ ...v, confirmPassword: e.target.value }))} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {profileMessage.text && (
                    <div className={`sec-profile-alert ${profileMessage.type}`}>
                      {profileMessage.type === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
                      <span>{profileMessage.text}</span>
                    </div>
                  )}

                  <div className="sec-profile-footer">
                    <button className="sec-btn primary" onClick={saveProfile} disabled={savingProfile}>
                      <Save size={16} />
                      {savingProfile ? 'Saving Changes...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="sec-approvals">
              <div className="sec-approvals-header">
                <div>
                  <div className="sec-approvals-title">Inbox</div>
                  <div className="sec-approvals-count">
                    {requests.length === 0
                      ? 'No approvals'
                      : `Showing ${(approvalsPage - 1) * approvalsPerPage + 1}–${Math.min(approvalsPage * approvalsPerPage, requests.length)} of ${requests.length}`}
                  </div>
                </div>
                <div className="sec-approvals-actions">
                  <div className="sec-pagination" aria-label="Approval pages">
                    <button
                      type="button"
                      onClick={() => setApprovalsPage((page) => Math.max(1, page - 1))}
                      disabled={loading || approvalsPage <= 1}
                      aria-label="Previous approvals page"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span>{approvalsPage} / {approvalsPageCount}</span>
                    <button
                      type="button"
                      onClick={() => setApprovalsPage((page) => Math.min(approvalsPageCount, page + 1))}
                      disabled={loading || approvalsPage >= approvalsPageCount}
                      aria-label="Next approvals page"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <button className="sec-refresh-btn" onClick={refreshInbox} type="button" disabled={loading}>
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                </div>
              </div>

              {error ? (
                <div className="sec-alert error">
                  <ShieldAlert size={16} />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="sec-approvals-grid">
                <div className="sec-list">
                  {loading ? <div className="sec-muted">Loading…</div> : null}
                  {!loading && requests.length === 0 ? <div className="sec-muted">No requests.</div> : null}
                  {paginatedRequests.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`sec-list-item ${String(selected?.id) === String(r.id) ? 'active' : ''}`}
                      onClick={() => openRequest(r)}
                    >
                      <div className="sec-list-top">
                        <div className="sec-list-name">{r.patientName || 'Patient'}</div>
                        <div className={`sec-status ${String(r.status || '').toLowerCase().includes('pending') ? 'pending' : String(r.status || '').toLowerCase() === 'approved' ? 'approved' : String(r.status || '').toLowerCase() === 'rejected' ? 'rejected' : ''}`}>
                          {r.status || 'Pending'}
                        </div>
                      </div>
                      <div className="sec-list-sub">{r.reason || r.serviceType || '—'}</div>
                      <div className="sec-list-sub small">
                        <Calendar size={14} />
                        {fmtDate(r.requestedDate)} • {fmtTime(r.requestedTime)}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="sec-detail">
                  {!selected ? (
                    <div className="sec-detail-empty">Select a request to review.</div>
                  ) : (
                    <div className="sec-detail-card">
                      <div className="sec-detail-title">Review Request</div>
                      <div className="sec-detail-row">
                        <div className="sec-detail-k">Patient</div>
                        <div className="sec-detail-v">{selected.patientName || 'Patient'}</div>
                      </div>
                      <div className="sec-detail-row">
                        <div className="sec-detail-k">Reason</div>
                        <div className="sec-detail-v">{selected.reason || selected.serviceType || '—'}</div>
                      </div>
                      <div className="sec-detail-row">
                        <div className="sec-detail-k">Schedule</div>
                        <div className="sec-detail-v">{fmtDate(selected.requestedDate)} • {fmtTime(selected.requestedTime)}</div>
                      </div>

                      <div className="sec-divider" />

                      <div className="sec-field">
                        <div className="sec-field-label">Linked Doctor</div>
                        <div className="sec-input" style={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
                          {linkedDoctorLoading ? 'Loading…' : (linkedDoctor?.name || linkedDoctor?.email || linkedDoctorId || '—')}
                        </div>
                        {linkedDoctorError ? <div className="sec-field-hint error">{linkedDoctorError}</div> : null}
                      </div>
                      
                      <div className="sec-field">
                        <div className="sec-field-label">Specialization</div>
                        <div className="sec-input" style={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
                          {linkedDoctorLoading ? 'Loading…' : (linkedDoctor?.specialization || '—')}
                        </div>
                      </div>

                      <div className="sec-field">
                        <div className="sec-field-label">Note (optional)</div>
                        <textarea className="sec-input" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note for the record…" />
                      </div>

                      {actionError ? (
                        <div className="sec-alert error">
                          <ShieldAlert size={16} />
                          <span>{actionError}</span>
                        </div>
                      ) : null}

                      <div className="sec-actions">
                        <button className="sec-btn danger" onClick={rejectRequest} type="button" disabled={actionLoading}>
                          <XCircle size={16} />
                          Reject
                        </button>
                        <button className="sec-btn primary" onClick={approveAndForward} type="button" disabled={actionLoading}>
                          <CheckCircle2 size={16} />
                          Approve &amp; Forward
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {chargeModalOpen && chargeTarget && (
          <div className="sec-modal-overlay" onClick={closeCharge}>
            <div className="sec-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="sec-modal-header">
                <div>
                  <div className="sec-modal-title">Set Consultation Charge</div>
                  <div className="sec-modal-sub">
                    {`${norm(chargeTarget.firstName || chargeTarget.first_name)} ${norm(chargeTarget.lastName || chargeTarget.last_name)}`.trim() || 'Patient'} • {fmtDate(chargeTarget.appointmentDate || chargeTarget.appointment_date)} {fmtTime(chargeTarget.appointmentTime || chargeTarget.appointment_time)}
                  </div>
                </div>
                <button className="sec-icon-btn" type="button" onClick={closeCharge}>
                  <XCircle size={18} />
                </button>
              </div>

              <div className="sec-modal-body">
                {chargeError ? <div className="sec-error" style={{ marginBottom: 10 }}>{chargeError}</div> : null}
                <div className="sec-pay-summary">
                  <div className="sec-pay-summary-row strong">
                    <div className="sec-pay-summary-k">Total Charge</div>
                    <div className="sec-pay-summary-v">₱{toMoney(chargeForm.amount)}</div>
                  </div>
                  <div className="sec-pay-summary-row">
                    <div className="sec-pay-summary-k">Next step</div>
                    <div className="sec-pay-summary-v" style={{ fontWeight: 800 }}>Cashier will collect payment</div>
                  </div>
                </div>
                <div className="sec-form-grid">
                  <div className="sec-field sec-field-full">
                    <label>Service</label>
                    <select
                      className="sec-input"
                      value={chargeForm.serviceKey}
                      onChange={(e) => {
                        const nextKey = String(e.target.value || '').trim();
                        const fee = nextKey ? serviceFeeMap.get(nextKey.toLowerCase()) : null;
                        const nextAmount = fee && Number(fee.defaultFee || 0) > 0 ? String(Number(fee.defaultFee || 0)) : (chargeForm.amount || '1');
                        setChargeForm((v) => ({ ...v, serviceKey: nextKey, amount: nextAmount }));
                      }}
                      disabled={serviceFeesLoading}
                    >
                      <option value="">{serviceFeesLoading ? 'Loading services…' : 'Custom / Not specified'}</option>
                      {activeServiceFees.map((s) => (
                        <option key={s.serviceKey} value={s.serviceKey}>
                          {s.serviceName} • ₱{toMoney(s.defaultFee)}
                        </option>
                      ))}
                    </select>
                    {serviceFeesError ? <div className="sec-field-hint error">{serviceFeesError}</div> : null}
                  </div>
                  <div className="sec-field">
                    <label>Amount (₱)</label>
                    <input
                      className="sec-input"
                      value={chargeForm.amount}
                      onChange={(e) => setChargeForm((v) => ({ ...v, amount: e.target.value }))}
                      placeholder="e.g. 1"
                      type="number"
                      min="1"
                      step="0.01"
                    />
                  </div>
                  <div className="sec-field">
                    <label>Amount Note</label>
                    <div className="sec-input" style={{ display: 'flex', alignItems: 'center', minHeight: 44, background: '#f8fafc', color: '#64748b' }}>
                      Use ₱1 for testing payments.
                    </div>
                  </div>
                </div>
              </div>

              <div className="sec-modal-footer">
                <div className="sec-modal-total">Total Charge: ₱{toMoney(chargeForm.amount)}</div>
                <div className="sec-modal-actions">
                  <button className="sec-btn ghost" type="button" onClick={closeCharge} disabled={chargeSaving}>Cancel</button>
                  <button className="sec-btn primary" type="button" onClick={submitCharge} disabled={chargeSaving}>
                    {chargeSaving ? 'Saving…' : 'Send to Cashier'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {confirmModalOpen && confirmTarget && (
          <div className="sec-modal-overlay" onClick={closeConfirm}>
            <div className="sec-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="sec-modal-header">
                <div>
                  <div className="sec-modal-title">Confirm Schedule</div>
                  <div className="sec-modal-sub">
                    {`${norm(confirmTarget.firstName || confirmTarget.first_name)} ${norm(confirmTarget.lastName || confirmTarget.last_name)}`.trim() || 'Patient'} • {fmtDate(confirmTarget.appointmentDate || confirmTarget.appointment_date)}
                  </div>
                </div>
                <button className="sec-icon-btn" type="button" onClick={closeConfirm}>
                  <XCircle size={18} />
                </button>
              </div>

              <div className="sec-modal-body">
                {confirmError ? <div className="sec-error" style={{ marginBottom: 10 }}>{confirmError}</div> : null}
                <div className="sec-form-grid">
                  <div className="sec-field">
                    <label>Time</label>
                    <input className="sec-input" type="time" value={confirmForm.time} onChange={(e) => setConfirmForm((v) => ({ ...v, time: e.target.value }))} />
                  </div>
                  <div className="sec-field">
                    <label>Status</label>
                    <select className="sec-input" value={confirmForm.status} onChange={(e) => setConfirmForm((v) => ({ ...v, status: e.target.value }))}>
                      <option value="Confirmed">Confirmed</option>
                      <option value="Checked-in">Checked-in</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </div>
                  <div className="sec-field sec-field-full">
                    <label>Note</label>
                    <div className="sec-muted" style={{ padding: 10, border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
                      This will set the exact time for the patient’s request.
                    </div>
                  </div>
                </div>
              </div>

              <div className="sec-modal-footer">
                <div className="sec-modal-actions">
                  <button className="sec-btn ghost" type="button" onClick={closeConfirm} disabled={confirmSaving}>Cancel</button>
                  <button className="sec-btn primary" type="button" onClick={submitConfirm} disabled={confirmSaving}>
                    {confirmSaving ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {assignModalOpen && assignTarget && (
          <ModalShell
            open={assignModalOpen}
            onClose={closeAssign}
            title="Assign Doctor"
            subtitle="Assign an onsite booking to a doctor"
            maxWidth={500}
          >
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px', marginBottom: 24, border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#1e293b', fontSize: '16px', fontWeight: '700' }}>
                    {`${norm(assignTarget.firstName || assignTarget.first_name)} ${norm(assignTarget.lastName || assignTarget.last_name)}`.trim() || 'Patient'} • {fmtDate(assignTarget.appointmentDate || assignTarget.appointment_date)} • {fmtTime(assignTarget.appointmentTime || assignTarget.appointment_time)}
                  </div>
                </div>

                {assignError && <div style={{ color: '#ef4444', background: '#fef2f2', padding: '12px', borderRadius: '12px', fontSize: '14px', fontWeight: '600', marginBottom: 20, border: '1px solid #fee2e2' }}>{assignError}</div>}
                {assignSlotNotice && <div style={{ color: assignSlots.length ? '#0369a1' : '#b45309', background: assignSlots.length ? '#f0f9ff' : '#fffbeb', padding: '12px', borderRadius: '12px', fontSize: '14px', fontWeight: '600', marginBottom: 20, border: `1px solid ${assignSlots.length ? '#bae6fd' : '#fde68a'}` }}>{assignSlotNotice}</div>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ color: '#475569', fontSize: '14px', fontWeight: '700' }}>Assign to doctor</label>
                    <select
                      style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '15px', fontWeight: '600', color: '#1e293b', background: '#ffffff' }}
                      value={assignForm.doctorId}
                      onChange={(e) => setAssignForm((v) => ({ ...v, doctorId: e.target.value }))}
                      disabled={onsiteDoctorsLoading}
                    >
                      <option value="">{onsiteDoctorsLoading ? 'Loading doctors...' : 'Select doctor'}</option>
                      {(Array.isArray(onsiteDoctors) ? onsiteDoctors : []).map((d) => (
                        <option key={String(d.id)} value={String(d.id)}>
                          {norm(d.name) || `Dr. ${norm(d.first_name)} ${norm(d.last_name)}`.trim() || 'Doctor'}{norm(d.status) ? ` • ${norm(d.status)}` : ''}
                        </option>
                      ))}
                    </select>
                    {onsiteDoctorsError && <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: '600', marginTop: 4 }}>{onsiteDoctorsError}</div>}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ color: '#475569', fontSize: '14px', fontWeight: '700' }}>Time</label>
                      {assignSlotsLoading ? (
                        <div style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b', background: '#f8fafc' }}>Loading available times…</div>
                      ) : assignSlots && assignSlots.length > 0 ? (
                        <select
                          style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '15px', fontWeight: '600', color: '#1e293b', background: '#ffffff' }}
                          value={assignForm.time}
                          onChange={(e) => setAssignForm((v) => ({ ...v, time: e.target.value }))}
                        >
                          <option value="">Select time slot</option>
                          {assignSlots.map((s) => (
                            <option key={s.time} value={String(s.time).slice(0, 5)}>
                              {fmtTime(String(s.time).slice(0, 5))}{Number(s.remainingCapacity) > 0 ? ` (${s.remainingCapacity} slot${Number(s.remainingCapacity) === 1 ? '' : 's'} left)` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #fecaca', color: '#b91c1c', background: '#fef2f2' }}>No available times</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ color: '#475569', fontSize: '14px', fontWeight: '700' }}>Status</label>
                      <select 
                        style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '15px', fontWeight: '600', color: '#1e293b', background: '#ffffff' }}
                        value={assignForm.status} 
                        onChange={(e) => setAssignForm((v) => ({ ...v, status: e.target.value }))}
                      >
                        <option value="Confirmed">Confirmed</option>
                        <option value="Checked-in">Checked-in</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ color: '#475569', fontSize: '14px', fontWeight: '700' }}>What this does</label>
                    <div style={{ padding: '14px', background: '#f0f9ff', border: '1px solid #e0f2fe', borderRadius: '12px', color: '#0369a1', fontSize: '14px', fontWeight: '600', lineHeight: '1.5' }}>
                      Assigns this onsite booking to a specific doctor so it appears in the doctor's queue (My Patients).
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
                  <button 
                    type="button"
                    onClick={closeAssign} 
                    disabled={assignSaving}
                    style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', color: '#475569', fontSize: '15px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={submitAssign} 
                    disabled={assignSaving || assignSlotsLoading || !assignForm.doctorId || !assignForm.time || assignSlots.length === 0}
                    style={{ flex: 1, padding: '14px', borderRadius: '12px', border: 'none', background: 'var(--brand-primary-gradient)', color: '#ffffff', fontSize: '15px', fontWeight: '700', cursor: assignSaving || assignSlotsLoading || !assignForm.time || assignSlots.length === 0 ? 'not-allowed' : 'pointer', opacity: assignSaving || assignSlotsLoading || !assignForm.time || assignSlots.length === 0 ? 0.6 : 1, boxShadow: '0 4px 6px -1px rgba(249, 115, 22, 0.2)' }}
                  >
                    {assignSaving ? 'Assigning...' : 'Confirm & Assign'}
                  </button>
                </div>
          </ModalShell>
        )}

        <PatientFullRecordModal
          open={centralRecordOpen}
          onClose={() => setCentralRecordOpen(false)}
          patientId={centralRecordPatientId}
          patientLabel={centralRecordPatientLabel}
          role="doctor_secretary"
          user={{ ...user, role: 'doctor_secretary' }}
        />

        <SignOutConfirmModal
          open={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={() => {
            setShowLogoutConfirm(false);
            logout();
          }}
        />
      </main>
    </div>
  );
}
