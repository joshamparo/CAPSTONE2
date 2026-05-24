import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    LogOut, 
    User, 
    Users, 
    MessageSquare, 
    ChevronDown, 
    ChevronUp, 
    ChevronLeft,
    ChevronRight, 
    Bell, 
    Settings,
    AlertCircle,
    AlertOctagon,
    Printer,
    Search,
    Eye,
    BedDouble,
    Bed,
    LayoutDashboard,
    Activity,
    FileText,
    Calendar,
    ClipboardList,
    ArrowLeft,
    Stethoscope,
    UserCheck,
    Clipboard,
    Check,
    Trash2,
    FilePenLine,
    LogIn,
    Pill,
    FlaskConical,
    Package,
    Clock,
    CheckCircle,
    XCircle,
    X,
    Plus,
    Phone,
    AlertTriangle,
    Info,
    MapPin,
    Copy,
    Save,
    Megaphone,
    RotateCw,
    Send,
    Upload,
    Menu
  } from 'lucide-react';
import './NurseDashboard.css';
import '../Admin/AdminDashboard.css'; 
import { supabase } from '../lib/supabaseClient';
import { checkBackendHealth, fetchJson } from '../utils/api';
import SignOutConfirmModal from '../components/SignOutConfirmModal';
import ConfirmModal from '../components/ConfirmModal';
import PatientFullRecordModal from '../components/PatientFullRecordModal';

const hasMojibake = (value) => /Ãƒ|Ã‚|Ã¢|Ã†â€™|ï¿½/.test(String(value || ''));

const repairMojibake = (value) => {
  if (value === null || value === undefined) return '';
  const original = String(value);
  if (!original || !hasMojibake(original)) return original;

  const attempts = [original];

  try {
    attempts.push(decodeURIComponent(escape(original)));
  } catch (_) {}

  try {
    const bytes = Uint8Array.from(Array.from(original).map((char) => char.charCodeAt(0) & 0xff));
    attempts.push(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
  } catch (_) {}

  const cleanup = (text) =>
    String(text || '')
      .replace(/ï¿½|Ã¯Â¿Â½|ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢/g, 'â€¢')
      .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“|ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ/g, 'â€“')
      .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢/g, "'")
      .replace(/ï¿½C|Ã¯Â¿Â½C/g, 'Â°C')
      .replace(/SpOÃƒ.*?2/g, 'SpO2')
      .replace(/\s*â€¢\s*/g, ' â€¢ ')
      .replace(/\s+/g, ' ')
      .trim();

  const score = (text) => {
    const valueText = String(text || '');
    const badMatches = valueText.match(/Ãƒ|Ã‚|Ã¢|Ã†â€™|ï¿½/g) || [];
    return badMatches.length;
  };

  const cleaned = attempts
    .map(cleanup)
    .filter(Boolean)
    .sort((a, b) => score(a) - score(b));

  return cleaned[0] || cleanup(original);
};

function NurseDashboard() {
  const navigate = useNavigate();
  const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });
  const [view, setView] = useState('overview');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [user, setUser] = useState({
    name: 'Nurse',
    roleLabel: 'Nurse',
    departmentLabel: '',
    specialization: '',
    shiftLabel: '',
    email: ''
  });
  const [isSchedulesOpen, setIsSchedulesOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Department State
  const normalizeDeptId = (v) => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const up = raw.toUpperCase().replace(/\s+/g, '');
    if (up === 'EMERGENCYROOM' || up === 'EMERGENCY' || up === 'ER') return 'ER';
    if (up === 'OUTPATIENTDEPT' || up === 'OUTPATIENT' || up === 'OPD') return 'OPD';
    if (up === 'PEDIATRICS' || up === 'PEDIA') return 'PEDIA';
    if (up === 'MEDICINE' || up === 'INTERNALMEDICINE') return 'MEDICINE';
    return raw;
  };

  const normalizeServiceKey = (v) => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    return raw.toLowerCase().replace(/\s+/g, '');
  };

  const normalizeServiceAliasKey = (v) => {
    const k = normalizeServiceKey(v);
    if (!k) return '';
    if (k === 'emergencyroom' || k === 'emergency') return 'er';
    return k;
  };

  const deptAllowsService = (deptRaw, serviceRaw) => {
    const deptId = normalizeDeptId(deptRaw);
    const deptKey = normalizeServiceAliasKey(deptRaw);
    const serviceKey = normalizeServiceAliasKey(serviceRaw);
    if (!deptId && !deptKey) return true;
    if (deptId === 'ER' || deptKey === 'er') {
      return serviceKey === 'er' || serviceKey === 'surgery' || serviceKey.includes('surgery');
    }
    return serviceKey === deptKey || (serviceKey && deptKey && (serviceKey.includes(deptKey) || deptKey.includes(serviceKey)));
  };

  const toDbId = (v) => {
    const s = String(v || '').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    return s;
  };

  const [activeDept] = useState(() => {
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const dept = currentUser?.department || currentUser?.specialization || currentUser?.dept;
      return normalizeDeptId(dept) || 'ER';
    } catch (_) {
      return 'ER';
    }
  });

  const formatDepartmentLabel = (deptId) => {
    const normalized = normalizeDeptId(deptId);
    const match = departments.find((department) => department.id === normalized);
    return match?.label || String(deptId || '').trim() || 'Department';
  };

  const normalizeSpecializationKey = (value) =>
    String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');

  const deriveShiftLabel = (rawShift) => {
    const explicit = String(rawShift || '').trim();
    if (explicit) return explicit;
    const hour = new Date().getHours();
    if (hour >= 7 && hour < 15) return 'Morning Shift';
    if (hour >= 15 && hour < 23) return 'Afternoon Shift';
    return 'Night Shift';
  };

  // Patients Data State
  const [patientsList, setPatientsList] = useState([]);
  const [patientRecords, setPatientRecords] = useState([]);
  const [patientRecordsLoading, setPatientRecordsLoading] = useState(false);
  const [patientRecordsError, setPatientRecordsError] = useState('');

  const [showUploadResultModal, setShowUploadResultModal] = useState(false);
  const [uploadTargetRecord, setUploadTargetRecord] = useState(null);
  const [uploadResultFile, setUploadResultFile] = useState(null);
  const [uploadResultTitle, setUploadResultTitle] = useState('');
  const [uploadResultType, setUploadResultType] = useState('Lab');
  const [uploadResultDate, setUploadResultDate] = useState('');
  const [uploadResultSaving, setUploadResultSaving] = useState(false);
  const [uploadResultError, setUploadResultError] = useState('');

  const normalizePatient = (p) => {
    const emergency = p?.emergencyContacts || p?.emergency_contacts || null;
    const emergencyContacts = Array.isArray(emergency)
      ? emergency.map((c) => ({
          name: c?.name || '',
          relationship: c?.relationship || '',
          phone: c?.phone || c?.contactNumber || c?.contact_number || ''
        }))
      : null;

    return {
      ...p,
      _id: p?._id || p?.id,
      firstName: repairMojibake(p?.firstName || p?.first_name || ''),
      lastName: repairMojibake(p?.lastName || p?.last_name || ''),
      middleName: repairMojibake(p?.middleName || p?.middle_name || ''),
      contactNumber: repairMojibake(p?.contactNumber || p?.contact_number || ''),
      dateOfBirth: p?.dateOfBirth || p?.date_of_birth || null,
      sex: repairMojibake(p?.sex || p?.gender || ''),
      bloodType: repairMojibake(p?.bloodType || p?.blood_type || ''),
      philHealthNumber: repairMojibake(p?.philHealthNumber || p?.philhealth_number || ''),
      admissionStatus: repairMojibake(p?.admissionStatus || p?.admission_status || ''),
      wardNumber: repairMojibake(p?.wardNumber || p?.ward_number || ''),
      attendingDoctor: repairMojibake(p?.attendingDoctor || p?.attending_doctor || ''),
      admissionDate: p?.admissionDate || p?.admission_date || null,
      diagnosis: repairMojibake(p?.diagnosis || ''),
      allergies: repairMojibake(p?.allergies || ''),
      email: repairMojibake(p?.email || ''),
      emergencyContacts
    };
  };

  const getAuthHeaders = () => {
    try {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const role = String(currentUser?.role || currentUser?.accountType || currentUser?.account_type || 'nurse').toLowerCase();
      const email = String(currentUser?.email || '').trim();
      const first = String(currentUser?.firstName || currentUser?.first_name || '').trim();
      const last = String(currentUser?.lastName || currentUser?.last_name || '').trim();
      const fullName = `${first} ${last}`.trim();
      const name = String(currentUser?.name || fullName || email || '').trim();
      return {
        'x-user-role': role,
        ...(email ? { 'x-user-email': email } : {}),
        ...(name ? { 'x-user-name': name } : {})
      };
    } catch (_) {
      return { 'x-user-role': 'nurse' };
    }
  };

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
  }, [API_BASE]);

  // Filtered Patients by Department
  const deptPatients = useMemo(() => {
    const list = Array.isArray(patientsList) ? patientsList : [];
    const filtered = list.filter((p) => {
      const deptRaw = p?.department || p?.wardNumber || p?.ward_number || p?.ward || '';
      const pDept = normalizeDeptId(deptRaw);
      const status = String(p?.admissionStatus || p?.admission_status || '').trim();
      const statusUp = status.toUpperCase();

      if (activeDept === 'ER') return pDept === 'ER' || statusUp === 'EMERGENCY';
      if (activeDept === 'OPD') return statusUp === 'OUTPATIENT' || !status;
      if (activeDept === 'PEDIA') return pDept === 'PEDIA' || (p?.age && Number(p.age) < 18);
      if (activeDept === 'MEDICINE') return pDept === 'MEDICINE' || statusUp === 'INPATIENT';
      return true;
    });

    return filtered.length ? filtered : list;
  }, [patientsList, activeDept]);

  const departments = [
    { id: 'ER', label: 'Emergency Room', icon: <AlertCircle size={18} />, color: '#ef4444' },
    { id: 'OPD', label: 'Outpatient Dept', icon: <Users size={18} />, color: '#3b82f6' },
    { id: 'PEDIA', label: 'Pediatrics', icon: <Activity size={18} />, color: '#ec4899' },
    { id: 'MEDICINE', label: 'Dept. of Medicine', icon: <Stethoscope size={18} />, color: '#10b981' }
  ];

  const nurseWorkspace = useMemo(() => {
    const raw = user.specialization || activeDept || user.departmentLabel || 'General';
    const key = normalizeSpecializationKey(raw);
    const fallback = {
      type: 'general',
      label: formatDepartmentLabel(raw),
      shortLabel: formatDepartmentLabel(raw),
      eyebrow: 'General nursing workspace',
      description: 'Unified nurse operations with handover, tasks, medication administration, and patient coordination.',
      heroTone: 'workspace-general',
      supportsPatientSpaces: false,
      primaryTitle: 'Service Coordination',
      secondaryTitle: 'Doctor Coordination',
      taskLabel: 'Shared nurse tasks'
    };

    if (key === 'PEDIA' || key === 'PEDIATRICS') {
      return {
        type: 'pedia',
        label: 'Pediatric Nursing',
        shortLabel: 'Pedia',
        eyebrow: 'Child-focused care workspace',
        description: 'Prioritize pediatric observation, medication safety, family follow-up, and endorsed bedside care.',
        heroTone: 'workspace-pedia',
        supportsPatientSpaces: true,
        primaryTitle: 'Pediatric Bedside Board',
        secondaryTitle: 'Pediatric Observation Watch',
        taskLabel: 'Pedia watchlist'
      };
    }

    if (key === 'MEDICINE' || key === 'ORTHOPEDICS') {
      return {
        type: 'bedside',
        label: key === 'ORTHOPEDICS' ? 'Orthopedic Nursing' : 'Ward Nursing',
        shortLabel: key === 'ORTHOPEDICS' ? 'Ortho' : 'Ward',
        eyebrow: 'Bedside rounds workspace',
        description: 'Lead bedside rounds, medication schedules, doctor endorsements, and inpatient handoff from one workspace.',
        heroTone: 'workspace-bedside',
        supportsPatientSpaces: true,
        primaryTitle: 'Bedside Rounds Board',
        secondaryTitle: 'Clinical Watchlist',
        taskLabel: 'Bedside action items'
      };
    }

    if (key === 'ER' || key === 'EMERGENCYROOM' || key === 'EMERGENCY') {
      return {
        type: 'emergency',
        label: 'Emergency Nursing',
        shortLabel: 'ER',
        eyebrow: 'Emergency support workspace',
        description: 'Coordinate emergency-room patient spaces, medication support, and shift coverage without switching modules.',
        heroTone: 'workspace-emergency',
        supportsPatientSpaces: true,
        primaryTitle: 'Emergency Support Board',
        secondaryTitle: 'Live Observation Watch',
        taskLabel: 'ER support tasks'
      };
    }

    if (key === 'OPD' || key === 'DENTALCLINIC' || key === 'OTOLARYNGOLOGYENT' || key === 'PHYSICALTHERAPY') {
      return {
        type: 'clinic',
        label: key === 'DENTALCLINIC' ? 'Dental Clinic Nursing' : key === 'OTOLARYNGOLOGYENT' ? 'ENT Clinic Nursing' : key === 'PHYSICALTHERAPY' ? 'Physical Therapy Nursing' : 'Outpatient Nursing',
        shortLabel: key === 'OPD' ? 'OPD' : formatDepartmentLabel(raw),
        eyebrow: 'Clinic flow workspace',
        description: 'Keep rooming, follow-up coordination, and shared clinic support visible through the entire shift.',
        heroTone: 'workspace-clinic',
        supportsPatientSpaces: false,
        primaryTitle: 'Clinic Flow Board',
        secondaryTitle: 'Doctor & Follow-up Coverage',
        taskLabel: 'Clinic support tasks'
      };
    }

    if (key === 'LABORATORY' || key === 'PATHOLOGY') {
      return {
        type: 'diagnostic',
        label: key === 'PATHOLOGY' ? 'Pathology Nursing' : 'Laboratory Nursing',
        shortLabel: key === 'PATHOLOGY' ? 'Pathology' : 'Laboratory',
        eyebrow: 'Diagnostic support workspace',
        description: 'Track specimen endorsements, diagnostic support tasks, and doctor coordination from a single queue.',
        heroTone: 'workspace-diagnostic',
        supportsPatientSpaces: false,
        primaryTitle: 'Diagnostic Support Board',
        secondaryTitle: 'Doctor Endorsements',
        taskLabel: 'Specimen support tasks'
      };
    }

    if (key === 'RADIOLOGY' || key === 'ECG') {
      return {
        type: 'imaging',
        label: key === 'ECG' ? 'ECG Nursing Support' : 'Radiology Nursing',
        shortLabel: key === 'ECG' ? 'ECG' : 'Radiology',
        eyebrow: 'Imaging support workspace',
        description: 'Coordinate patient prep, endorsed exams, and doctor-linked imaging support with the same shared workflow.',
        heroTone: 'workspace-imaging',
        supportsPatientSpaces: false,
        primaryTitle: 'Imaging Support Board',
        secondaryTitle: 'Exam Coordination',
        taskLabel: 'Imaging support tasks'
      };
    }

    if (key === 'VIDEOCONSULTATION') {
      return {
        type: 'remote',
        label: 'Video Consultation Nursing',
        shortLabel: 'Video Consult',
        eyebrow: 'Remote care workspace',
        description: 'Handle virtual consult assists, follow-up documentation, and cross-team coordination without leaving the nurse hub.',
        heroTone: 'workspace-remote',
        supportsPatientSpaces: false,
        primaryTitle: 'Virtual Assist Board',
        secondaryTitle: 'Doctor Coordination',
        taskLabel: 'Remote support tasks'
      };
    }

    if (key === 'SURGERYMINOR' || key === 'ANESTHESIA') {
      return {
        type: 'procedure',
        label: key === 'ANESTHESIA' ? 'Anesthesia Nursing' : 'Minor Surgery Nursing',
        shortLabel: key === 'ANESTHESIA' ? 'Anesthesia' : 'Minor Surgery',
        eyebrow: 'Procedure support workspace',
        description: 'Keep prep tasks, recovery support, medication coverage, and doctor coordination aligned around procedures.',
        heroTone: 'workspace-procedure',
        supportsPatientSpaces: false,
        primaryTitle: 'Procedure Support Board',
        secondaryTitle: 'Procedure Coordination',
        taskLabel: 'Procedure support tasks'
      };
    }

    return fallback;
  }, [user.specialization, user.departmentLabel, activeDept]);

  // Appointment State
  const [appointments, setAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState('');
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [approvalInbox, setApprovalInbox] = useState([]);
  const [approvalInboxLoading, setApprovalInboxLoading] = useState(false);
  const [approvalInboxError, setApprovalInboxError] = useState('');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [approvalThread, setApprovalThread] = useState(null);
  const [approvalMessages, setApprovalMessages] = useState([]);
  const [approvalThreadLoading, setApprovalThreadLoading] = useState(false);
  const [approvalThreadError, setApprovalThreadError] = useState('');
  const [approvalMessageText, setApprovalMessageText] = useState('');
  const [approvalSending, setApprovalSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestDate, setSuggestDate] = useState('');
  const [suggestTime, setSuggestTime] = useState('');
  const [suggestNote, setSuggestNote] = useState('');
  const [approvalServiceFilter, setApprovalServiceFilter] = useState('All');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState('All');

  const nurseInboxName = useMemo(() => {
    const u = JSON.parse(localStorage.getItem('currentUser')) || {};
    const first = u.firstName || u.first_name || '';
    const last = u.lastName || u.last_name || '';
    const full = `${first} ${last}`.trim();
    if (full) return full;
    return u.name || 'Nurse';
  }, []);

  const approvalDepartment = useMemo(() => {
    try {
      const u = JSON.parse(localStorage.getItem('currentUser') || '{}');
      return String(u.department || u.specialization || '').trim();
    } catch (_) {
      return '';
    }
  }, []);

  const getApprovalServiceType = (t) => {
    const direct = String(t?.serviceType || t?.service_type || '').trim();
    if (direct) return direct;
    const reason = String(t?.reason || '').trim();
    if (!reason) return 'General';
    const idx = reason.indexOf(':');
    if (idx > 0) return reason.slice(0, idx).trim();
    if (/^(need|approval)\b/i.test(reason)) return 'General';
    return reason;
  };

  const approvalServiceOptions = useMemo(() => {
    const seen = new Map();
    (approvalInbox || []).forEach((t) => {
      const label = String(getApprovalServiceType(t) || '').trim();
      const key = normalizeServiceKey(label);
      if (!key) return;
      if (!seen.has(key)) seen.set(key, label);
    });
    return Array.from(seen.values()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [approvalInbox]);

  const filteredApprovalInbox = useMemo(() => {
    return (approvalInbox || []).filter((t) => {
      if (approvalStatusFilter !== 'All' && String(t.status || '').trim() !== approvalStatusFilter) return false;
      if (approvalServiceFilter !== 'All') {
        const itemKey = normalizeServiceKey(getApprovalServiceType(t));
        const filterKey = normalizeServiceKey(approvalServiceFilter);
        if (itemKey !== filterKey) return false;
      }
      return true;
    });
  }, [approvalInbox, approvalServiceFilter, approvalStatusFilter]);

  const [activeAppointmentTab, setActiveAppointmentTab] = useState('requests'); // 'requests' or 'confirmed'
  const [appointmentRangeFilter, setAppointmentRangeFilter] = useState('Today'); // Today | All
  const [appointmentBucketFilter, setAppointmentBucketFilter] = useState('Needs Action'); // Needs Action | Late | Confirmed | Checked-In | No-Show | Completed | Cancelled | All
  const [appointmentModeFilter, setAppointmentModeFilter] = useState('All'); // All | Video | Onsite
  const [appointmentSearchText, setAppointmentSearchText] = useState('');

  const [consultPriorityRows, setConsultPriorityRows] = useState([]);
  const [consultPriorityLoading, setConsultPriorityLoading] = useState(false);
  const [consultPriorityError, setConsultPriorityError] = useState('');
  const [consultPriorityRange, setConsultPriorityRange] = useState('Today'); // Today | Week | All
  const [consultPriorityStatus, setConsultPriorityStatus] = useState('Pending'); // Pending | All
  const [consultPriorityQuery, setConsultPriorityQuery] = useState('');

  const filteredConsultPriorityRows = useMemo(() => {
    const list = Array.isArray(consultPriorityRows) ? consultPriorityRows : [];
    const q = String(consultPriorityQuery || '').trim().toLowerCase();

    const inRange = (dateValue) => {
      if (consultPriorityRange === 'All') return true;
      const d = dateValue ? new Date(dateValue) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      if (consultPriorityRange === 'Today') return d.toDateString() === new Date().toDateString();
      if (consultPriorityRange === 'Week') {
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);
        return d >= start && d <= now;
      }
      return true;
    };

    return list.filter((r) => {
      const st = String(r.status || '').trim().toLowerCase();
      if (consultPriorityStatus === 'Pending' && !st.includes('pending')) return false;

      const when = r.requestedDate || r.createdAt || null;
      if (!inRange(when)) return false;

      if (!q) return true;
      const hay = `${r.patientName || ''} ${r.email || ''} ${r.cleanReason || ''} ${r.doctorName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [consultPriorityQuery, consultPriorityRange, consultPriorityRows, consultPriorityStatus]);

  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [triageTargetAppointment, setTriageTargetAppointment] = useState(null);
  const [triageDraftLevel, setTriageDraftLevel] = useState('');
  const [triageDraftNote, setTriageDraftNote] = useState('');
  const [triageAiLoading, setTriageAiLoading] = useState(false);
  const [triageAiSuggestion, setTriageAiSuggestion] = useState(null);

  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditTargetAppointment, setAuditTargetAppointment] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditError, setAuditError] = useState('');

  const [walkInNextSteps, setWalkInNextSteps] = useState(null);
  const [walkInNextStepsOpen, setWalkInNextStepsOpen] = useState(false);
  const [walkInPharmacyDest, setWalkInPharmacyDest] = useState('in_house'); // in_house | outside
  const [walkInPharmacyNotes, setWalkInPharmacyNotes] = useState('');

  // --- Add Patient Modal State ---
  const [showAddPatientModal, setShowAddPatientModal] = useState(false);
  const [addPatientStep, setAddPatientStep] = useState(1);
  const [addPatientSaving, setAddPatientSaving] = useState(false);
  const [addPatientError, setAddPatientError] = useState("");
  const [walkInDoctorOptions, setWalkInDoctorOptions] = useState([]);
  const [walkInDoctorLoading, setWalkInDoctorLoading] = useState(false);
  const [walkInDoctorError, setWalkInDoctorError] = useState('');
  const [walkInSpecializationOptions, setWalkInSpecializationOptions] = useState([]);
  const [walkInSpecializationLoading, setWalkInSpecializationLoading] = useState(false);
  const [walkInPatientPage, setWalkInPatientPage] = useState(1);
  const [triageCommittedData, setTriageCommittedData] = useState(null);
  const [addPatientData, setAddPatientData] = useState({
    patientMode: "new",
    routeType: "er_consult",
    existingPatientId: "",
    patientLookup: "",
    doctorId: "",
    doctorName: "",
    selectedSpecialization: "",
    consultTiming: "same_day",
    preferredDate: "",
    preferredTime: "",
    confirmNotDuplicate: false,
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "Male",
    contactNumber: "",
    email: "",
    address: "",
    bloodType: "A+",
    // Vitals
    temperature: "",
    bp_systolic: "",
    bp_diastolic: "",
    heartRate: "",
    respiratoryRate: "",
    spo2: "",
    weight: "",
    height: "",
    mainConcern: "",
    existingConditions: "",
    routeNote: "",
    painLevel: "0",
    nextStepLab: false,
    nextStepImaging: false,
    nextStepPharmacy: false
  });

  const walkInRouteOptions = [
    { value: 'er_consult', title: 'ER Consultation', hint: 'Urgent nurse-led triage that moves into the doctor queue immediately.' },
    { value: 'onsite_consult', title: 'Clinic Consultation', hint: 'Front desk clinic intake routed to the correct doctor secretary queue by specialization.' },
    { value: 'lab', title: 'Laboratory', hint: 'Create a walk-in lab service request tied to the patient record.' },
    { value: 'imaging', title: 'Imaging / ECG', hint: 'Route the patient into imaging, radiology, or ECG support.' },
    { value: 'pharmacy', title: 'Pharmacy', hint: 'Record a pharmacy-only walk-in and create the service handoff note.' },
    { value: 'admission_eval', title: 'Admission Evaluation', hint: 'Prepare the case for doctor-led admission review before room assignment.' }
  ];

  const walkInNeedsDoctor =
    addPatientData.routeType === 'er_consult' ||
    addPatientData.routeType === 'admission_eval';

  const TRIAGE_FIELD_NAMES = new Set(['temperature', 'bp_systolic', 'bp_diastolic', 'heartRate', 'respiratoryRate', 'spo2', 'painLevel']);

  const walkInPatientDirectory = useMemo(() => {
    const seen = new Map();
    [...(Array.isArray(patientsList) ? patientsList : []), ...(Array.isArray(patientRecords) ? patientRecords : [])].forEach((raw) => {
      const patient = normalizePatient(raw);
      const id = String(patient?._id || patient?.id || '').trim();
      if (!id || seen.has(id)) return;
      seen.set(id, patient);
    });
    return Array.from(seen.values());
  }, [patientsList, patientRecords]);

  const walkInPatientMatches = useMemo(() => {
    if (addPatientData.patientMode !== 'existing') return [];
    const query = String(addPatientData.patientLookup || '').trim().toLowerCase();
    if (!query) return walkInPatientDirectory;
    return walkInPatientDirectory.filter((patient) => {
      const name = `${patient.firstName || ''} ${patient.lastName || ''}`.trim().toLowerCase();
      const email = String(patient.email || '').toLowerCase();
      const phone = String(patient.contactNumber || '').toLowerCase();
      return name.includes(query) || email.includes(query) || phone.includes(query);
    });
  }, [addPatientData.patientLookup, addPatientData.patientMode, walkInPatientDirectory]);

  const walkInPatientPageSize = 8;

  const walkInPatientPageCount = useMemo(() => {
    const total = Array.isArray(walkInPatientMatches) ? walkInPatientMatches.length : 0;
    return Math.max(1, Math.ceil(total / walkInPatientPageSize));
  }, [walkInPatientMatches]);

  const walkInPatientPageItems = useMemo(() => {
    const currentPage = Math.min(walkInPatientPage, walkInPatientPageCount);
    const startIndex = (currentPage - 1) * walkInPatientPageSize;
    return walkInPatientMatches.slice(startIndex, startIndex + walkInPatientPageSize);
  }, [walkInPatientMatches, walkInPatientPage, walkInPatientPageCount]);

  const walkInPatientMatchCount = walkInPatientMatches.length;
  const walkInPatientRangeStart = walkInPatientMatchCount === 0 ? 0 : ((Math.min(walkInPatientPage, walkInPatientPageCount) - 1) * walkInPatientPageSize) + 1;
  const walkInPatientRangeEnd = walkInPatientMatchCount === 0 ? 0 : Math.min(walkInPatientMatchCount, walkInPatientRangeStart + walkInPatientPageItems.length - 1);

  const selectedWalkInPatient = useMemo(() => {
    const targetId = String(addPatientData.existingPatientId || '').trim();
    if (!targetId) return null;
    return walkInPatientDirectory.find((patient) => String(patient._id || patient.id || '').trim() === targetId) || null;
  }, [addPatientData.existingPatientId, walkInPatientDirectory]);

  const handleAddPatientChange = (e) => {
    const { name, value } = e.target;
    setAddPatientData((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'patientMode') {
        if (value === 'new') {
          next.existingPatientId = '';
          next.patientLookup = '';
          next.confirmNotDuplicate = false;
        } else {
          next.firstName = '';
          next.middleName = '';
          next.lastName = '';
          next.dateOfBirth = '';
          next.gender = 'Male';
          next.contactNumber = '';
          next.email = '';
          next.address = '';
          next.bloodType = 'A+';
          next.confirmNotDuplicate = false;
        }
      }
      if (name === 'routeType') {
        if (value === 'er_consult') {
          next.selectedSpecialization = '';
          next.consultTiming = 'same_day';
          next.preferredDate = '';
          next.preferredTime = '';
        } else if (value === 'onsite_consult') {
          next.doctorId = '';
          next.doctorName = '';
        }
      }
      if (name === 'consultTiming' && value === 'same_day') {
        next.preferredDate = '';
        next.preferredTime = '';
      }
      if (name === 'selectedSpecialization' && String(value || '').trim()) {
        next.doctorId = '';
        next.doctorName = '';
      }
      if (name === 'doctorId') {
        const match = walkInDoctorOptions.find((doctor) => String(doctor.id) === String(value));
        next.doctorName = match?.name || '';
        try {
          if (String(next.routeType || '').trim() === 'er_consult' && String(value || '').trim()) {
            localStorage.setItem('nurse_er_last_doctor_id', String(value));
          }
        } catch (_) {}
      }
      return next;
    });
  };

  const handleWalkInTriageCommit = () => {
    setTriageCommittedData((prev) => ({ ...(prev || {}), ...addPatientData }));
  };

  const pickExistingWalkInPatient = (patient) => {
    const id = String(patient?._id || patient?.id || '').trim();
    if (!id) return;
    setAddPatientData((prev) => ({
      ...prev,
      existingPatientId: id,
      patientLookup: `${patient.firstName || ''} ${patient.lastName || ''}`.trim(),
      contactNumber: patient.contactNumber || '',
      email: patient.email || '',
      address: patient.street || patient.address || '',
      bloodType: patient.bloodType || prev.bloodType || 'A+'
    }));
  };

  useEffect(() => {
    setWalkInPatientPage(1);
  }, [addPatientData.patientLookup, addPatientData.patientMode]);

  useEffect(() => {
    if (!showAddPatientModal) return;
    if ((!patientRecords || patientRecords.length === 0) && typeof fetchPatientRecords === 'function') {
      fetchPatientRecords().catch(() => {});
    }
    let cancelled = false;
    const loadDoctors = async () => {
      setWalkInDoctorLoading(true);
      setWalkInDoctorError('');
      try {
        const params = new URLSearchParams();
        // ER consults must be routed to Medicine doctors assigned to ER and currently Online.
        if (String(addPatientData.routeType || '').trim() === 'er_consult') {
          params.set('specialization', 'Medicine');
          params.set('department', 'ER');
          params.set('status', 'Online');
        }
        const suffix = params.toString() ? `?${params.toString()}` : '';
        const data = await fetchJson(`/api/video-consults/doctors${suffix}`, {
          apiBase: API_BASE,
          headers: { ...getAuthHeaders() }
        });
        if (cancelled) return;
        setWalkInDoctorOptions(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled) return;
        setWalkInDoctorOptions([]);
        setWalkInDoctorError(String(e?.message || 'Unable to load doctor list.'));
      } finally {
        if (!cancelled) setWalkInDoctorLoading(false);
      }
    };
    loadDoctors();
    return () => { cancelled = true; };
  }, [addPatientData.routeType, showAddPatientModal]);

  useEffect(() => {
    if (!showAddPatientModal) return;
    let cancelled = false;
    const loadSpecializations = async () => {
      setWalkInSpecializationLoading(true);
      try {
        const data = await fetchJson(`/api/doctors/specializations`, {
          apiBase: API_BASE,
          headers: { ...getAuthHeaders() }
        });
        if (cancelled) return;
        setWalkInSpecializationOptions(
          Array.isArray(data) ? data.map((item) => String(item || '').trim()).filter(Boolean) : []
        );
      } catch (_) {
        if (!cancelled) setWalkInSpecializationOptions([]);
      } finally {
        if (!cancelled) setWalkInSpecializationLoading(false);
      }
    };
    loadSpecializations();
    return () => { cancelled = true; };
  }, [showAddPatientModal]);

  useEffect(() => {
    if (!showAddPatientModal) return;
    if (String(addPatientData.routeType || '').trim() !== 'er_consult') return;
    if (String(addPatientData.doctorId || '').trim()) return;
    try {
      const last = localStorage.getItem('nurse_er_last_doctor_id');
      if (last && walkInDoctorOptions.some((d) => String(d.id) === String(last))) {
        handleAddPatientChange({ target: { name: 'doctorId', value: String(last) } });
      }
    } catch (_) {}
  }, [addPatientData.doctorId, addPatientData.routeType, showAddPatientModal, walkInDoctorOptions]);

  const handleAddPatientSubmit = async (e) => {
    e.preventDefault();
    setAddPatientError("");

    if (addPatientStep === 1) {
      if (!addPatientData.routeType) {
        setAddPatientError("Choose the walk-in destination first.");
        return;
      }
      if (addPatientData.patientMode === 'existing') {
        if (!addPatientData.existingPatientId) {
          setAddPatientError("Select the existing patient before continuing.");
          return;
        }
      } else if (!addPatientData.firstName || !addPatientData.lastName || !addPatientData.dateOfBirth) {
        setAddPatientError("Please fill in the required patient identity details.");
        return;
      } else {
        const fn = String(addPatientData.firstName || '').trim().toLowerCase();
        const ln = String(addPatientData.lastName || '').trim().toLowerCase();
        const dob = String(addPatientData.dateOfBirth || '').trim();
        const possible = walkInPatientDirectory.find((p) => {
          const pfn = String(p.firstName || p.first_name || '').trim().toLowerCase();
          const pln = String(p.lastName || p.last_name || '').trim().toLowerCase();
          const pdobRaw = p.dateOfBirth || p.date_of_birth || p.dob || null;
          const pdob = pdobRaw ? new Date(pdobRaw).toISOString().slice(0, 10) : '';
          return pfn === fn && pln === ln && pdob === dob;
        });
        if (possible && !addPatientData.confirmNotDuplicate) {
          setAddPatientError("Possible duplicate found. Use Existing Patient or confirm this is a new record.");
          return;
        }
      }
      setTriageCommittedData({ ...addPatientData });
      setAddPatientStep(2);
      return;
    }

    if (!addPatientData.mainConcern) {
      setAddPatientError("Main concern is required for walk-in intake.");
      return;
    }
    if (quickTriage.issues.length) {
      setAddPatientError("Please fix the Quick Triage items first.");
      return;
    }
    if (quickTriage.suggestedRouteType === 'er_consult' && addPatientData.routeType !== 'er_consult') {
      setAddPatientError("Quick Triage suggests ER Consultation for this acuity. Switch to ER to continue.");
      return;
    }
    if (addPatientData.routeType === 'onsite_consult' && !String(addPatientData.selectedSpecialization || '').trim()) {
      setAddPatientError("Choose the clinic specialization first so the patient reaches the correct doctor secretary queue.");
      return;
    }
    if (addPatientData.routeType === 'onsite_consult' && addPatientData.consultTiming === 'future_schedule' && !String(addPatientData.preferredDate || '').trim()) {
      setAddPatientError("Select the preferred date for this clinic consultation.");
      return;
    }
    if (walkInNeedsDoctor && !addPatientData.doctorId) {
      setAddPatientError("Assign a doctor first so the walk-in consult reaches the correct doctor queue.");
      return;
    }

    setAddPatientSaving(true);
    try {
      const response = await fetchJson(`/api/patients/walk-in-intake`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          patientMode: addPatientData.patientMode,
          routeType: addPatientData.routeType,
          existingPatientId: addPatientData.existingPatientId || null,
          doctorId: addPatientData.doctorId || null,
          doctorName: addPatientData.doctorName || null,
          selectedSpecialization: addPatientData.selectedSpecialization || null,
          consultTiming: addPatientData.consultTiming || 'same_day',
          preferredDate: addPatientData.preferredDate || null,
          preferredTime: addPatientData.preferredTime || null,
          firstName: addPatientData.firstName,
          middleName: addPatientData.middleName,
          lastName: addPatientData.lastName,
          dateOfBirth: addPatientData.dateOfBirth,
          gender: addPatientData.gender,
          contactNumber: addPatientData.contactNumber,
          email: addPatientData.email,
          address: addPatientData.address,
          bloodType: addPatientData.bloodType,
          temperature: addPatientData.temperature,
          bp_systolic: addPatientData.bp_systolic,
          bp_diastolic: addPatientData.bp_diastolic,
          heartRate: addPatientData.heartRate,
          respiratoryRate: addPatientData.respiratoryRate,
          spo2: addPatientData.spo2,
          weight: addPatientData.weight,
          height: addPatientData.height,
          mainConcern: addPatientData.mainConcern,
          existingConditions: addPatientData.existingConditions,
          routeNote: addPatientData.routeNote,
          painLevel: addPatientData.painLevel
        })
      });

      const routeLabel = String(response?.routeLabel || 'Walk-In Intake').trim();
      const routeKind = String(response?.routing?.kind || '').trim().toLowerCase();
      const routeTarget = String(response?.routing?.target || '').trim();
      const routeId = String(response?.routing?.id || '').trim();
      const routeTicket = String(response?.routing?.ticket || '').trim();
      const patientId = String(response?.patient?.id || response?.patient?._id || '').trim();
      const patientName = response?.patient
        ? `${String(response.patient.first_name || response.patient.firstName || '').trim()} ${String(response.patient.last_name || response.patient.lastName || '').trim()}`.trim()
        : '';
      const appointmentId = routeKind === 'appointment' ? routeId : '';
      const scheduledDate = String(response?.routing?.scheduledDate || '').trim();
      const successDetail = routeKind === 'appointment'
        ? (
            addPatientData.routeType === 'onsite_consult' && addPatientData.consultTiming === 'future_schedule'
              ? `${routeLabel} was scheduled${scheduledDate ? ` - Appointment #${routeId}` : ''}.`
              : `${routeLabel} is now in the doctor queue${routeId ? ` - Appointment #${routeId}` : ''}${routeTicket ? ` - Ticket ${routeTicket}` : ''}.`
          )
        : `${routeLabel}${routeTarget ? ` was routed to ${routeTarget}` : ''}${routeId ? ` - Request #${routeId}` : ''}.`;
      setSuccessMessage(successDetail);
      setModalType("success");
      setShowSuccessModal(true);
      setWalkInNextSteps({
        patientId: patientId || null,
        patientName: patientName || null,
        appointmentId: appointmentId || null,
        ticket: routeTicket || null,
        routeType: addPatientData.routeType
      });
      setWalkInPharmacyDest('in_house');
      setWalkInPharmacyNotes('');
      setWalkInNextStepsOpen(true);

      // Optional: fast routing after intake (real-time checkboxes)
      const shouldOpenLab = Boolean(addPatientData.nextStepLab);
      const shouldOpenImaging = Boolean(addPatientData.nextStepImaging);
      const shouldOpenPharmacy = Boolean(addPatientData.nextStepPharmacy);
      const selected = [shouldOpenLab, shouldOpenImaging, shouldOpenPharmacy].filter(Boolean).length;
      if (selected === 1 && patientId) {
        if (shouldOpenLab) openNextStepsOrders({ tab: 'labs', patientId, patientName });
        else if (shouldOpenImaging) openNextStepsOrders({ tab: 'labs', patientId, patientName });
        else if (shouldOpenPharmacy) openNextStepsOrders({ tab: 'medications', patientId, patientName });
      }
      setShowAddPatientModal(false);
      setAddPatientStep(1);
      setAddPatientData({
        patientMode: "new",
        routeType: "er_consult",
        existingPatientId: "",
        patientLookup: "",
        doctorId: "",
        doctorName: "",
        firstName: "", middleName: "", lastName: "", dateOfBirth: "", gender: "Male",
        contactNumber: "", email: "", address: "", bloodType: "A+",
        temperature: "", bp_systolic: "", bp_diastolic: "", heartRate: "",
        respiratoryRate: "", spo2: "", weight: "", height: "",
        mainConcern: "", existingConditions: "", routeNote: "", painLevel: "0"
      });
      await fetchPatientRecords();
      await fetchAppointments();
    } catch (err) {
      setModalType("error");
      setAddPatientError(String(err.message || "Failed to add patient."));
    } finally {
      setAddPatientSaving(false);
    }
  };

  const parseOptionalNumber = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const computeQuickTriage = (draft) => {
    const temperature = parseOptionalNumber(draft.temperature);
    const systolic = parseOptionalNumber(draft.bp_systolic);
    const diastolic = parseOptionalNumber(draft.bp_diastolic);
    const heartRate = parseOptionalNumber(draft.heartRate);
    const respiratoryRate = parseOptionalNumber(draft.respiratoryRate);
    const spo2 = parseOptionalNumber(draft.spo2);
    const painLevel = parseOptionalNumber(draft.painLevel);

    const issues = [];
    const flags = [];
    const isER = String(draft.routeType || '').trim() === 'er_consult';

    const addIssue = (msg) => issues.push(msg);
    const addFlag = (sev, msg) => flags.push({ severity: sev, message: msg });

    // Hard validation (prevents wrong picks / impossible values).
    if (temperature !== null && (temperature < 30 || temperature > 45)) addIssue('Temperature looks invalid (expected 30 to 45 C).');
    if (systolic !== null && (systolic < 50 || systolic > 260)) addIssue('Systolic BP looks invalid (expected 50 to 260).');
    if (diastolic !== null && (diastolic < 30 || diastolic > 160)) addIssue('Diastolic BP looks invalid (expected 30 to 160).');
    if (heartRate !== null && (heartRate < 20 || heartRate > 250)) addIssue('Heart rate looks invalid (expected 20 to 250 bpm).');
    if (respiratoryRate !== null && (respiratoryRate < 6 || respiratoryRate > 80)) addIssue('Respiratory rate looks invalid (expected 6 to 80).');
    if (spo2 !== null && (spo2 < 50 || spo2 > 100)) addIssue('SpO2 looks invalid (expected 50 to 100%).');
    if (painLevel !== null && (painLevel < 0 || painLevel > 10)) addIssue('Pain score looks invalid (expected 0 to 10).');

    if (isER) {
      const missing = [];
      if (temperature === null) missing.push('Temp');
      if (systolic === null) missing.push('Systolic BP');
      if (diastolic === null) missing.push('Diastolic BP');
      if (heartRate === null) missing.push('Heart Rate');
      if (respiratoryRate === null) missing.push('Resp. Rate');
      if (spo2 === null) missing.push('SpO2');
      if (missing.length) addIssue(`ER quick triage needs vitals: ${missing.join(' - ')}.`);
    }

    // Deterministic triage flags (no AI inference).
    // Level: 1 Emergent, 2 Urgent, 3 Moderate, 4 Routine
    let level = 4;
    let label = 'Routine';

    const makeEmergent = (msg) => {
      level = 1;
      label = 'Emergent';
      addFlag('danger', msg);
    };
    const makeUrgent = (msg) => {
      if (level > 2) {
        level = 2;
        label = 'Urgent';
      }
      addFlag('warn', msg);
    };
    const makeModerate = (msg) => {
      if (level > 3) {
        level = 3;
        label = 'Moderate';
      }
      addFlag('info', msg);
    };

    if (spo2 !== null && spo2 > 0) {
      if (spo2 < 90) makeEmergent('SpO2 below 90%');
      else if (spo2 < 92) makeUrgent('SpO2 at 90 to 91%');
      else if (spo2 <= 94) makeModerate('SpO2 at 92 to 94%');
    }

    if (systolic !== null && systolic > 0) {
      if (systolic >= 180) makeUrgent('Systolic BP at or above 180');
      else if (systolic >= 160) makeModerate('Systolic BP at 160 to 179');
    }

    if (heartRate !== null && heartRate > 0) {
      if (heartRate > 140 || heartRate < 40) makeUrgent('Abnormal heart rate');
      else if (heartRate > 120 || heartRate < 50) makeModerate('Borderline heart rate');
    }

    if (respiratoryRate !== null && respiratoryRate > 0) {
      if (respiratoryRate >= 30 || respiratoryRate <= 8) makeUrgent('Abnormal respiratory rate');
      else if (respiratoryRate >= 24 || respiratoryRate <= 10) makeModerate('Borderline respiratory rate');
    }

    if (temperature !== null && temperature > 0) {
      if (temperature >= 40 || temperature <= 35) makeUrgent('Abnormal temperature');
      else if (temperature >= 38.5) makeModerate('Fever at or above 38.5 C');
    }

    if (painLevel !== null) {
      if (painLevel >= 8) makeUrgent('Severe pain (8 to 10)');
      else if (painLevel >= 5) makeModerate('Moderate pain (5 to 7)');
    }

    const suggestedRouteType = level <= 2 ? 'er_consult' : draft.routeType || 'er_consult';
    const suggestedRouteLabel = level <= 2 ? 'ER Consultation' : null;

    return {
      issues,
      flags,
      level,
      label,
      suggestedRouteType,
      suggestedRouteLabel
    };
  };

  const quickTriage = useMemo(() => computeQuickTriage(triageCommittedData || addPatientData), [addPatientData, triageCommittedData]);

  const openNextStepsOrders = ({ tab, patientId, patientName }) => {
    if (tab) setActiveOrderTab(tab);
    if (patientId) {
      setOrderFormData((prev) => ({
        ...prev,
        patientId: String(patientId),
        patientName: String(patientName || prev.patientName || '').trim()
      }));
    }
    setView('orders');
    setWalkInNextStepsOpen(false);
  };

  const submitOutsidePharmacyNote = async ({ patientId, patientName }) => {
    const note = `Pharmacy: Outside purchase\n${walkInPharmacyNotes ? `Notes: ${String(walkInPharmacyNotes).trim()}` : ''}`.trim();
    const res = await fetch(`${API_BASE}/api/clinical-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        patientId: patientId || null,
        patientName: patientName || 'Unknown',
        kind: 'Pharmacy',
        service: 'Outside Purchase',
        priority: 'Routine',
        notes: note,
        orderedByName: user?.name || 'Nurse',
        orderedByRole: 'Nurse',
        assignedRole: 'pharmacist',
        assignedTo: null,
        scheduledAt: null,
        actorName: user?.name || 'Nurse',
        actorRole: 'nurse'
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || 'Unable to send pharmacy note');
    await refreshRecentOrders({ silent: true }).catch(() => {});
    setWalkInNextStepsOpen(false);
    setWalkInPharmacyNotes('');
    setSuccessMessage('Marked as outside pharmacy purchase.');
    setModalType('success');
    setShowSuccessModal(true);
  };

  const copyWalkInSlip = async () => {
    try {
      const patient = walkInNextSteps?.patientName ? `Patient: ${walkInNextSteps.patientName}` : 'Patient:';
      const apt = walkInNextSteps?.appointmentId ? `Appointment #: ${walkInNextSteps.appointmentId}` : 'Appointment #:';
      const ticket = walkInNextSteps?.ticket ? `Ticket: ${walkInNextSteps.ticket}` : '';
      const doctor = addPatientData?.doctorName ? `Assigned doctor: ${addPatientData.doctorName}` : '';
      const when = `Time: ${new Date().toLocaleString()}`;
      const text = [patient, apt, ticket, doctor, when].filter(Boolean).join('\n');
      await navigator.clipboard.writeText(text);
      setSuccessMessage('Copied handoff slip.');
      setModalType('success');
      setShowSuccessModal(true);
    } catch (_) {
      setSuccessMessage('Unable to copy. Please allow clipboard permission.');
      setModalType('error');
      setShowSuccessModal(true);
    }
  };

  const isVideoAppointment = (apt) => {
    const mode = String(apt?.consultationMode || apt?.consultation_mode || '').trim().toLowerCase();
    if (mode === 'video') return true;
    const reason = String(apt?.reason || '').trim().toLowerCase();
    return reason.includes('video consultation') || reason.startsWith('video:') || reason.includes('(online)');
  };

  const getScheduledDateTime = (apt) => {
    try {
      const d = apt?.appointmentDate ? new Date(apt.appointmentDate) : null;
      const t = apt?.appointmentTime ? new Date(apt.appointmentTime) : null;
      if (!d || !t || Number.isNaN(d.getTime()) || Number.isNaN(t.getTime())) return null;
      const scheduled = new Date(d);
      scheduled.setHours(t.getHours(), t.getMinutes(), 0, 0);
      return scheduled;
    } catch (_) {
      return null;
    }
  };

  const isAppointmentLate = (apt) => {
    const st = String(apt?.status || '').trim().toLowerCase();
    if (st !== 'confirmed') return false;
    const scheduled = getScheduledDateTime(apt);
    if (!scheduled) return false;
    return Date.now() - scheduled.getTime() > 15 * 60 * 1000;
  };

  const openTriageModal = (apt) => {
    setTriageTargetAppointment(apt);
    setTriageDraftLevel(apt?.triageLevel ? String(apt.triageLevel) : '');
    const note = apt?.triageReasons?.note || apt?.triageReasons?.reason || '';
    setTriageDraftNote(String(note || ''));
    setTriageAiSuggestion(null);
    setTriageModalOpen(true);
  };

  const suggestTriageWithAI = async () => {
    const aptId = triageTargetAppointment?.id;
    if (!aptId) return;
    setTriageAiLoading(true);
    try {
      const data = await fetchJson(`/api/appointments/${aptId}/triage/ai`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }
      });
      const lvl = data?.triageLevel ? String(data.triageLevel) : '';
      const note = data?.triageReasons?.note || data?.triageReasons?.reason || '';
      setTriageDraftLevel(lvl);
      if (note) setTriageDraftNote(String(note));
      setTriageAiSuggestion(data?.triageReasons && typeof data.triageReasons === 'object' ? data.triageReasons : null);
      await fetchAppointments();
    } catch (e) {
      setErrorMessage(String(e?.message || 'Unable to generate AI triage suggestion.'));
      setShowErrorModal(true);
    } finally {
      setTriageAiLoading(false);
    }
  };

  const submitTriageUpdate = async () => {
    const aptId = triageTargetAppointment?.id;
    if (!aptId) return;
    try {
      const lvlRaw = String(triageDraftLevel || '').trim();
      const lvl = lvlRaw ? Number(lvlRaw) : null;
      const normalized = lvl && Number.isFinite(lvl) ? Math.max(1, Math.min(4, Math.floor(lvl))) : null;
      const payload = {
        triageLevel: normalized,
        triageStatus: normalized ? 'Assessed' : 'Unassessed',
        triageReasons: triageDraftNote ? { note: triageDraftNote } : null,
        triagedBy: nurseInboxName,
        triagedAt: new Date().toISOString()
      };
      const res = await fetch(`${API_BASE}/api/appointments/${aptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setTriageModalOpen(false);
        setTriageTargetAppointment(null);
        await fetchAppointments();
        setSuccessMessage('Triage updated.');
        setShowSuccessModal(true);
      }
    } catch (_) {}
  };

  const openAuditModal = async (apt) => {
    setAuditTargetAppointment(apt);
    setAuditModalOpen(true);
    setAuditLoading(true);
    setAuditError('');
    setAuditLogs([]);
    try {
      const res = await fetch(`${API_BASE}/api/appointments/${encodeURIComponent(String(apt?.id || ''))}/audit?take=100`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setAuditError(String(data?.message || 'Unable to load history.'));
        setAuditLogs([]);
      } else {
        setAuditLogs(Array.isArray(data) ? data : []);
      }
    } catch (_) {
      setAuditError('Unable to load history.');
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const safeJsonParse = (v) => {
    try {
      return JSON.parse(v);
    } catch (_) {
      return null;
    }
  };

  const stripTriagePrefix = (reason) => {
    const raw = String(reason || '').trim();
    if (!raw) return '';
    if (!raw.startsWith('[')) return raw;
    const idx = raw.indexOf(']');
    if (idx < 0) return raw;
    return raw.slice(idx + 1).trim();
  };

  const fetchConsultPriorityQueue = async () => {
    setConsultPriorityLoading(true);
    setConsultPriorityError('');
    try {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase
        .from('appointment_approval_requests')
        .select('id, patient_name, email, requested_date, requested_time, reason, status, suggested_note, created_at, updated_at, doctor_id, doctor_name')
        .ilike('reason', '[TRIAGE%')
        .order('created_at', { ascending: false })
        .limit(400);

      if (error) throw new Error('Unable to load priority queue.');

      const mapped = (Array.isArray(data) ? data : []).map((r) => {
        const triage = safeJsonParse(r.suggested_note || '{}') || {};
        const triageLevel = Number(triage?.triage_level ?? triage?.triageLevel ?? 0) || null;
        const priorityScore = Number(triage?.priority_score ?? triage?.priorityScore ?? 0) || 0;
        const priorityLabel = String(triage?.priority_label ?? triage?.priorityLabel ?? '').trim() || null;
        const reasons = Array.isArray(triage?.reasons) ? triage.reasons.filter(Boolean).slice(0, 4) : [];
        return {
          id: String(r.id),
          patientName: r.patient_name || null,
          email: r.email || null,
          requestedDate: r.requested_date || null,
          requestedTime: r.requested_time || null,
          reason: r.reason || null,
          cleanReason: stripTriagePrefix(r.reason || ''),
          status: r.status || null,
          createdAt: r.created_at || null,
          updatedAt: r.updated_at || null,
          doctorId: r.doctor_id ? String(r.doctor_id) : null,
          doctorName: r.doctor_name || null,
          triageLevel,
          priorityScore,
          priorityLabel,
          reasons
        };
      });

      mapped.sort((a, b) => {
        const ta = a.triageLevel && Number.isFinite(a.triageLevel) ? a.triageLevel : 99;
        const tb = b.triageLevel && Number.isFinite(b.triageLevel) ? b.triageLevel : 99;
        if (ta !== tb) return ta - tb;
        if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return da - db;
      });

      setConsultPriorityRows(mapped);
    } catch (e) {
      setConsultPriorityRows([]);
      setConsultPriorityError(String(e?.message || 'Unable to load priority queue.'));
    } finally {
      setConsultPriorityLoading(false);
    }
  };

  const fetchAppointments = async () => {
    setLoadingAppointments(true);
    setAppointmentsError('');
    try {
      const qs = new URLSearchParams();
      if (appointmentRangeFilter === 'Today') {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const s = `${y}-${m}-${d}`;
        qs.set('start', s);
        qs.set('end', s);
      }
      const url = qs.toString() ? `${API_BASE}/api/appointments?${qs.toString()}` : `${API_BASE}/api/appointments`;
      const data = await fetchJson(url, { headers: { ...getAuthHeaders() }, timeoutMs: 15000, parseJson: true });
      const list = Array.isArray(data) ? data : [];
      const deptRaw = String(approvalDepartment || activeDept || '').trim();
      const filtered = deptRaw
        ? list.filter((apt) => deptAllowsService(deptRaw, getApprovalServiceType(apt)))
        : list;
      setAppointments(filtered);
    } catch (e) {
      setAppointments([]);
      setAppointmentsError(String(e?.message || 'Unable to load appointments.'));
    } finally {
      setLoadingAppointments(false);
    }
  };

  const filteredAppointments = useMemo(() => {
    const list = Array.isArray(appointments) ? appointments : [];
    const search = String(appointmentSearchText || '').trim().toLowerCase();
    const modeFilter = String(appointmentModeFilter || 'All').toLowerCase();
    const bucket = String(appointmentBucketFilter || 'All').toLowerCase();

    const filtered = list.filter((apt) => {
      if (modeFilter === 'video' && !isVideoAppointment(apt)) return false;
      if (modeFilter === 'onsite' && isVideoAppointment(apt)) return false;

      if (search) {
        const name = `${String(apt.firstName || '')} ${String(apt.lastName || '')}`.trim().toLowerCase();
        const reason = String(apt.reason || '').toLowerCase();
        const doc = String(apt.doctor || apt.doctor_id || '').toLowerCase();
        if (!name.includes(search) && !reason.includes(search) && !doc.includes(search)) return false;
      }

      const statusRaw = String(apt.status || '').trim();
      const st = statusRaw.toLowerCase();
      const late = isAppointmentLate(apt);

      if (bucket === 'all') return true;
      if (bucket === 'needs action') {
        if (st === 'completed' || st === 'cancelled' || st === 'no-show' || st === 'no show') return false;
        return true;
      }
      if (bucket === 'late') return late;
      if (bucket === 'confirmed') return st === 'confirmed' && !late;
      if (bucket === 'checked-in' || bucket === 'checked in') return st === 'checked-in' || st === 'checked in';
      if (bucket === 'no-show' || bucket === 'no show') return st === 'no-show' || st === 'no show';
      if (bucket === 'completed') return st === 'completed';
      if (bucket === 'cancelled') return st === 'cancelled';
      return true;
    });

    filtered.sort((a, b) => {
      const aLvl = a?.triageLevel ? Number(a.triageLevel) : null;
      const bLvl = b?.triageLevel ? Number(b.triageLevel) : null;
      const aKey = aLvl && Number.isFinite(aLvl) ? aLvl : 99;
      const bKey = bLvl && Number.isFinite(bLvl) ? bLvl : 99;
      if (aKey !== bKey) return aKey - bKey;

      const aLate = isAppointmentLate(a);
      const bLate = isAppointmentLate(b);
      if (aLate !== bLate) return aLate ? -1 : 1;

      const aTime = getScheduledDateTime(a);
      const bTime = getScheduledDateTime(b);
      const aT = aTime && Number.isFinite(aTime.getTime()) ? aTime.getTime() : Number.POSITIVE_INFINITY;
      const bT = bTime && Number.isFinite(bTime.getTime()) ? bTime.getTime() : Number.POSITIVE_INFINITY;
      if (aT !== bT) return aT - bT;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return filtered;
  }, [appointments, appointmentBucketFilter, appointmentModeFilter, appointmentSearchText]);

  const openAppointments = useMemo(() => {
    return filteredAppointments.filter((apt) => {
      const st = String(apt.status || '').trim().toLowerCase();
      return st !== 'completed' && st !== 'cancelled' && st !== 'no-show' && st !== 'no show';
    });
  }, [filteredAppointments]);

  const careTeamDoctors = useMemo(() => {
    const names = new Set();
    deptPatients.forEach((patient) => {
      const name = String(patient?.attendingDoctor || '').trim();
      if (name) names.add(name);
    });
    appointments.forEach((apt) => {
      const name = String(apt?.doctor || apt?.doctor_name || apt?.doctorName || '').trim();
      if (name) names.add(name);
    });
    return Array.from(names);
  }, [deptPatients, appointments]);

  const doctorCoverageLabel = useMemo(() => {
    if (careTeamDoctors.length === 0) return 'No linked doctors yet';
    if (careTeamDoctors.length === 1) return careTeamDoctors[0];
    if (careTeamDoctors.length === 2) return `${careTeamDoctors[0]} and ${careTeamDoctors[1]}`;
    return `${careTeamDoctors[0]}, ${careTeamDoctors[1]} +${careTeamDoctors.length - 2} more`;
  }, [careTeamDoctors]);

  const refreshPatientsList = async () => {
    setLoadingPatients(true);
    try {
      const res = await fetch(`${API_BASE}/api/patients`, { headers: { ...getAuthHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setPatientsList((Array.isArray(data) ? data : []).map(normalizePatient));
      } else {
        throw new Error('Failed to fetch');
      }
    } catch (error) {
      console.error("Error fetching patients:", error);
      setPatientsList([]);
    } finally {
      setLoadingPatients(false);
    }
  };

  const handleUpdateAppointmentStatus = async (aptId, status) => {
    try {
      const res = await fetch(`${API_BASE}/api/appointments/${aptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchAppointments();
        const st = String(status || '').trim().toLowerCase();
        if (st === 'confirmed') {
          refreshPatientsList();
        }
        setSuccessMessage(
          st === 'checked-in' || st === 'checked in'
            ? 'Patient checked-in.'
            : st === 'no-show' || st === 'no show'
              ? 'Marked as no-show.'
              : `Appointment ${status}`
        );
        setShowSuccessModal(true);
      }
    } catch (_) {}
  };

  const fetchPatientRecords = async () => {
    setPatientRecordsLoading(true);
    setPatientRecordsError('');
    try {
      const deptRaw = String(approvalDepartment || '').trim();
      const deptId = normalizeDeptId(deptRaw);
      const deptKey = normalizeServiceAliasKey(deptRaw);

      if (supabase) {
        const { data, error } = await supabase
          .from('appointment_approval_requests')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(500);

        if (error) {
          setPatientRecords([]);
          setPatientRecordsError('Unable to load patient records.');
          return;
        }

        const mapped = (Array.isArray(data) ? data : [])
          .filter((r) => String(r?.status || '').trim().toLowerCase() === 'approved')
          .map((r) => ({
          id: String(r.id),
          patientId: r.patient_id || null,
          patientName: r.patient_name || null,
          doctorName: r.doctor_name || null,
          nurseName: r.nurse_name || null,
          requestedDate: r.requested_date || null,
          requestedTime: r.requested_time || null,
          serviceType: r.service_type || null,
          reason: r.reason || null,
          status: r.status || 'Approved',
          appointmentId: r.appointment_id !== null && r.appointment_id !== undefined ? String(r.appointment_id) : null,
          createdAt: r.created_at || null,
          updatedAt: r.updated_at || null
        }));

        const filtered = deptKey
          ? mapped.filter((t) => deptAllowsService(deptRaw, getApprovalServiceType(t)))
          : mapped;

        setPatientRecords(filtered);
        return;
      }

      const res = await fetch(`${API_BASE}/api/approval-requests/inbox?role=nurse&department=${encodeURIComponent(deptId)}&take=500`, {
        headers: { ...getAuthHeaders() }
      });
      if (!res.ok) {
        setPatientRecords([]);
        setPatientRecordsError('Unable to load patient records.');
        return;
      }
      const rows = await res.json().catch(() => []);
      const approved = (Array.isArray(rows) ? rows : []).filter((r) => String(r.status || '').trim() === 'Approved');
      setPatientRecords(approved);
    } catch (_) {
      setPatientRecords([]);
      setPatientRecordsError('Unable to load patient records.');
    } finally {
      setPatientRecordsLoading(false);
    }
  };

  const fetchApprovalInbox = async () => {
    setApprovalInboxLoading(true);
    setApprovalInboxError('');
    try {
      const deptRaw = String(approvalDepartment || activeDept || '').trim();
      const deptId = normalizeDeptId(deptRaw);
      const deptKey = normalizeServiceAliasKey(deptRaw);

      if (supabase) {
        const { data, error } = await supabase
          .from('appointment_approval_requests')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(200);

        if (error) {
          setApprovalInbox([]);
          setApprovalInboxError('Unable to load approval requests.');
          return;
        }

        const mapped = (Array.isArray(data) ? data : []).map((r) => ({
          id: String(r.id),
          patientId: r.patient_id || null,
          patientName: r.patient_name || null,
          doctorName: r.doctor_name || null,
          nurseName: r.nurse_name || null,
          requestedDate: r.requested_date || null,
          requestedTime: r.requested_time || null,
          serviceType: r.service_type || null,
          reason: r.reason || null,
          status: r.status || 'Pending',
          suggestedDate: r.suggested_date || null,
          suggestedTime: r.suggested_time || null,
          suggestedNote: r.suggested_note || null,
          appointmentId: r.appointment_id !== null && r.appointment_id !== undefined ? String(r.appointment_id) : null,
          createdAt: r.created_at || null,
          updatedAt: r.updated_at || null
        }));

        const filtered = deptKey
          ? mapped.filter((t) => deptAllowsService(deptRaw, getApprovalServiceType(t)))
          : mapped;

        setApprovalInbox(filtered);
      } else {
        const res = await fetch(`${API_BASE}/api/approval-requests/inbox?role=nurse&department=${encodeURIComponent(deptId)}&take=200`, {
          headers: { ...getAuthHeaders() }
        });
        if (!res.ok) {
          setApprovalInbox([]);
          setApprovalInboxError('Unable to load messages.');
          return;
        }
        const data = await res.json();
        setApprovalInbox(Array.isArray(data) ? data : []);
      }
    } catch (_) {
      setApprovalInbox([]);
      setApprovalInboxError('Unable to load messages.');
    } finally {
      setApprovalInboxLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'appointments' && activeAppointmentTab === 'requests') {
      fetchApprovalInbox();
    }
    if (view === 'appointments' && activeAppointmentTab === 'priority') {
      fetchConsultPriorityQueue();
    }
  }, [view, activeAppointmentTab]);

  const openApprovalThread = async (thread) => {
    if (!thread?.id) return;
    setSelectedApproval(thread);
    setApprovalThreadLoading(true);
    setApprovalThreadError('');
    try {
      if (supabase) {
        const requestId = toDbId(thread.id);
        if (!requestId) {
          setApprovalThread(null);
          setApprovalMessages([]);
          setApprovalThreadError('Unable to load conversation.');
          return;
        }

        const { data: reqRows, error: reqErr } = await supabase
          .from('appointment_approval_requests')
          .select('*')
          .eq('id', requestId)
          .limit(1);

        if (reqErr) {
          setApprovalThread(null);
          setApprovalMessages([]);
          setApprovalThreadError('Unable to load conversation.');
          return;
        }

        const r = Array.isArray(reqRows) ? reqRows[0] : null;
        const mappedReq = r ? {
          id: String(r.id),
          patientId: r.patient_id || null,
          patientName: r.patient_name || null,
          doctorName: r.doctor_name || null,
          nurseName: r.nurse_name || null,
          requestedDate: r.requested_date || null,
          requestedTime: r.requested_time || null,
          serviceType: r.service_type || null,
          reason: r.reason || null,
          status: r.status || 'Pending',
          suggestedDate: r.suggested_date || null,
          suggestedTime: r.suggested_time || null,
          suggestedNote: r.suggested_note || null,
          appointmentId: r.appointment_id !== null && r.appointment_id !== undefined ? String(r.appointment_id) : null,
          createdAt: r.created_at || null,
          updatedAt: r.updated_at || null
        } : null;

        const { data: msgRows, error: msgErr } = await supabase
          .from('appointment_messages')
          .select('*')
          .eq('request_id', requestId)
          .order('created_at', { ascending: true });

        if (msgErr) {
          setApprovalThread(mappedReq);
          setApprovalMessages([]);
          setApprovalThreadError('Unable to load conversation.');
          return;
        }

        const msgs = (Array.isArray(msgRows) ? msgRows : []).map((m) => ({
          id: String(m.id),
          requestId: String(m.request_id),
          senderRole: m.sender_role,
          senderName: m.sender_name || null,
          body: m.body,
          createdAt: m.created_at
        }));

        setApprovalThread(mappedReq);
        setApprovalMessages(msgs);
      } else {
        const res = await fetch(`${API_BASE}/api/approval-requests/${thread.id}/messages?role=nurse&name=${encodeURIComponent(nurseInboxName)}`, {
          headers: { ...getAuthHeaders() }
        });
        if (!res.ok) {
          setApprovalThread(null);
          setApprovalMessages([]);
          setApprovalThreadError('Unable to load conversation.');
          return;
        }
        const data = await res.json();
        setApprovalThread(data.request || null);
        setApprovalMessages(Array.isArray(data.messages) ? data.messages : []);
      }
    } catch (_) {
      setApprovalThread(null);
      setApprovalMessages([]);
      setApprovalThreadError('Unable to load conversation.');
    } finally {
      setApprovalThreadLoading(false);
    }
  };

  const sendApprovalMessage = async () => {
    if (!selectedApproval?.id) return;
    const text = String(approvalMessageText || '').trim();
    if (!text) return;
    setApprovalSending(true);
    try {
      if (supabase) {
        const requestId = toDbId(selectedApproval.id);
        if (!requestId) return;
        const { error } = await supabase
          .from('appointment_messages')
          .insert({
            request_id: requestId,
            sender_role: 'nurse',
            sender_name: nurseInboxName,
            body: text
          });

        if (error) return;
        setApprovalMessageText('');
        await openApprovalThread(selectedApproval);
        await fetchApprovalInbox();
      } else {
        const res = await fetch(`${API_BASE}/api/approval-requests/${selectedApproval.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ senderRole: 'nurse', senderName: nurseInboxName, body: text })
        });
        if (res.ok) {
          setApprovalMessageText('');
          await openApprovalThread(selectedApproval);
          await fetchApprovalInbox();
        }
      }
    } catch (_) {} finally {
      setApprovalSending(false);
    }
  };

  const updateApprovalStatus = async (status) => {
    if (!selectedApproval?.id) return;
    setApprovalSending(true);
    try {
      const departmentParam = String(approvalDepartment || getApprovalServiceType(selectedApproval) || activeDept || '').trim();

      if (supabase) {
        const requestId = toDbId(selectedApproval.id);
        if (!requestId) return;
        const { data: reqRows, error: reqErr } = await supabase
          .from('appointment_approval_requests')
          .select('*')
          .eq('id', requestId)
          .limit(1);

        if (reqErr) return;
        const req = Array.isArray(reqRows) ? reqRows[0] : null;
        if (!req) return;

        const reqService = String(req.service_type || '').trim() || String(req.reason || '').split(':')[0].trim();
        const isAllowed = deptAllowsService(departmentParam, reqService);
        if (departmentParam && reqService && !isAllowed) {
          setModalType('error');
          setSuccessMessage('Hindi ka allowed mag-approve ng ibang service.');
          setShowSuccessModal(true);
          return;
        }

        if (status === 'Approved') {
          const fullName = String(req.patient_name || '').trim();
          const parts = fullName.split(' ').filter(Boolean);
          const firstName = parts.slice(0, 1).join(' ') || fullName || null;
          const lastName = parts.slice(1).join(' ') || null;

          const apptPayload = {
            first_name: firstName,
            last_name: lastName,
            reason: req.service_type || req.reason || 'Appointment',
            appointment_date: req.requested_date,
            appointment_time: req.requested_time,
            doctor_id: req.doctor_name,
            status: 'Confirmed'
          };

          const { data: apptRow, error: apptErr } = await supabase
            .from('appointments')
            .insert(apptPayload)
            .select('id')
            .limit(1);

          if (apptErr) {
            setModalType('error');
            setSuccessMessage('Hindi ma-save sa appointments table.');
            setShowSuccessModal(true);
            return;
          }

          const apptId = Array.isArray(apptRow) ? apptRow[0]?.id : null;

          await supabase
            .from('appointment_approval_requests')
            .update({ status: 'Approved', appointment_id: apptId })
            .eq('id', requestId);

          await supabase
            .from('appointment_messages')
            .insert({
              request_id: requestId,
              sender_role: 'nurse',
              sender_name: nurseInboxName,
              body: `Approved by ${nurseInboxName}`
            });

          setModalType('success');
          setSuggesting(false);
          setSuggestDate('');
          setSuggestTime('');
          setSuggestNote('');
          setSelectedApproval(null);
          setApprovalThread(null);
          setApprovalMessages([]);
          await fetchApprovalInbox();
          setSuccessMessage('Appointment Confirmed!');
          setShowSuccessModal(true);
          return;
        }

        if (status === 'Suggested') {
          await supabase
            .from('appointment_approval_requests')
            .update({
              status: 'Suggested',
              suggested_date: suggestDate || null,
              suggested_time: suggestTime || null,
              suggested_note: suggestNote || null
            })
            .eq('id', requestId);

          await supabase
            .from('appointment_messages')
            .insert({
              request_id: requestId,
              sender_role: 'nurse',
              sender_name: nurseInboxName,
              body: `Suggested new schedule: ${suggestDate || ''} ${suggestTime || ''}${suggestNote ? ` - ${suggestNote}` : ''}`.trim()
            });

          await openApprovalThread(selectedApproval);
          await fetchApprovalInbox();
          setModalType('success');
          setSuccessMessage('Status Updated');
          setShowSuccessModal(true);
          return;
        }

        if (status === 'Rejected') {
          await supabase
            .from('appointment_approval_requests')
            .update({
              status: 'Rejected',
              suggested_note: suggestNote || null
            })
            .eq('id', requestId);

          await supabase
            .from('appointment_messages')
            .insert({
              request_id: requestId,
              sender_role: 'nurse',
              sender_name: nurseInboxName,
              body: `Rejected by ${nurseInboxName}${suggestNote ? `: ${suggestNote}` : ''}`
            });

          await openApprovalThread(selectedApproval);
          await fetchApprovalInbox();
          setModalType('success');
          setSuccessMessage('Status Updated');
          setShowSuccessModal(true);
          return;
        }
      }

      if (status === 'Approved') {
        const res = await fetch(`${API_BASE}/api/approval-requests/${selectedApproval.id}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ nurseName: nurseInboxName, department: departmentParam })
        });
        if (res.ok) {
          setModalType('success');
          setSuggesting(false);
          setSuggestDate('');
          setSuggestTime('');
          setSuggestNote('');
          setSelectedApproval(null);
          setApprovalThread(null);
          setApprovalMessages([]);
          await fetchApprovalInbox();
          await fetchAppointments();
          await refreshPatientsList();
          setSuccessMessage('Appointment Confirmed!');
          setShowSuccessModal(true);
        } else {
          setSuccessMessage('Unable to confirm appointment.');
          setModalType('error');
          setShowSuccessModal(true);
        }
        return;
      }

      const payload = { status, actor: nurseInboxName, role: 'nurse', department: approvalDepartment || getApprovalServiceType(selectedApproval) || activeDept };
      if (status === 'Suggested') {
        payload.suggestedDate = suggestDate;
        payload.suggestedTime = suggestTime;
        payload.note = suggestNote;
      } else if (status === 'Rejected') {
        payload.note = suggestNote;
      }
      const res = await fetch(`${API_BASE}/api/approval-requests/${selectedApproval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await openApprovalThread(selectedApproval);
        await fetchApprovalInbox();
        setSuccessMessage('Status Updated');
        setShowSuccessModal(true);
      }
    } catch (_) {} finally {
      setApprovalSending(false);
    }
  };

  // Lock body scroll when Dashboard is active
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  useEffect(() => {
    const cleanup = () => {
      document.body.classList.remove('print-incidents');
      document.body.classList.remove('print-patient-records');
    };
    window.addEventListener('afterprint', cleanup);
    return () => window.removeEventListener('afterprint', cleanup);
  }, []);

  const handlePrint = (mode) => {
    document.body.classList.remove('print-incidents');
    document.body.classList.remove('print-patient-records');
    if (mode === 'incidents') document.body.classList.add('print-incidents');
    if (mode === 'patient-records') document.body.classList.add('print-patient-records');
    setTimeout(() => window.print(), 0);
  };

  const [patientSearch, setPatientSearch] = useState("");
  const [patientGenderFilter, setPatientGenderFilter] = useState("All");
  const [patientPage, setPatientPage] = useState(1);
  const itemsPerPage = 8;
  const [loadingPatients, setLoadingPatients] = useState(false);

  const patientsById = useMemo(() => {
    const map = new Map();
    (patientsList || []).forEach((p) => {
      const id = String(p?._id || '').trim();
      if (id) map.set(id, p);
    });
    return map;
  }, [patientsList]);

  const filteredPatientRecords = useMemo(() => {
    const search = String(patientSearch || '').trim().toLowerCase();
    const list = Array.isArray(patientRecords) ? patientRecords : [];
    if (!search) return list;
    return list.filter((r) => {
      const name = String(r.patientName || '').toLowerCase();
      const doctor = String(r.doctorName || '').toLowerCase();
      const svc = String(r.serviceType || r.reason || '').toLowerCase();
      return name.includes(search) || doctor.includes(search) || svc.includes(search);
    });
  }, [patientRecords, patientSearch]);

  const filteredPatientsForRecords = useMemo(() => {
    const search = String(patientSearch || '').trim().toLowerCase();
    const list = Array.isArray(patientsList) ? patientsList : [];
    if (!search) return list;
    return list.filter((p) => {
      const fullName = `${String(p.firstName || '')} ${String(p.lastName || '')}`.trim().toLowerCase();
      const id = String(p._id || '').toLowerCase();
      const ward = String(p.wardNumber || '').toLowerCase();
      return fullName.includes(search) || id.includes(search) || ward.includes(search);
    });
  }, [patientsList, patientSearch]);

  const patientRecordsPageCount = useMemo(() => {
    return Math.max(1, Math.ceil(filteredPatientsForRecords.length / itemsPerPage));
  }, [filteredPatientsForRecords.length, itemsPerPage]);

  const pagedPatientsForRecords = useMemo(() => {
    const currentPage = Math.min(patientPage, patientRecordsPageCount);
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredPatientsForRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredPatientsForRecords, patientPage, patientRecordsPageCount, itemsPerPage]);

  const patientRecordsMatchCount = filteredPatientsForRecords.length;
  const patientRecordsRangeStart = patientRecordsMatchCount === 0 ? 0 : ((Math.min(patientPage, patientRecordsPageCount) - 1) * itemsPerPage) + 1;
  const patientRecordsRangeEnd = patientRecordsMatchCount === 0 ? 0 : Math.min(patientRecordsMatchCount, patientRecordsRangeStart + pagedPatientsForRecords.length - 1);

  useEffect(() => {
    setPatientPage(1);
  }, [patientSearch]);

  // Notifications Data (Moved to top for dependency)
  const [notifications, setNotifications] = useState(() => {
      const saved = localStorage.getItem('notifications');
      return saved ? JSON.parse(saved) : [];
  });

  const addActivity = (title, message, type = 'info') => {
      const newActivity = {
          id: Date.now(),
          title,
          message,
          time: new Date().toLocaleTimeString('en-PH', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
              timeZone: 'Asia/Manila'
          }),
          type,
          isUnread: true
      };
      setNotifications(prev => {
          const updated = [newActivity, ...prev];
          localStorage.setItem('notifications', JSON.stringify(updated));
          return updated;
      });
  };

  const upsertWelcomeNotification = useCallback(() => {
      const nurseName = String(user?.name || '').trim();
      if (!nurseName) return;

      const now = new Date();
      const welcomeActivity = {
          id: `welcome-${String(user?.email || nurseName).trim().toLowerCase()}`,
          title: 'Welcome',
          message: `Welcome Nurse ${nurseName}`,
          time: now.toLocaleTimeString('en-PH', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
              timeZone: 'Asia/Manila'
          }),
          createdAt: now.toISOString(),
          type: 'info',
          isUnread: true
      };

      setNotifications((prev) => {
          const existing = Array.isArray(prev) ? prev : [];
          const filtered = existing.filter((item) => {
              const title = String(item?.title || '').trim().toLowerCase();
              const message = String(item?.message || '').trim().toLowerCase();
              return !(title === 'welcome' && message.includes(`welcome nurse ${nurseName.toLowerCase()}`));
          });
          const updated = [welcomeActivity, ...filtered];
          localStorage.setItem('notifications', JSON.stringify(updated));
          return updated;
      });
  }, [user?.email, user?.name]);

  const pollMyLabResultVerifications = async () => {
      try {
          const res = await fetch(`${API_BASE}/api/lab-results/mine?take=50`, { headers: { ...getAuthHeaders() } });
          const data = await res.json().catch(() => []);
          if (!res.ok) return;
          const rows = Array.isArray(data) ? data : [];
          const key = 'lab_results_verification_seen';
          const initKey = 'lab_results_verification_seen_init';
          const delayedKey = 'lab_results_verification_delayed_warned';
          let seen = {};
          let delayedWarned = {};
          try {
              const raw = localStorage.getItem(key);
              seen = raw ? JSON.parse(raw) : {};
          } catch (_) {
              seen = {};
          }
          try {
              const raw = localStorage.getItem(delayedKey);
              delayedWarned = raw ? JSON.parse(raw) : {};
          } catch (_) {
              delayedWarned = {};
          }
          const initialized = localStorage.getItem(initKey) === '1';
          if (!initialized) {
              rows.forEach((r) => {
                  const id = String(r?.id || '').trim();
                  if (!id) return;
                  seen[id] = String(r?.verificationStatus || 'pending').trim().toLowerCase() || 'pending';
              });
              localStorage.setItem(key, JSON.stringify(seen));
              localStorage.setItem(initKey, '1');
              return;
          }

          let changed = false;
          rows.forEach((r) => {
              const id = String(r?.id || '').trim();
              if (!id) return;
              const next = String(r?.verificationStatus || 'pending').trim().toLowerCase() || 'pending';
              const prev = String(seen[id] || '').trim().toLowerCase();
              if (prev && prev === next) return;
              seen[id] = next;
              changed = true;
              if (next === 'rejected') {
                  const patientName = String(r?.patientName || '').trim() || 'the patient';
                  addActivity('Verification Failed', `The file you sent to ${patientName} is not real or invalid.`, 'alert');
              } else if (next === 'verified') {
                  const patientName = String(r?.patientName || '').trim() || 'the patient';
                  addActivity('Verification Confirmed', `The file you sent to ${patientName} was verified successfully.`, 'success');
              } else if (next === 'flagged') {
                  const patientName = String(r?.patientName || '').trim() || 'the patient';
                  addActivity('Verification Flagged', `The file you sent to ${patientName} needs review.`, 'info');
              }
          });
          rows.forEach((r) => {
              const id = String(r?.id || '').trim();
              if (!id) return;
              const st = String(r?.verificationStatus || 'pending').trim().toLowerCase() || 'pending';
              if (st !== 'pending') return;
              const warned = delayedWarned[id] === true;
              if (warned) return;
              const createdAtRaw = r?.createdAt || r?.created_at || null;
              if (!createdAtRaw) return;
              const createdAt = new Date(createdAtRaw);
              if (Number.isNaN(createdAt.getTime())) return;
              if (Date.now() - createdAt.getTime() < 60 * 1000) return;
              delayedWarned[id] = true;
              localStorage.setItem(delayedKey, JSON.stringify(delayedWarned));
              const patientName = String(r?.patientName || '').trim() || 'the patient';
              addActivity('Verification Delayed', `Verification is taking longer than expected for ${patientName}.`, 'info');
          });
          if (changed) localStorage.setItem(key, JSON.stringify(seen));
      } catch (_) {}
  };

  const [criticalVitals, setCriticalVitals] = useState(() => {
      const saved = localStorage.getItem('criticalVitals');
      if (saved) {
          try {
              const parsed = JSON.parse(saved);
              return parsed.map(p => ({
                  ...p,
                  trend: p.trend || (Math.random() > 0.5 ? 'up' : 'down')
              }));
          } catch (e) { return []; }
      }
      return [];
  });

  // Announcement Pop-up Logic
  // Announcement Pop-up & Feed Logic
  const [activeAnnouncement, setActiveAnnouncement] = useState(null);
  const [dashboardAnnouncements, setDashboardAnnouncements] = useState([]);

  useEffect(() => {
    upsertWelcomeNotification();
  }, [upsertWelcomeNotification]);

  useEffect(() => {
    // Poll for Admin Announcements (API)
    const fetchAnnouncements = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/announcements`, { headers: { ...getAuthHeaders() } });
        if (response.ok) {
          const data = await response.json();
          // Filter for 'All' or 'Nurse'
          const relevant = data.filter(a => a.target === 'All' || a.target === 'Nurse');
          
          // Sort by newest first
          relevant.sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));
          
          // Update Dashboard Widget State
          setDashboardAnnouncements(relevant.slice(0, 3));

          if (relevant.length > 0) {
            // Get the latest one
            relevant.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const latest = relevant[0];
            const latestId = String(latest._id || latest.id);
            
            const lastSeenId = localStorage.getItem('lastSeenAnnouncementId');
            
            if (latestId !== lastSeenId) {
              setActiveAnnouncement(latest);
              setTimeout(() => setActiveAnnouncement(null), 15000);
              localStorage.setItem('lastSeenAnnouncementId', latestId);
            }

            // 2b. Handle Notification Feed (Activity Stream)
            const lastCheckedTime = localStorage.getItem('last_checked_announcement_time');
            const newTime = new Date().toISOString();
            
            if (!lastCheckedTime) {
                localStorage.setItem('last_checked_announcement_time', newTime);
            } else {
                const newAnnouncements = relevant.filter(a => new Date(a.createdAt || a.created_at) > new Date(lastCheckedTime));
                if (newAnnouncements.length > 0) {
                    newAnnouncements.forEach(a => {
                        let activityType = 'info';
                        if (a.priority === 'Urgent') activityType = 'alert';
                        if (a.priority === 'Normal') activityType = 'success';
                        addActivity('Admin Announcement', `${a.title}: ${a.content}`, activityType);
                    });
                    localStorage.setItem('last_checked_announcement_time', newTime);
                }
            }
          }
        }
      } catch (error) {
        console.error("Error fetching announcements:", error);
      }
    };

    // Poll every 10 seconds
    const interval = setInterval(fetchAnnouncements, 10000);
    fetchAnnouncements(); // Initial fetch

    const verifyInterval = setInterval(() => {
        pollMyLabResultVerifications();
    }, 15000);
    pollMyLabResultVerifications();

    // Poll for Appointments & Approvals
    const pollInterval = setInterval(() => {
        if (view === 'appointments') {
            fetchApprovalInbox();
            if (selectedApproval?.id) openApprovalThread(selectedApproval);
        }
    }, 15000);
    
    return () => {
        clearInterval(interval);
        clearInterval(verifyInterval);
        clearInterval(pollInterval);
    };
  }, [view, selectedApproval?.id]);

  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [modalType, setModalType] = useState("success"); // success or error
  const [successMessage, setSuccessMessage] = useState("");
  const [criticalPatients, setCriticalPatients] = useState(() => {
      const saved = localStorage.getItem('criticalPatients');
      return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [selectedBed, setSelectedBed] = useState(null); // Bed Modal State

  const toggleCritical = (patient) => {
      const newCritical = new Set(criticalPatients);
      const patientName = `${patient.firstName} ${patient.lastName}`;
      let updatedVitals;
      
      if (newCritical.has(patient._id)) {
          newCritical.delete(patient._id);
          // Remove from widget list
          updatedVitals = criticalVitals.filter(p => p.id !== patient._id);
          addActivity('Critical Status Removed', `Patient ${patientName} marked as stable.`, 'info');
      } else {
          newCritical.add(patient._id);
          // Add to widget list (Mock data)
          updatedVitals = [...criticalVitals, {
              id: patient._id,
              name: patientName,
              room: `Ward ${patient.wardNumber || 'Unassigned'}`,
              bp: '140/90', // Mock initial alert stats
              hr: '110',
              status: 'critical',
              trend: Math.random() > 0.5 ? 'up' : 'down'
          }];
          addActivity('Critical Alert', `Patient ${patientName} marked as CRITICAL.`, 'alert');
          
          // Navigate to Overview to show Critical Watchlist
          setView('overview');
      }
      setCriticalPatients(newCritical);
      setCriticalVitals(updatedVitals);

      // Save to LocalStorage
      localStorage.setItem('criticalPatients', JSON.stringify([...newCritical]));
      localStorage.setItem('criticalVitals', JSON.stringify(updatedVitals));
  };

  // --- New Widgets State ---
  const [shiftNotes, setShiftNotes] = useState('Check Bed 4 IV drip at 2 PM\nDr. Smith rounds at 3 PM\nHandover report pending for Night Shift');
  // --- Task Management State ---
  const [tasks, setTasks] = useState([
      { id: 1, text: 'Vitals Round', time: '14:00', priority: 'routine', completed: false },
      { id: 2, text: 'Antibiotics - Bed 2', time: '14:30', priority: 'urgent', completed: false },
      { id: 3, text: 'Update Charts', time: '16:00', priority: 'handover', completed: false },
      { id: 4, text: 'Discharge Bed 6', time: '15:00', priority: 'routine', completed: true },
  ]);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("routine");
  const [handoverId, setHandoverId] = useState(null);
  const [handoverHistory, setHandoverHistory] = useState([]);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverSaving, setHandoverSaving] = useState(false);
  const [handoverAcknowledging, setHandoverAcknowledging] = useState(false);
  const [taskCounts, setTaskCounts] = useState({ urgent: 0, routine: 0, handover: 0, completed: 0 });
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [pendingMedicationRequests, setPendingMedicationRequests] = useState([]);
  const [medAdminLogs, setMedAdminLogs] = useState([]);
  const [medAdminLoading, setMedAdminLoading] = useState(false);
  const [medAdminError, setMedAdminError] = useState('');
  const [medAdminActionId, setMedAdminActionId] = useState('');
  const [liveBoard, setLiveBoard] = useState(null);
  const [recentWorkflowActivities, setRecentWorkflowActivities] = useState([]);

  const currentShiftLabel = user.shiftLabel || deriveShiftLabel();

  const refreshNurseWorkflow = async ({ silent = false } = {}) => {
      if (!silent) {
          setHandoverLoading(true);
          setTasksLoading(true);
          setMedAdminLoading(true);
      }
      setTasksError("");
      setMedAdminError('');
      try {
          const params = new URLSearchParams();
          params.set('department', activeDept);
          params.set('shift', currentShiftLabel);
          const data = await fetchJson(`/api/nurse-workflow/summary?${params.toString()}`, {
              apiBase: API_BASE,
              headers: { ...getAuthHeaders() }
          });
          const latest = data?.latestHandover || null;
          setHandoverId(latest?.id || null);
          setShiftNotes(String(latest?.note_text || latest?.noteText || ''));
          setHandoverHistory(Array.isArray(data?.handoverHistory) ? data.handoverHistory : []);
          setTasks(Array.isArray(data?.tasks) ? data.tasks.map((task) => ({
              id: task.id,
              text: task.title || '',
              time: task.due_time || task.dueTime || new Date(task.created_at || task.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              priority: String(task.priority || 'routine').toLowerCase(),
              completed: Boolean(task.completed),
              patientName: task.patient_name || task.patientName || '',
              status: task.status || 'open'
          })) : []);
          setTaskCounts(data?.taskCounts || { urgent: 0, routine: 0, handover: 0, completed: 0 });
          setPendingMedicationRequests(Array.isArray(data?.pendingMedicationRequests) ? data.pendingMedicationRequests : []);
          setMedAdminLogs(Array.isArray(data?.medAdminLogs) ? data.medAdminLogs : []);
          setLiveBoard(data?.liveBoard || null);
          setRecentWorkflowActivities(Array.isArray(data?.recentActivities) ? data.recentActivities : []);
      } catch (error) {
          const message = String(error?.message || 'Unable to load nurse workflow.');
          setTasksError(message);
          setMedAdminError(message);
      } finally {
          if (!silent) {
              setHandoverLoading(false);
              setTasksLoading(false);
              setMedAdminLoading(false);
          }
      }
  };

  const createTask = async () => {
      const title = String(newTaskText || '').trim();
      if (!title) return;
      const created = await fetchJson('/api/nurse-workflow/tasks', {
          apiBase: API_BASE,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
              department: activeDept,
              shiftLabel: currentShiftLabel,
              title,
              priority: newTaskPriority
          })
      });
      setTasks((prev) => [{
          id: created.id,
          text: created.title || title,
          time: created.due_time || new Date(created.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          priority: String(created.priority || newTaskPriority).toLowerCase(),
          completed: Boolean(created.completed),
          patientName: created.patient_name || '',
          status: created.status || 'open'
      }, ...prev]);
      setNewTaskText("");
      await refreshNurseWorkflow({ silent: true });
      addActivity('New Task', `Added: ${title}`, 'info');
  };

  const updateTask = async (id, patch) => {
      const updated = await fetchJson(`/api/nurse-workflow/tasks/${encodeURIComponent(id)}`, {
          apiBase: API_BASE,
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(patch)
      });
      setTasks((prev) => prev.map((task) => (
          String(task.id) === String(id)
              ? {
                  ...task,
                  text: updated.title || task.text,
                  time: updated.due_time || task.time,
                  priority: String(updated.priority || task.priority).toLowerCase(),
                  completed: Boolean(updated.completed),
                  patientName: updated.patient_name || task.patientName || '',
                  status: updated.status || task.status
                }
              : task
      )));
      await refreshNurseWorkflow({ silent: true });
  };

  const removeTask = async (id) => {
      await fetchJson(`/api/nurse-workflow/tasks/${encodeURIComponent(id)}`, {
          apiBase: API_BASE,
          method: 'DELETE',
          headers: { ...getAuthHeaders() }
      });
      setTasks((prev) => prev.filter((task) => String(task.id) !== String(id)));
      await refreshNurseWorkflow({ silent: true });
  };

  const saveHandoverNote = async () => {
      const noteText = String(shiftNotes || '').trim();
      if (!noteText) {
          setSuccessMessage('Add a handover note first.');
          setModalType('error');
          setShowSuccessModal(true);
          return;
      }
      setHandoverSaving(true);
      try {
          const saved = await fetchJson('/api/nurse-workflow/handover', {
              apiBase: API_BASE,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({
                  department: activeDept,
                  shiftLabel: currentShiftLabel,
                  noteText
              })
          });
          setHandoverId(saved?.id || null);
          await refreshNurseWorkflow({ silent: true });
          addActivity('Shift Handover', `Updated ${currentShiftLabel} handover notes.`, 'success');
      } catch (error) {
          setSuccessMessage(String(error?.message || 'Unable to save handover note.'));
          setModalType('error');
          setShowSuccessModal(true);
      } finally {
          setHandoverSaving(false);
      }
  };

  const acknowledgeHandover = async () => {
      if (!handoverId) return;
      setHandoverAcknowledging(true);
      try {
          await fetchJson(`/api/nurse-workflow/handover/${encodeURIComponent(handoverId)}/acknowledge`, {
              apiBase: API_BASE,
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({})
          });
          await refreshNurseWorkflow({ silent: true });
      } catch (error) {
          setSuccessMessage(String(error?.message || 'Unable to acknowledge handover note.'));
          setModalType('error');
          setShowSuccessModal(true);
      } finally {
          setHandoverAcknowledging(false);
      }
  };

  const recordMedicationAdministration = async (request, status) => {
      setMedAdminActionId(`${request.requestId}-${status}`);
      try {
          await fetchJson('/api/nurse-workflow/med-admin', {
              apiBase: API_BASE,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({
                  department: activeDept,
                  requestId: request.requestId,
                  patientId: request.patientId || null,
                  patientName: request.patientName || '',
                  medicationName: request.medicationName || '',
                  dosage: request.dosage || '',
                  quantity: request.quantity || 1,
                  status
              })
          });
          await refreshNurseWorkflow({ silent: true });
          addActivity('Medication Round', `${request.medicationName} marked as ${status}.`, status === 'administered' ? 'success' : 'alert');
      } catch (error) {
          setSuccessMessage(String(error?.message || 'Unable to record medication administration.'));
          setModalType('error');
          setShowSuccessModal(true);
      } finally {
          setMedAdminActionId('');
      }
  };

  const addTask = (e) => {
      e.preventDefault();
      createTask().catch(() => {});
  };

  const moveTask = (id, newPriority) => {
      updateTask(id, { priority: newPriority }).catch(() => {});
  };
  
  const deleteTask = (id) => {
      removeTask(id).catch(() => {});
  };
  
  const toggleTask = (id) => {
      const target = tasks.find((task) => String(task.id) === String(id));
      updateTask(id, { completed: !target?.completed }).catch(() => {});
  };

  const markAllAsRead = () => {
      setNotifications(prev => {
          const updated = prev.map(n => ({ ...n, isUnread: false }));
          localStorage.setItem('notifications', JSON.stringify(updated));
          return updated;
      });
  };

  // --- Calendar State ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarEvents, setCalendarEvents] = useState(() => {
      const saved = localStorage.getItem('calendarEvents');
      return saved ? JSON.parse(saved) : [];
  });
  
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDay, setNewEventDay] = useState("");
  const [newEventTime, setNewEventTime] = useState("");
  const [newEventType, setNewEventType] = useState("event");

  // Orders Summary State
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentOrdersLoading, setRecentOrdersLoading] = useState(false);
  const [recentOrdersError, setRecentOrdersError] = useState('');

  // Stats State
  const [stats, setStats] = useState({
    patients: 0,
    inpatients: 0,
    accounts: 0
  });

  const handleAddEvent = (e) => {
      e.preventDefault();
      if (!newEventTitle.trim() || !newEventDay) return;
      
      const newEvent = { 
          id: Date.now(), 
          title: newEventTitle, 
          date: parseInt(newEventDay), 
          time: newEventTime,
          type: newEventType 
      };
      
      const updatedEvents = [...calendarEvents, newEvent];
      setCalendarEvents(updatedEvents);
      localStorage.setItem('calendarEvents', JSON.stringify(updatedEvents));
      addActivity('Calendar', `Added ${newEventType}: ${newEventTitle}`, 'info');
      
      setNewEventTitle("");
      setNewEventDay("");
      setNewEventTime("");
  };

  const getDaysInMonth = (date) => {
      return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
      return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const changeMonth = (offset) => {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  };

  // Dynamic Ward Occupancy
  const wardOccupancy = useMemo(() => {
      if (nurseWorkspace.type === 'emergency' && Array.isArray(liveBoard?.spaces) && liveBoard.spaces.length) {
          return liveBoard.spaces.map((space) => ({
              id: space.id,
              label: space.label,
              status: space.status,
              patientName: space.patientName || null,
              occupantData: space.occupantData || null
          }));
      }

      // Define beds per department
      let beds = [];
      if (activeDept === 'ER') {
          beds = Array.from({ length: 10 }, (_, i) => ({ id: `ER-${i+1}`, label: `E${101 + i}` }));
      } else if (activeDept === 'PEDIA') {
          beds = Array.from({ length: 8 }, (_, i) => ({ id: `PD-${i+1}`, label: `P${201 + i}` }));
      } else if (activeDept === 'MEDICINE') {
          beds = Array.from({ length: 15 }, (_, i) => ({ id: `MD-${i+1}`, label: `M${301 + i}` }));
      } else {
          beds = Array.from({ length: 12 }, (_, i) => ({ id: `GN-${i+1}`, label: `${101 + i}` }));
      }

      return beds.map(bed => {
          // Find occupant from the filtered department list
          const occupant = deptPatients.find(p => 
              p.admissionStatus === 'Inpatient' && 
              (p.wardNumber === bed.label || (p.wardNumber && p.wardNumber.toString().includes(bed.label)))
          );
          
          return {
              ...bed,
              status: occupant ? 'occupied' : 'free',
              patientName: occupant ? `${occupant.firstName} ${occupant.lastName}` : null,
              occupantData: occupant
          };
      });
  }, [deptPatients, activeDept, liveBoard, nurseWorkspace.type]);

  const activeCriticalWatch = useMemo(() => {
      if (nurseWorkspace.type === 'emergency' && Array.isArray(liveBoard?.observationWatch)) {
          return liveBoard.observationWatch;
      }
      return criticalVitals.filter((patient) => {
          if (activeDept === 'ER') return patient.room?.startsWith('E');
          if (activeDept === 'PEDIA') return patient.room?.startsWith('P');
          if (activeDept === 'MEDICINE') return patient.room?.startsWith('M');
          return true;
      });
  }, [criticalVitals, activeDept, liveBoard, nurseWorkspace.type]);

  const recentOverviewActivities = useMemo(() => {
      if (Array.isArray(recentWorkflowActivities) && recentWorkflowActivities.length) {
          return recentWorkflowActivities.slice(0, 6);
      }
      return notifications.slice(0, 6).map((notif) => ({
          id: notif.id,
          title: notif.title,
          message: notif.message,
          time: notif.time,
          type: notif.type
      }));
  }, [recentWorkflowActivities, notifications]);

  const overviewSupportTasks = useMemo(() => {
      const taskRows = tasks
          .filter((task) => !task.completed)
          .map((task) => ({
              id: `task-${task.id}`,
              text: task.text,
              patientName: task.patientName || '',
              priority: task.priority,
              completed: Boolean(task.completed),
              source: 'task'
          }));

      const medRows = pendingMedicationRequests.slice(0, 8).map((request) => ({
          id: `med-${request.requestId}`,
          text: `${request.medicationName} for ${request.patientName || 'patient'}`,
          patientName: request.patientName || '',
          priority: String(request.priority || '').toLowerCase().includes('urgent') ? 'urgent' : 'routine',
          completed: false,
          source: 'medication'
      }));

      return [...taskRows, ...medRows]
        .sort((a, b) => {
          const aUrgent = a.priority === 'urgent' ? 0 : 1;
          const bUrgent = b.priority === 'urgent' ? 0 : 1;
          return aUrgent - bUrgent;
        })
        .slice(0, 8);
  }, [tasks, pendingMedicationRequests]);

  const openTaskCount = useMemo(() => tasks.filter((task) => !task.completed).length, [tasks]);
  const urgentTaskCount = useMemo(() => tasks.filter((task) => task.priority === 'urgent' && !task.completed).length, [tasks]);
  const inpatientDeptCount = useMemo(
      () => deptPatients.filter((patient) => String(patient?.admissionStatus || '').toLowerCase() === 'inpatient').length,
      [deptPatients]
  );
  const acknowledgedHandover = handoverHistory[0]?.status === 'acknowledged';

  const workspaceStats = useMemo(() => {
      const commonShiftCard = {
          icon: <ClipboardList size={32} className="text-blue" />,
          tone: 'bg-blue-soft',
          value: urgentTaskCount,
          label: nurseWorkspace.taskLabel,
          detail: `${currentShiftLabel} - ${pendingMedicationRequests.length} med rounds pending`
      };

      switch (nurseWorkspace.type) {
          case 'pedia':
              return [
                  {
                      icon: <Users size={32} className="text-orange" />,
                      tone: 'bg-orange-soft',
                      value: deptPatients.length,
                      label: 'Pediatric Patients',
                      detail: `${inpatientDeptCount} admitted, ${openAppointments.length} follow-ups today`
                  },
                  {
                      icon: <Pill size={32} className="text-green" />,
                      tone: 'bg-green-soft',
                      value: pendingMedicationRequests.length,
                      label: 'Medication Checks',
                      detail: 'Weight-safe dosing and bedside administration queue'
                  },
                  {
                      icon: <Stethoscope size={32} className="text-purple" />,
                      tone: 'bg-purple-soft',
                      value: careTeamDoctors.length,
                      label: 'Linked Doctors',
                      detail: doctorCoverageLabel
                  },
                  commonShiftCard
              ];
          case 'bedside':
          case 'emergency':
              return [
                  {
                      icon: <Users size={32} className="text-orange" />,
                      tone: 'bg-orange-soft',
                      value: deptPatients.length,
                      label: nurseWorkspace.type === 'emergency' ? 'Active ER Patients' : 'Assigned Patients',
                      detail: `${inpatientDeptCount} inpatient beds, ${openAppointments.length} open endorsements`
                  },
                  {
                      icon: <Bed size={32} className="text-blue" />,
                      tone: 'bg-blue-soft',
                      value: wardOccupancy.filter((bed) => bed.status === 'occupied').length,
                      label: 'Occupied Spaces',
                      detail: `${wardOccupancy.filter((bed) => bed.status === 'free').length} available right now`
                  },
                  {
                      icon: <Activity size={32} className="text-purple" />,
                      tone: 'bg-purple-soft',
                      value: activeCriticalWatch.length,
                      label: 'Observation Watch',
                      detail: activeCriticalWatch.length ? 'Patients needing close review this shift' : 'No active critical watch this shift'
                  },
                  commonShiftCard
              ];
          case 'diagnostic':
          case 'imaging':
              return [
                  {
                      icon: <FlaskConical size={32} className="text-orange" />,
                      tone: 'bg-orange-soft',
                      value: recentOrders.length,
                      label: nurseWorkspace.type === 'imaging' ? 'Diagnostic Requests' : 'Specimen Support',
                      detail: `${approvalInbox.length} endorsements, ${openAppointments.length} patient assists`
                  },
                  {
                      icon: <Calendar size={32} className="text-blue" />,
                      tone: 'bg-blue-soft',
                      value: openAppointments.length,
                      label: 'Scheduled Supports',
                      detail: 'Appointments and same-day endorsements in your queue'
                  },
                  {
                      icon: <Stethoscope size={32} className="text-purple" />,
                      tone: 'bg-purple-soft',
                      value: careTeamDoctors.length,
                      label: 'Referring Doctors',
                      detail: doctorCoverageLabel
                  },
                  commonShiftCard
              ];
          case 'clinic':
          case 'remote':
              return [
                  {
                      icon: <Calendar size={32} className="text-orange" />,
                      tone: 'bg-orange-soft',
                      value: openAppointments.length,
                      label: nurseWorkspace.type === 'remote' ? 'Virtual Assists' : 'Patients to Support',
                      detail: `${filteredAppointments.length} total appointments in scope`
                  },
                  {
                      icon: <Users size={32} className="text-blue" />,
                      tone: 'bg-blue-soft',
                      value: deptPatients.length,
                      label: 'Patient Follow-ups',
                      detail: 'Shared patient list and consult-related coordination'
                  },
                  {
                      icon: <Stethoscope size={32} className="text-purple" />,
                      tone: 'bg-purple-soft',
                      value: careTeamDoctors.length,
                      label: 'Clinic Doctors',
                      detail: doctorCoverageLabel
                  },
                  commonShiftCard
              ];
          case 'procedure':
              return [
                  {
                      icon: <Clipboard size={32} className="text-orange" />,
                      tone: 'bg-orange-soft',
                      value: openAppointments.length,
                      label: 'Procedure Assists',
                      detail: `${recentOrders.length} support orders, ${approvalInbox.length} endorsements`
                  },
                  {
                      icon: <Pill size={32} className="text-blue" />,
                      tone: 'bg-blue-soft',
                      value: pendingMedicationRequests.length,
                      label: 'Medication Coverage',
                      detail: 'Pre-op, recovery, and procedure-related medication watch'
                  },
                  {
                      icon: <Stethoscope size={32} className="text-purple" />,
                      tone: 'bg-purple-soft',
                      value: careTeamDoctors.length,
                      label: 'Procedure Doctors',
                      detail: doctorCoverageLabel
                  },
                  commonShiftCard
              ];
          default:
              return [
                  {
                      icon: <Users size={32} className="text-orange" />,
                      tone: 'bg-orange-soft',
                      value: stats.patients,
                      label: 'Total Patients',
                      detail: `${stats.inpatients} currently admitted`
                  },
                  {
                      icon: <Activity size={32} className="text-blue" />,
                      tone: 'bg-blue-soft',
                      value: activeCriticalWatch.length,
                      label: 'Watchlist',
                      detail: activeCriticalWatch.length ? 'Patients requiring closer review' : 'No active critical watch'
                  },
                  {
                      icon: <Stethoscope size={32} className="text-purple" />,
                      tone: 'bg-purple-soft',
                      value: careTeamDoctors.length,
                      label: 'Coordinating Doctors',
                      detail: doctorCoverageLabel
                  },
                  commonShiftCard
              ];
      }
  }, [
      nurseWorkspace,
      deptPatients.length,
      inpatientDeptCount,
      openAppointments.length,
      pendingMedicationRequests.length,
      careTeamDoctors.length,
      doctorCoverageLabel,
      urgentTaskCount,
      currentShiftLabel,
      wardOccupancy,
      activeCriticalWatch.length,
      recentOrders.length,
      approvalInbox.length,
      filteredAppointments.length,
      stats.patients,
      stats.inpatients
  ]);

  const workspaceFocusCards = useMemo(() => {
      switch (nurseWorkspace.type) {
          case 'pedia':
              return [
                  { title: 'Child Observation Watch', value: activeCriticalWatch.length, caption: 'Pediatric patients needing closer observation this shift.' },
                  { title: 'Family Follow-ups', value: openAppointments.length, caption: 'Consults and follow-up assists that still need nurse support.' },
                  { title: 'Doctor Coordination', value: careTeamDoctors.length, caption: doctorCoverageLabel }
              ];
          case 'bedside':
          case 'emergency':
              return [
                  { title: 'Bedside Rounds Queue', value: inpatientDeptCount || deptPatients.length, caption: 'Patients to endorse, round on, and monitor this shift.' },
                  { title: 'Medication Due Soon', value: pendingMedicationRequests.length, caption: 'Bedside administrations waiting for nurse action.' },
                  { title: 'Handover Coverage', value: acknowledgedHandover ? 'Ready' : 'Pending', caption: acknowledgedHandover ? 'Latest handover has been acknowledged.' : 'Save or acknowledge the active handover note.' }
              ];
          case 'diagnostic':
              return [
                  { title: 'Specimen Endorsements', value: approvalInbox.length, caption: 'Incoming endorsements and lab-linked support requests.' },
                  { title: 'Diagnostic Orders', value: recentOrders.length, caption: 'Orders that may need sample, labeling, or routing support.' },
                  { title: 'Doctor Liaison', value: careTeamDoctors.length, caption: doctorCoverageLabel }
              ];
          case 'imaging':
              return [
                  { title: 'Exam Preparation Queue', value: openAppointments.length, caption: 'Patients scheduled for exam-related support and prep.' },
                  { title: 'Imaging Coordination', value: recentOrders.length, caption: 'Shared support items connected to imaging and ECG workflows.' },
                  { title: 'Doctor Liaison', value: careTeamDoctors.length, caption: doctorCoverageLabel }
              ];
          case 'clinic':
          case 'remote':
              return [
                  { title: nurseWorkspace.type === 'remote' ? 'Virtual Assist Queue' : 'Rooming & Flow Queue', value: openAppointments.length, caption: 'Active appointments still needing nurse-side support.' },
                  { title: 'Shared Documentation Tasks', value: openTaskCount, caption: 'Open tasks, endorsements, and shift responsibilities.' },
                  { title: 'Doctor Coverage', value: careTeamDoctors.length, caption: doctorCoverageLabel }
              ];
          case 'procedure':
              return [
                  { title: 'Procedure Prep Coverage', value: openAppointments.length, caption: 'Scheduled assists and patient prep still in progress.' },
                  { title: 'Recovery & Medication Watch', value: pendingMedicationRequests.length, caption: 'Procedure-related medication and recovery observations.' },
                  { title: 'Doctor Coverage', value: careTeamDoctors.length, caption: doctorCoverageLabel }
              ];
          default:
              return [
                  { title: 'Shift Tasks', value: openTaskCount, caption: 'Shared items that still need nurse action.' },
                  { title: 'Medication Queue', value: pendingMedicationRequests.length, caption: 'Medication administrations waiting in the queue.' },
                  { title: 'Doctor Coverage', value: careTeamDoctors.length, caption: doctorCoverageLabel }
              ];
      }
  }, [
      nurseWorkspace.type,
      openAppointments.length,
      openTaskCount,
      pendingMedicationRequests.length,
      careTeamDoctors.length,
      doctorCoverageLabel,
      activeCriticalWatch.length,
      inpatientDeptCount,
      deptPatients.length,
      approvalInbox.length,
      recentOrders.length,
      acknowledgedHandover
  ]);

  const workspaceQueueItems = useMemo(() => {
      switch (nurseWorkspace.type) {
          case 'diagnostic':
              return [
                  { label: 'Specimen endorsements', value: approvalInbox.length, note: 'Requests waiting for nurse support or follow-through.' },
                  { label: 'Diagnostic orders', value: recentOrders.length, note: 'Recent orders that may require sample or workflow coordination.' },
                  { label: 'Open shared tasks', value: openTaskCount, note: 'Department handoff and support tasks still in progress.' }
              ];
          case 'imaging':
              return [
                  { label: 'Exam support appointments', value: openAppointments.length, note: 'Patients scheduled for imaging or ECG-related support.' },
                  { label: 'Imaging-linked orders', value: recentOrders.length, note: 'Orders and preparation tasks assigned to the nurse queue.' },
                  { label: 'Open shared tasks', value: openTaskCount, note: 'Follow-up, endorsement, and transport-related tasks.' }
              ];
          case 'clinic':
          case 'remote':
              return [
                  { label: nurseWorkspace.type === 'remote' ? 'Virtual consult assists' : 'Patients waiting for rooming', value: openAppointments.length, note: 'Appointments still requiring nurse preparation or follow-up.' },
                  { label: 'Doctor endorsements', value: approvalInbox.length, note: 'Inbox items forwarded from doctor-linked workflows.' },
                  { label: 'Open shared tasks', value: openTaskCount, note: 'Shift tasks and care coordination items still open.' }
              ];
          case 'procedure':
              return [
                  { label: 'Procedure support requests', value: openAppointments.length, note: 'Scheduled assists and prep workflows assigned to nursing.' },
                  { label: 'Recovery-linked orders', value: recentOrders.length, note: 'Medication, supplies, or procedure follow-up orders.' },
                  { label: 'Open shared tasks', value: openTaskCount, note: 'Prep, recovery, and endorsement tasks still active.' }
              ];
          default:
              return [
                  { label: 'Support requests', value: approvalInbox.length, note: 'Shared nurse inbox endorsements waiting for review.' },
                  { label: 'Recent orders', value: recentOrders.length, note: 'Recent care orders and requests from the clinical workflow.' },
                  { label: 'Open shared tasks', value: openTaskCount, note: 'Shift tasks and handover items still in progress.' }
              ];
      }
  }, [nurseWorkspace.type, approvalInbox.length, recentOrders.length, openTaskCount, openAppointments.length]);

  // Real-time Welcome & Admin Announcements
  useEffect(() => {
      // Poll for Admin Announcements (API)
      const fetchAnnouncements = async () => {
          try {
              const response = await fetch(`${API_BASE}/api/announcements`, { headers: { ...getAuthHeaders() } });
              if (response.ok) {
                  const announcements = await response.json();
                  // We use a simpler logic: check if we have seen this announcement ID before
                  // For this to work robustly, we need a persisted "last seen" ID or timestamp.
                  // Here we use localStorage to track the highest ID seen.
                  const lastSeenId = localStorage.getItem('last_seen_announcement_id') || '0';
                  
                  // Filter for new announcements (assuming mongo _id or a numeric id is sortable/comparable, 
                  // but Mongo IDs are strings. We might need a better check, e.g. "createdAt" > lastCheckTime)
                  // For simplicity with the current mock setup, let's filter by checking if ID is NOT in our "seen list"
                  // A better approach for production: Store 'lastCheckedTime' and filter items created after that.
                  
                  // Let's stick to the 'lastCheckedTime' approach for stability with MongoDB
                  const lastCheckedTime = localStorage.getItem('last_checked_announcement_time');
                  const newTime = new Date().toISOString();
                  
                  const newAnnouncements = announcements.filter(a => {
                      if (!lastCheckedTime) return true; // First run, show all? Or maybe just recent? Let's show all for now.
                      return new Date(a.createdAt) > new Date(lastCheckedTime);
                  });

                  if (newAnnouncements.length > 0) {
                      newAnnouncements.forEach(a => {
                         // Map priority to activity type style
                         let activityType = 'info';
                         if (a.priority === 'Urgent') activityType = 'alert';
                         if (a.priority === 'Normal') activityType = 'success'; // or default
                         
                         addActivity('Admin Announcement', `${a.title}: ${a.content}`, activityType);
                      });
                  }
                  
                  // Update check time
                  localStorage.setItem('last_checked_announcement_time', newTime);
              }
          } catch (error) {
              console.error("Error fetching announcements:", error);
          }
      };

      // Initial fetch
      fetchAnnouncements();

      // Poll every 10 seconds
      const interval = setInterval(fetchAnnouncements, 10000); 

      return () => clearInterval(interval);
  }, []);



  const onCallDirectory = [
      { id: 1, name: 'Dr. Emily Chen', role: 'Cardiology', initial: 'EC' },
      { id: 2, name: 'Dr. Michael Tan', role: 'Pediatrics', initial: 'MT' },
      { id: 3, name: 'Nurse Station 2', role: 'Emergency', initial: 'NS' },
  ];

  // Admission State
  const [showAdmissionModal, setShowAdmissionModal] = useState(false);
  const [selectedPatientForAdmission, setSelectedPatientForAdmission] = useState(null);
  const [admissionFormData, setAdmissionFormData] = useState({
    wardNumber: '',
    diagnosis: '',
    attendingDoctor: ''
  });

  // Clinical Update State
  const [showClinicalUpdateModal, setShowClinicalUpdateModal] = useState(false);
  const [selectedPatientForClinicalUpdate, setSelectedPatientForClinicalUpdate] = useState(null);
  const [clinicalUpdateFormData, setClinicalUpdateFormData] = useState({
    type: 'Vitals',
    bloodPressure: '',
    heartRate: '',
    temperature: '',
    respiratoryRate: '',
    notes: ''
  });
  const [clinicalUpdateStatus, setClinicalUpdateStatus] = useState(null);

  // Orders State
  const [activeOrderTab, setActiveOrderTab] = useState('medications');
  const [orderFormData, setOrderFormData] = useState({
    patientId: '',
    patientName: '',
    item: '',
    dosage: '',
    productId: '',
    productType: '',
    unitPrice: '',
    quantity: 1,
    priority: 'Routine',
    notes: ''
  });
  const handleOrderInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'patientId') {
      const match = (deptPatients || []).find((p) => String(p._id) === String(value));
      setOrderFormData((prev) => ({
        ...prev,
        patientId: value,
        patientName: match ? `${match.firstName} ${match.lastName}`.trim() : prev.patientName
      }));
      return;
    }
    setOrderFormData(prev => ({ ...prev, [name]: value }));
  };

  const parseOrderMessage = (msg) => {
    const t = String(msg || '');
    const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
    const map = {};
    lines.forEach((l) => {
      const idx = l.indexOf(':');
      if (idx > 0) {
        const k = l.slice(0, idx).trim().toLowerCase().replace(/\s+/g, '');
        const v = l.slice(idx + 1).trim();
        map[k] = v;
      }
    });
    let items = [];
    const itemsJsonRaw = map.itemsjson || '';
    if (itemsJsonRaw) {
      try {
        const parsed = JSON.parse(itemsJsonRaw);
        items = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        items = [];
      }
    }
    const firstName = items.length ? String(items[0]?.name || items[0]?.item || '').trim() : '';
    const firstQty = items.length ? Math.max(1, Number(items[0]?.qty || items[0]?.quantity || 1)) : 0;
    return {
      type: map.type || '',
      item: map.item || firstName || '',
      quantity: Number(map.quantity || firstQty || 1) || 1,
      patient: map.patient || '',
      priority: map.priority || '',
      notes: map.notes || '',
      items
    };
  };

  const relativeTime = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    const diff = Math.max(0, Date.now() - d.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} mins ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.floor(hrs / 24);
    return `${days} days ago`;
  };

  const inferAssignedRoleForLab = (testName) => {
    const t = String(testName || '').toLowerCase();
    if (t.includes('x-ray') || t.includes('xray') || t.includes('radiology')) return 'radiographer';
    if (t.includes('ecg') || t.includes('ekg')) return 'ecg_operator';
    return 'medtech';
  };

  const refreshRecentOrders = async ({ silent = false } = {}) => {
    if (!user?.name) return;
    if (!silent) setRecentOrdersLoading(true);
    setRecentOrdersError('');
    try {
      const headers = { ...getAuthHeaders() };
      const [clinicalRes, requestRes] = await Promise.all([
        (async () => {
          const params = new URLSearchParams();
          params.set('orderedByRole', 'Nurse');
          params.set('orderedByName', user.name);
          params.set('take', '50');
          const res = await fetch(`${API_BASE}/api/clinical-orders?${params.toString()}`, { headers });
          const data = await res.json().catch(() => []);
          if (!res.ok) throw new Error(data?.message || 'Unable to load recent orders');
          return (Array.isArray(data) ? data : []).map((o) => {
            const rawIso = o.updatedAt || o.createdAt || null;
            return {
              id: `clinical-${o.id}`,
              type: o.kind || 'Order',
              item: o.service || '',
              patient: o.patientName || '',
              status: o.status || 'Pending',
              time: relativeTime(rawIso),
              _ts: rawIso ? new Date(rawIso).getTime() : 0
            };
          });
        })(),
        (async () => {
          const params = new URLSearchParams();
          params.set('requesterName', user.name);
          params.set('take', '50');
          const res = await fetch(`${API_BASE}/api/requests?${params.toString()}`, { headers });
          const data = await res.json().catch(() => []);
          if (!res.ok) throw new Error(data?.message || 'Unable to load recent orders');
          return (Array.isArray(data) ? data : [])
            .map((r) => ({ ...r, _parsed: parseOrderMessage(r.message) }))
            .filter((r) => {
              const t = String(r._parsed?.type || '').trim().toLowerCase();
              return t === 'medication' || t === 'supply';
            })
            .map((r) => {
              const rawIso = r.created_at || r.createdAt || null;
              const parsedType = String(r._parsed?.type || '').trim().toLowerCase();
              return {
                id: `request-${r.id}`,
                type: parsedType === 'medication' ? 'Medication' : 'Supply',
                item: r._parsed?.item || '',
                patient: r._parsed?.patient || '',
                status: r.status || 'Pending',
                time: relativeTime(rawIso),
                _ts: rawIso ? new Date(rawIso).getTime() : 0
              };
            });
        })()
      ]);

      const merged = [...clinicalRes, ...requestRes]
        .sort((a, b) => (b._ts || 0) - (a._ts || 0))
        .map(({ _ts, ...rest }) => rest);

      setRecentOrders(merged);
    } catch (e) {
      setRecentOrders([]);
      setRecentOrdersError(String(e.message || 'Unable to load recent orders'));
    } finally {
      if (!silent) setRecentOrdersLoading(false);
    }
  };

  React.useEffect(() => {
    refreshRecentOrders().catch(() => {});
  }, [user?.name]);

  const handleOrderSubmit = async (e) => {
    e.preventDefault();

    const type = activeOrderTab === 'medications' ? 'Medication' : (activeOrderTab === 'labs' ? 'Lab' : 'Supply');
    const itemText = `${orderFormData.item || ''}${orderFormData.dosage ? ` ${orderFormData.dosage}` : ''}`.trim();
    const patientText = String(orderFormData.patientName || '').trim() || 'Unknown';
    const qty = Number(orderFormData.quantity || 1) || 1;
    const pr = String(orderFormData.priority || 'Routine').trim() || 'Routine';

    try {
      let res = null;
      if (type === 'Lab') {
        const assignedRole = inferAssignedRoleForLab(orderFormData.item);
        res = await fetch(`${API_BASE}/api/clinical-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            patientId: orderFormData.patientId || null,
            patientName: patientText,
            kind: type,
            service: itemText,
            priority: pr,
            notes: orderFormData.notes ? String(orderFormData.notes).trim() : null,
            orderedByName: user.name || 'Nurse',
            orderedByRole: 'Nurse',
            assignedRole,
            assignedTo: null,
            scheduledAt: null,
            actorName: user.name || 'Nurse',
            actorRole: 'nurse'
          })
        });
      } else {
        const productId = String(orderFormData.productId || '').trim();
        const productType = String(orderFormData.productType || '').trim().toLowerCase();
        const unitPrice = Number(orderFormData.unitPrice || 0);
        if (!productId || !/^\d+$/.test(productId)) throw new Error('Select an item from inventory.');
        if (productType !== 'medicine' && productType !== 'supply') throw new Error('Invalid item type.');
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid item price.');
        const lineTotal = (Math.round(unitPrice * 100) / 100) * Math.max(1, qty);

        const itemsJson = JSON.stringify([
          {
            type: productType,
            itemId: productId,
            name: itemText,
            unitPrice: Math.round(unitPrice * 100) / 100,
            qty: Math.max(1, qty),
            lineTotal: Math.round(lineTotal * 100) / 100
          }
        ]);

        const msgLines = [
          `Type: ${type.toLowerCase()}`,
          itemText ? `Item: ${itemText}` : '',
          `Quantity: ${qty}`,
          `Patient: ${patientText}`,
          `Priority: ${pr}`,
          `Unit Price: ${Math.round(unitPrice * 100) / 100}`,
          `Total Amount: ${Math.round(lineTotal * 100) / 100}`,
          `ItemsJson: ${itemsJson}`,
          orderFormData.notes ? `Notes: ${String(orderFormData.notes).trim()}` : ''
        ].filter(Boolean).join('\n');

        res = await fetch(`${API_BASE}/api/requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            patientId: orderFormData.patientId || null,
            patientName: patientText,
            requesterName: user.name || 'Nurse',
            requestType: type,
            details: msgLines
          })
        });
      }

      if (!res.ok) throw new Error('Failed');
      await res.json().catch(() => null);
      await refreshRecentOrders({ silent: true });
      setSuccessMessage(`${type} order submitted successfully!`);
      setModalType("success");
      setShowSuccessModal(true);
      addActivity('New Order', `${type} order for ${patientText}`, 'success');

      setOrderFormData({
        patientId: '',
        patientName: '',
        item: '',
        dosage: '',
        productId: '',
        productType: '',
        unitPrice: '',
        quantity: 1,
        priority: 'Routine',
        notes: ''
      });
    } catch (_) {
      setSuccessMessage("Failed to submit order. Please check your connection.");
      setModalType("error");
      setShowSuccessModal(true);
    }
  };

  // Edit Patient State
  const [editingPatient, setEditingPatient] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [updatePatientError, setUpdatePatientError] = useState("");

  // Delete Patient State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [deleteStatus, setDeleteStatus] = useState(null); // 'deleting', 'success', 'error'

  // View Profile State
  const [showViewProfileModal, setShowViewProfileModal] = useState(false);
  const [viewingPatient, setViewingPatient] = useState(null);
  const [viewingPatientResults, setViewingPatientResults] = useState([]);
  const [viewingPatientResultsLoading, setViewingPatientResultsLoading] = useState(false);
  const [viewingPatientResultsError, setViewingPatientResultsError] = useState('');

  const [showEROrdersModal, setShowEROrdersModal] = useState(false);
  const [ordersModalTab, setOrdersModalTab] = useState('orders'); // orders | supplies
  const [ordersTargetPatient, setOrdersTargetPatient] = useState(null);
  const [patientOrders, setPatientOrders] = useState([]);
  const [patientOrdersLoading, setPatientOrdersLoading] = useState(false);
  const [patientOrdersError, setPatientOrdersError] = useState('');
  const [orderRemarkDraft, setOrderRemarkDraft] = useState({});
  const [orderDetailsById, setOrderDetailsById] = useState({});
  const [orderDetailsLoadingId, setOrderDetailsLoadingId] = useState(null);
  const [orderActionLoadingId, setOrderActionLoadingId] = useState(null);

  const [supplyCatalog, setSupplyCatalog] = useState([]);
  const [supplyCatalogLoading, setSupplyCatalogLoading] = useState(false);
  const [restockMine, setRestockMine] = useState([]);
  const [restockMineLoading, setRestockMineLoading] = useState(false);
  const [restockMineError, setRestockMineError] = useState('');
  const [supplyRequestForm, setSupplyRequestForm] = useState({ supplyId: '', qty: 1, priority: 'Normal', note: '' });
  const [supplyRequestSubmitting, setSupplyRequestSubmitting] = useState(false);

  const [pharmacyCatalog, setPharmacyCatalog] = useState([]);
  const [pharmacyCatalogLoading, setPharmacyCatalogLoading] = useState(false);
  const [pharmacyCatalogError, setPharmacyCatalogError] = useState('');
  const [pharmacyCatalogSearch, setPharmacyCatalogSearch] = useState('');

  const refreshPharmacyCatalog = async () => {
    setPharmacyCatalogLoading(true);
    setPharmacyCatalogError('');
    try {
      const params = new URLSearchParams();
      params.set('includeOutOfStock', '1');
      params.set('take', '1000');
      const res = await fetch(`${API_BASE}/api/pharmacy/products?${params.toString()}`, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.message || 'Unable to load inventory products');
      setPharmacyCatalog(Array.isArray(data) ? data : []);
    } catch (e) {
      setPharmacyCatalog([]);
      setPharmacyCatalogError(String(e.message || 'Unable to load inventory products'));
    } finally {
      setPharmacyCatalogLoading(false);
    }
  };

  React.useEffect(() => {
    refreshPharmacyCatalog().catch(() => {});
  }, []);

  // Request Correction State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestStatus, setRequestStatus] = useState(null);

  // Incident Reports State
  const [incidentReports, setIncidentReports] = useState([]);
  const [incidentFormData, setIncidentFormData] = useState({
      date: new Date().toISOString().split('T')[0],
      time: '',
      type: 'Fall',
      severity: 'Moderate',
      location: '',
      patientId: '',
      patientName: '',
      escalatedTo: '',
      description: '',
      actionTaken: '',
      followUpStatus: 'For Review'
  });

  // Fetch incidents on load
  React.useEffect(() => {
    fetch(`${API_BASE}/api/incidents`, { headers: { ...getAuthHeaders() } })
      .then(res => res.json())
      .then(data => {
        // Map database fields to frontend fields
        const formatted = data.map(inc => ({
            id: inc.id,
            date: new Date(inc.incident_date).toISOString().split('T')[0],
            time: inc.incident_time,
            type: inc.incident_type,
            severity: inc.severity || 'Moderate',
            location: inc.location,
            patientId: inc.patient_id || '',
            patientName: inc.patient_name || '',
            escalatedTo: inc.escalated_to || '',
            description: inc.description,
            reporter: inc.created_by_email,
            status: inc.status,
            followUpStatus: inc.follow_up_status || 'For Review'
        }));
        setIncidentReports(formatted);
      })
      .catch(err => console.error("Failed to fetch incidents:", err));
  }, []);

  const handleIncidentSubmit = async (e) => {
      e.preventDefault();
      
      const currentUser = JSON.parse(localStorage.getItem('currentUser')) || {};
      const reporterEmail = currentUser.email || user.name;

      const payload = {
          incident_date: incidentFormData.date,
          incident_time: incidentFormData.time,
          incident_type: incidentFormData.type,
          severity: incidentFormData.severity,
          location: incidentFormData.location,
          patient_id: incidentFormData.patientId || null,
          patient_name: incidentFormData.patientName || null,
          escalated_to: incidentFormData.escalatedTo || null,
          description: incidentFormData.description,
          action_taken: incidentFormData.actionTaken,
          created_by_email: reporterEmail,
          follow_up_status: incidentFormData.followUpStatus
      };

      try {
          const res = await fetch(`${API_BASE}/api/incidents`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify(payload)
          });

          if (res.ok) {
              const savedIncident = await res.json();
              
              // Add to local state immediately
              const newReport = {
                  id: savedIncident.id,
                  date: new Date(savedIncident.incident_date).toISOString().split('T')[0],
                  time: savedIncident.incident_time,
                  type: savedIncident.incident_type,
                  severity: savedIncident.severity || incidentFormData.severity,
                  location: savedIncident.location,
                  patientId: savedIncident.patient_id || incidentFormData.patientId || '',
                  patientName: savedIncident.patient_name || incidentFormData.patientName || '',
                  escalatedTo: savedIncident.escalated_to || incidentFormData.escalatedTo || '',
                  description: savedIncident.description,
                  reporter: savedIncident.created_by_email,
                  status: savedIncident.status,
                  followUpStatus: savedIncident.follow_up_status || incidentFormData.followUpStatus
              };
              
              setIncidentReports([newReport, ...incidentReports]);
              addActivity('Incident Reported', `${newReport.type} in ${newReport.location}`, 'alert');
              setSuccessMessage("Incident report submitted successfully.");
              setModalType("success");
              setShowSuccessModal(true);
              
              // Reset form
              setIncidentFormData({
                  date: new Date().toISOString().split('T')[0],
                  time: '',
                  type: 'Fall',
                  severity: 'Moderate',
                  location: '',
                  patientId: '',
                  patientName: '',
                  escalatedTo: '',
                  description: '',
                  actionTaken: '',
                  followUpStatus: 'For Review'
              });
          } else {
              throw new Error("Failed to save to database");
          }
      } catch (err) {
          console.error(err);
          alert("Error saving incident report");
      }
  };

  const handleIncidentChange = (e) => {
      const { name, value } = e.target;
      setIncidentFormData(prev => ({ ...prev, [name]: value }));
  };

  // Validation State
  const [nameNotice, setNameNotice] = useState("");
  const [nameNoticeField, setNameNoticeField] = useState(null);
  const [ageNotice, setAgeNotice] = useState("");
  const [ageNoticeField, setAgeNoticeField] = useState(null);
  const [phoneNotice, setPhoneNotice] = useState("");
  const [phoneNoticeField, setPhoneNoticeField] = useState(null);
  const [emailNotice, setEmailNotice] = useState("");
  const [emailNoticeField, setEmailNoticeField] = useState(null);
  const [addressNotice, setAddressNotice] = useState("");
  const [addressNoticeField, setAddressNoticeField] = useState(null);
  const [countryNotice, setCountryNotice] = useState("");
  const [countryNoticeField, setCountryNoticeField] = useState(null);
  
  // Location Data
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedProvince, setSelectedProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const ncrCalabarzonCities = [
    // NCR
    { city: "Caloocan", province: "Metro Manila", zip: "1400" },
    { city: "Las Pinas", province: "Metro Manila", zip: "1740" },
    { city: "Makati", province: "Metro Manila", zip: "1200" },
    { city: "Malabon", province: "Metro Manila", zip: "1470" },
    { city: "Mandaluyong", province: "Metro Manila", zip: "1550" },
    { city: "Manila", province: "Metro Manila", zip: "1000" },
    { city: "Marikina", province: "Metro Manila", zip: "1800" },
    { city: "Muntinlupa", province: "Metro Manila", zip: "1770" },
    { city: "Navotas", province: "Metro Manila", zip: "1485" },
    { city: "Paranaque", province: "Metro Manila", zip: "1700" },
    { city: "Pasay", province: "Metro Manila", zip: "1300" },
    { city: "Pasig", province: "Metro Manila", zip: "1600" },
    { city: "Pateros", province: "Metro Manila", zip: "1620" },
    { city: "Quezon City", province: "Metro Manila", zip: "1100" },
    { city: "San Juan", province: "Metro Manila", zip: "1500" },
    { city: "Taguig", province: "Metro Manila", zip: "1630" },
    { city: "Valenzuela", province: "Metro Manila", zip: "1440" },
    // Cavite
    { city: "Bacoor", province: "Cavite", zip: "4102" },
    { city: "Cavite City", province: "Cavite", zip: "4100" },
    { city: "Dasmarinas", province: "Cavite", zip: "4114" },
    { city: "Imus", province: "Cavite", zip: "4103" },
    { city: "Tagaytay", province: "Cavite", zip: "4120" },
    { city: "General Trias", province: "Cavite", zip: "4107" },
    // Laguna
    { city: "Binan", province: "Laguna", zip: "4024" },
    { city: "Cabuyao", province: "Laguna", zip: "4025" },
    { city: "Calamba", province: "Laguna", zip: "4027" },
    { city: "San Pablo", province: "Laguna", zip: "4000" },
    { city: "Santa Rosa", province: "Laguna", zip: "4026" },
    { city: "San Pedro", province: "Laguna", zip: "4023" },
    // Batangas
    { city: "Batangas City", province: "Batangas", zip: "4200" },
    { city: "Lipa", province: "Batangas", zip: "4217" },
    { city: "Tanauan", province: "Batangas", zip: "4232" },
    { city: "Santo Tomas", province: "Batangas", zip: "4234" },
    // Rizal
    { city: "Antipolo", province: "Rizal", zip: "1870" },
    { city: "Cainta", province: "Rizal", zip: "1900" },
    { city: "Taytay", province: "Rizal", zip: "1920" },
    { city: "Binangonan", province: "Rizal", zip: "1940" },
    // Quezon
    { city: "Lucena", province: "Quezon", zip: "4301" },
    { city: "Tayabas", province: "Quezon", zip: "4327" },
  ];

  // Profile Form State
  const [profileData, setProfileData] = useState({
    username: '',
    email: '',
    phone: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [profileErrors, setProfileErrors] = useState({});
  const [formError, setFormError] = useState('');



  const [isFormValid, setIsFormValid] = useState(false);

  React.useEffect(() => {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser) {
            const displayName = currentUser.name || `${currentUser.firstName || currentUser.first_name || ''} ${currentUser.lastName || currentUser.last_name || ''}`.trim() || 'Nurse';
            const specialization = String(currentUser.specialization || '').trim();
            const departmentRaw = currentUser.department || currentUser.dept || specialization || activeDept;
            const roleLabel = specialization || formatDepartmentLabel(departmentRaw) || 'Nurse';
            const shiftLabel = deriveShiftLabel(currentUser.shift);
            setUser({
                name: displayName,
                roleLabel,
                departmentLabel: formatDepartmentLabel(departmentRaw),
                specialization,
                shiftLabel,
                email: currentUser.email || ''
            });
            setProfileData(prev => ({
                ...prev,
                username: displayName,
                email: currentUser.email || 'nurse@hospital.com', // fallback
                phone: currentUser.phone || '09123456789' // fallback
            }));
        }
    } catch (e) {
        // ignore
    }
  }, [activeDept]);

  React.useEffect(() => {
    // Validation Logic
    const isValid = () => {
        if (!profileData.username || !profileData.email || !profileData.phone) return false;
        
        if (profileData.newPassword) {
            if (profileData.newPassword.length < 6) return false;
            if (profileData.newPassword !== profileData.confirmPassword) return false;
            if (!profileData.currentPassword) return false;
        }
        return true;
    };
    setIsFormValid(isValid());
  }, [profileData]);

  React.useEffect(() => {
    if (!user?.name) return;
    refreshNurseWorkflow().catch(() => {});
  }, [user?.name, activeDept, currentShiftLabel]);

  React.useEffect(() => {
    if (!user?.name) return undefined;
    const interval = setInterval(() => {
      refreshNurseWorkflow({ silent: true }).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [user?.name, activeDept, currentShiftLabel]);

  // Fetch Dashboard Stats
  React.useEffect(() => {
    const fetchStats = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/stats/overview`, { headers: { ...getAuthHeaders() } });
            const data = await res.json();
            if (res.ok) {
                setStats(data);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000); // Poll every 5s for real-time updates
    return () => clearInterval(interval);
  }, []);

  // Fetch Patients List
  React.useEffect(() => {
    if (['patients', 'overview', 'inpatients'].includes(view)) {
        refreshPatientsList();
    }
  }, [view]);

  React.useEffect(() => {
    if (view === 'patients') {
      fetchPatientRecords();
    }
  }, [view, activeDept, approvalDepartment]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    
    const errors = {};
    if (!profileData.username) errors.username = "Username is required";
    if (!profileData.email) errors.email = "Email is required";
    if (!profileData.phone) errors.phone = "Phone is required";
    
    // Only validate new password if user is trying to change it
    if (profileData.newPassword || profileData.confirmPassword) {
        if ((profileData.newPassword || "").length < 6) errors.newPassword = "Password must be at least 6 characters";
        if (profileData.newPassword !== profileData.confirmPassword) errors.confirmPassword = "Passwords do not match";
    }

    // Strict validation: Always require current password for any update
    if (!profileData.currentPassword) errors.currentPassword = "Current password is required";
    
    setProfileErrors(errors);
    
    if (Object.keys(errors).length > 0) {
        setFormError("Please correct the errors above.");
        return;
    }

    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (!currentUser || !currentUser._id) {
            setFormError("Session expired. Please login again.");
            return;
        }

        // Split username into firstName and lastName for backend compatibility
        const nameParts = profileData.username.trim().split(' ');
        let firstName = profileData.username;
        let lastName = '.'; // Default placeholder if single name provided

        if (nameParts.length > 1) {
            lastName = nameParts.pop();
            firstName = nameParts.join(' ');
        }

        const payload = {
            firstName: firstName,
            lastName: lastName,
            email: profileData.email,
            phone: profileData.phone,
            currentPassword: profileData.currentPassword,
            requiresPasswordAuth: true
        };

        if (profileData.newPassword) {
            payload.password = profileData.newPassword.trim();
        }

        const response = await fetch(`${API_BASE}/api/staff/${currentUser._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            setSuccessMessage("Successful");
            setShowSuccessModal(true);
            setFormError("");
            
            // Update local storage
            const updatedUser = { 
                ...currentUser, 
                name: profileData.username,
                email: data.email || profileData.email, 
                phone: data.phone || profileData.phone 
            };
            localStorage.setItem('currentUser', JSON.stringify(updatedUser));
            
            // Update Dashboard Header
            setUser(prev => ({ ...prev, name: profileData.username, email: data.email || profileData.email }));
            
            // Clear passwords from form
            setProfileData(prev => ({ 
                ...prev, 
                currentPassword: '', 
                newPassword: '', 
                confirmPassword: '' 
            }));
            
            // Optional: Navigate after modal close? For now, just show modal.
        } else {
            setFormError(data.message || "Failed to update profile.");
        }
    } catch (error) {
        console.error("Update error:", error);
        setFormError("Network error. Please try again.");
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (profileErrors[name]) {
        setProfileErrors(prev => ({ ...prev, [name]: null }));
    }
    if (formError) setFormError('');
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    setRequestStatus('submitting');
    
    try {
        const response = await fetch(`${API_BASE}/api/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
                patientId: editingPatient._id,
                requesterName: user.name || 'Nurse',
                requestType: 'Data Correction',
                details: `Patient: ${editingPatient.firstName} ${editingPatient.lastName} - Correction: ${requestMessage}`
            })
        });

        if (response.ok) {
            setShowRequestModal(false);
            setRequestMessage("");
            setRequestStatus(null);
            setSuccessMessage("Request submitted successfully!");
            setModalType("success");
            setShowSuccessModal(true);
        } else {
            setRequestStatus('error');
        }
    } catch (error) {
        console.error("Error submitting request:", error);
        setRequestStatus('error');
    }
  };

  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [handoffContent, setHandoffContent] = useState("");

  const generateHandoff = () => {
      const date = new Date().toLocaleDateString();
      const time = new Date().toLocaleTimeString();
      
      let report = `SHIFT HANDOFF REPORT\n`;
      report += `Nurse: ${user.name}\n`;
      report += `Date: ${date} ${time}\n`;
      report += `-----------------------------------\n\n`;

      report += `[CRITICAL PATIENTS]\n`;
      if (criticalVitals.length === 0) report += `None.\n`;
      criticalVitals.forEach(p => {
          report += `- ${p.name} (${p.room}): ${p.bp}, HR ${p.hr} [${p.status.toUpperCase()}]\n`;
      });
      report += `\n`;

      report += `[PENDING URGENT TASKS]\n`;
      const urgentTasks = tasks.filter(t => t.priority === 'urgent' && !t.completed);
      if (urgentTasks.length === 0) report += `None.\n`;
      urgentTasks.forEach(t => {
          report += `- ${t.text} (${t.time})\n`;
      });
      report += `\n`;

      report += `[RECENT ALERTS]\n`;
      const alerts = notifications.filter(n => n.type === 'alert').slice(0, 5);
      if (alerts.length === 0) report += `None.\n`;
      alerts.forEach(n => {
          report += `- ${n.time}: ${n.message}\n`;
      });
      report += `\n`;
      
      report += `[SHIFT NOTES]\n`;
      report += shiftNotes || "No notes.";

      setHandoffContent(report);
      setShowHandoffModal(true);
  };

  const handleLogout = async () => {
    try {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser && currentUser._id) {
            await fetch(`${API_BASE}/api/staff/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ 
                    id: currentUser._id, 
                    accountType: currentUser.accountType || 'nurse' 
                })
            });
        }
    } catch (error) {
        console.error("Logout error:", error);
    }

    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('currentUser');
    navigate('/login');
  };

  // --- Validation Functions (Reused from Admin) ---

  const handleCityChange = (e) => {
    const city = e.target.value;
    setSelectedCity(city);
    const data = ncrCalabarzonCities.find(c => c.city === city);
    if (data) {
      setSelectedProvince(data.province);
      setPostalCode(data.zip);
      setEditFormData(prev => ({
        ...prev,
        city: city,
        province: data.province,
        postalCode: data.zip
      }));
    } else {
      setSelectedProvince("");
      setPostalCode("");
      setEditFormData(prev => ({
        ...prev,
        city: city,
        province: "",
        postalCode: ""
      }));
    }
  };

  const handleNameInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape", " "];
    const isLetter = /^[a-zA-Z]$/.test(e.key);

    if (!isLetter && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setNameNoticeField(fieldId);
      setNameNotice("Letters only.");
    } else if (isLetter && nameNoticeField === fieldId) {
      setNameNotice("");
      setNameNoticeField(null);
    }
  };

  const handlePhoneInput = (e, fieldId) => {
    const allowedKeys = ["Backspace", "Tab", "ArrowLeft", "ArrowRight", "Delete", "Enter", "Escape"];
    const isNumber = /^[0-9]$/.test(e.key);
    const currentVal = e.target.value;
    const currentLength = currentVal.length;

    if (!isNumber && !allowedKeys.includes(e.key)) {
      e.preventDefault();
      setPhoneNoticeField(fieldId);
      setPhoneNotice("Numbers only.");
    } else if (isNumber) {
      if (currentLength === 0 && e.key !== "0") {
         e.preventDefault();
         setPhoneNoticeField(fieldId);
         setPhoneNotice("Must start with 0.");
      } else if (currentLength === 1 && e.key !== "9") {
         e.preventDefault();
         setPhoneNoticeField(fieldId);
         setPhoneNotice("Must start with 09.");
      } else if (currentLength >= 11) {
        e.preventDefault();
        setPhoneNoticeField(fieldId);
        setPhoneNotice("Max 11 digits.");
      } else if (phoneNoticeField === fieldId) {
        setPhoneNotice("");
        setPhoneNoticeField(null);
      }
    } else if (allowedKeys.includes(e.key)) {
      if (phoneNoticeField === fieldId) {
        setPhoneNotice("");
        setPhoneNoticeField(null);
      }
    }
  };

  const handleDateChange = (e, fieldId) => {
    const val = e.target.value;
    setEditFormData(prev => ({ ...prev, dateOfBirth: val }));
    
    const selectedDate = new Date(val);
    const today = new Date();
    
    if (selectedDate.getFullYear() >= today.getFullYear()) {
        setAgeNoticeField(fieldId);
        setAgeNotice("Invalid year.");
        return;
    }
    
    // Clear error if valid
    if (ageNoticeField === fieldId) {
        setAgeNotice("");
        setAgeNoticeField(null);
    }
  };

  const handleAddressInput = (e, fieldId) => {
    // Basic check for dangerous chars or whatever requirement
    // Admin uses specific logic, simplifying here to allow most chars but block some if needed
    // Or just clear errors on type
    if (addressNoticeField === fieldId) {
        setAddressNotice("");
        setAddressNoticeField(null);
    }
  };

  // --- Edit Handlers ---

  const handleEditClick = (patient) => {
    // Map patient data to form structure
    // Handle emergency contacts array -> individual fields
    const ec1 = patient.emergencyContacts?.[0] || {};
    const ec2 = patient.emergencyContacts?.[1] || {};
    const ec3 = patient.emergencyContacts?.[2] || {};

    setEditFormData({
        ...patient,
        // Ensure dates are formatted for input type="date"
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().split('T')[0] : '',
        dateHired: patient.dateHired ? new Date(patient.dateHired).toISOString().split('T')[0] : '',
        
        // Flatten emergency contacts
        emergencyName1: ec1.name || '',
        emergencyRel1: ec1.relationship || '',
        emergencyContact1: ec1.phone || '',
        
        emergencyName2: ec2.name || '',
        emergencyRel2: ec2.relationship || '',
        emergencyContact2: ec2.phone || '',
        
        emergencyName3: ec3.name || '',
        emergencyRel3: ec3.relationship || '',
        emergencyContact3: ec3.phone || '',
    });
    
    setSelectedCity(patient.city || "");
    setSelectedProvince(patient.province || "");
    setPostalCode(patient.postalCode || "");
    
    setEditingPatient(patient);
  };

  const handleEditFormChange = (e) => {
    const { name, value } = e.target;
    
    if (name === 'philHealthNumber') {
        const cleanVal = value.replace(/\D/g, '').slice(0, 12);
        setEditFormData(prev => ({
            ...prev,
            [name]: cleanVal
        }));
        return;
    }

    setEditFormData(prev => ({
        ...prev,
        [name]: value
    }));
  };

  const handleCancelEdit = () => {
    setEditingPatient(null);
    setEditFormData({});
    setUpdatePatientError("");
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setUpdatePatientError("");

    // Validate
    if (!editFormData.firstName || !editFormData.lastName) {
        setUpdatePatientError("Name fields are required.");
        return;
    }

    if (editFormData.philHealthNumber && editFormData.philHealthNumber.length !== 12) {
        setUpdatePatientError("PhilHealth Number must be exactly 12 digits.");
        return;
    }
    
    // Reconstruct emergency contacts array
    const emergencyContacts = [];
    if (editFormData.emergencyName1) emergencyContacts.push({ name: editFormData.emergencyName1, relationship: editFormData.emergencyRel1, phone: editFormData.emergencyContact1 });
    if (editFormData.emergencyName2) emergencyContacts.push({ name: editFormData.emergencyName2, relationship: editFormData.emergencyRel2, phone: editFormData.emergencyContact2 });
    if (editFormData.emergencyName3) emergencyContacts.push({ name: editFormData.emergencyName3, relationship: editFormData.emergencyRel3, phone: editFormData.emergencyContact3 });
    
    const payload = {
        ...editFormData,
        emergencyContacts
    };

    try {
        const response = await fetch(`${API_BASE}/api/patients/${editingPatient._id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            const updatedPatient = normalizePatient(await response.json());
            // Update list
            setPatientsList(prev => prev.map(p => p._id === updatedPatient._id ? updatedPatient : p));
            setEditingPatient(null);
            setSuccessMessage("Patient updated successfully!");
            setShowSuccessModal(true);
            addActivity('Patient Updated', `Record for ${updatedPatient.firstName} ${updatedPatient.lastName} updated.`, 'info');
        } else {
            const err = await response.json();
            setUpdatePatientError(err.message || "Failed to update patient.");
        }
    } catch (error) {
        console.error("Error updating patient:", error);
        setUpdatePatientError("Network error.");
    }
  };

  // Delete Handlers
  const handleDeleteClick = (patient) => {
    setPatientToDelete(patient);
    setDeleteStatus(null);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!patientToDelete) return;
    setDeleteStatus('deleting');

    try {
        const response = await fetch(`${API_BASE}/api/patients/${patientToDelete._id}`, {
            method: 'DELETE',
            headers: { ...getAuthHeaders() }
        });

        if (response.ok) {
            setPatientsList(prev => prev.filter(p => p._id !== patientToDelete._id));
            setDeleteStatus('success');
            setTimeout(() => {
                setShowDeleteConfirm(false);
                setPatientToDelete(null);
                setDeleteStatus(null);
                setSuccessMessage("Patient record deleted successfully.");
                setModalType("success");
                setShowSuccessModal(true);
                addActivity('Patient Deleted', `Record for ${patientToDelete.firstName} ${patientToDelete.lastName} removed.`, 'alert');
            }, 1000);
        } else {
            setDeleteStatus('error');
        }
    } catch (error) {
        console.error("Error deleting patient:", error);
        setDeleteStatus('error');
    }
  };

  // View Profile Handler
  const handleViewClick = (patient) => {
    setViewingPatient(patient);
    setShowViewProfileModal(true);
    const pid = String(patient?._id || patient?.id || '').trim();
    if (pid) fetchLabResultsForPatient(pid);
  };

  const closeViewProfileModal = () => {
    setShowViewProfileModal(false);
    setViewingPatient(null);
    setViewingPatientResults([]);
    setViewingPatientResultsLoading(false);
    setViewingPatientResultsError('');
  };

  const fetchPatientOrders = async (patientId, { silent } = {}) => {
    const pid = String(patientId || '').trim();
    if (!pid) {
      setPatientOrders([]);
      return;
    }
    if (!silent) setPatientOrdersLoading(true);
    setPatientOrdersError('');
    try {
      const params = new URLSearchParams();
      params.set('patientId', pid);
      params.set('assignedRole', 'nurse');
      params.set('take', '200');
      const res = await fetch(`${API_BASE}/api/clinical-orders?${params.toString()}`, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.message || 'Unable to load doctor orders.');
      const rows = Array.isArray(data) ? data : [];
      rows.sort((a, b) => {
        const at = a.updatedAt || a.createdAt || null;
        const bt = b.updatedAt || b.createdAt || null;
        const aKey = at ? new Date(at).getTime() : 0;
        const bKey = bt ? new Date(bt).getTime() : 0;
        return bKey - aKey;
      });
      setPatientOrders(rows);
    } catch (e) {
      setPatientOrders([]);
      setPatientOrdersError(String(e?.message || 'Unable to load doctor orders.'));
    } finally {
      if (!silent) setPatientOrdersLoading(false);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    const oid = String(orderId || '').trim();
    if (!oid) return;
    setOrderDetailsLoadingId(oid);
    try {
      const res = await fetch(`${API_BASE}/api/clinical-orders/${encodeURIComponent(oid)}`, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Unable to load order history.');
      setOrderDetailsById((prev) => ({ ...prev, [oid]: data }));
    } catch (_) {
      setOrderDetailsById((prev) => ({ ...prev, [oid]: { order: null, events: [], results: [] } }));
    } finally {
      setOrderDetailsLoadingId(null);
    }
  };

  const patchOrder = async (orderId, { status, eventNote } = {}) => {
    const oid = String(orderId || '').trim();
    if (!oid) return;
    setOrderActionLoadingId(oid);
    try {
      const res = await fetch(`${API_BASE}/api/clinical-orders/${encodeURIComponent(oid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...(status ? { status } : {}),
          eventNote: eventNote != null ? String(eventNote) : null,
          actorName: nurseInboxName,
          actorRole: 'nurse'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Update failed');
      if (ordersTargetPatient?._id) {
        await fetchPatientOrders(String(ordersTargetPatient._id), { silent: true });
      }
      await fetchOrderDetails(oid);
      setSuccessMessage('Order updated successfully.');
      setModalType('success');
      setShowSuccessModal(true);
    } catch (e) {
      setSuccessMessage(String(e?.message || 'Failed to update order.'));
      setModalType('error');
      setShowSuccessModal(true);
    } finally {
      setOrderActionLoadingId(null);
    }
  };

  const refreshSupplyCatalog = async () => {
    setSupplyCatalogLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/supplies`, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => []);
      setSupplyCatalog(Array.isArray(data) ? data : []);
    } catch (_) {
      setSupplyCatalog([]);
    } finally {
      setSupplyCatalogLoading(false);
    }
  };

  const refreshMyRestockRequests = async () => {
    setRestockMineLoading(true);
    setRestockMineError('');
    try {
      const params = new URLSearchParams();
      params.set('take', '100');
      const res = await fetch(`${API_BASE}/api/restock-requests?${params.toString()}`, { headers: { ...getAuthHeaders() } });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.message || 'Unable to load supply requests.');
      setRestockMine(Array.isArray(data) ? data : []);
    } catch (e) {
      setRestockMine([]);
      setRestockMineError(String(e?.message || 'Unable to load supply requests.'));
    } finally {
      setRestockMineLoading(false);
    }
  };

  const submitSupplyRequest = async (e) => {
    if (e) e.preventDefault();
    const supplyId = String(supplyRequestForm.supplyId || '').trim();
    const qty = Math.trunc(Number(supplyRequestForm.qty || 0));
    if (!supplyId) {
      setRestockMineError('Select a supply item.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setRestockMineError('Quantity must be greater than 0.');
      return;
    }
    setSupplyRequestSubmitting(true);
    setRestockMineError('');
    try {
      const res = await fetch(`${API_BASE}/api/restock-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          itemType: 'supply',
          itemId: supplyId,
          requestedQty: qty,
          priority: supplyRequestForm.priority || 'Normal',
          note: String(supplyRequestForm.note || '').trim() || null,
          requestedBy: nurseInboxName
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Failed to submit request');
      setSupplyRequestForm({ supplyId: '', qty: 1, priority: 'Normal', note: '' });
      await refreshMyRestockRequests();
      setSuccessMessage('Supply request sent for approval.');
      setModalType('success');
      setShowSuccessModal(true);
    } catch (e2) {
      setRestockMineError(String(e2?.message || 'Failed to submit request'));
    } finally {
      setSupplyRequestSubmitting(false);
    }
  };

  const openEROrdersForPatient = async (patient) => {
    if (!patient?._id) return;
    setOrdersTargetPatient(patient);
    setOrdersModalTab('orders');
    setShowEROrdersModal(true);
    setOrderRemarkDraft({});
    await fetchPatientOrders(String(patient._id));
    refreshSupplyCatalog().catch(() => {});
    refreshMyRestockRequests().catch(() => {});
  };

  const closeEROrdersModal = () => {
    setShowEROrdersModal(false);
    setOrdersModalTab('orders');
    setOrdersTargetPatient(null);
    setPatientOrders([]);
    setPatientOrdersError('');
    setOrderRemarkDraft({});
    setOrderDetailsById({});
    setOrderDetailsLoadingId(null);
    setOrderActionLoadingId(null);
    setRestockMineError('');
  };

  const handleViewRecordPatient = (record) => {
    const pid = String(record?.patientId || '').trim();
    if (!pid) {
      setModalType('error');
      setSuccessMessage('Missing patient id for this record.');
      setShowSuccessModal(true);
      return;
    }
    const patient = patientsById.get(pid) || null;
    if (!patient) {
      setModalType('error');
      setSuccessMessage('Patient profile is not available yet. Refresh or verify patient is registered.');
      setShowSuccessModal(true);
      return;
    }
    handleViewClick(patient);
  };

  const openUploadForRecord = (record) => {
    setUploadTargetRecord(record || null);
    setUploadResultFile(null);
    setUploadResultTitle('');
    setUploadResultType('Lab');
    setUploadResultDate('');
    setUploadResultError('');
    setShowUploadResultModal(true);
  };

  const closeUploadResultModal = () => {
    setShowUploadResultModal(false);
    setUploadTargetRecord(null);
    setUploadResultFile(null);
    setUploadResultTitle('');
    setUploadResultType('Lab');
    setUploadResultDate('');
    setUploadResultError('');
    setUploadResultSaving(false);
  };

  const submitUploadResult = async (e) => {
    e.preventDefault();
    if (!uploadTargetRecord) return;
    const pid = String(uploadTargetRecord.patientId || '').trim();
    const title = String(uploadResultTitle || '').trim();
    if (!pid) {
      setUploadResultError('Missing patient id for this record.');
      return;
    }
    if (!uploadResultFile) {
      setUploadResultError('Choose a file first.');
      return;
    }
    setUploadResultSaving(true);
    setUploadResultError('');
    try {
      const fd = new FormData();
      fd.append('file', uploadResultFile);
      fd.append('patientId', pid);

      const uploadRes = await fetch(`${API_BASE}/api/lab-results/upload`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: fd
      });
      const uploadJson = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        setUploadResultError(String(uploadJson?.message || 'Upload failed'));
        return;
      }

      const createRes = await fetch(`${API_BASE}/api/lab-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          patientId: pid,
          type: uploadResultType || 'Lab',
          title: title || (uploadResultType ? `${uploadResultType} Result` : 'Lab Result'),
          url: uploadJson.url,
          resultDate: uploadResultDate || null,
          uploadedBy: nurseInboxName,
          fileHash: uploadJson.hash || null,
          fileMeta: {
            originalName: uploadJson.originalName || null,
            mimeType: uploadJson.mimeType || null,
            size: uploadJson.size || null
          }
        })
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const rawMsg = String(createJson?.message || 'Failed to save result.');
        const msg =
          rawMsg.includes('prisma.$executeRaw') || rawMsg.includes('Invalid `prisma.$executeRaw()` invocation')
            ? 'The server could not finalize verification for this upload. Please try again or refresh the page.'
            : rawMsg;
        setUploadResultError(msg);
        return;
      }

      if (showViewProfileModal && viewingPatient && String(viewingPatient._id || '') === pid) {
        fetchLabResultsForPatient(pid, { silent: true });
      }

      closeUploadResultModal();
      const st = String(createJson?.verificationStatus || createJson?.verification_status || '').trim().toLowerCase();
      setModalType('success');
      setSuccessMessage(
        st === 'verified'
          ? 'Test result uploaded and verified. The patient can now see it.'
          : st === 'rejected'
            ? 'Test result uploaded but rejected as invalid. Check Notifications for details.'
            : st === 'flagged'
              ? 'Test result uploaded but flagged for review. Check Notifications for details.'
              : 'Test result uploaded. Verification is pending. Check Notifications for updates.'
      );
      setShowSuccessModal(true);
      addActivity('Result Uploaded', `Test result uploaded for ${String(uploadTargetRecord.patientName || 'patient')}`, st === 'rejected' ? 'error' : 'success');
    } catch (err) {
      setUploadResultError(String(err?.message || 'Upload failed'));
    } finally {
      setUploadResultSaving(false);
    }
  };

  const fetchLabResultsForPatient = async (patientId, { silent } = {}) => {
    const pid = String(patientId || '').trim();
    if (!pid) {
      setViewingPatientResults([]);
      setViewingPatientResultsError('Missing patient id.');
      return;
    }
    if (!silent) {
      setViewingPatientResultsLoading(true);
      setViewingPatientResultsError('');
    }
    try {
      const res = await fetch(`${API_BASE}/api/lab-results?patientId=${encodeURIComponent(pid)}&take=50`, {
        headers: { ...getAuthHeaders() }
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setViewingPatientResults([]);
        setViewingPatientResultsError(String(data?.message || 'Unable to load test results.'));
        return;
      }
      setViewingPatientResults(Array.isArray(data) ? data : []);
      setViewingPatientResultsError('');
    } catch (e) {
      setViewingPatientResults([]);
      setViewingPatientResultsError(String(e?.message || 'Unable to load test results.'));
    } finally {
      if (!silent) setViewingPatientResultsLoading(false);
    }
  };

  const requestReverifyLabResult = async (id) => {
    const rid = String(id || '').trim();
    if (!rid) return;
    try {
      await fetch(`${API_BASE}/api/lab-results/${encodeURIComponent(rid)}/verify`, {
        method: 'POST',
        headers: { ...getAuthHeaders() }
      });
    } catch (_) {}
    if (viewingPatient?._id) {
      fetchLabResultsForPatient(String(viewingPatient._id), { silent: true });
    }
  };

  // Admission Handlers
  const handleAdmitClick = (patient) => {
    setSelectedPatientForAdmission(patient);
    setAdmissionFormData({
      wardNumber: '',
      diagnosis: '',
      attendingDoctor: ''
    });
    setShowAdmissionModal(true);
  };

  const handleAdmissionChange = (e) => {
    const { name, value } = e.target;
    setAdmissionFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAdmissionSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatientForAdmission) return;

    try {
      const response = await fetch(`${API_BASE}/api/patients/${selectedPatientForAdmission._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          ...selectedPatientForAdmission, // Keep existing data
          admissionStatus: 'Inpatient',
          wardNumber: admissionFormData.wardNumber,
          diagnosis: admissionFormData.diagnosis,
          attendingDoctor: admissionFormData.attendingDoctor,
          admissionDate: new Date()
        }),
      });

      if (response.ok) {
        const updatedPatient = normalizePatient(await response.json());
        // Update list
        setPatientsList(prev => prev.map(p => p._id === updatedPatient._id ? updatedPatient : p));
        
        // Update stats
        setStats(prev => ({
          ...prev,
          inpatients: prev.inpatients + 1
        }));

        setShowAdmissionModal(false);
        setSelectedPatientForAdmission(null);
        setSuccessMessage("Patient admitted successfully!");
        setModalType("success");
        setShowSuccessModal(true);
        addActivity('Patient Admitted', `${updatedPatient.firstName} ${updatedPatient.lastName} admitted to Ward ${updatedPatient.wardNumber}.`, 'success');
        setView('inpatients'); // Switch to inpatients view
      } else {
        setModalType("error");
        setSuccessMessage("Failed to admit patient.");
        setShowSuccessModal(true);
      }
    } catch (error) {
      console.error("Error admitting patient:", error);
      setModalType("error");
      setSuccessMessage("Network error.");
      setShowSuccessModal(true);
    }
  };

  // Clinical Update Handlers
  const handleClinicalUpdateClick = (patient) => {
    setSelectedPatientForClinicalUpdate(patient);
    setClinicalUpdateFormData({
      type: 'Vitals',
      bloodPressure: '',
      heartRate: '',
      temperature: '',
      respiratoryRate: '',
      notes: ''
    });
    setShowClinicalUpdateModal(true);
  };

  const handleClinicalUpdateChange = (e) => {
    const { name, value } = e.target;
    setClinicalUpdateFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleClinicalUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatientForClinicalUpdate) return;

    try {
      const response = await fetch(`${API_BASE}/api/patients/${selectedPatientForClinicalUpdate._id}/clinical-records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          ...clinicalUpdateFormData,
          nurseName: user.name
        }),
      });

      if (response.ok) {
        const updatedPatient = normalizePatient(await response.json());
        // Update list
        setPatientsList(prev => prev.map(p => p._id === updatedPatient._id ? updatedPatient : p));
        
        setShowClinicalUpdateModal(false);
        setSelectedPatientForClinicalUpdate(null);
        setSuccessMessage("Clinical update recorded successfully!");
        setModalType("success");
        setShowSuccessModal(true);
      } else {
        setModalType("error");
        setSuccessMessage("Failed to record update.");
        setShowSuccessModal(true);
      }
    } catch (error) {
      console.error("Error recording update:", error);
      setModalType("error");
      setSuccessMessage("Network error.");
      setShowSuccessModal(true);
    }
  };

  return (
    <div className="nurse-dashboard-container" style={{ paddingTop: backendHealth.checked && !backendHealth.ok ? 44 : 0 }}>
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
      <aside className={`nurse-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="nurse-sidebar-header">
           <div className="nurse-brand">
             <img src="/images/pgh%20logo.png" alt="PASCUALINGA" className="nurse-brand-logo" />
             {!isSidebarCollapsed ? <span className="nurse-brand-text">PASCUALINGA</span> : null}
           </div>
           <button className="nurse-sidebar-toggle-btn" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
               {isSidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
           </button>
        </div>
        
        <nav className="nurse-sidebar-nav">
          <button className={`nurse-nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </button>
          
          <button className={`nurse-nav-item ${view === 'patients' ? 'active' : ''}`} onClick={() => setView('patients')}>
            <Users size={20} />
            <span>Patient Records</span>
          </button>

          <button className={`nurse-nav-item ${view === 'appointments' ? 'active' : ''}`} onClick={() => setView('appointments')}>
            <Calendar size={20} />
            <span>Appointments</span>
          </button>

          <button className={`nurse-nav-item ${view === 'orders' ? 'active' : ''}`} onClick={() => setView('orders')}>
            <FileText size={20} />
            <span>Orders</span>
          </button>
          {/* Schedules Dropdown */}
          <button className={`nurse-nav-item ${['schedules', 'tasks', 'calendar', 'shifts'].includes(view) ? 'active' : ''}`} onClick={() => setIsSchedulesOpen(!isSchedulesOpen)}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px', flex: 1}}>
                <Calendar size={20} />
                <span>Schedules</span>
            </div>
            {isSchedulesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {isSchedulesOpen && (
            <div className="nurse-nav-sub-menu" style={{paddingLeft: isSidebarCollapsed ? '0' : '16px'}}>
                <button className={`nurse-nav-item sub-item ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')} style={{fontSize: '0.9rem'}}>
                    <ClipboardList size={18} />
                    <span>Tasks</span>
                </button>
                <button className={`nurse-nav-item sub-item ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')} style={{fontSize: '0.9rem'}}>
                    <Calendar size={18} />
                    <span>Calendar</span>
                </button>
		                <button className={`nurse-nav-item sub-item ${view === 'shifts' ? 'active' : ''}`} onClick={() => setView('shifts')} style={{fontSize: '0.9rem'}}>
		                    <Clock size={18} />
		                    <span>My Shifts</span>
		                </button>
                </div>
		            )}
	        </nav>

      </aside>

      <main className={`nurse-main-content ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <header className="nurse-header">
            <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {isSidebarCollapsed ? (
                  <button type="button" className="app-mobile-menu-btn" onClick={() => setIsSidebarCollapsed(false)} aria-label="Open menu">
                    <Menu size={18} />
                  </button>
                ) : null}
                <div>
                  <h2 className="header-title">Nurse Dashboard</h2>
                  <p className="header-subtitle">{repairMojibake(nurseWorkspace.label)} - {repairMojibake(user.departmentLabel || formatDepartmentLabel(activeDept))}</p>
                </div>
            </div>

            <div className="header-actions-group">
                <div className="header-actions">
                    {/* Notifications */}
                    <div className="header-icon-btn relative" onClick={() => {setShowNotifications(!showNotifications); setShowSettings(false);}}>
                        <Bell size={20} className="text-slate-500" />
                        {notifications.some(n => n.isUnread) && <span className="notification-badge"></span>}
                        
	                        {showNotifications && (
	                            <div className="dropdown-menu-card" onClick={(e) => e.stopPropagation()}>
	                                <div className="dropdown-header">
	                                    <h4>Notifications</h4>
	                                    <span className="mark-read" onClick={markAllAsRead}>Mark all as read</span>
	                                </div>
	                                <div className="notification-list">
	                                    {notifications.map(notif => (
	                                        <div key={notif.id} className="notification-item">
	                                            <div className={`notif-icon ${notif.type}`}>
	                                                <Bell size={14} />
	                                            </div>
	                                            <div className="notif-content">
	                                                <p className="notif-title">{notif.title}</p>
	                                                <p className="notif-message">{notif.message}</p>
	                                                <span className="notif-time">{notif.time}</span>
	                                            </div>
	                                        </div>
	                                    ))}
	                                </div>
	                            </div>
	                        )}
                    </div>

                    {/* Settings */}
                    <div className="header-icon-btn" onClick={() => {setShowSettings(!showSettings); setShowNotifications(false);}}>
                        <Settings size={20} className="text-slate-500" />
                        
	                        {showSettings && (
	                            <div className="dropdown-menu-card settings-card" onClick={(e) => e.stopPropagation()}>
	                                <div className="dropdown-header">
	                                    <h4>Settings</h4>
	                                </div>
	                                <div className="settings-list">
	                                    <div className="setting-item">
	                                        <div className="setting-info">
	                                            <p className="setting-label">Email Notifications</p>
	                                            <p className="setting-desc">Daily summaries</p>
	                                        </div>
	                                        <label className="switch">
	                                            <input type="checkbox" defaultChecked />
	                                            <span className="slider round"></span>
	                                        </label>
	                                    </div>
	                                    <div className="setting-item">
	                                        <div className="setting-info">
	                                            <p className="setting-label">Dark Mode</p>
	                                            <p className="setting-desc">Reduce eye strain</p>
	                                        </div>
	                                        <label className="switch">
	                                            <input type="checkbox" />
	                                            <span className="slider round"></span>
	                                        </label>
	                                    </div>
	                                </div>
	                            </div>
	                        )}
	                    </div>
	                </div>
	                
	                <div className="header-separator"></div>

                <div 
                    className="header-profile-wrapper" 
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowProfileMenu(!showProfileMenu);
                    }}
                >
                    <div className="header-profile-info">
                        <span className="header-profile-name">{user.name}</span>
                        <span className="header-profile-role">{user.roleLabel || 'Nurse'}</span>
                    </div>
                    <div className="header-avatar-circle">
                        <User size={20} className="text-slate-600" />
                    </div>
                    <ChevronDown size={14} className="text-slate-400" />
                    
                    {showProfileMenu && (
                        <div className="profile-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                            <div className="profile-dropdown-header">
                                <div className="dropdown-user-info">
                                    <div className="dropdown-avatar">{user.name.charAt(0)}</div>
                                    <div>
                                        <p className="dropdown-name">{user.name}</p>
                                        <p className="dropdown-role">{user.roleLabel || 'Nurse'}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="profile-dropdown-body">
                                <div className="profile-menu-item" style={{ cursor: 'default', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <LayoutDashboard size={18} />
                                    <span style={{ flex: 1 }}>Department</span>
                                    <select className="white-input" value={activeDept} disabled style={{ width: '140px', padding: '6px 10px' }}>
                                        <option value={activeDept}>{activeDept}</option>
                                    </select>
                                </div>
                                <button className="profile-menu-item" onClick={() => {
                                    setShowProfileMenu(false);
                                    setView('profile');
                                }}>
                                    <User size={18} />
                                    <span>My Profile</span>
                                </button>
                                <button className="profile-menu-item logout" onClick={() => {
                                    setShowProfileMenu(false);
                                    setShowLogoutConfirm(true);
                                }}>
                                    <LogOut size={18} />
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
        <section className="nurse-content-body">
            {view === 'appointments' && (
                <div className="doc-section" style={{ padding: '24px', background: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap' }}>
                        <button className={`btn-gray ${activeAppointmentTab === 'requests' ? 'active' : ''}`} onClick={() => setActiveAppointmentTab('requests')} style={{ padding: '8px 16px', background: activeAppointmentTab === 'requests' ? '#ea580c' : 'transparent', color: activeAppointmentTab === 'requests' ? 'white' : '#64748b' }}>
                            Approval Inbox
                        </button>
                        <button className={`btn-gray ${activeAppointmentTab === 'confirmed' ? 'active' : ''}`} onClick={() => { setActiveAppointmentTab('confirmed'); fetchAppointments(); }} style={{ padding: '8px 16px', background: activeAppointmentTab === 'confirmed' ? '#ea580c' : 'transparent', color: activeAppointmentTab === 'confirmed' ? 'white' : '#64748b' }}>
                            Direct Appointments
                        </button>
                        {activeDept === 'ER' ? (
                            <button className={`btn-gray ${activeAppointmentTab === 'priority' ? 'active' : ''}`} onClick={() => setActiveAppointmentTab('priority')} style={{ padding: '8px 16px', background: activeAppointmentTab === 'priority' ? '#ea580c' : 'transparent', color: activeAppointmentTab === 'priority' ? 'white' : '#64748b' }}>
                                Consult Priority Queue
                            </button>
                        ) : null}
                    </div>

                    {activeAppointmentTab === 'requests' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '20px' }}>
                            <div className="overview-card" style={{ padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                    <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Approval Requests</h3>
                                    <button onClick={fetchApprovalInbox} className="btn-gray"><RotateCw size={14} /></button>
                                </div>
                                {approvalInboxLoading ? (
                                    <div style={{ color: '#64748b' }}>Loading requests...</div>
                                ) : filteredApprovalInbox.length === 0 ? (
                                    <div style={{ color: '#64748b' }}>No requests found.</div>
                                ) : (
                                    <div className="modern-list">
                                        {filteredApprovalInbox.map((thread) => (
                                            <div key={thread.id} className={`modern-list-item ${selectedApproval?.id === thread.id ? 'active' : ''}`} onClick={() => openApprovalThread(thread)} style={{ cursor: 'pointer', padding: '12px', borderRadius: '8px', marginBottom: '8px', border: selectedApproval?.id === thread.id ? '2px solid #ea580c' : '1px solid #e2e8f0' }}>
                                                <div style={{ fontWeight: 'bold' }}>{thread.patientName}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{getApprovalServiceType(thread)}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{thread.status}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="overview-card" style={{ padding: '16px' }}>
                                {selectedApproval ? (
                                    <>
                                        <h3 style={{ marginTop: 0 }}>{selectedApproval.patientName}</h3>
                                        <p style={{ color: '#64748b' }}>Service: {getApprovalServiceType(selectedApproval)}</p>
                                        <p style={{ color: '#64748b' }}>Requested: {selectedApproval.requestedDate}{selectedApproval.requestedTime ? ` - ${selectedApproval.requestedTime}` : ''}</p>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
                                            <button className="btn-orange-sm" onClick={() => updateApprovalStatus('Approved')} disabled={approvalSending}><Check size={16} /> Approve</button>
                                            <button className="btn-gray" onClick={() => updateApprovalStatus('Rejected')} disabled={approvalSending}><X size={16} /> Reject</button>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {approvalMessages.length === 0 ? <div style={{ color: '#64748b' }}>No messages yet.</div> : approvalMessages.map((msg, i) => (
                                                <div key={i} style={{ padding: '10px 12px', borderRadius: '10px', background: msg.senderRole === 'nurse' ? '#fff7ed' : '#f8fafc' }}>
                                                    <div style={{ fontWeight: 700 }}>{msg.senderName}</div>
                                                    <div>{msg.body}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ color: '#64748b' }}>Select a request to view details.</div>
                                )}
                            </div>
                        </div>
                    ) : activeAppointmentTab === 'priority' ? (
                        <div className="overview-card" style={{ padding: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <h3 style={{ margin: 0 }}>Consult Priority Queue</h3>
                                <button onClick={fetchConsultPriorityQueue} className="btn-gray" disabled={consultPriorityLoading}><RotateCw size={14} /></button>
                            </div>
                            {consultPriorityLoading ? (
                                <div style={{ color: '#64748b' }}>Loading priority queue...</div>
                            ) : filteredConsultPriorityRows.length === 0 ? (
                                <div style={{ color: '#64748b' }}>No priority-tagged consult requests found.</div>
                            ) : (
                                <table className="staff-table" style={{ width: '100%' }}>
                                    <thead><tr><th>Patient</th><th>Priority</th><th>Requested</th><th>Doctor</th><th>Status</th></tr></thead>
                                    <tbody>
                                        {filteredConsultPriorityRows.slice(0, 100).map((row) => (
                                            <tr key={row.id}>
                                                <td>{row.patientName || 'Unknown patient'}</td>
                                                <td>{row.priorityLabel || 'Unspecified'}</td>
                                                <td>{row.requestedDate ? new Date(row.requestedDate).toLocaleDateString() : 'Not set'}</td>
                                                <td>{row.doctorName || 'Unassigned'}</td>
                                                <td>{row.status || 'Pending'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    ) : (
                        <div className="overview-card" style={{ padding: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <h3 style={{ margin: 0 }}>All Appointments</h3>
                                <button onClick={fetchAppointments} className="btn-gray"><RotateCw size={14} /></button>
                            </div>
                            {loadingAppointments ? (
                                <div style={{ color: '#64748b' }}>Loading appointments...</div>
                            ) : filteredAppointments.length === 0 ? (
                                <div style={{ color: '#64748b' }}>No appointments found.</div>
                            ) : (
                                <table className="staff-table" style={{ width: '100%' }}>
                                    <thead><tr><th>Patient</th><th>Date</th><th>Time</th><th>Reason</th><th>Status</th></tr></thead>
                                    <tbody>
                                        {filteredAppointments.map((apt) => (
                                            <tr key={apt.id}>
                                                <td>{apt.firstName} {apt.lastName}</td>
                                                <td>{apt.appointmentDate ? new Date(apt.appointmentDate).toLocaleDateString() : 'Not set'}</td>
                                                <td>{apt.appointmentTime ? new Date(apt.appointmentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not set'}</td>
                                                <td>{apt.reason}</td>
                                                <td>{apt.status}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>
	            )}
            {view === 'overview' && (
                <div className="overview-container">
                    <div className="overview-header-stack">
                        <div className="welcome-banner full-width">
                            <div className="welcome-text">
                                <div className={`workspace-badge ${nurseWorkspace.heroTone}`}>{nurseWorkspace.eyebrow}</div>
                                <h1>{nurseWorkspace.label} Workspace for {user.name}</h1>
                                <p>{nurseWorkspace.description}</p>
                            </div>
                            <div className="welcome-date">
                                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                        </div>

                        <div className="dashboard-stats-row">
                            {workspaceStats.map((card, index) => (
                                <div key={`${card.label}-${index}`} className="stat-card-large">
                                    <div className={`stat-icon-large ${card.tone}`}>
                                        {card.icon}
                                    </div>
                                    <div className="stat-content-large">
                                        <span className="stat-value-large">{card.value}</span>
                                        <span className="stat-label-large">{card.label}</span>
                                        <div className="stat-trend">
                                            <span className="trend-neutral">{card.detail}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="workspace-focus-grid">
                            {workspaceFocusCards.map((card, index) => (
                                <div key={`${card.title}-${index}`} className="workspace-focus-card">
                                    <span className="workspace-focus-title">{card.title}</span>
                                    <span className="workspace-focus-value">{card.value}</span>
                                    <span className="workspace-focus-caption">{card.caption}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="nurse-grid-layout">





                        {/* Column 1: Ward Occupancy */}
                        <div className="grid-col col-ward">
                            <div className="overview-card full-height">
                                <div className="card-header">
                                    <h3>{nurseWorkspace.primaryTitle}</h3>
                                    {nurseWorkspace.supportsPatientSpaces ? (
                                        <div className="legend">
                                            <span className="dot occupied"></span> Occupied
                                            <span className="dot free"></span> Free
                                            {nurseWorkspace.type === 'emergency' && Number(liveBoard?.overflowCount || 0) > 0 ? (
                                              <span className="badge-red" style={{marginLeft: '10px'}}>{liveBoard.overflowCount} overflow</span>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <span className="badge-count">{workspaceQueueItems.length} queues</span>
                                    )}
                                </div>
                                {nurseWorkspace.supportsPatientSpaces ? (
                                    <div className="ward-occupancy-grid">
                                        {wardOccupancy.map(bed => (
                                            <div 
                                                key={bed.id} 
                                                className={`bed-box status-${bed.status}`}
                                                onClick={() => bed.status === 'occupied' && setSelectedBed(bed)}
                                                title={bed.status === 'occupied' ? `${bed.patientName}` : 'Available'}
                                            >
                                                <div className="bed-icon-wrapper">
                                                     {bed.status === 'occupied' ? <User size={20} /> : <Bed size={20} />}
                                                </div>
                                                <span className="bed-label">{bed.label}</span>
                                                {bed.status === 'occupied' ? (
                                                    <span className="bed-patient">{bed.patientName}</span>
                                                ) : (
                                                    <span className="bed-patient" style={{color: '#16a34a', fontWeight: '600'}}>Available</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-queue-list">
                                        {workspaceQueueItems.map((item, index) => (
                                            <div key={`${item.label}-${index}`} className="workspace-queue-item">
                                                <div className="workspace-queue-top">
                                                    <span className="workspace-queue-label">{item.label}</span>
                                                    <span className="workspace-queue-value">{item.value}</span>
                                                </div>
                                                <p className="workspace-queue-note">{repairMojibake(item.note)}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Column 2: Critical Watchlist */}
                        <div className="grid-col col-critical">
                            <div className="overview-card full-height">
                                <div className="card-header">
                                    <h3>{nurseWorkspace.secondaryTitle}</h3>
                                    <span className="badge-red">{nurseWorkspace.supportsPatientSpaces ? `${activeCriticalWatch.length} Active` : `${careTeamDoctors.length} Doctors`}</span>
                                </div>
                                {nurseWorkspace.supportsPatientSpaces ? (
                                    <div className="critical-list-container">
                                        {activeCriticalWatch.map(p => (
                                            <div key={p.id} className="critical-item-row">
                                                <div className="critical-info">
                                                    <span className="critical-name">{p.name}</span>
                                                    <span className="critical-loc">{repairMojibake(p.room)}{p.reason ? ` - ${repairMojibake(p.reason)}` : ""}</span>
                                                </div>
                                                <div className="critical-stats-mini">
                                                    <div className="stat-pill">BP: <span className={`val-${p.status}`}>{p.bp}</span></div>
                                                    <div className="stat-pill">HR: <span className={`val-${p.status}`}>{p.hr}</span></div>
                                                    {p.spo2 && repairMojibake(p.spo2) !== "-" ? <div className="stat-pill">SpO2: <span className={`val-${p.status}`}>{repairMojibake(p.spo2)}</span></div> : null}
                                                </div>
                                            </div>
                                        ))}
                                        {activeCriticalWatch.length === 0 && (
                                            <div className="empty-state-mini" style={{textAlign: 'center', padding: '20px', color: '#64748b'}}>
                                                <CheckCircle size={32} style={{color: '#16a34a', marginBottom: '8px'}} />
                                                <p>No active watchlist patients in {nurseWorkspace.shortLabel}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="workspace-queue-list">
                                        {careTeamDoctors.length === 0 ? (
                                            <div className="empty-state-mini" style={{textAlign: 'center', padding: '20px', color: '#64748b'}}>
                                                <CheckCircle size={32} style={{color: '#16a34a', marginBottom: '8px'}} />
                                                <p>No doctor coordination links yet for this shift.</p>
                                            </div>
                                        ) : (
                                            careTeamDoctors.slice(0, 6).map((doctorName, index) => (
                                                <div key={`${doctorName}-${index}`} className="workspace-queue-item compact">
                                                    <div className="workspace-queue-top">
                                                        <span className="workspace-queue-label">{doctorName}</span>
                                                        <span className="workspace-queue-value">Linked</span>
                                                    </div>
                                                    <p className="workspace-queue-note">
                                                        {openAppointments.length} active appointments, {approvalInbox.length} inbox endorsements, {recentOrders.length} recent orders.
                                                    </p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Column 3: Recent Activity & Tasks */}
                        <div className="grid-col col-activity">
                            <div className="overview-card half-height">
                                <div className="card-header">
                                    <h3>Recent Activity</h3>
                                </div>
                                <div className="activity-list-compact">
                                    {recentOverviewActivities.length === 0 ? (
                                      <div className="empty-state-mini" style={{textAlign: 'center', padding: '20px', color: '#64748b'}}>
                                        <CheckCircle size={28} style={{color: '#16a34a', marginBottom: '8px'}} />
                                        <p>No recent workflow activity yet.</p>
                                      </div>
                                    ) : recentOverviewActivities.map(activity => (
                                      <div key={activity.id} className="activity-item-compact">
                                          <div className={`activity-dot ${activity.type}`}></div>
                                          <div className="activity-content">
                                              <span className="activity-text">{activity.title}</span>
                                              <span className="activity-time-mini">{activity.time}</span>
                                          </div>
                                      </div>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="overview-card half-height">
                                <div className="card-header">
                                    <h3>{nurseWorkspace.taskLabel}</h3>
                                    {urgentTaskCount > 0 && 
                                        <span className="badge-red">Urgent</span>
                                    }
                                </div>
                                <div className="tasks-list-compact">
                                    {overviewSupportTasks.length === 0 ? (
                                      <div className="empty-state-mini" style={{textAlign: 'center', padding: '20px', color: '#64748b'}}>
                                        <CheckCircle size={28} style={{color: '#16a34a', marginBottom: '8px'}} />
                                        <p>No active support tasks right now.</p>
                                      </div>
                                    ) : overviewSupportTasks.map(task => (
                                        <div key={task.id} className="task-item-compact">
                                            <div
                                              className={`task-checkbox ${task.source === 'task' && task.completed ? 'checked' : ''}`}
                                              onClick={() => task.source === 'task' && toggleTask(String(task.id).replace('task-', ''))}
                                            >
                                                {task.source === 'task' && task.completed && <Check size={12} color="white" />}
                                            </div>
                                            <div className="task-content-wrapper" style={{flex: 1}}>
                                                <span className={`task-text-mini ${task.completed ? 'completed' : ''}`} style={task.priority === 'urgent' ? {color: '#ef4444', fontWeight: '700'} : {}}>
                                                    {task.text}
                                                </span>
                                                {task.patientName ? (
                                                  <span className="activity-time-mini" style={{display: 'block', marginTop: '4px'}}>{task.patientName}</span>
                                                ) : null}
                                                {task.priority === 'urgent' && (
                                                    <span className="task-urgent-badge">Urgent</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>


                </div>
            )}
            {view === 'shifts' && (
                <div className="shifts-container">
                    <div className="orders-header">
                        <div>
                            <h2 className="page-title">Shift Handoff & Roster</h2>
                            <p className="page-subtitle">Manage your shift schedule and end-of-shift reports</p>
                        </div>
                        <button className="btn-primary-action" onClick={generateHandoff}>
                            <FileText size={18} /> Generate Handoff Report
                        </button>
                    </div>

                    <div className="shift-cards-grid">
                        <div className="overview-card shift-status-card">
                            <div className="card-header">
                                <h3>Current Shift</h3>
                                <span className="badge-status inpatient">Active</span>
                            </div>
                            <div className="shift-details">
                                <div className="shift-time-large">{currentShiftLabel}</div>
                                <div className="shift-meta">
                                    <span style={{display:'flex', gap:'8px', alignItems:'center'}}><User size={16}/>{user.departmentLabel || formatDepartmentLabel(activeDept)}</span>
                                    <span style={{display:'flex', gap:'8px', alignItems:'center'}}><Calendar size={16}/> {new Date().toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>

                        <div className="overview-card">
                            <div className="card-header">
                                <h3>Shared Handover</h3>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    {handoverHistory[0]?.status === 'acknowledged' ? (
                                        <span className="badge-status paid">Acknowledged</span>
                                    ) : null}
                                    <button className="btn-gray" type="button" onClick={saveHandoverNote} disabled={handoverSaving || handoverLoading}>
                                        <Save size={14} /> {handoverSaving ? 'Saving...' : 'Save'}
                                    </button>
                                </div>
                            </div>
                            <textarea 
                                className="box-input box-textarea" 
                                style={{height: '120px', border: 'none', background: '#f8fafc', resize: 'none'}}
                                value={shiftNotes}
                                onChange={(e) => setShiftNotes(e.target.value)}
                                placeholder="Write the live shift handover for the next nurse..."
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '12px', alignItems: 'center' }}>
                                <div style={{ fontSize: '0.86rem', color: '#64748b' }}>
                                    {handoverHistory[0]?.created_by_name ? `Latest by ${handoverHistory[0].created_by_name}` : 'No saved handover yet.'}
                                </div>
                                <button className="btn-gray" type="button" onClick={acknowledgeHandover} disabled={!handoverId || handoverAcknowledging}>
                                    <Check size={14} /> {handoverAcknowledging ? 'Acknowledging...' : 'Acknowledge'}
                                </button>
                        </div>
                    </div>
                </div>
            </div>
            )}
            {view === 'incidents' && (
                <div className="incidents-container">
                    <div className="orders-header" style={{marginBottom: '24px'}}>
                        <div>
                            <h2 className="page-title-large">Incident Reporting</h2>
                            <p className="page-subtitle">Document and track safety incidents</p>
                        </div>
                        <button className="btn-primary-action" onClick={() => handlePrint('incidents')}>
                            <Printer size={18} /> Print Report
                        </button>
                    </div>

                    <div className="incidents-split-layout">
                        {/* Form Side */}
                        <div className="incident-form-panel">
                            <div className="panel-header-gradient">
                                <AlertTriangle size={24} className="text-white" />
                                <h3>New Incident Report</h3>
                            </div>
                            <form onSubmit={handleIncidentSubmit} className="incident-form-body">
                                <div className="form-grid-2-col">
                                    <div className="input-group">
                                        <label><Calendar size={14} style={{marginRight: '6px'}}/> Date of Incident</label>
                                        <input 
                                            type="date" 
                                            name="date"
                                            value={incidentFormData.date}
                                            onChange={handleIncidentChange}
                                            className="white-input"
                                            required
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label><Clock size={14} style={{marginRight: '6px'}}/> Time</label>
                                        <input 
                                            type="time" 
                                            name="time"
                                            value={incidentFormData.time}
                                            onChange={handleIncidentChange}
                                            className="white-input"
                                            required
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label><AlertCircle size={14} style={{marginRight: '6px'}}/> Incident Type</label>
                                        <select 
                                            name="type"
                                            value={incidentFormData.type}
                                            onChange={handleIncidentChange}
                                            className="white-input"
                                        >
                                            <option value="Fall">Patient Fall</option>
                                            <option value="Medication">Medication Error</option>
                                            <option value="Equipment">Equipment Failure</option>
                                            <option value="Harassment">Harassment/Abuse</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label><AlertOctagon size={14} style={{marginRight: '6px'}}/> Severity</label>
                                        <select
                                            name="severity"
                                            value={incidentFormData.severity}
                                            onChange={handleIncidentChange}
                                            className="white-input"
                                        >
                                            <option value="Low">Low</option>
                                            <option value="Moderate">Moderate</option>
                                            <option value="High">High</option>
                                            <option value="Critical">Critical</option>
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label><MapPin size={14} style={{marginRight: '6px'}}/> Location</label>
                                        <input 
                                            type="text" 
                                            name="location"
                                            value={incidentFormData.location}
                                            onChange={handleIncidentChange}
                                            placeholder="e.g. Ward 101, Room 3"
                                            className="white-input"
                                            required
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label><UserCheck size={14} style={{marginRight: '6px'}}/> Affected Patient</label>
                                        <select
                                            name="patientId"
                                            value={incidentFormData.patientId}
                                            onChange={(e) => {
                                                const patientId = e.target.value;
                                                const match = deptPatients.find((patient) => String(patient._id) === String(patientId));
                                                setIncidentFormData((prev) => ({
                                                    ...prev,
                                                    patientId,
                                                    patientName: match ? `${match.firstName} ${match.lastName}`.trim() : ''
                                                }));
                                            }}
                                            className="white-input"
                                        >
                                            <option value="">-- Select (optional) --</option>
                      <option value="lab">Laboratory</option>
                      <option value="imaging">Imaging / ECG</option>
                      <option value="pharmacy">Pharmacy (walk-in)</option>
                      <option value="admission_eval">Admission Evaluation</option>
                    </select>
                    <div style={{marginTop: 6, fontSize: 12.5, color: '#64748b', fontWeight: 700}}>
                      Use ER / Walk-In Doctor for most walk-ins. Pick from here for special cases.
                    </div>
                  </div>
                  <div className="walkin-toggle-row" style={{display: 'flex', gap: '10px', marginBottom: '18px'}}>
                    <button
                      type="button"
                      onClick={() => handleAddPatientChange({ target: { name: 'patientMode', value: 'new' } })}
                      className="btn-gray"
                      style={{
                        background: addPatientData.patientMode === 'new' ? '#fff7ed' : '#fff',
                        border: addPatientData.patientMode === 'new' ? '1px solid #fb923c' : '1px solid #e2e8f0',
                        color: '#0f172a',
                        fontWeight: 800
                      }}
                    >
                      New Patient
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddPatientChange({ target: { name: 'patientMode', value: 'existing' } })}
                      className="btn-gray"
                      style={{
                        background: addPatientData.patientMode === 'existing' ? '#fff7ed' : '#fff',
                        border: addPatientData.patientMode === 'existing' ? '1px solid #fb923c' : '1px solid #e2e8f0',
                        color: '#0f172a',
                        fontWeight: 800
                      }}
                    >
                      Existing Patient
                    </button>
                  </div>
                  {addPatientData.patientMode === 'existing' ? (
                    <div>
                      <div className="input-group">
                        <label>Find Existing Patient <span style={{color: '#ef4444'}}>*</span></label>
                        <input
                          type="text"
                          name="patientLookup"
                          value={addPatientData.patientLookup}
                          onChange={handleAddPatientChange}
                          className="white-input"
                          placeholder="Search by patient name, email, or contact number"
                        />
                      </div>
                      <div className="walkin-results-count">
                        {walkInPatientMatchCount === 0
                          ? 'No matching patients found yet.'
                          : `Showing ${walkInPatientRangeStart}-${walkInPatientRangeEnd} of ${walkInPatientMatchCount} matching patient${walkInPatientMatchCount === 1 ? '' : 's'}`}
                      </div>
                      <div style={{marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', background: '#fff'}}>
                        {walkInPatientMatches.length === 0 ? (
                          <div style={{padding: '16px 18px', color: '#64748b', fontWeight: 700}}>No matching patient found yet.</div>
                        ) : (
                          walkInPatientPageItems.map((patient) => {
                            const selected = String(addPatientData.existingPatientId || '') === String(patient._id || patient.id || '');
                            return (
                              <button
                                key={String(patient._id || patient.id)}
                                type="button"
                                onClick={() => pickExistingWalkInPatient(patient)}
                                style={{
                                  width: '100%',
                                  padding: '14px 18px',
                                  textAlign: 'left',
                                  border: 'none',
                                  borderBottom: '1px solid #f1f5f9',
                                  background: selected ? '#fff7ed' : '#fff',
                                  cursor: 'pointer'
                                }}
                              >
                                <div style={{fontWeight: 800, color: '#0f172a'}}>{`${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unnamed Patient'}</div>
                                <div style={{fontSize: '0.82rem', color: '#64748b', marginTop: 3}}>
                                  {[repairMojibake(patient.email) || 'No email', repairMojibake(patient.contactNumber) || 'No contact', repairMojibake(patient.admissionStatus) || 'Patient record'].filter(Boolean).join(' - ')}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                      {walkInPatientMatches.length > walkInPatientPageSize ? (
                        <div className="walkin-pagination">
                          <button
                            type="button"
                            className="walkin-page-btn"
                            onClick={() => setWalkInPatientPage((page) => Math.max(1, page - 1))}
                            disabled={walkInPatientPage <= 1}
                          >
                            Previous
                          </button>
                          <div className="walkin-page-status">
                            Page {Math.min(walkInPatientPage, walkInPatientPageCount)} of {walkInPatientPageCount}
                          </div>
                          <button
                            type="button"
                            className="walkin-page-btn"
                            onClick={() => setWalkInPatientPage((page) => Math.min(walkInPatientPageCount, page + 1))}
                            disabled={walkInPatientPage >= walkInPatientPageCount}
                          >
                            Next
                          </button>
                        </div>
                      ) : null}
                      {selectedWalkInPatient ? (
                        <div style={{marginTop: 14, padding: 16, borderRadius: 16, background: '#f8fafc', border: '1px solid #e2e8f0'}}>
                          <div style={{fontWeight: 800, color: '#0f172a', marginBottom: 6}}>Selected Patient</div>
                          <div style={{color: '#475569', fontSize: '0.92rem', lineHeight: 1.6}}>
                            {`${selectedWalkInPatient.firstName || ''} ${selectedWalkInPatient.lastName || ''}`.trim()}
                            <br />
                            {repairMojibake(selectedWalkInPatient.email) || 'No email on file'} - {repairMojibake(selectedWalkInPatient.contactNumber) || 'No contact on file'}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="form-grid-2-col">
                        <div className="input-group">
                          <label>First Name <span style={{color: '#ef4444'}}>*</span></label>
                          <input 
                            type="text" 
                            name="firstName" 
                            value={addPatientData.firstName} 
                            onChange={handleAddPatientChange} 
                            onKeyDown={(e) => handleNameInput(e, 'add-fn')}
                            required 
                            className="white-input" 
                            placeholder="e.g. Juan" 
                          />
                          {nameNoticeField === 'add-fn' && <span style={{color: '#ef4444', fontSize: '0.75rem', fontWeight: 600}}>{nameNotice}</span>}
                        </div>
                        <div className="input-group">
                          <label>Last Name <span style={{color: '#ef4444'}}>*</span></label>
                          <input 
                            type="text" 
                            name="lastName" 
                            value={addPatientData.lastName} 
                            onChange={handleAddPatientChange} 
                            onKeyDown={(e) => handleNameInput(e, 'add-ln')}
                            required 
                            className="white-input" 
                            placeholder="e.g. Dela Cruz" 
                          />
                          {nameNoticeField === 'add-ln' && <span style={{color: '#ef4444', fontSize: '0.75rem', fontWeight: 600}}>{nameNotice}</span>}
                        </div>
                        <div className="input-group">
                          <label>Date of Birth <span style={{color: '#ef4444'}}>*</span></label>
                          <input type="date" name="dateOfBirth" value={addPatientData.dateOfBirth} onChange={handleAddPatientChange} required className="white-input" max={new Date().toISOString().split('T')[0]} />
                        </div>
                        <div className="input-group">
                          <label>Gender</label>
                          <select name="gender" value={addPatientData.gender} onChange={handleAddPatientChange} className="white-input">
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </div>
                      </div>

                      <div className="input-group" style={{marginTop: 10}}>
                        <label style={{fontWeight: 900}}>Duplicate check</label>
                        <label style={{display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, color: '#334155'}}>
                          <input
                            type="checkbox"
                            checked={Boolean(addPatientData.confirmNotDuplicate)}
                            onChange={(e) => handleAddPatientChange({ target: { name: 'confirmNotDuplicate', value: e.target.checked } })}
                          />
                          This is a new patient record (not a duplicate)
                        </label>
                      </div>

                      <details style={{marginTop: 12}}>
                        <summary style={{cursor: 'pointer', fontWeight: 900, color: '#0f172a'}}>More details (optional)</summary>
                        <div className="form-grid-2-col" style={{marginTop: '12px'}}>
                          <div className="input-group">
                            <label>Middle Name</label>
                            <input 
                              type="text" 
                              name="middleName" 
                              value={addPatientData.middleName} 
                              onChange={handleAddPatientChange} 
                              onKeyDown={(e) => handleNameInput(e, 'add-mn')}
                              className="white-input" 
                              placeholder="Optional" 
                            />
                            {nameNoticeField === 'add-mn' && <span style={{color: '#ef4444', fontSize: '0.75rem', fontWeight: 600}}>{nameNotice}</span>}
                          </div>
                          <div className="input-group">
                            <label>Blood Type</label>
                            <select name="bloodType" value={addPatientData.bloodType} onChange={handleAddPatientChange} className="white-input">
                              <option value="A+">A+</option><option value="A-">A-</option>
                              <option value="B+">B+</option><option value="B-">B-</option>
                              <option value="AB+">AB+</option><option value="AB-">AB-</option>
                              <option value="O+">O+</option><option value="O-">O-</option>
                              <option value="Unknown">Unknown</option>
                            </select>
                          </div>
                        </div>
                        <div className="form-grid-2-col" style={{marginTop: '12px'}}>
                          <div className="input-group">
                            <label>Contact Number</label>
                            <input 
                              type="text" 
                              name="contactNumber" 
                              value={addPatientData.contactNumber} 
                              onChange={handleAddPatientChange} 
                              onKeyDown={(e) => handlePhoneInput(e, 'add-phone')}
                              className="white-input" 
                              placeholder="09XX XXX XXXX" 
                            />
                            {phoneNoticeField === 'add-phone' && <span style={{color: '#ef4444', fontSize: '0.75rem', fontWeight: 600}}>{phoneNotice}</span>}
                          </div>
                          <div className="input-group">
                            <label>Email Address</label>
                            <input
                              type="email"
                              name="email"
                              value={addPatientData.email}
                              onChange={handleAddPatientChange}
                              className="white-input"
                              placeholder="Optional for follow-up"
                            />
                          </div>
                        </div>
                        <div className="input-group" style={{marginTop: '12px'}}>
                          <label>Address</label>
                          <input
                            type="text"
                            name="address"
                            value={addPatientData.address}
                            onChange={handleAddPatientChange}
                            className="white-input"
                            placeholder="Street, barangay, city"
                          />
                        </div>
                      </details>
                    </>
                  )}
                </div>
              ) : (
                <div className="step-content">
                  <h4 style={{marginBottom: '20px', color: '#0f172a', fontWeight: '800', textTransform: 'uppercase', fontSize: '0.85rem', letterSpacing: '0.05em'}}>Step 2: Clinical Intake & Routing</h4>
                  <div style={{
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    borderRadius: 14,
                    padding: '14px 14px',
                    marginBottom: 18
                  }}>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
                      <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                        <div style={{fontWeight: 900, color: '#0f172a'}}>Quick Triage</div>
                        <div style={{fontSize: 13, color: '#475569', fontWeight: 700}}>
                          Deterministic rules only (no AI). Nurse final decision always applies.
                        </div>
                      </div>
                      <div style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        fontWeight: 900,
                        background: quickTriage.level <= 1 ? '#fee2e2' : quickTriage.level <= 2 ? '#ffedd5' : quickTriage.level <= 3 ? '#e0f2fe' : '#e2e8f0',
                        color: quickTriage.level <= 1 ? '#991b1b' : quickTriage.level <= 2 ? '#9a3412' : quickTriage.level <= 3 ? '#075985' : '#334155',
                        border: '1px solid #e2e8f0',
                        whiteSpace: 'nowrap'
                      }}>
                        {quickTriage.label} - Level {quickTriage.level}
                      </div>
                    </div>

                    {quickTriage.flags.length ? (
                      <div style={{marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8}}>
                        {quickTriage.flags.slice(0, 6).map((f, idx) => (
                          <div key={`${f.message}-${idx}`} style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 900,
                            background: f.severity === 'danger' ? '#fee2e2' : f.severity === 'warn' ? '#ffedd5' : '#e0f2fe',
                            color: f.severity === 'danger' ? '#991b1b' : f.severity === 'warn' ? '#9a3412' : '#075985',
                            border: '1px solid #e2e8f0'
                          }}>
                            {f.message}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{marginTop: 10, fontSize: 13, color: '#475569', fontWeight: 700}}>
                        Complete a vital field first to refresh the acuity flags.
                      </div>
                    )}

                    {quickTriage.suggestedRouteLabel && addPatientData.routeType !== quickTriage.suggestedRouteType ? (
                      <div style={{marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid #fecaca', background: '#fff1f2'}}>
                        <div style={{fontWeight: 900, color: '#991b1b'}}>
                          Suggested route: {quickTriage.suggestedRouteLabel}
                        </div>
                        <div style={{marginTop: 6, fontSize: 13, color: '#7f1d1d', fontWeight: 700}}>
                          Current selection may be unsafe for this acuity. Switch route to ER to continue safely.
                        </div>
                        <div style={{marginTop: 10}}>
                          <button
                            type="button"
                            className="btn-gray"
                            onClick={() => handleAddPatientChange({ target: { name: 'routeType', value: 'er_consult' } })}
                            style={{background: '#fff', border: '1px solid #fecaca', color: '#991b1b', fontWeight: 900}}
                          >
                            Switch to ER Consultation
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {quickTriage.issues.length ? (
                      <div style={{marginTop: 12, padding: 12, borderRadius: 12, border: '1px solid #fecaca', background: '#fff'}}>
                        <div style={{fontWeight: 900, color: '#b91c1c'}}>Fix before submitting</div>
                        <ul style={{margin: '8px 0 0 18px', color: '#b91c1c', fontWeight: 800, fontSize: 13}}>
                          {quickTriage.issues.slice(0, 6).map((msg, idx) => (
                            <li key={`${msg}-${idx}`}>{msg}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  {selectedWalkInPatient ? (
                    <div className="walkin-selected-summary">
                      <div className="walkin-selected-title">Using existing patient record</div>
                      <div className="walkin-selected-text">
                        {`${selectedWalkInPatient.firstName || ''} ${selectedWalkInPatient.lastName || ''}`.trim()} - {repairMojibake(selectedWalkInPatient.email) || 'No email'} - {repairMojibake(selectedWalkInPatient.contactNumber) || 'No contact'}
                      </div>
                    </div>
                  ) : null}
                  {addPatientData.routeType === 'onsite_consult' ? (
                    <>
                      <div className="form-grid-2-col" style={{marginBottom: '18px'}}>
                        <div className="input-group">
                          <label>
                            Clinic Specialization <span style={{color: '#ef4444'}}>*</span>
                          </label>
                          <select
                            name="selectedSpecialization"
                            value={addPatientData.selectedSpecialization}
                            onChange={handleAddPatientChange}
                            className="white-input"
                            disabled={walkInSpecializationLoading}
                          >
                            <option value="">
                              {walkInSpecializationLoading ? 'Loading specializations...' : '-- Select Specialization --'}
                            </option>
                            {walkInSpecializationOptions.map((specialization) => (
                              <option key={specialization} value={specialization}>
                                {specialization}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="input-group">
                          <label>Consultation Timing</label>
                          <select
                            name="consultTiming"
                            value={addPatientData.consultTiming}
                            onChange={handleAddPatientChange}
                            className="white-input"
                          >
                            <option value="same_day">Today / Same-Day</option>
                            <option value="future_schedule">Another Day / Future Schedule</option>
                          </select>
                        </div>
                      </div>
                      {addPatientData.consultTiming === 'future_schedule' ? (
                        <div className="form-grid-2-col" style={{marginBottom: '18px'}}>
                          <div className="input-group">
                            <label>
                              Preferred Date <span style={{color: '#ef4444'}}>*</span>
                            </label>
                            <input
                              type="date"
                              name="preferredDate"
                              value={addPatientData.preferredDate}
                              onChange={handleAddPatientChange}
                              className="white-input"
                              min={new Date().toISOString().slice(0, 10)}
                            />
                          </div>
                          <div className="input-group">
                            <label>Preferred Time (optional)</label>
                            <input
                              type="time"
                              name="preferredTime"
                              value={addPatientData.preferredTime}
                              onChange={handleAddPatientChange}
                              className="white-input"
                            />
                          </div>
                        </div>
                      ) : null}
                      <div style={{marginBottom: 18, padding: '12px 14px', borderRadius: 12, border: '1px solid #dbeafe', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700}}>
                        Nurse reception chooses the specialization, then the system routes the patient to the correct doctor secretary workflow for that clinic.
                      </div>
                    </>
                  ) : null}
                  {walkInNeedsDoctor ? (
                    <div className="input-group" style={{marginBottom: '18px'}}>
                      <label>
                        {addPatientData.routeType === 'er_consult' ? 'Assign ER Doctor' : 'Assign Doctor'}{' '}
                        <span style={{color: '#ef4444'}}>*</span>
                      </label>
                      <select
                        name="doctorId"
                        value={addPatientData.doctorId}
                        onChange={handleAddPatientChange}
                        className="white-input"
                        disabled={walkInDoctorLoading}
                      >
                        <option value="">{walkInDoctorLoading ? 'Loading doctors...' : '-- Select Doctor --'}</option>
                        {walkInDoctorOptions.map((doctor) => (
                          <option key={doctor.id} value={doctor.id}>
                            {repairMojibake(doctor.name)}{doctor.specialization ? ` - ${repairMojibake(doctor.specialization)}` : ""}
                          </option>
                        ))}
                      </select>
                      {walkInDoctorError ? <div style={{marginTop: 8, color: '#b91c1c', fontWeight: 700}}>{walkInDoctorError}</div> : null}
                    </div>
                  ) : null}
                  <div className="form-grid-3-col">
                    <div className="input-group">
                      <label>Temp (C)</label>
                      <input type="number" step="0.1" name="temperature" value={addPatientData.temperature} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" placeholder="36.5" />
                    </div>
                    <div className="input-group">
                      <label>Systolic (BP)</label>
                      <input type="number" name="bp_systolic" value={addPatientData.bp_systolic} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" placeholder="120" />
                    </div>
                    <div className="input-group">
                      <label>Diastolic (BP)</label>
                      <input type="number" name="bp_diastolic" value={addPatientData.bp_diastolic} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" placeholder="80" />
                    </div>
                    <div className="input-group">
                      <label>Heart Rate</label>
                      <input type="number" name="heartRate" value={addPatientData.heartRate} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" placeholder="bpm" />
                    </div>
                    <div className="input-group">
                      <label>Resp. Rate</label>
                      <input type="number" name="respiratoryRate" value={addPatientData.respiratoryRate} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" placeholder="per min" />
                    </div>
                    <div className="input-group">
                      <label>SpO2 (%)</label>
                      <input type="number" name="spo2" value={addPatientData.spo2} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" placeholder="98" />
                    </div>
                    <div className="input-group">
                      <label>Pain (0-10)</label>
                      <input type="number" min="0" max="10" name="painLevel" value={addPatientData.painLevel} onChange={handleAddPatientChange} onBlur={handleWalkInTriageCommit} className="white-input" />
                    </div>
                  </div>
                  
                  <div className="input-group" style={{marginTop: '15px'}}>
                    <label>Main Concern / Symptoms <span style={{color: '#ef4444'}}>*</span></label>
                    <textarea name="mainConcern" value={addPatientData.mainConcern} onChange={handleAddPatientChange} required className="white-input" style={{height: '80px'}} placeholder="What is the patient's current condition?" />
                  </div>

                  <div style={{marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center'}}>
                    <div style={{fontWeight: 900, color: '#0f172a'}}>After submit, open:</div>
                    <label style={{display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#334155'}}>
                      <input
                        type="checkbox"
                        checked={Boolean(addPatientData.nextStepLab)}
                        onChange={(e) => handleAddPatientChange({ target: { name: 'nextStepLab', value: e.target.checked } })}
                      />
                      Lab
                    </label>
                    <label style={{display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#334155'}}>
                      <input
                        type="checkbox"
                        checked={Boolean(addPatientData.nextStepImaging)}
                        onChange={(e) => handleAddPatientChange({ target: { name: 'nextStepImaging', value: e.target.checked } })}
                      />
                      Imaging
                    </label>
                    <label style={{display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#334155'}}>
                      <input
                        type="checkbox"
                        checked={Boolean(addPatientData.nextStepPharmacy)}
                        onChange={(e) => handleAddPatientChange({ target: { name: 'nextStepPharmacy', value: e.target.checked } })}
                      />
                      Pharmacy
                    </label>
                  </div>
                  <details style={{marginTop: 12}}>
                    <summary style={{cursor: 'pointer', fontWeight: 900, color: '#0f172a'}}>More details (optional)</summary>
                    <div className="input-group" style={{marginTop: '12px'}}>
                      <label>Existing Conditions / Relevant History</label>
                      <textarea name="existingConditions" value={addPatientData.existingConditions} onChange={handleAddPatientChange} className="white-input" style={{height: '70px'}} placeholder="Optional clinical context for the next team" />
                    </div>
                    <div className="input-group" style={{marginTop: '12px'}}>
                      <label>Routing Note</label>
                      <textarea name="routeNote" value={addPatientData.routeNote} onChange={handleAddPatientChange} className="white-input" style={{height: '70px'}} placeholder="Short note for the receiving doctor or service team" />
                    </div>
                  </details>
                </div>
              )}

              {addPatientError && (
                <div className="form-error-message" style={{marginTop: '20px'}}>{addPatientError}</div>
              )}

              <div className="modal-actions-right walkin-intake-actions" style={{marginTop: '30px', display: 'flex', justifyContent: 'space-between', width: '100%'}}>
                <button type="button" className="btn-modal-cancel" onClick={() => addPatientStep === 1 ? setShowAddPatientModal(false) : setAddPatientStep(1)}>
                  {addPatientStep === 1 ? 'Cancel' : 'Back'}
                </button>
                <button type="submit" className="btn-modal-submit" disabled={addPatientSaving} style={{minWidth: '180px'}}>
                   {addPatientStep === 1 ? 'Next: Clinical Intake' : (addPatientSaving ? 'Routing...' : 'Complete Intake')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default NurseDashboard;



