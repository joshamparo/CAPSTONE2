import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Calendar, CheckCircle2, FileText, LogOut, Search, Plus, Trash2, Printer, User, ClipboardCheck, X, Menu, Upload, RotateCw, MessageSquare, Send, Check, Ban, CornerUpRight, ChevronLeft, ChevronRight, Video, Activity, Stethoscope, HeartPulse, Thermometer, Droplets, Wind, AlertTriangle, BriefcaseMedical, Save, ChevronUp, ChevronDown, Mail, Briefcase, Phone, Key, Shield, Eye, EyeOff, Maximize2, Paperclip, Pin, MoreHorizontal, Download, Image as ImageIcon, File, Video as VideoIcon, ArrowDown, Bell, Copy, AtSign, Reply, Clock, Sparkles } from 'lucide-react';
import './DoctorDashboard.css';
import AccountHeaderActions from '../components/AccountHeaderActions';
import PatientFullRecordModal from '../components/PatientFullRecordModal';
import StatusBadge from '../components/StatusBadge';
import { checkBackendHealth, fetchJson } from '../utils/api';
import { supabase } from '../lib/supabaseClient';
const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const VIDEO_ROOM_DEBUG_URL = 'http://192.168.1.74:7777/event';

// #region debug-point A:web-reporter
const reportVideoRoomDebug = ({ runId = 'pre-fix', hypothesisId = 'A', location = 'DoctorDashboard.js', msg = '[DEBUG] web trace', data = {} }) => {
  try {
    fetch(VIDEO_ROOM_DEBUG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'video-room-mismatch',
        runId,
        hypothesisId,
        location,
        msg,
        data,
        ts: Date.now()
      })
    }).catch(() => {});
  } catch (_) {}
};
// #endregion

function DoctorDashboard() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    specialization: '',
    email: '',
    contactNumber: '',
    profilePicture: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);

  const [selectedDate, setSelectedDate] = useState(new Date());  
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [patientsError, setPatientsError] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showFullRecord, setShowFullRecord] = useState(false);
  const [centralRecordOpen, setCentralRecordOpen] = useState(false);
  const [centralRecordPatientId, setCentralRecordPatientId] = useState(null);
  const [centralRecordPatientLabel, setCentralRecordPatientLabel] = useState('');

  const [notes, setNotes] = useState([]);
  const [noteForm, setNoteForm] = useState({
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    bp: '',
    hr: '',
    temp: '',
    weight: '',
    height: '',
    o2: '',
    vaccinationHistory: '',
    heartRateRhythm: '',
    ecgNotes: '',
    lesionType: '',
    affectedArea: ''
  });
  const [savingNote, setSavingNote] = useState(false);

  const [prescriptions, setPrescriptions] = useState([]);
  const [prescriptionItems, setPrescriptionItems] = useState([
    { medication: '', dosage: '', frequency: '', duration: '', notes: '' }
  ]);

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
  const [prescriptionMeta, setPrescriptionMeta] = useState({ diagnosis: '', instructions: '' });
  const [isSentToPharmacy, setIsSentToPharmacy] = useState(false);
  const [prescriptionFulfillment, setPrescriptionFulfillment] = useState('not_sent');
  const [savingPrescription, setSavingPrescription] = useState(false);
  const [medicalProfile, setMedicalProfile] = useState({
    allergies: '',
    pastMedicalHistory: '',
    familyHistory: '',
    socialHistory: '',
    immunizations: ''
  });
  const [showMedicalProfile, setShowMedicalProfile] = useState(false);
  const [savingMedicalProfile, setSavingMedicalProfile] = useState(false);
  const [printTarget, setPrintTarget] = useState(null);
  const [labResults, setLabResults] = useState([]);
  const [labResultsError, setLabResultsError] = useState('');
  const [labForm, setLabForm] = useState({ type: 'Lab', title: '', url: '', resultDate: '' });
  const [savingLab, setSavingLab] = useState(false);
  const [certificates, setCertificates] = useState([]);
  const [certificatesError, setCertificatesError] = useState('');
  const [certForm, setCertForm] = useState({ purpose: '', diagnosis: '', recommendations: '', validUntil: '' });
  const [savingCert, setSavingCert] = useState(false);
  const [printCertificateTarget, setPrintCertificateTarget] = useState(null);
  const [labFile, setLabFile] = useState(null);
  const [toast, setToast] = useState(null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoMeetingUrl, setVideoMeetingUrl] = useState('');
  const [videoMeetingTitle, setVideoMeetingTitle] = useState('');

  // Queue State
  const [appointments, setAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState('');
  const [queueFilter, setQueueFilter] = useState('all'); // all | video
  const [queueScope, setQueueScope] = useState('mine'); // mine | specialization
  const [queueDateMode, setQueueDateMode] = useState('upcoming'); // upcoming | date

  // Patient Records State
  const [recordList, setRecordList] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordQuery, setRecordQuery] = useState('');
  const [recordScope, setRecordScope] = useState('specialization'); // mine | specialization | all
  const [recordSkip, setRecordSkip] = useState(0);
  const recordTake = 10;

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordProfile, setRecordProfile] = useState(null);
  const [recordHistory, setRecordHistory] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [recordTab, setRecordTab] = useState('overview'); // 'overview', 'visits', 'notes', 'prescriptions', 'labs', 'certs'
  const [approvalInbox, setApprovalInbox] = useState([]);
  const [approvalInboxLoading, setApprovalInboxLoading] = useState(false);
  const [approvalInboxError, setApprovalInboxError] = useState('');
  const [selectedApprovalId, setSelectedApprovalId] = useState(null);
  const [approvalThread, setApprovalThread] = useState(null);
  const [approvalMessages, setApprovalMessages] = useState([]);
  const [approvalThreadLoading, setApprovalThreadLoading] = useState(false);
  const [approvalReply, setApprovalReply] = useState('');
  const [sendingApprovalReply, setSendingApprovalReply] = useState(false);
  const [approvalActionLoading, setApprovalActionLoading] = useState(false);
  const [approvalRejectNote, setApprovalRejectNote] = useState('');
  const [approvalSuggest, setApprovalSuggest] = useState({ date: '', time: '', note: '' });

  const [staffSettings, setStaffSettings] = useState({ prefs: {}, updatedAt: null });
  const [loadingStaffSettings, setLoadingStaffSettings] = useState(false);

  const [worklistRange, setWorklistRange] = useState('today'); // today | week
  const [worklistLoading, setWorklistLoading] = useState(false);
  const [worklistError, setWorklistError] = useState('');
  const [worklistAppointments, setWorklistAppointments] = useState([]);
  const [worklistApprovals, setWorklistApprovals] = useState([]);

  const [selectedLabResultId, setSelectedLabResultId] = useState(null);
  const [labInterpretation, setLabInterpretation] = useState({ note: '', updatedAt: null });
  const [loadingLabInterpretation, setLoadingLabInterpretation] = useState(false);
  const [savingLabInterpretation, setSavingLabInterpretation] = useState(false);

  const [selectedRxTemplate, setSelectedRxTemplate] = useState('');
  const [rxDraftUpdatedAt, setRxDraftUpdatedAt] = useState(null);

  // --- ER Specific State ---
  const [erVitals, setERVitals] = useState(null);
  const [erTriage, setERTriage] = useState(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({ kind: 'Laboratory', service: '', notes: '', priority: 'Routine', assignedRole: 'medtech' });
  const [savingOrder, setSavingOrder] = useState(false);
  const [erOrders, setErOrders] = useState([]);
  const [erOrdersLoading, setErOrdersLoading] = useState(false);
  const [erOrdersError, setErOrdersError] = useState('');
  const [billOutOpen, setBillOutOpen] = useState(false);
  const [billOutItems, setBillOutItems] = useState([]);
  const [billOutNotes, setBillOutNotes] = useState('');
  const [billOutSaving, setBillOutSaving] = useState(false);
  const [wards, setWards] = useState([]);
  const [wardsLoading, setWardsLoading] = useState(false);
  const [selectedWard, setSelectedWard] = useState('');
  const [disposition, setDisposition] = useState('Treatment'); // Treatment, Admit, Discharge, Transfer
  const [finalizingVisit, setFinalizingVisit] = useState(false);

  const doctorName = useMemo(() => {
    if (!currentUser) return 'Doctor';
    const u = currentUser;
    const first = String(u.firstName || u.first_name || u.firstname || '').trim();
    const last = String(u.lastName || u.last_name || u.lastname || '').trim();
    const hasSpace = (s) => /\s/.test(String(s || '').trim());
    const isEmailOrUser = (s) => {
      const v = String(s || '').trim().toLowerCase();
      if (!v) return true;
      if (v.includes('@')) return true;
      if (/\d{2,}$/.test(v) && !hasSpace(v)) return true;
      if (/^(user|staff|doctor|patient|admin|nurse|cashier|pharm)\d+$/i.test(v)) return true;
      return false;
    };
    const fullName = `${first} ${last}`.trim();
    if (fullName && hasSpace(fullName) && !isEmailOrUser(fullName)) return fullName;
    if (u.fullName && String(u.fullName).trim() && hasSpace(u.fullName) && !isEmailOrUser(u.fullName)) return String(u.fullName).trim();
    if (u.full_name && String(u.full_name).trim() && hasSpace(u.full_name) && !isEmailOrUser(u.full_name)) return String(u.full_name).trim();
    const nameRaw = String(u.name || u.displayName || '').trim();
    if (nameRaw && hasSpace(nameRaw) && !isEmailOrUser(nameRaw)) return nameRaw;
    if (first && last && !isEmailOrUser(first) && !isEmailOrUser(last)) {
      return `${first} ${last}`.trim();
    }
    const titleCaseWord = (w) => String(w || '').trim().replace(/^./, (c) => c.toUpperCase());
    // Common Filipino + Spanish surnames (longest first) for lowercase concat splits.
    // Needed because usernames like 'joshamparo5' are all lowercase (PascalCase splitter fails), so we match known lastname suffix at end then split.
    const PH_SURNAMES_LONGEST_FIRST = [
      // 9+
      'pascualinga','bautista','gonzales','rodriguez','hernandez','guerrero','gutierrez','benedicto','alejandro','santiago','villanueva','cruz','mercado','mendoza','montenegro','navarro','salvador','tolentino','castillo','fernando','clemente','corpus','flores','fontanilla','dejesus','delacruz','dimalanta','galicia','hermosa','hipolito','isidoro','javier','jimenez','joson','labios','ledesma','legazpi','macaraig','malonzo','marasigan','marcelo','miranda','montealto','morales','natividad','nolasco','padilla','panganiban','panlilio','pedrosa','pilapil','pineda','plantilla','quirino','regalado','remulla','salazar','sandoval','sanjuanserroblesrosalesrostata','tuazon','umbaliurdanetavenezuela','vicencio','villena','viteri','amparo',
      // 7-8
      'acosta','aguinaldo','agustin','alvarez','angelo','antonio','asilo','ayala','baldos','bayani','bernal','besa','bueno','cabrera','cadeña','carreon','casanova','cendaña','chavez','conde','corona','cortes','danao','dapula','devera','divina','domingo','enciso','ermitaño','faustino','fuerte','gabriel','galang','galvez','garcia','ginez','gomez','gozon','ignacio','ilustre','kalaw','laurel','lazaro','lopez','macaraig','magno','malaya','manuel','marcos','mariano','matienzo','medina','mojica','nable','ortiz','osmena','palma','paraiso','pastor','pascual','perez','ponce','quezon','quimpo','ramirez','ramos','ranada','ricarte','rivas','rivera','sanchez','sepuede','soliman','sotto','suarez','sumulong','taber','tabora','tandoc','tanchanco','teodoro','torres','valdez','vargas','vasquez','velasco','veloso','villas',
      // 6
      'abravalencia','zamora','abaya','albaño','aldo','amocha','angeles','asano','bagsic','baliuag','bantug','basco','bautra','baylon','beltran','buanza','bundoc','cabral','cabus','cano','caraos','cedo','cera','chua','colet','dado','dalmacio','daza','diaz','digo','diosdado','echavez','elena','emeterio','eraña','estrada','fabella','fariñas','filio','galicia','gervacio','ginez','godinez','gregorio','halili','hidalgo','ibanez','ilagan','javellana','jocson','kalaw','kapunan','lanuza','lares','latonio','ledesma','licuanan','limjoco','linan','mabini','magbanua','makarunday','malazcona','manalo','manlapaz','manzano','maratas','masbate','mateo','mayo','menchaca','mijares','milante','misa','moldes','niel','nucum','obra','ocampo','otad','pacia','pagad','paguio','palabay','panti','paraiso','pasco','pedron','peralta','pilapil','pinlac','plantiya','quibilan','quirino','rabe','rafael','rances','recio','reyna','rubio','sabado','sagala','saldarretercias','tiglao','tinio','tiomsa','togonon','tolentino','umbra','urquiza','valera','vicencio','villon','viray',
      // 5 (always LAST since we match longest FIRST, sorted by default — short matches won't consume long.
      'reyes','santos','cruz','garcia','mercado','rivera','ramos','torres','flores','villanueva','santiago','diaz','pascua','aquino','bautista','delosreyes'
    ].map(s => String(s).toLowerCase().replace(/[^a-z]/g,'')).filter(Boolean).sort((a,b)=>b.length-a.length);
    const splitLowerSurnameSplit = (oneWordLower) => {
      const s = String(oneWordLower || '').toLowerCase().replace(/[^a-z]/g,'');
      if (!s || s.length < 6) return '';
      for (const sfx of PH_SURNAMES_LONGEST_FIRST) {
        if (!sfx || s === sfx) continue;
        if (s.endsWith(sfx)) {
          const firstLen = s.length - sfx.length;
          if (firstLen >= 2 && firstLen <= sfx.length + 6) {
            const fRaw = s.slice(0, firstLen);
            // first part shouldn't itself be a known surname
            if (PH_SURNAMES_LONGEST_FIRST.indexOf(fRaw) === -1) {
              const l = sfx;
              return [titleCaseWord(fRaw), titleCaseWord(l)].join(' ');
            }
          }
        }
      }
      return '';
    };
    const cleanUsername = (v) => {
      const s = String(v || '').trim();
      if (!s) return '';
      const local = s.includes('@') ? s.split('@')[0] : s;
      const stripped = local.replace(/[-_.]+/g, ' ').replace(/\d+$/, '').trim();
      const parts = stripped.split(/\s+/).filter(Boolean).map(titleCaseWord);
      if (parts.length === 1) {
        const only = parts[0];
        if (!only) return '';
        const split = only.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/);
        if (split) return `${split[1]} ${split[2]}`;
        const lowerSplit = splitLowerSurnameSplit(only);
        if (lowerSplit && /\s/.test(lowerSplit)) return lowerSplit;
      }
      if (parts.length === 0) {
        const lowerFallback = splitLowerSurnameSplit(stripped);
        if (lowerFallback && /\s/.test(lowerFallback)) return lowerFallback;
      }
      return parts.join(' ');
    };
    const firstIsPattern = Boolean(isEmailOrUser(first));
    if (u.email && firstIsPattern) {
      const nice = cleanUsername(u.email);
      if (nice && hasSpace(nice)) return nice;
    }
    if (first) {
      if (!isEmailOrUser(first)) {
        if (last) return `${first} ${last}`.trim();
        return first;
      }
      const niceF = cleanUsername(first);
      if (niceF && hasSpace(niceF)) return niceF;
      if (niceF) return niceF;
    }
    if (nameRaw) {
      const niceRaw = cleanUsername(nameRaw);
      if (niceRaw) return niceRaw;
      return nameRaw;
    }
    return 'Doctor';
  }, [currentUser]);

  const doctorInboxName = useMemo(() => {
    return doctorName;
  }, [doctorName]);

  const doctorSpecialization = useMemo(() => {
    const u = currentUser || {};
    return String(u.specialization || '').toLowerCase();
  }, [currentUser]);

  const isERDoctor = useMemo(() => {
    const spec = doctorSpecialization;
    const dept = String(currentUser?.department || currentUser?.dept || '').trim().toLowerCase();
    // ER Doctor mode is explicitly tagged via department=ER (specialization can remain Medicine).
    if (dept === 'er' || dept.includes('er')) return true;
    // Backward-compat fallback if older accounts used "Emergency" specialization.
    return spec.includes('emergency');
  }, [currentUser?.department, currentUser?.dept, doctorSpecialization]);

  const isPediatricsDoctor = useMemo(() => {
    const spec = doctorSpecialization;
    return spec.includes('pediatric') || spec.includes('pediatrics');
  }, [doctorSpecialization]);

  const doctorSpecKey = useMemo(() => {
    const raw = String(doctorSpecialization || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.includes('pedi')) return 'pediatrics';
    if (raw.includes('ob-gyn') || raw.includes('obgyn') || raw === 'ob') return 'ob_gyn';
    if (raw.includes('cardio')) return 'cardiology';
    if (raw.includes('derma')) return 'dermatology';
    if (raw.includes('surg')) return 'surgery';
    if (raw.includes('ortho')) return 'orthopedics';
    if (raw.includes('medicine') || raw.includes('internal') || raw.includes('emergency')) return 'medicine';
    return raw.replace(/\s+/g, '_');
  }, [doctorSpecialization]);

  const allowedDoctorNav = useMemo(() => {
    const base = ['dashboard', 'worklist', 'patient-records', 'certificates', 'doctor-chat', 'profile'];
    const withCare = ['approval-inbox', 'patient-summary'];
    const withLabs = ['labs'];

    const spec = doctorSpecKey;
    if (!spec) return new Set([...base, ...withCare, ...withLabs]);

    if (isERDoctor) return new Set([...base]);
    if (spec === 'pediatrics') return new Set([...base]);
    if (spec === 'dermatology') return new Set([...base, ...withCare]);

    return new Set([...base, ...withCare, ...withLabs]);
  }, [doctorSpecKey, isERDoctor]);

  const defaultDoctorNav = useMemo(() => {
    const preferred = ['dashboard', 'worklist', 'patient-records', 'certificates', 'doctor-chat', 'patient-summary', 'labs', 'approval-inbox'];
    for (const k of preferred) {
      if (allowedDoctorNav.has(k)) return k;
    }
    return 'dashboard';
  }, [allowedDoctorNav]);

  useEffect(() => {
    if (!allowedDoctorNav.has(activeNav)) {
      setActiveNav(defaultDoctorNav);
    }
  }, [activeNav, allowedDoctorNav, defaultDoctorNav]);

  const doctorNavItems = useMemo(() => {
    const isPathoOrRadio = doctorSpecialization.toLowerCase().includes('patholog') || doctorSpecialization.toLowerCase().includes('radiolog');
    
    let items = [
      { key: 'dashboard', label: 'Patients Queue', icon: <User size={20} /> },
      { key: 'worklist', label: 'Worklist', icon: <Calendar size={20} /> },
      { key: 'doctor-chat', label: 'Doctor Chat', icon: <MessageSquare size={20} /> },
      { key: 'approval-inbox', label: 'Approvals Inbox', icon: <MessageSquare size={20} /> },
      { key: 'patient-summary', label: 'Patient Summary', icon: <ChevronRight size={20} /> },
      { key: 'patient-records', label: 'Patient Records', icon: <FileText size={20} /> },
      { key: 'labs', label: 'Lab & Imaging', icon: <Search size={20} /> },
      { key: 'certificates', label: 'Certificates', icon: <FileText size={20} /> }
    ];
    
    if (isPathoOrRadio) {
      items = items.filter(it => it.key !== 'labs' && it.key !== 'certificates');
    }
    
    return items.filter((it) => allowedDoctorNav.has(it.key));
  }, [allowedDoctorNav, doctorSpecialization]);

  const [doctorChatMessages, setDoctorChatMessages] = useState([]);
  const [doctorChatLoading, setDoctorChatLoading] = useState(false);
  const [doctorChatLoadingOlder, setDoctorChatLoadingOlder] = useState(false);
  const [doctorChatOlderExhausted, setDoctorChatOlderExhausted] = useState(false);
  const [doctorChatError, setDoctorChatError] = useState('');
  const [doctorChatText, setDoctorChatText] = useState('');
  const [doctorChatInputInvalid, setDoctorChatInputInvalid] = useState(false);
  const [doctorChatShowFAB, setDoctorChatShowFAB] = useState(false);
  const [doctorChatUnreadBadge, setDoctorChatUnreadBadge] = useState(0);
  const [doctorChatScrollInterrupt, setDoctorChatScrollInterrupt] = useState(false);
  const [doctorChatSearch, setDoctorChatSearch] = useState('');
  const [doctorChatShowSearch, setDoctorChatShowSearch] = useState(false);
  const [doctorChatBannerDismissed, setDoctorChatBannerDismissed] = useState(() => {
    try { return Number(localStorage.getItem('dc_phi_banner_closed') || 0) >= 3; } catch (_) { return false; }
  });
  const [doctorChatAttachment, setDoctorChatAttachment] = useState(null);
  const [doctorChatAttachmentUploading, setDoctorChatAttachmentUploading] = useState(false);
  const [doctorChatAttPreview, setDoctorChatAttPreview] = useState(null);
  const [doctorChatReplying, setDoctorChatReplying] = useState(null);
  const [doctorChatMentionOpen, setDoctorChatMentionOpen] = useState(false);
  const [doctorChatMentionIdx, setDoctorChatMentionIdx] = useState(null);
  const [doctorChatMentionQuery, setDoctorChatMentionQuery] = useState('');
  const [doctorChatPinOpen, setDoctorChatPinOpen] = useState(false);
  const [doctorChatMsgMenu, setDoctorChatMsgMenu] = useState(null);
  const [doctorChatDeleteConfirm, setDoctorChatDeleteConfirm] = useState(null);
  const doctorChatScrollRef = useRef(null);
  const doctorChatFileInputRef = useRef(null);
  const doctorChatComposeRef = useRef(null);
  const doctorChatLastSeenIdRef = useRef(null);

  const doctorChatSpecialty = useMemo(() => {
    return 'global_doctors'; // All doctors share the same chat room
  }, []);

  const loadDoctorChatMessages = async (opts = {}) => {
    const specialty = doctorChatSpecialty;
    if (!supabase) {
      setDoctorChatMessages([]);
      setDoctorChatError('Chat is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in homepage/.env, then restart the dev server and rebuild before uploading to Hostinger.');
      return;
    }
    const isOlder = opts.older === true;
    const existing = Array.isArray(doctorChatMessages) ? doctorChatMessages : [];
    if (isOlder && existing.length < 20) {
      setDoctorChatOlderExhausted(true);
      return;
    }
    if (isOlder) setDoctorChatLoadingOlder(true); else setDoctorChatLoading(true);
    setDoctorChatError('');
    try {
      const PAGE = 50;
      let query = supabase
        .from('consultation_messages')
        .select('*')
        .eq('specialty', specialty)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (isOlder && existing.length) {
        const earliest = existing[0];
        if (earliest?.created_at) query = query.lt('created_at', earliest.created_at);
      }
      const { data, error } = await query;
      if (error) throw error;
      const rows = Array.isArray(data) ? [...data].reverse() : [];
      if (isOlder) {
        if (!rows.length) setDoctorChatOlderExhausted(true);
        setDoctorChatMessages((prev) => [...rows, ...(Array.isArray(prev) ? prev : [])]);
      } else {
        if (rows.length < PAGE) setDoctorChatOlderExhausted(true);
        setDoctorChatMessages(rows);
        if (rows.length) doctorChatLastSeenIdRef.current = rows[rows.length - 1]?.id || null;
      }
    } catch (e) {
      if (!isOlder) setDoctorChatMessages([]);
      setDoctorChatError(String(e?.message || 'Unable to load messages.'));
    } finally {
      if (isOlder) setDoctorChatLoadingOlder(false); else setDoctorChatLoading(false);
    }
  };

  const scrollDoctorChatToBottom = (force) => {
    try {
      const el = doctorChatScrollRef?.current;
      if (!el) return;
      if (force !== true && doctorChatScrollInterrupt) return;
      if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight + 99999, behavior: 'smooth' });
      else el.scrollTop = el.scrollHeight;
      setDoctorChatUnreadBadge(0);
      setDoctorChatShowFAB(false);
    } catch (_) {}
  };

  const doctorChatSenderIdentity = useMemo(() => {
    const name = String(doctorInboxName || doctorName || 'Doctor').trim();
    const spec = String(doctorSpecialization || '').trim();
    const dept = spec ? spec.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
    const username = String(currentUser?.username || currentUser?.email || currentUser?.user || '').trim().split('@')[0];
    return { name, dept, displayName: dept ? `${name} • ${dept}` : name, username };
  }, [doctorInboxName, doctorName, doctorSpecialization, currentUser]);

  const doctorChatCurrentUsernameKeys = useMemo(() => {
    const keys = new Set();
    const push = (raw) => {
      const s = String(raw || '').trim().toLowerCase().replace(/[\s._-]+/g, '');
      if (s) keys.add(s);
    };
    push(doctorChatSenderIdentity.name);
    push(doctorChatSenderIdentity.username);
    push(currentUser?.username);
    push(currentUser?.email);
    push(currentUser?.user);
    const u0 = String(currentUser?.username || '').split('@')[0];
    push(u0);
    const e0 = String(currentUser?.email || '').split('@')[0];
    if (e0 && e0 !== u0) push(e0);
    const nameParts = doctorChatSenderIdentity.name.split(/\s+/).filter(Boolean);
    if (nameParts.length >= 2) push(nameParts[0] + nameParts[nameParts.length - 1]);
    return keys;
  }, [doctorChatSenderIdentity, currentUser]);

  const normalizeSenderKey = (raw) => String(raw || '').trim().toLowerCase().replace(/[\s._@-]+/g, '');

  const isDoctorChatMine = (msg) => {
    const names = [msg?.sender_name, msg?.senderName, msg?.sender_email, msg?.senderEmail, msg?.sender_user, msg?.sender_username];
    for (const raw of names) {
      const k = normalizeSenderKey(raw);
      if (!k) continue;
      if (doctorChatCurrentUsernameKeys.has(k)) return true;
      for (const mine of doctorChatCurrentUsernameKeys) if (mine && k.includes(mine)) return true;
    }
    if (msg?.sender_id && String(msg.sender_id) === String(currentUser?.id || '')) return true;
    return false;
  };

  const guessDisplayName = (msg) => {
    const raw = String(msg?.sender_name || msg?.senderName || '').trim();
    if (raw.includes(' ')) return raw;
    if (!raw) return 'Doctor';
    if (/^[a-z0-9]+$/i.test(raw) && /\d/.test(raw)) {
      const cleaned = raw.replace(/\d+$/g, '').replace(/[_.-]/g, ' ').replace(/\s+/g, ' ').trim();
      const titled = cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
      return titled ? `Dr. ${titled}` : `Dr. (${raw})`;
    }
    if (/^[a-z]+$/i.test(raw)) return `Dr. ${raw.charAt(0).toUpperCase() + raw.slice(1)}`;
    return raw;
  };

  const doctorChatAllSenders = useMemo(() => {
    const map = new Map();
    const list = Array.isArray(doctorChatMessages) ? doctorChatMessages : [];
    list.forEach((m) => {
      const name = guessDisplayName(m);
      if (!name || name === 'Doctor') return;
      const key = name.toLowerCase().replace(/\s+/g, '');
      if (map.has(key)) return;
      const dept = String(m?.sender_dept || m?.senderDept || '').trim();
      map.set(key, { name, dept, key });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [doctorChatMessages]);

  const doctorChatOnlineMap = useMemo(() => {
    const state = new Map();
    const now = Date.now();
    const list = Array.isArray(doctorChatMessages) ? [...doctorChatMessages].reverse() : [];
    list.forEach((m) => {
      const key = normalizeSenderKey(guessDisplayName(m) + '|' + String(m?.sender_dept || ''));
      if (state.has(key)) return;
      const ts = m?.created_at || m?.createdAt || null;
      if (!ts) { state.set(key, { level: 'off', label: 'Offline' }); return; }
      const diff = now - new Date(ts).getTime();
      let level = 'off', label = 'Offline';
      if (diff <= 5 * 60 * 1000) { level = 'on'; label = 'Online'; }
      else if (diff <= 30 * 60 * 1000) { level = 'away'; label = 'Away'; }
      state.set(key, { level, label, ts });
    });
    const meKey = normalizeSenderKey(doctorChatSenderIdentity.displayName);
    state.set(meKey, { level: 'on', label: 'Online', ts: now });
    return state;
  }, [doctorChatMessages, doctorChatSenderIdentity]);

  const doctorChatOnlineCounts = useMemo(() => {
    let on = 0, away = 0, off = 0;
    doctorChatOnlineMap.forEach((v) => {
      if (v.level === 'on') on += 1;
      else if (v.level === 'away') away += 1; else off += 1;
    });
    return { on, away, off, total: on + away + off };
  }, [doctorChatOnlineMap]);

  const formatDoctorChatTime = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  };

  const formatDoctorChatFullTs = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  };

  const formatDoctorChatDayKey = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch (_) { return ''; }
  };

  const formatDoctorChatDayLabel = (dayKey) => {
    if (!dayKey) return '';
    const today = formatDoctorChatDayKey(new Date());
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = formatDoctorChatDayKey(y);
    if (dayKey === today) return 'Today';
    if (dayKey === yesterday) return 'Yesterday';
    try {
      const [yy, mm, dd] = dayKey.split('-').map(Number);
      return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (_) { return dayKey; }
  };

  const doctorChatPinnedMessages = useMemo(() => {
    const arr = Array.isArray(doctorChatMessages) ? doctorChatMessages.filter((m) => !!m?.pinned) : [];
    return [...arr].sort((a, b) => new Date(b.pinned_at || b.created_at || 0) - new Date(a.pinned_at || a.created_at || 0)).slice(0, 3);
  }, [doctorChatMessages]);

  const doctorChatMessageDeletable = (m) => {
    if (!isDoctorChatMine(m)) return false;
    if (!!m?.deleted) return false;
    const ts = m?.created_at || m?.createdAt;
    if (!ts) return false;
    return (Date.now() - new Date(ts).getTime()) <= 5 * 60 * 1000;
  };

  const doctorChatCopyText = async (txt) => {
    try {
      await navigator.clipboard.writeText(String(txt || ''));
      setToast({ type: 'success', message: 'Copied to clipboard.' });
    } catch (_) { setToast({ type: 'info', message: String(txt || '').slice(0, 120) }); }
  };

  const doctorChatSoftDelete = async (m) => {
    if (!doctorChatMessageDeletable(m) || !supabase) return;
    try {
      const { error } = await supabase
        .from('consultation_messages')
        .update({ deleted: true, deleted_at: new Date().toISOString(), deleted_by: doctorChatSenderIdentity.name })
        .eq('id', m.id);
      if (error) throw error;
      setDoctorChatMessages((prev) => (Array.isArray(prev) ? prev : []).map((x) => String(x?.id) === String(m?.id) ? { ...x, deleted: true, deleted_at: new Date().toISOString(), deleted_by: doctorChatSenderIdentity.name } : x));
      setDoctorChatDeleteConfirm(null);
      setToast({ type: 'success', message: 'Message deleted.' });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Delete failed.') });
    }
  };

  const doctorChatTogglePin = async (m) => {
    if (!supabase || !m?.id) return;
    const pinned = !m?.pinned;
    if (pinned && doctorChatPinnedMessages.length >= 3) {
      setToast({ type: 'warning', message: 'Maximum 3 pinned messages. Unpin an older one first.' });
      return;
    }
    try {
      const payload = pinned ? { pinned: true, pinned_at: new Date().toISOString(), pinned_by: doctorChatSenderIdentity.name } : { pinned: false, pinned_at: null, pinned_by: null };
      const { error } = await supabase.from('consultation_messages').update(payload).eq('id', m.id);
      if (error) throw error;
      setDoctorChatMessages((prev) => (Array.isArray(prev) ? prev : []).map((x) => String(x?.id) === String(m?.id) ? { ...x, ...payload } : x));
      setDoctorChatMsgMenu(null);
      setToast({ type: 'success', message: pinned ? '📌 Pinned to top.' : 'Unpinned.' });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Pin failed.') });
    }
  };

  const doctorChatScrollToMsg = (id) => {
    try {
      const el = doctorChatScrollRef?.current;
      if (!el) return;
      const tgt = el.querySelector(`[data-dc-id="${CSS.escape(String(id))}"]`);
      if (tgt && typeof tgt.scrollIntoView === 'function') {
        tgt.scrollIntoView({ behavior: 'smooth', block: 'center' });
        tgt.classList.add('dc-flash');
        setTimeout(() => tgt.classList.remove('dc-flash'), 1600);
      }
      setDoctorChatPinOpen(false);
    } catch (_) {}
  };

  const doctorChatFiltered = useMemo(() => {
    const list = Array.isArray(doctorChatMessages) ? doctorChatMessages.filter((m) => !m?.deleted) : [];
    const q = String(doctorChatSearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => String(m?.body || '').toLowerCase().includes(q));
  }, [doctorChatMessages, doctorChatSearch]);

  const doctorChatQuickReplies = [
    { id: 'hi-avail', label: '👋 Hi, available now?', text: 'Hi, available now here.' },
    { id: 'stat-consult', label: '🩺 STAT consult', text: 'STAT consult needed — please assist.' },
    { id: 'stat-lab', label: '🩸 Lab priority', text: 'Lab priority request for patient.' },
    { id: 'er-help', label: '🚨 ER help', text: 'ER help needed — please proceed to ER.' },
    { id: 'queue-upd', label: '⏱️ Queue update', text: 'Queue update — current ETA 30-45min.' },
    { id: 'pt-upd', label: '📋 Patient update', text: 'Patient status update incoming.' },
    { id: 'saan-na', label: '❓ Saan ka na?', text: 'Nasaan ka na? Need ka na dito.' }
  ];

  const doctorChatFileAllowed = useMemo(() => {
    return {
      image: { accept: 'image/jpeg,image/png,image/gif,image/webp', max: 10 * 1024 * 1024, types: ['image/jpeg','image/png','image/gif','image/webp'] },
      pdf: { accept: 'application/pdf', max: 10 * 1024 * 1024, types: ['application/pdf'] },
      video: { accept: 'video/mp4,video/webm,video/quicktime,video/x-matroska', max: 50 * 1024 * 1024, types: ['video/mp4','video/webm','video/quicktime','video/x-matroska'] }
    };
  }, []);

  const doctorChatAttachmentKind = (file) => {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    if (doctorChatFileAllowed.image.types.includes(type) || /\.(jpe?g|png|gif|webp)$/i.test(name)) return 'image';
    if (doctorChatFileAllowed.pdf.types.includes(type) || name.endsWith('.pdf')) return 'pdf';
    if (doctorChatFileAllowed.video.types.includes(type) || /\.(mp4|webm|mov|mkv|qt)$/i.test(name)) return 'video';
    return null;
  };

  const doctorChatFileSizeOk = (file, kind) => {
    if (!file || !kind) return { ok: false, msg: 'Unsupported file type.' };
    const limit = doctorChatFileAllowed[kind]?.max || 0;
    if (!file.size || file.size <= 0) return { ok: false, msg: 'Empty file.' };
    if (file.size > limit) return { ok: false, msg: `File too large. Max ${Math.round(limit / 1024 / 1024)}MB.` };
    return { ok: true };
  };

  const doctorChatOnPickFile = (ev) => {
    const files = Array.from(ev?.target?.files || []);
    if (!files.length) return;
    const f = files[0];
    const kind = doctorChatAttachmentKind(f);
    if (!kind) { setToast({ type: 'error', message: 'Only images, PDFs, or videos allowed.' }); return; }
    const sz = doctorChatFileSizeOk(f, kind);
    if (!sz.ok) { setToast({ type: 'error', message: sz.msg }); return; }
    setDoctorChatAttachment({ file: f, kind, name: f.name, size: f.size, type: f.type });
  };

  const doctorChatUploadAttachment = async () => {
    if (!supabase || !doctorChatAttachment) return;
    const { file, kind } = doctorChatAttachment;
    const sz = doctorChatFileSizeOk(file, kind);
    if (!sz.ok) { setToast({ type: 'error', message: sz.msg }); return; }
    setDoctorChatAttachmentUploading(true);
    try {
      const ts = Date.now();
      const safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
      const path = `${doctorChatSpecialty}/${doctorChatSenderIdentity.username || 'doc'}/${ts}_${safe}`;
      const { error: upErr } = await supabase.storage.from('doctor-chat-attachments').upload(path, file, { cacheControl: '31536000', upsert: false });
      if (upErr) throw upErr;
      const signedUrlRes = await supabase.storage.from('doctor-chat-attachments').createSignedUrl(path, 60 * 60 * 72);
      const signedUrl = signedUrlRes?.data?.signedUrl || '';
      const publicData = supabase.storage.from('doctor-chat-attachments').getPublicUrl(path);
      const publicUrl = publicData?.data?.publicUrl || '';
      const caption = String(doctorChatText || '').trim();
      const payload = {
        specialty: doctorChatSpecialty, sender_role: 'doctor',
        body: caption,
        sender_name: doctorChatSenderIdentity.name, sender_dept: doctorChatSenderIdentity.dept,
        attachment_kind: kind, attachment_name: file.name, attachment_size: file.size, attachment_mime: file.type || '',
        attachment_path: path, attachment_url: signedUrl || publicUrl, attachment_public_url: publicUrl
      };
      if (doctorChatReplying?.id) { payload.reply_to_id = doctorChatReplying.id; payload.reply_to_body = String(doctorChatReplying.body || '').slice(0, 240); }
      const { error } = await supabase.from('consultation_messages').insert([payload]);
      if (error) throw error;
      setDoctorChatAttachment(null);
      setDoctorChatAttachmentUploading(false);
      setDoctorChatText('');
      setDoctorChatReplying(null);
    } catch (e) {
      setDoctorChatAttachmentUploading(false);
      setToast({ type: 'error', message: String(e?.message || 'Upload failed. Ensure bucket "doctor-chat-attachments" exists with RLS insert enabled.') });
    }
  };

  const sendDoctorChatMessage = async () => {
    const specialty = doctorChatSpecialty;
    if (doctorChatAttachment && !doctorChatAttachmentUploading) {
      await doctorChatUploadAttachment();
      return;
    }
    const body = String(doctorChatText || '').trim();
    if (body.length > 2000) {
      setToast({ type: 'error', message: 'Message too long (2000 character max).' });
      return;
    }
    if (!body) {
      setDoctorChatInputInvalid(true);
      setTimeout(() => setDoctorChatInputInvalid(false), 900);
      return;
    }
    if (!supabase) return;
    try {
      const payload = {
      specialty, sender_role: 'doctor', body,
      sender_name: doctorChatSenderIdentity.name, sender_dept: doctorChatSenderIdentity.dept
    };
    if (doctorChatReplying?.id) {
      payload.reply_to_id = doctorChatReplying.id; payload.reply_to_body = String(doctorChatReplying.body || '').slice(0, 240); payload.reply_to_sender = guessDisplayName(doctorChatReplying);
    }
    const { error } = await supabase.from('consultation_messages').insert([payload]);
    if (error) throw error;
    setDoctorChatText('');
    setDoctorChatInputInvalid(false);
    setDoctorChatReplying(null);
  } catch (e) {
    setToast({ type: 'error', message: String(e?.message || 'Failed to send.') });
  }
  };

  const rxTemplates = useMemo(() => {
    const common = [
      { id: 'common-pain', label: 'Pain / Fever (Basic)', meta: { diagnosis: 'Pain / Fever', instructions: 'Take as directed. Return if symptoms worsen.' }, items: [{ medication: 'Paracetamol', dosage: '500 mg', frequency: 'Every 6-8 hours', duration: '3 days', notes: 'Max 4 g/day' }] }
    ];

    const pediatrics = [
      { id: 'peds-fever', label: 'Pediatrics: Fever', meta: { diagnosis: 'Fever', instructions: 'Monitor temperature. Encourage fluids.' }, items: [{ medication: 'Paracetamol (Pediatric)', dosage: 'As per weight', frequency: 'Every 6 hours', duration: '2-3 days', notes: '' }] }
    ];

    const cardio = [
      { id: 'cardio-htn', label: 'Cardiology: Hypertension (Basic)', meta: { diagnosis: 'Hypertension', instructions: 'Lifestyle changes + take medication consistently.' }, items: [{ medication: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', duration: '30 days', notes: 'Monitor BP' }] }
    ];

    const derma = [
      { id: 'derma-dermatitis', label: 'Dermatology: Dermatitis (Basic)', meta: { diagnosis: 'Dermatitis', instructions: 'Avoid triggers. Use medication as directed.' }, items: [{ medication: 'Hydrocortisone 1% cream', dosage: 'Thin layer', frequency: '2x daily', duration: '7 days', notes: 'Avoid face/eyes unless advised' }] }
    ];

    const obgyn = [
      { id: 'obgyn-uti', label: 'OB-GYN: UTI (Basic)', meta: { diagnosis: 'UTI', instructions: 'Hydrate well. Return if fever/flank pain.' }, items: [{ medication: 'As prescribed', dosage: '', frequency: '', duration: '', notes: '' }] }
    ];

    const surgery = [
      { id: 'surg-postop', label: 'Surgery: Post-op Pain (Basic)', meta: { diagnosis: 'Post-op pain', instructions: 'Wound care as instructed. Return for redness, fever, severe pain.' }, items: [{ medication: 'Paracetamol', dosage: '500 mg', frequency: 'Every 6-8 hours', duration: '3 days', notes: '' }] }
    ];

    const spec = doctorSpecialization;
    if (spec.includes('pediatric')) return [...pediatrics, ...common];
    if (spec.includes('cardiolog')) return [...cardio, ...common];
    if (spec.includes('dermatolog')) return [...derma, ...common];
    if (spec.includes('obgyn')) return [...obgyn, ...common];
    if (spec.includes('surg')) return [...surgery, ...common];
    return common;
  }, [doctorSpecialization]);

  const normalizeAssignee = (v) => {
    return String(v || '')
      .toLowerCase()
      .replace(/^dr\.?\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normalizeSpecKey = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.includes('pedi')) return 'pediatrics';
    if (raw.includes('physical therapy') || raw === 'pt' || raw.includes('physio')) return 'physical_therapy';
    if (raw.includes('ob-gyn') || raw.includes('obgyn') || raw === 'ob') return 'ob_gyn';
    if (raw.includes('cardio')) return 'cardiology';
    if (raw.includes('derma')) return 'dermatology';
    if (raw.includes('surg')) return 'surgery';
    if (raw.includes('medicine') || raw.includes('internal')) return 'medicine';
    return raw.replace(/\s+/g, '_');
  };

  const isVideoConsult = (apt) => {
    const mode = String(apt?.consultationMode || apt?.consultation_mode || '').trim().toLowerCase();
    if (mode === 'video') return true;
    const reason = String(apt?.reason || '').trim().toLowerCase();
    return reason.includes('video consultation') || reason.startsWith('video:') || reason.includes('(online)');
  };

  const inferVideoSpecialization = (reason) => {
    const raw = String(reason || '').trim();
    const lower = raw.toLowerCase();
    if (!lower.includes('video consultation')) return '';
    let tail = raw;
    const idx = lower.indexOf('video consultation');
    if (idx >= 0) tail = raw.slice(idx + 'video consultation'.length);
    tail = tail.replace(/^\s*[-:]\s*/g, '');
    const stopIdx = (() => {
      const i1 = tail.indexOf(':');
      const i2 = tail.indexOf('|');
      const arr = [i1, i2].filter(n => n >= 0);
      return arr.length ? Math.min(...arr) : -1;
    })();
    const head = (stopIdx >= 0 ? tail.slice(0, stopIdx) : tail).trim();
    const cleaned = head.replace(/\(online\)/gi, '').trim();
    return normalizeSpecKey(cleaned);
  };

  const getAppointmentStartAt = (apt) => {
    const dateRaw = apt?.appointment_date || apt?.appointmentDate || null;
    const timeRaw = apt?.appointment_time || apt?.appointmentTime || null;

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

  const getVideoJoinWindowState = (apt) => {
    const startAt = getAppointmentStartAt(apt);
    if (!startAt) return { allowed: false, reason: 'Missing schedule' };
    const now = new Date();
    const diffMin = (now.getTime() - startAt.getTime()) / 60000;
    if (diffMin < -10) return { allowed: false, reason: 'You can start/join 10 mins before schedule' };
    // Increased window to 12 hours for testing purposes
    if (diffMin > 720) return { allowed: false, reason: 'Call window ended' };
    return { allowed: true, reason: '' };
  };

  const openVideoMeeting = (url, title) => {
    setVideoMeetingUrl(String(url || '').trim());
    setVideoMeetingTitle(String(title || '').trim());
    setVideoModalOpen(true);
  };

  const startVideoCall = async (apt) => {
    if (!apt?.id) return;
    try {
      // #region debug-point D:web-start-click
      reportVideoRoomDebug({
        hypothesisId: 'D',
        location: 'DoctorDashboard.js:startVideoCall:request',
        msg: '[DEBUG] doctor web requested start call',
        data: {
          appointmentId: String(apt.id),
          patientName: `${apt.firstName || ''} ${apt.lastName || ''}`.trim() || null
        }
      });
      // #endregion
      if (!supabase) {
        throw new Error('Supabase client not initialized. Check .env configuration.');
      }

      const sourceTable = String(apt?.sourceTable || apt?.source_table || 'appointments').trim() || 'appointments';
      const { data, error } = await supabase.functions.invoke('daily-create-room', {
        body: {
          appointmentId: Number(apt.id),
          action: 'start',
          sourceTable
        }
      });

      if (error) {
        throw new Error(error.message || 'Error from daily-create-room');
      }

      const meetingUrl = String(data?.url || data?.roomUrl || data?.meetingUrl || '').trim();
      if (!meetingUrl) throw new Error(data?.message || data?.error || 'Failed to retrieve video room URL');
      // #region debug-point A:web-start-response
      reportVideoRoomDebug({
        hypothesisId: 'A',
        location: 'DoctorDashboard.js:startVideoCall:response',
        msg: '[DEBUG] doctor web received start response',
        data: {
          appointmentId: String(apt.id),
          sourceTable,
          roomId: data?.roomId || null,
          url: meetingUrl || null,
          startedAt: data?.startedAt || null
        }
      });
      // #endregion

      openVideoMeeting(meetingUrl, `Video Consultation • ${apt.firstName || ''} ${apt.lastName || ''}`.trim());
    } catch (e) {
      // #region debug-point C:web-start-error
      reportVideoRoomDebug({
        hypothesisId: 'C',
        location: 'DoctorDashboard.js:startVideoCall:error',
        msg: '[DEBUG] doctor web start call failed',
        data: {
          appointmentId: String(apt?.id || ''),
          error: String(e?.message || 'Unable to start call.')
        }
      });
      // #endregion
      setToast({ type: 'error', message: String(e?.message || 'Unable to start call.') });
    }
  };

  const userRole = useMemo(() => {
    const u = currentUser || {};
    return String(u.accountType || u.account_type || u.role || '').toLowerCase();
  }, [currentUser]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const authHeaders = useMemo(() => {
    const headers = {};
    if (userRole) headers['x-user-role'] = userRole;

    // Pass the actual doctor name from the user object, fallback to doctorInboxName
    let actualDoctorName = '';
    if (currentUser?.first_name) {
      actualDoctorName = `${currentUser.first_name} ${currentUser.last_name || ''}`.trim();
    } else if (currentUser?.firstName) {
      actualDoctorName = `${currentUser.firstName} ${currentUser.lastName || ''}`.trim();
    } else {
      actualDoctorName = currentUser?.name || doctorInboxName;
    }
      
    if (actualDoctorName) headers['x-user-name'] = actualDoctorName;
    
    const email = currentUser?.email || profileForm?.email || '';
    if (email) headers['x-user-email'] = email;

    const doctorUuid = currentUser?.id || '';
    if (doctorUuid) headers['x-doctor-uuid'] = doctorUuid;

    return headers;
  }, [doctorInboxName, userRole, currentUser, profileForm?.email]);

  const rxDraftKey = useMemo(() => {
    if (!currentUser?.email || !selectedPatient?._id) return null;
    return `rxDraft:${String(currentUser.email).toLowerCase()}:${String(selectedPatient._id)}`;
  }, [currentUser?.email, selectedPatient?._id]);

  const labsLastSeenAt = useMemo(() => {
    const raw = staffSettings?.prefs?.labsLastSeenAt;
    return raw ? new Date(raw) : null;
  }, [staffSettings?.prefs?.labsLastSeenAt]);

  const rxSafety = useMemo(() => {
    const meds = prescriptionItems
      .map((it) => String(it.medication || '').trim())
      .filter(Boolean);
    const normalized = meds.map((m) => m.toLowerCase());
    const duplicates = [];
    const seen = new Set();
    for (const med of normalized) {
      if (seen.has(med)) duplicates.push(med);
      else seen.add(med);
    }

    const allergyRaw = String(selectedPatient?.allergies || '').trim();
    const allergyTokens = allergyRaw
      ? allergyRaw
          .split(/[,/]/g)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
    const allergyHits = [];
    for (const med of normalized) {
      for (const a of allergyTokens) {
        if (a && med.includes(a)) allergyHits.push({ med, allergy: a });
      }
    }

    return {
      duplicateMeds: Array.from(new Set(duplicates)),
      allergyHits
    };
  }, [prescriptionItems, selectedPatient?.allergies]);

  const fetchStaffSettings = async () => {
    if (!userRole || !currentUser?.email) return;
    setLoadingStaffSettings(true);
    try {
      const data = await fetchJson(`/api/staff/settings`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setStaffSettings({ prefs: data?.prefs || {}, updatedAt: data?.updatedAt || null });
    } catch (_err) {
      setStaffSettings({ prefs: {}, updatedAt: null });
    } finally {
      setLoadingStaffSettings(false);
    }
  };

  const saveStaffPrefs = async (partialPrefs) => {
    if (!userRole || !currentUser?.email) return null;
    const nextPrefs = { ...(staffSettings?.prefs || {}), ...(partialPrefs || {}) };
    setStaffSettings((prev) => ({ prefs: nextPrefs, updatedAt: prev?.updatedAt || null }));
    try {
      const data = await fetchJson(`/api/staff/settings`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ prefs: nextPrefs })
      });
      setStaffSettings({ prefs: data?.prefs || nextPrefs, updatedAt: data?.updatedAt || null });
      return data;
    } catch (_err) {
      return null;
    }
  };

  useEffect(() => {
    if (!userRole || !currentUser?.email) return;
    let alive = true;
    setLoadingStaffSettings(true);
    fetchJson(`/api/staff/settings`, { apiBase: API_BASE, headers: { ...authHeaders } })
      .then((data) => {
        if (!alive) return;
        setStaffSettings({ prefs: data?.prefs || {}, updatedAt: data?.updatedAt || null });
      })
      .catch(() => {
        if (!alive) return;
        setStaffSettings({ prefs: {}, updatedAt: null });
      })
      .finally(() => {
        if (!alive) return;
        setLoadingStaffSettings(false);
      });
    return () => {
      alive = false;
    };
  }, [userRole, currentUser?.email, authHeaders]);

  const welcomeDateText = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  const welcomeQuote = useMemo(() => {
    const quotes = [
      'One patient at a time. One decision at a time.',
      'Small actions, steady care.',
      'Be calm. Be thorough. Be kind.',
      'Listen first. Treat second.',
      'Clear notes. Clear thinking.',
      'Compassion is part of the treatment.'
    ];
    const daySeed = new Date().toISOString().slice(0, 10);
    let hash = 0;
    for (let i = 0; i < daySeed.length; i += 1) hash = (hash * 31 + daySeed.charCodeAt(i)) % 2147483647;
    return quotes[hash % quotes.length];
  }, []);

  const activePatientName = useMemo(() => {
    if (selectedPatient) return `${selectedPatient.firstName || ''} ${selectedPatient.lastName || ''}`.trim();
    return '';
  }, [selectedPatient]);

  const activeAppointmentTime = useMemo(() => {
    return '';
  }, []);

  const activePatientMeta = useMemo(() => {
    const p = recordProfile || selectedPatient || {};
    const email = p.email || p.email_address || '';
    const contact = p.contactNumber || p.contact_number || p.phone || '';
    const gender = p.gender || p.sex || '';
    const allergies = p.allergies || '';
    return { email, contact, gender, allergies };
  }, [selectedPatient, recordProfile]);

  const fetchRecordList = async () => {
    if (!userRole) return;
    setLoadingRecords(true);
    try {
      const q = encodeURIComponent(recordQuery);
      // Use the generic /api/patients if the doctor is an ER doctor to ensure all are seen
      const url = isERDoctor 
        ? `${API_BASE}/api/patients?q=${q}&take=${recordTake}&skip=${recordSkip}`
        : `${API_BASE}/api/doctor/patients/patients?scope=${recordScope}&status=all&q=${q}&take=${recordTake}&skip=${recordSkip}`;

      const data = await fetchJson(url, { apiBase: API_BASE, headers: { ...authHeaders } });
      
      if (isERDoctor) {
        // Map generic patient list to the recordList format
        // Handle both paginated {rows, total} and simple array responses
        const rowsRaw = data.rows || (Array.isArray(data) ? data : []);
        const totalRaw = typeof data.total === 'number' ? data.total : rowsRaw.length;

        const rows = rowsRaw.map(p => ({
          patient: {
            ...p,
            id: p.id,
            firstName: p.first_name || p.firstName,
            lastName: p.last_name || p.lastName,
            contactNumber: p.contact_number || p.contactNumber,
            email: p.email,
            gender: p.gender || p.sex,
            bloodType: p.blood_type || p.bloodType,
            admissionStatus: p.admission_status || p.admissionStatus,
            wardNumber: p.ward_number || p.wardNumber,
            diagnosis: p.diagnosis
          },
          lastVisitAt: p.updated_at || p.created_at
        }));
        setRecordList(rows);
        setRecordsTotal(totalRaw);
      } else {
        setRecordList(data.rows || []);
        setRecordsTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', message: 'Failed to load patient records: ' + err.message });
    } finally {
      setLoadingRecords(false);
    }
  };

  const fetchRecordDetails = async (patientId) => {
    if (!userRole) return;
    setLoadingProfile(true);
    try {
      const [profData, histData] = await Promise.all([
        fetchJson(`/api/doctor/patients/patients/${patientId}/profile`, { apiBase: API_BASE, headers: { ...authHeaders } }),
        fetchJson(`/api/doctor/patients/patients/${patientId}/history`, { apiBase: API_BASE, headers: { ...authHeaders } })
      ]);
      setRecordProfile(profData || null);
        setRecordHistory(histData || null);

        if (profData) {
          const mp = profData?.summary?.clinical_records?.medicalProfile || {};
          setMedicalProfile({
            allergies: profData.patient?.allergies || '',
            pastMedicalHistory: mp.pastMedicalHistory || '',
            familyHistory: mp.familyHistory || '',
            socialHistory: mp.socialHistory || '',
            immunizations: mp.immunizations || ''
          });
        }
      } catch (err) {
      console.error(err);
      setToast({ type: 'error', message: 'Failed to load patient profile.' });
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (!userRole) return;
    if (activeNav === 'patient-records') {
      fetchRecordList();
    }
  }, [activeNav, recordScope, recordQuery, recordSkip, userRole, isERDoctor]);

  useEffect(() => {
    if (activeNav === 'dashboard' && patientQuery.trim()) {
      fetchPatients();
    }
  }, [activeNav, patientQuery]);

  useEffect(() => {
    if (selectedRecord?.patient?.id) {
      fetchRecordDetails(selectedRecord.patient.id);
    } else {
      setRecordProfile(null);
      setRecordHistory(null);
    }
  }, [selectedRecord]);

  const formatDateParam = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const fetchAppointments = async () => {
    if (!userRole) return;
    setLoadingAppointments(true);
    setAppointmentsError('');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startUpcoming = new Date(today);
      startUpcoming.setDate(startUpcoming.getDate() - 7);
      const endUpcoming = new Date(today);
      endUpcoming.setDate(endUpcoming.getDate() + 365);
      const startStr = formatDateParam(startUpcoming);
      const endStr = formatDateParam(endUpcoming);

      const dateStr = formatDateParam(selectedDate);
      const url = queueDateMode === 'date'
        ? `${API_BASE}/api/appointments?date=${dateStr}`
        : `${API_BASE}/api/appointments?start=${startStr}&end=${endStr}`;

      const data = await fetchJson(url, { headers: { ...authHeaders } });
      const rows = Array.isArray(data) ? data : [];
      const filtered = rows.filter((apt) => {
        const mode = String(apt.consultationMode || apt.consultation_mode || '').toLowerCase();
        const aptUuid = String(apt.doctorUuid || apt.doctor_uuid || '').trim();
        const reason = String(apt.reason || '').toLowerCase();
        // Secretary-first onsite booking rule: hide unassigned onsite bookings from doctors.
        // ER triage walk-ins are still visible to ER doctors as an exception.
        if (mode !== 'video' && !aptUuid) {
          if (isERDoctor && reason.includes('[triage]')) return true;
          return false;
        }
        return true;
      });
      setAppointments(filtered);
    } catch (e) {
      setAppointments([]);
      setAppointmentsError(String(e?.message || 'Unable to load appointments.'));
    } finally {
      setLoadingAppointments(false);
    }
  };

  const computeWorklistDates = () => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    if (worklistRange === 'week') {
      const day = (now.getDay() + 6) % 7;
      start.setDate(now.getDate() - day);
      end.setDate(start.getDate() + 6);
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  const fetchWorklist = async () => {
    if (!doctorInboxName) return;
    setWorklistLoading(true);
    setWorklistError('');
    try {
      const { start, end } = computeWorklistDates();
      const startStr = formatDateParam(start);
      const endStr = formatDateParam(end);
      const doctorUuid = String(currentUser?.id || '').trim();

      const [apptJson, approvalsJson] = await Promise.all([
        fetchJson(`/api/appointments?start=${startStr}&end=${endStr}`, { apiBase: API_BASE, headers: { ...authHeaders } }),
        fetchJson(`/api/approval-requests/inbox?role=doctor&doctorId=${encodeURIComponent(doctorUuid)}&name=${encodeURIComponent(doctorInboxName)}&take=50`, { apiBase: API_BASE, headers: { ...authHeaders } })
      ]);

      const target = normalizeAssignee(doctorInboxName || doctorName);
      const allAppts = Array.isArray(apptJson) ? apptJson : [];
      const mineAppts = allAppts.filter((apt) => {
        const st = String(apt.status || '').trim().toLowerCase();
        if (st.includes('cancel') || st.includes('no-show') || st.includes('no show') || st.includes('completed') || st.includes('done')) {
          return false;
        }
        const aptUuid = String(apt.doctorUuid || apt.doctor_uuid || '').trim();
        if (doctorUuid && aptUuid && aptUuid === doctorUuid) return true;

        // Special rule for Medicine/ER doctors: show triage walk-ins
        const reason = String(apt.reason || '').toLowerCase();
        if (isERDoctor && reason.includes('[triage]')) {
          return true;
        }

        return normalizeAssignee(apt.doctor || apt.preferredDoctor) === target;
      }).sort((a, b) => {
        // Sort by triage level (1 is highest priority)
        const lvA = a.triageLevel || a.triage_level || 99;
        const lvB = b.triageLevel || b.triage_level || 99;
        if (lvA !== lvB) return lvA - lvB;
        // Then by time
        return new Date(a.appointment_date || a.appointmentDate || 0) - new Date(b.appointment_date || b.appointmentDate || 0);
      });
      setWorklistAppointments(mineAppts);

      const approvals = Array.isArray(approvalsJson) ? approvalsJson : [];
      setWorklistApprovals(approvals);
    } catch (e) {
      setWorklistAppointments([]);
      setWorklistApprovals([]);
      setWorklistError(String(e?.message || 'Failed to load worklist.'));
    } finally {
      setWorklistLoading(false);
    }
  };

  const fetchPatients = async () => {
    setLoadingPatients(true);
    setPatientsError('');
    try {
      const data = await fetchJson(`/api/patients`, { apiBase: API_BASE, headers: { ...authHeaders } });
      const mapped = (Array.isArray(data) ? data : []).map((p) => ({
        ...p,
        _id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        middleName: p.middle_name,
        contactNumber: p.contact_number,
        dateOfBirth: p.date_of_birth,
        bloodType: p.blood_type,
        philHealthNumber: p.philhealth_number,
        admissionStatus: p.admission_status,
        wardNumber: p.ward_number,
        attendingDoctor: p.attending_doctor,
        admissionDate: p.admission_date,
        diagnosis: p.diagnosis
      }));
      setPatients(mapped);
      return true;
    } catch (e) {
      setPatients([]);
      setPatientsError(String(e?.message || 'Unable to load patients.'));
      return false;
    } finally {
      setLoadingPatients(false);
    }
  };

  const fetchPatientVitalsAndTriage = async (patientId) => {
    if (!patientId) return;
    try {
      if (!supabase) return;

      const { data: vitals, error: vErr } = await supabase
        .from('patient_vitals_logs')
        .select('*')
        .eq('patient_id', String(patientId))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!vErr) setERVitals(vitals);

      const { data: triage, error: tErr } = await supabase
        .from('er_triage_logs')
        .select('*')
        .eq('patient_id', String(patientId))
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tErr) setERTriage(triage);
    } catch (e) {
      console.error('Failed to fetch patient data:', e);
    }
  };

  const defaultAssignedRoleForKind = (kind) => {
    const k = String(kind || '').trim().toLowerCase();
    if (k === 'laboratory') return 'medtech';
    if (k === 'imaging') return 'radiographer';
    if (k === 'procedure') return 'nurse';
    return 'nurse';
  };

  const fetchWards = async () => {
    if (!userRole) return;
    setWardsLoading(true);
    try {
      const json = await fetchJson(`/api/wards`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setWards(Array.isArray(json) ? json : []);
    } catch (_) {
      setWards([]);
    } finally {
      setWardsLoading(false);
    }
  };

  const fetchEROrders = async (patientId) => {
    const pid = String(patientId || '').trim();
    if (!pid) {
      setErOrders([]);
      return;
    }
    setErOrdersLoading(true);
    setErOrdersError('');
    try {
      const params = new URLSearchParams();
      params.set('patientId', pid);
      params.set('take', '200');
      const json = await fetchJson(`/api/clinical-orders?${params.toString()}`, { apiBase: API_BASE, headers: { ...authHeaders } });
      const rows = Array.isArray(json) ? json : [];
      rows.sort((a, b) => {
        const at = a.updatedAt || a.createdAt || null;
        const bt = b.updatedAt || b.createdAt || null;
        const aKey = at ? new Date(at).getTime() : 0;
        const bKey = bt ? new Date(bt).getTime() : 0;
        return bKey - aKey;
      });
      setErOrders(rows);
    } catch (e) {
      setErOrders([]);
      setErOrdersError(String(e?.message || 'Unable to load orders'));
    } finally {
      setErOrdersLoading(false);
    }
  };

  const openBillOut = () => {
    const items = (Array.isArray(erOrders) ? erOrders : [])
      .filter((o) => {
        const st = String(o?.status || '').trim().toLowerCase();
        return st !== 'cancelled' && st !== 'rejected';
      })
      .map((o) => ({
        key: String(o.id || ''),
        orderId: String(o.id || ''),
        include: true,
        description: `${String(o.kind || 'Order')}${o.service ? `: ${String(o.service)}` : ''}`.trim(),
        quantity: 1,
        unitPrice: ''
      }));
    setBillOutItems(items.length ? items : [{ key: 'custom-0', orderId: null, include: true, description: '', quantity: 1, unitPrice: '' }]);
    setBillOutNotes('');
    setBillOutOpen(true);
  };

  const updateBillOutItem = (key, patch) => {
    setBillOutItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const addBillOutItem = () => {
    setBillOutItems((prev) => [...prev, { key: `custom-${Date.now()}`, orderId: null, include: true, description: '', quantity: 1, unitPrice: '' }]);
  };

  const removeBillOutItem = (key) => {
    setBillOutItems((prev) => prev.filter((it) => it.key !== key));
  };

  const submitBillOut = async () => {
    if (!selectedPatient?._id) return;
    setBillOutSaving(true);
    try {
      const items = (Array.isArray(billOutItems) ? billOutItems : [])
        .filter((it) => it && it.include)
        .map((it) => ({
          description: String(it.description || '').trim(),
          quantity: Math.max(1, Math.trunc(Number(it.quantity || 1))),
          unitPrice: Number(it.unitPrice || 0)
        }))
        .filter((it) => it.description);

      if (items.length === 0) throw new Error('Add at least one billable item.');

      const linkedOrderIds = (Array.isArray(billOutItems) ? billOutItems : [])
        .filter((it) => it && it.include && it.orderId)
        .map((it) => String(it.orderId))
        .filter(Boolean);

      const notes = (() => {
        const base = String(billOutNotes || '').trim();
        const link = linkedOrderIds.length ? `Linked clinical orders: ${linkedOrderIds.join(', ')}` : '';
        return [base, link].filter(Boolean).join('\n');
      })();

      await fetchJson(`/api/billing/invoices`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          patientId: selectedPatient._id,
          items,
          notes: notes || null,
          status: 'Ready'
        })
      });

      setToast({ type: 'success', message: 'Bill out sent to cashier.' });
      setBillOutOpen(false);
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to bill out') });
    } finally {
      setBillOutSaving(false);
    }
  };

  const handleOrderSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!selectedPatient?._id || !orderForm.service) return;
    setSavingOrder(true);
    try {
      await fetchJson(`/api/clinical-orders`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          patientId: selectedPatient._id,
          patientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`,
          kind: orderForm.kind,
          service: orderForm.service,
          notes: orderForm.notes,
          priority: orderForm.priority,
          assignedRole: orderForm.assignedRole || defaultAssignedRoleForKind(orderForm.kind),
          assignedTo: null,
          orderedByName: doctorName,
          orderedByRole: 'Doctor'
        })
      });
      setToast({ type: 'success', message: 'Order submitted successfully!' });
      setOrderModalOpen(false);
      setOrderForm({ kind: 'Laboratory', service: '', notes: '', priority: 'Routine', assignedRole: defaultAssignedRoleForKind('Laboratory') });
      fetchEROrders(selectedPatient._id).catch(() => {});
    } catch (err) {
      setToast({ type: 'error', message: String(err?.message || 'Failed to save order') });
    } finally {
      setSavingOrder(false);
    }
  };

  const finalizeERVisit = async () => {
    if (!selectedPatient?._id) return;
    setFinalizingVisit(true);
    try {
      // 1. Save Note if there's content
      if (noteForm.assessment || noteForm.subjective || noteForm.plan) {
        await saveNote();
      }
      
      // 2. Save Prescription if there are items
      const hasPrescription = prescriptionItems.some(it => it.medication.trim() !== '');
      if (hasPrescription) {
        await savePrescription();
      }

      // 3. Update Patient Status based on Disposition
      if (disposition === 'Admit' || disposition === 'Discharge' || disposition === 'Transfer') {
        const wardValue = String(selectedWard || '').trim();
        if (disposition === 'Transfer' && !wardValue) {
          throw new Error('Select a ward/room before transferring.');
        }
        await fetchJson(`/api/patients/${selectedPatient._id}`, {
          apiBase: API_BASE,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            admissionStatus: disposition === 'Admit' ? 'Admitted' : (disposition === 'Transfer' ? 'Transferred' : 'Discharged'),
            wardNumber: (disposition === 'Admit' || disposition === 'Transfer') ? (wardValue || undefined) : undefined,
            attendingDoctor: disposition === 'Admit' ? doctorName : (disposition === 'Transfer' ? doctorName : undefined),
            admissionDate: (disposition === 'Admit' || disposition === 'Transfer') ? new Date().toISOString() : undefined
          })
        });
      }

      setToast({ type: 'success', message: `Visit finalized with disposition: ${disposition}` });
      setSelectedPatient(null);
      setERVitals(null);
      setERTriage(null);
      fetchAppointments();
      fetchPatients();
    } catch (err) {
      console.error('Finalization error:', err);
      setToast({ type: 'error', message: 'Finalization failed: ' + err.message });
    } finally {
      setFinalizingVisit(false);
    }
  };

  useEffect(() => {
    if (selectedPatient?._id) {
      fetchPatientVitalsAndTriage(selectedPatient._id);
      fetchRecordDetails(selectedPatient._id);
      if (isERDoctor) {
        fetchEROrders(selectedPatient._id).catch(() => {});
        fetchWards().catch(() => {});
        setSelectedWard(String(selectedPatient?.wardNumber || selectedPatient?.ward_number || '').trim());
        // Auto-scroll to clinical actions for ER doctors
        setTimeout(() => {
          const el = document.querySelector('.er-clinical-card');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    } else {
      setERVitals(null);
      setERTriage(null);
      setErOrders([]);
      setErOrdersError('');
      setSelectedWard('');
      setRecordProfile(null);
      setRecordHistory(null);
    }
  }, [selectedPatient?._id, isERDoctor]);

  const fetchNotes = async (patientId) => {
    if (!patientId) {
      setNotes([]);
      return;
    }
    try {
      const data = await fetchJson(`/api/doctor-notes?patientId=${patientId}`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setNotes(Array.isArray(data) ? data : []);
    } catch (_) {
      setNotes([]);
    }
  };

  const fetchPrescriptions = async (patientId) => {
    if (!patientId) {
      setPrescriptions([]);
      return;
    }
    try {
      const data = await fetchJson(`/api/prescriptions?patientId=${patientId}`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setPrescriptions(Array.isArray(data) ? data : []);
    } catch (_) {
      setPrescriptions([]);
    }
  };

  const fetchLabResults = async (patientId) => {
    setLabResultsError('');
    if (!patientId) {
      setLabResults([]);
      return;
    }
    try {
      const data = await fetchJson(`/api/lab-results?patientId=${patientId}`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setLabResults(Array.isArray(data) ? data : []);
    } catch (_) {
      setLabResults([]);
      setLabResultsError('Unable to load lab/imaging results.');
    }
  };

  const openLabInterpretation = async (labId) => {
    if (!labId) return;
    setSelectedLabResultId(String(labId));
    setLoadingLabInterpretation(true);
    try {
      const json = await fetchJson(`/api/lab-results/${labId}/interpretation`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setLabInterpretation({ note: String(json?.note || ''), updatedAt: json?.updatedAt || null });
    } catch (e) {
      setLabInterpretation({ note: '', updatedAt: null });
      setToast({ type: 'error', message: String(e?.message || 'Failed to load interpretation.') });
    } finally {
      setLoadingLabInterpretation(false);
    }
  };

  const saveLabInterpretationNote = async () => {
    if (!selectedLabResultId) return;
    setSavingLabInterpretation(true);
    try {
      const json = await fetchJson(`/api/lab-results/${selectedLabResultId}/interpretation`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ note: String(labInterpretation.note || ''), doctorName })
      });
      setLabInterpretation({ note: String(json?.note || ''), updatedAt: json?.updatedAt || null });
      setToast({ type: 'success', message: 'Interpretation saved.' });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to save interpretation.') });
    } finally {
      setSavingLabInterpretation(false);
    }
  };

  const fetchCertificates = async (patientId) => {
    setCertificatesError('');
    if (!patientId) {
      setCertificates([]);
      return;
    }
    try {
      const data = await fetchJson(`/api/medical-certificates?patientId=${patientId}`, { apiBase: API_BASE, headers: { ...authHeaders } });
      setCertificates(Array.isArray(data) ? data : []);
    } catch (_) {
      setCertificates([]);
      setCertificatesError('Unable to load certificates.');
    }
  };

  const fetchApprovalInbox = async () => {
    if (!doctorInboxName) return;
    setApprovalInboxLoading(true);
    setApprovalInboxError('');
    try {
      const name = encodeURIComponent(doctorInboxName);
      const doctorUuid = String(currentUser?.id || '').trim();
      const json = await fetchJson(`/api/approval-requests/inbox?role=doctor&doctorId=${encodeURIComponent(doctorUuid)}&name=${name}&take=50`, {
        apiBase: API_BASE,
        headers: { ...authHeaders }
      });
      setApprovalInbox(Array.isArray(json) ? json : []);
    } catch (e) {
      setApprovalInbox([]);
      setApprovalInboxError(String(e?.message || 'Failed to load approval inbox'));
    } finally {
      setApprovalInboxLoading(false);
    }
  };

  const openApprovalThread = async (requestId) => {
    if (!doctorInboxName || !requestId) return;
    setSelectedApprovalId(String(requestId));
    setApprovalThreadLoading(true);
    try {
      const name = encodeURIComponent(doctorInboxName);
      const json = await fetchJson(`/api/approval-requests/${requestId}/messages?role=doctor&name=${name}`, {
        apiBase: API_BASE,
        headers: { ...authHeaders }
      });
      setApprovalThread(json?.request || null);
      setApprovalMessages(Array.isArray(json?.messages) ? json.messages : []);
      setApprovalReply('');
      fetchApprovalInbox();
    } catch (e) {
      setApprovalThread(null);
      setApprovalMessages([]);
      setToast({ type: 'error', message: String(e?.message || 'Failed to load messages.') });
    } finally {
      setApprovalThreadLoading(false);
    }
  };

  const sendApprovalReply = async () => {
    const id = selectedApprovalId;
    const body = String(approvalReply || '').trim();
    if (!id || !body) return;

    setSendingApprovalReply(true);
    try {
      await fetchJson(`/api/approval-requests/${id}/messages`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ senderRole: 'doctor', senderName: doctorInboxName, body })
      });
      await openApprovalThread(id);
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to send message.') });
    } finally {
      setSendingApprovalReply(false);
    }
  };

  const applyApprovalAction = async (nextStatus) => {
    const id = selectedApprovalId;
    if (!id || !doctorInboxName) return;
    const status = String(nextStatus || '').trim();
    if (status !== 'Approved' && status !== 'Rejected' && status !== 'Suggested') return;

    const note = status === 'Rejected'
      ? String(approvalRejectNote || '').trim()
      : String(approvalSuggest.note || '').trim();

    const suggestedDate = status === 'Suggested' ? String(approvalSuggest.date || '').trim() : '';
    const suggestedTime = status === 'Suggested' ? String(approvalSuggest.time || '').trim() : '';
    if (status === 'Suggested' && (!suggestedDate || !suggestedTime)) {
      setToast({ type: 'error', message: 'Provide suggested date and time.' });
      return;
    }

    setApprovalActionLoading(true);
    try {
      await fetchJson(`/api/approval-requests/${id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          role: 'doctor',
          actor: doctorInboxName,
          status,
          note: note || null,
          suggestedDate: status === 'Suggested' ? suggestedDate : null,
          suggestedTime: status === 'Suggested' ? suggestedTime : null
        })
      });
      setApprovalRejectNote('');
      setApprovalSuggest({ date: '', time: '', note: '' });
      await openApprovalThread(id);
      setToast({ type: 'success', message: `Request ${status.toLowerCase()}.` });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'Failed to update request.' });
    } finally {
      setApprovalActionLoading(false);
    }
  };

  useEffect(() => {
    if (activeNav === 'approval-inbox') fetchApprovalInbox();
  }, [activeNav, doctorInboxName]);

  useEffect(() => {
    if (activeNav !== 'doctor-chat') return;
    loadDoctorChatMessages();
    const specialty = String(doctorChatSpecialty || '').trim();
    if (!supabase || !specialty) return;
    const channel = supabase
      .channel(`consultation:${specialty}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'consultation_messages',
          filter: `specialty=eq.${specialty}`
        },
        (payload) => {
          if (!payload) return;
          const evType = String(payload?.eventType || '').toLowerCase();
          const next = payload?.new || null;
          const old = payload?.old || null;
          if (evType === 'insert') {
            if (!next) return;
            setDoctorChatMessages((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              if (next.id && list.some((m) => String(m?.id || '') === String(next.id))) return list;
              const merged = [...list, next];
              const seen = new Set();
              const deduped = [];
              for (let i = merged.length - 1; i >= 0; i -= 1) {
                const m = merged[i] || {};
                const k = String(m?.id || `${m.created_at}_${m.body}`);
                if (seen.has(k)) continue;
                seen.add(k);
                deduped.unshift(m);
              }
              return deduped;
            });
            setDoctorChatMessages((prev) => {
              const last = Array.isArray(prev) ? prev[prev.length - 1] : null;
              if (!last || isDoctorChatMine(last)) {
                setTimeout(() => scrollDoctorChatToBottom(false), 120);
                return prev;
              }
              setDoctorChatUnreadBadge((n) => n + 1);
              const el = doctorChatScrollRef?.current;
              if (el) {
                const near = el.scrollHeight - el.scrollTop - el.clientHeight;
                if (near < 220) {
                  setTimeout(() => scrollDoctorChatToBottom(false), 120);
                } else {
                  setDoctorChatShowFAB(true);
                  setDoctorChatScrollInterrupt(true);
                }
              }
              return prev;
            });
          } else if (evType === 'update' && next) {
            setDoctorChatMessages((prev) => (Array.isArray(prev) ? prev : []).map((m) => String(m?.id) === String(next?.id || old?.id) ? { ...m, ...next } : m));
          } else if (evType === 'delete' && old) {
            setDoctorChatMessages((prev) => (Array.isArray(prev) ? prev : []).filter((m) => String(m?.id) !== String(old?.id)));
          }
        }
      )
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch (_) {}
    };
  }, [activeNav, doctorChatSpecialty, supabase]);

  useEffect(() => {
    if (activeNav !== 'doctor-chat') return;
    const t = setTimeout(() => scrollDoctorChatToBottom(true), 220);
    return () => clearTimeout(t);
  }, [activeNav, doctorChatFiltered.length, doctorChatLoading]);

  useEffect(() => {
    if (activeNav !== 'doctor-chat') return;
    const el = doctorChatScrollRef?.current;
    if (!el) return undefined;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = near < 150;
      const scrolledUp = el.scrollTop > 350;
      setDoctorChatScrollInterrupt(!nearBottom && scrolledUp);
      setDoctorChatShowFAB(!nearBottom);
      if (nearBottom && doctorChatUnreadBadge) setDoctorChatUnreadBadge(0);
      if (el.scrollTop < 30 && !doctorChatLoadingOlder && !doctorChatOlderExhausted) {
        loadDoctorChatMessages({ older: true });
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeNav, doctorChatLoadingOlder, doctorChatOlderExhausted, doctorChatUnreadBadge]);

  useEffect(() => {
    const onClickOutside = () => setDoctorChatMsgMenu(null);
    window.addEventListener('click', onClickOutside);
    return () => window.removeEventListener('click', onClickOutside);
  }, []);

  useEffect(() => {
    if (activeNav === 'worklist') fetchWorklist();
  }, [activeNav, worklistRange, doctorInboxName]);

  useEffect(() => {
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem('currentUser'));
    } catch {}
    if (!parsed) {
      navigate('/login');
      return;
    }
    setCurrentUser(parsed);
    setProfileForm({
      firstName: parsed.firstName || parsed.first_name || '',
      lastName: parsed.lastName || parsed.last_name || '',
      specialization: parsed.specialization || '',
      email: parsed.email || '',
      contactNumber: parsed.contactNumber || parsed.contact_number || '',
      profilePicture: parsed.profilePicture || parsed.profile_picture || parsed.avatar_url || '',
      newPassword: '',
      confirmPassword: ''
    });
  }, [navigate]);

  useEffect(() => {
    const handler = () => {
      setPrintTarget(null);
      setPrintCertificateTarget(null);
    };
    window.addEventListener('afterprint', handler);
    return () => window.removeEventListener('afterprint', handler);
  }, []);

  useEffect(() => {
    if (!userRole) return;
    fetchPatients();
    fetchAppointments();
  }, [selectedDate, queueDateMode, userRole]);

  useEffect(() => {
    if (isERDoctor) return;
    if (queueFilter === 'video' && queueScope !== 'specialization') {
      setQueueScope('specialization');
    }
  }, [queueFilter, queueScope, isERDoctor]);

  useEffect(() => {
    if (!userRole) return;
    const t = setInterval(() => {
      fetchPatients();
      fetchAppointments();
      if (activeNav === 'patient-records') fetchRecordList();
      if (activeNav === 'labs' && selectedPatient?._id) fetchLabResults(selectedPatient._id);
      if (activeNav === 'certificates' && selectedPatient?._id) fetchCertificates(selectedPatient._id);
    }, 20000);
    return () => clearInterval(t);
  }, [activeNav, selectedPatient?._id, selectedDate, queueDateMode, userRole, patientQuery, recordScope, recordQuery]);

  useEffect(() => {
    const pid = selectedPatient?._id;
    fetchNotes(pid);
    fetchPrescriptions(pid);
    fetchLabResults(pid);
    fetchCertificates(pid);
    setSelectedLabResultId(null);
    setLabInterpretation({ note: '', updatedAt: null });
    try {
      if (rxDraftKey) {
        const raw = localStorage.getItem(rxDraftKey);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          if (items.length > 0) setPrescriptionItems(items);
          if (parsed.meta && typeof parsed.meta === 'object') setPrescriptionMeta({ diagnosis: parsed.meta.diagnosis || '', instructions: parsed.meta.instructions || '' });
          const nextFulfillment = String(parsed.pharmacySource || '').trim().toLowerCase() || (parsed.isSentToPharmacy ? 'hospital' : 'not_sent');
          setPrescriptionFulfillment(nextFulfillment);
          setIsSentToPharmacy(nextFulfillment === 'hospital' || Boolean(parsed.isSentToPharmacy));
          setRxDraftUpdatedAt(parsed.updatedAt || null);
        } else {
          setRxDraftUpdatedAt(null);
        }
      } else {
        setRxDraftUpdatedAt(null);
      }
      setSelectedRxTemplate('');
    } catch {
      setRxDraftUpdatedAt(null);
    }
  }, [selectedPatient?._id, rxDraftKey]);

  const filteredPatientResults = useMemo(() => {
    const q = String(patientQuery || '').trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter((p) => {
        const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim().toLowerCase();
        const email = (p.email || '').toLowerCase();
        const contact = (p.contactNumber || '').toString().toLowerCase();
        return fullName.includes(q) || email.includes(q) || contact.includes(q);
      })
      .slice(0, 8);
  }, [patientQuery, patients]);

  const saveProfile = async () => {
    if (profileForm.newPassword || profileForm.confirmPassword) {
      if (profileForm.newPassword !== profileForm.confirmPassword) {
        setToast({ type: 'error', message: 'Passwords do not match.' });
        return;
      }
      if (profileForm.newPassword.length < 6) {
        setToast({ type: 'error', message: 'Password must be at least 6 characters.' });
        return;
      }
    }

    setSavingProfile(true);
    try {
      let profilePictureUrl = profileForm.profilePicture;

      if (profileImage) {
        const formData = new FormData();
        formData.append('avatar', profileImage);
        formData.append('id', currentUser.id);
        formData.append('accountType', 'doctor');

        const uploadData = await fetchJson(`/api/staff/avatar`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: { ...authHeaders },
          body: formData
        });
        if (!uploadData?.avatarUrl) throw new Error('Failed to upload image');
        profilePictureUrl = uploadData.avatarUrl;
      }

      const payload = {
        ...profileForm,
        profilePicture: profilePictureUrl,
        id: currentUser.id
      };

      await fetchJson(`/api/doctor/profile/update`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload)
      });

      const updatedUser = { ...currentUser, ...payload };
      delete updatedUser.newPassword;
      delete updatedUser.confirmPassword;
      setCurrentUser(updatedUser);
      localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      setToast({ type: 'success', message: 'Profile updated successfully.' });
      setProfileImage(null);
      setProfilePreview(null);
      setProfileForm(prev => ({ ...prev, newPassword: '', confirmPassword: '' }));
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', message: 'An error occurred while saving profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfileImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogout = async () => {
    try {
      const session = JSON.parse(localStorage.getItem('currentUser'));
      if (session?.id && session?.accountType) {
        fetch(`${API_BASE}/api/staff/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ id: session.id, accountType: session.accountType })
        }).catch(() => {});
      }
    } catch {}
    localStorage.removeItem('currentUser');
    localStorage.removeItem('tempLoginEmail');
    localStorage.removeItem('tempLoginRole');
    localStorage.removeItem('generatedOTP');
    navigate('/login');
  };

  const saveMedicalProfile = async () => {
    if (!selectedPatient?._id) return;
    setSavingMedicalProfile(true);
    try {
      const existingRaw = recordProfile?.summary?.clinical_records || {};
      const updatedRecords = {
        ...existingRaw,
        medicalProfile: {
          pastMedicalHistory: medicalProfile.pastMedicalHistory,
          familyHistory: medicalProfile.familyHistory,
          socialHistory: medicalProfile.socialHistory,
          immunizations: medicalProfile.immunizations
        }
      };

      const res = await fetchJson(`/api/patients/${selectedPatient._id}`, {
        apiBase: API_BASE,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          allergies: medicalProfile.allergies,
          clinicalRecords: updatedRecords
        })
      });
      if (res) {
        setToast({ type: 'success', message: 'Medical Profile saved successfully.' });
        setRecordProfile(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            patient: { ...prev.patient, allergies: medicalProfile.allergies },
            summary: { ...prev.summary, clinical_records: updatedRecords }
          };
        });
      }
    } catch (e) {
      console.error(e);
      setToast({ type: 'error', message: 'Failed to save Medical Profile.' });
    } finally {
      setSavingMedicalProfile(false);
    }
  };

  const saveNote = async (e) => {
    if (!selectedPatient?._id) return;
    if (!userRole) {
      setToast({ type: 'error', message: 'Session missing. Please login again.' });
      return;
    }
    setSavingNote(true);
    const payload = {
      patientId: selectedPatient._id,
      doctorName,
      subjective: noteForm.subjective,
      objective: noteForm.objective,
      assessment: noteForm.assessment,
      plan: noteForm.plan,
      vitals: {
        bp: noteForm.bp,
        hr: noteForm.hr,
        temp: noteForm.temp,
        weight: noteForm.weight,
        height: noteForm.height,
        o2: noteForm.o2,
      },
      specialization: currentUser?.specialization || 'General',
      vaccinationHistory: noteForm.vaccinationHistory,
      heartRateRhythm: noteForm.heartRateRhythm,
      ecgNotes: noteForm.ecgNotes,
      lesionType: noteForm.lesionType,
      affectedArea: noteForm.affectedArea
    };
    try {
      await fetchJson(`/api/doctor-notes`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload)
      });
      setNoteForm({ 
        subjective: '', objective: '', assessment: '', plan: '', 
        bp: '', hr: '', temp: '', weight: '', height: '', o2: '',
        vaccinationHistory: '', heartRateRhythm: '', ecgNotes: '', lesionType: '', affectedArea: '' 
      });
      await fetchNotes(selectedPatient._id);
      setToast({ type: 'success', message: 'Note saved.' });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to save note.') });
    } finally {
      setSavingNote(false);
    }
  };

  const addPrescriptionItem = () => {
    setPrescriptionItems((items) => [...items, { medication: '', dosage: '', frequency: '', duration: '', notes: '' }]);
  };

  const removePrescriptionItem = (idx) => {
    setPrescriptionItems((items) => items.filter((_, i) => i !== idx));
  };

  const updatePrescriptionItem = (idx, key, value) => {
    setPrescriptionItems((items) => items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  };

  const applySelectedRxTemplate = () => {
    const id = String(selectedRxTemplate || '').trim();
    if (!id) return;
    const tpl = rxTemplates.find((t) => t.id === id);
    if (!tpl) return;
    setPrescriptionMeta({ diagnosis: tpl.meta?.diagnosis || '', instructions: tpl.meta?.instructions || '' });
    setPrescriptionItems(Array.isArray(tpl.items) && tpl.items.length > 0 ? tpl.items : [{ medication: '', dosage: '', frequency: '', duration: '', notes: '' }]);
    setPrescriptionFulfillment('not_sent');
    setIsSentToPharmacy(false);
    setToast({ type: 'success', message: 'Template applied.' });
  };

  const saveRxDraft = () => {
    if (!rxDraftKey) return;
    const payload = {
      meta: { ...prescriptionMeta },
      items: Array.isArray(prescriptionItems) ? prescriptionItems : [],
      pharmacySource: prescriptionFulfillment,
      isSentToPharmacy: Boolean(isSentToPharmacy),
      updatedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(rxDraftKey, JSON.stringify(payload));
      setRxDraftUpdatedAt(payload.updatedAt);
      setToast({ type: 'success', message: 'Draft saved.' });
    } catch {
      setToast({ type: 'error', message: 'Failed to save draft.' });
    }
  };

  const clearRxDraft = () => {
    if (!rxDraftKey) return;
    try {
      localStorage.removeItem(rxDraftKey);
      setRxDraftUpdatedAt(null);
      setToast({ type: 'success', message: 'Draft cleared.' });
    } catch {
      setToast({ type: 'error', message: 'Failed to clear draft.' });
    }
  };

  const savePrescription = async () => {
    if (!selectedPatient?._id) return;
    if (!userRole) {
      setToast({ type: 'error', message: 'Session missing. Please login again.' });
      return;
    }
    const cleanItems = prescriptionItems
      .map((it) => ({
        medication: String(it.medication || '').trim(),
        dosage: String(it.dosage || '').trim(),
        frequency: String(it.frequency || '').trim(),
        duration: String(it.duration || '').trim(),
        notes: String(it.notes || '').trim()
      }))
      .filter((it) => it.medication);

    if (cleanItems.length === 0) return;

    setSavingPrescription(true);
    const payload = {
      patientId: selectedPatient._id,
      doctorName,
      diagnosis: String(prescriptionMeta.diagnosis || '').trim(),
      instructions: String(prescriptionMeta.instructions || '').trim(),
      items: cleanItems,
      isSentToPharmacy,
      pharmacySource: prescriptionFulfillment,
      pharmacyStatus: prescriptionFulfillment === 'hospital' ? 'Pending' : prescriptionFulfillment === 'external' ? 'Bought Outside' : 'Not Sent',
      externalPurchaseAllowed: prescriptionFulfillment === 'external'
    };

    try {
      await fetchJson(`/api/prescriptions`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload)
      });
      const wasSent = isSentToPharmacy;
      const usedExternal = prescriptionFulfillment === 'external';
      setPrescriptionItems([{ medication: '', dosage: '', frequency: '', duration: '', notes: '' }]);
      setPrescriptionMeta({ diagnosis: '', instructions: '' });
      setIsSentToPharmacy(false);
      setPrescriptionFulfillment('not_sent');
      clearRxDraft();
      await fetchPrescriptions(selectedPatient._id);
      setToast({ type: 'success', message: wasSent ? 'Prescription saved and sent to Pharmacy.' : usedExternal ? 'Prescription saved for outside purchase.' : 'Prescription saved.' });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to save prescription.') });
    } finally {
      setSavingPrescription(false);
    }
  };

  const printPrescription = (p) => {
    if (!p) return;
    setPrintTarget(p);
    setTimeout(() => window.print(), 50);
  };

  const copyToCurrentPrescription = (pastPrescription) => {
    if (!pastPrescription || !pastPrescription.items) return;
    const items = Array.isArray(pastPrescription.items) ? pastPrescription.items : [];
    if (items.length === 0) return;

    const currentClean = prescriptionItems.filter(it => it.medication.trim() !== '');
    const newItems = [...currentClean, ...items.map(it => ({
      medication: it.medication || '',
      dosage: it.dosage || '',
      frequency: it.frequency || '',
      duration: it.duration || '',
      notes: it.notes || ''
    }))];

    setPrescriptionItems(newItems.length > 0 ? newItems : [{ medication: '', dosage: '', frequency: '', duration: '', notes: '' }]);
    if (!prescriptionMeta.diagnosis) setPrescriptionMeta(v => ({ ...v, diagnosis: pastPrescription.diagnosis || '' }));
    if (!prescriptionMeta.instructions) setPrescriptionMeta(v => ({ ...v, instructions: pastPrescription.instructions || '' }));
    setActiveNav('dashboard');
    setTimeout(() => {
      const el = document.getElementById('doc-sec-prescriptions');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const saveLabResult = async () => {
    if (!selectedPatient?._id) return;
    const title = String(labForm.title || '').trim();
    const typedUrl = String(labForm.url || '').trim();
    if (!userRole) {
      setToast({ type: 'error', message: 'Session missing. Please login again.' });
      return;
    }
    if (!title) {
      setToast({ type: 'error', message: 'Title is required.' });
      return;
    }
    if (!labFile && !typedUrl) {
      setToast({ type: 'error', message: 'Upload a file or provide a URL.' });
      return;
    }

    setSavingLab(true);
    try {
      let url = typedUrl;
      if (labFile) {
        const fd = new FormData();
        fd.append('file', labFile);
        fd.append('patientId', selectedPatient._id);
        const upData = await fetchJson(`/api/lab-results/upload`, {
          apiBase: API_BASE,
          method: 'POST',
          headers: { ...authHeaders },
          body: fd
        });
        url = String(upData?.url || '').trim();
        if (!url) {
          setToast({ type: 'error', message: 'Upload failed.' });
          return;
        }
      }

      const data = await fetchJson(`/api/lab-results`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          patientId: selectedPatient._id,
          type: labForm.type,
          title,
          url,
          resultDate: labForm.resultDate || null,
          uploadedBy: doctorName
        })
      });
      const st = String(data?.verificationStatus || data?.verification_status || '').trim().toLowerCase();
      setLabForm({ type: 'Lab', title: '', url: '', resultDate: '' });
      setLabFile(null);
      await fetchLabResults(selectedPatient._id);
      setToast({
        type: st === 'rejected' ? 'error' : 'success',
        message:
          st === 'verified'
            ? 'Result added and verified.'
            : st === 'rejected'
              ? 'Result added but rejected as invalid. Check Notifications for details.'
              : st === 'flagged'
                ? 'Result added but flagged for review. Check Notifications for details.'
                : 'Result added. Verification is pending. Check Notifications for updates.'
      });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to add result.') });
    } finally {
      setSavingLab(false);
    }
  };

  const saveCertificate = async () => {
    if (!selectedPatient?._id) return;
    const purpose = String(certForm.purpose || '').trim();
    if (!userRole) {
      setToast({ type: 'error', message: 'Session missing. Please login again.' });
      return;
    }
    if (!purpose) {
      setToast({ type: 'error', message: 'Purpose is required.' });
      return;
    }

    setSavingCert(true);
    try {
      await fetchJson(`/api/medical-certificates`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          patientId: selectedPatient._id,
          doctorName,
          purpose,
          diagnosis: certForm.diagnosis || null,
          recommendations: certForm.recommendations || null,
          validUntil: certForm.validUntil || null
        })
      });
      setCertForm({ purpose: '', diagnosis: '', recommendations: '', validUntil: '' });
      await fetchCertificates(selectedPatient._id);
      setToast({ type: 'success', message: 'Certificate created.' });
    } catch (e) {
      setToast({ type: 'error', message: String(e?.message || 'Failed to create certificate.') });
    } finally {
      setSavingCert(false);
    }
  };

  const printCertificate = (c) => {
    if (!c) return;
    setPrintCertificateTarget(c);
    setTimeout(() => window.print(), 50);
  };

  const printFullPatientRecord = () => {
    if (!selectedPatient) return;
    
    // Create a printable content
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setToast({ type: 'error', message: 'Popup blocked. Allow popups to print.' });
      return;
    }
    const patient = selectedPatient;
    const patientName = `${patient.firstName} ${patient.lastName}`;
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Patient Record - ${patientName}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
            .header { border-bottom: 2px solid #ea580c; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
            .hospital-name { font-size: 24px; font-weight: 800; color: #ea580c; }
            .record-title { font-size: 18px; font-weight: 600; color: #64748b; }
            .patient-info { display: grid; grid-template-columns: 150px 1fr; gap: 30px; margin-bottom: 40px; background: #f8fafc; padding: 20px; border-radius: 12px; }
            .patient-photo { width: 150px; height: 150px; border-radius: 12px; object-fit: cover; border: 3px solid white; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
            .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
            .info-item { margin-bottom: 10px; }
            .info-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 700; }
            .info-value { font-size: 16px; font-weight: 600; color: #0f172a; }
            .section { margin-bottom: 30px; }
            .section-title { font-size: 18px; font-weight: 800; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px; color: #0f172a; }
            .note-item { border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 15px; page-break-inside: avoid; }
            .note-header { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 13px; font-weight: 700; color: #64748b; }
            .vitals-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 10px; background: #f1f5f9; padding: 10px; border-radius: 6px; }
            .vital-item { text-align: center; }
            .vital-label { font-size: 10px; color: #64748b; }
            .vital-value { font-size: 13px; font-weight: 700; }
            .note-body { font-size: 14px; white-space: pre-wrap; }
            .prescription-item { border-left: 3px solid #ea580c; padding-left: 15px; margin-bottom: 15px; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="hospital-name">Pascual General Hospital</div>
              <div class="record-title">Official Patient Medical Record</div>
            </div>
            <button class="no-print" onclick="window.print()" style="background: #ea580c; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 700;">Print Record</button>
          </div>

          <div class="patient-info">
            <img class="patient-photo" src="${patient.avatar_url || patient.avatarUrl || 'https://via.placeholder.com/150'}" alt="Patient Photo" onerror="this.src='https://via.placeholder.com/150'">
            <div class="info-grid">
              <div class="info-item"><div class="info-label">Full Name</div><div class="info-value">${patientName}</div></div>
              <div class="info-item"><div class="info-label">Patient ID</div><div class="info-value">${patient.id || patient._id}</div></div>
              <div class="info-item"><div class="info-label">Gender</div><div class="info-value">${patient.gender || '—'}</div></div>
              <div class="info-item"><div class="info-label">Blood Type</div><div class="info-value">${patient.bloodType || '—'}</div></div>
              <div class="info-item"><div class="info-label">Date of Birth</div><div class="info-value">${patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : '—'}</div></div>
              <div class="info-item"><div class="info-label">Contact</div><div class="info-value">${patient.contact_number || patient.phone || '—'}</div></div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Medical History & Notes</div>
            ${notes.length === 0 ? '<p>No medical notes found.</p>' : notes.map(n => `
              <div class="note-item">
                <div class="note-header">
                  <span>Dr. ${n.doctorName}</span>
                  <span>${new Date(n.created_at || n.createdAt).toLocaleString()}</span>
                </div>
                <div class="vitals-grid">
                  <div class="vital-item"><div class="vital-label">BP</div><div class="vital-value">${n.bp || '—'}</div></div>
                  <div class="vital-item"><div class="vital-label">HR</div><div class="vital-value">${n.hr || '—'}</div></div>
                  <div class="vital-item"><div class="vital-label">TEMP</div><div class="vital-value">${n.temp || '—'}</div></div>
                  <div class="vital-item"><div class="vital-label">WT</div><div class="vital-value">${n.weight || '—'}</div></div>
                  <div class="vital-item"><div class="vital-label">HT</div><div class="vital-value">${n.height || '—'}</div></div>
                  <div class="vital-item"><div class="vital-label">O2</div><div class="vital-value">${n.o2 || '—'}</div></div>
                </div>
                <div class="note-body"><strong>Assessment:</strong> ${n.assessment || '—'}</div>
                <div class="note-body" style="margin-top: 5px;"><strong>Plan:</strong> ${n.plan || '—'}</div>
              </div>
            `).join('')}
          </div>

          <div class="section">
            <div class="section-title">Recent Prescriptions</div>
            ${prescriptions.length === 0 ? '<p>No prescriptions found.</p>' : prescriptions.map(p => `
              <div class="prescription-item">
                <div class="note-header">
                  <span>Dr. ${p.doctorName}</span>
                  <span>${new Date(p.created_at || p.createdAt).toLocaleString()}</span>
                </div>
                <div class="note-body"><strong>Diagnosis:</strong> ${p.diagnosis || '—'}</div>
                <div style="margin-top: 10px; font-size: 13px;">
                  ${Array.isArray(p.items) ? p.items.map(it => `
                    <div style="margin-bottom: 5px;">• ${it.medication} - ${it.dosage} (${it.frequency}) for ${it.duration}</div>
                  `).join('') : '—'}
                </div>
              </div>
            `).join('')}
          </div>

          <div style="margin-top: 50px; font-size: 10px; color: #94a3b8; text-align: center;">
            This is a system-generated medical record from Pascual General Hospital. Generated on ${new Date().toLocaleString()}.
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const statusClass = (s) => {
    const v = String(s || '').toLowerCase();
    if (v.includes('waiting')) return 'doc-badge badge-purple';
    if (v.includes('checked')) return 'doc-badge badge-purple';
    if (v.includes('confirmed')) return 'doc-badge badge-blue';
    if (v.includes('consult')) return 'doc-badge badge-blue';
    if (v.includes('completed') || v.includes('done')) return 'doc-badge badge-green';
    if (v.includes('no-show') || v.includes('no show')) return 'doc-badge badge-red';
    if (v.includes('cancel')) return 'doc-badge badge-red';
    return 'doc-badge badge-orange';
  };

  const goSection = (key, id) => {
    setActiveNav(key);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const orderModal = orderModalOpen && (
    <div className="doc-modal-overlay" onClick={() => setOrderModalOpen(false)}>
      <div className="doc-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="doc-modal-header">
          <div className="doc-modal-title">Clinical Order</div>
          <button type="button" className="doc-icon-btn" onClick={() => setOrderModalOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleOrderSubmit} className="doc-form" style={{ marginTop: '16px' }}>
          <div className="doc-form-group">
            <label>Order Type</label>
            <select 
              className="doc-select" 
              value={orderForm.kind} 
              onChange={(e) => {
                const kind = e.target.value;
                setOrderForm(v => ({ ...v, kind, assignedRole: defaultAssignedRoleForKind(kind) }));
              }}
            >
              <option value="Laboratory">Laboratory</option>
              <option value="Imaging">Imaging</option>
              <option value="Procedure">Procedure</option>
            </select>
          </div>
          <div className="doc-form-group">
            <label>Assigned To</label>
            <select
              className="doc-select"
              value={orderForm.assignedRole}
              onChange={(e) => setOrderForm(v => ({ ...v, assignedRole: e.target.value }))}
            >
              <option value="nurse">Nurse</option>
              <option value="medtech">Medtech</option>
              <option value="radiographer">Radiographer</option>
              <option value="ecg_operator">ECG Operator</option>
              <option value="physical_therapist">Physical Therapist</option>
              <option value="pharmacist">Pharmacist</option>
            </select>
          </div>
          <div className="doc-form-group">
            <label>Service / Test Name</label>
            <input 
              className="doc-input" 
              placeholder="e.g. CBC, Chest X-ray" 
              value={orderForm.service} 
              onChange={(e) => setOrderForm(v => ({ ...v, service: e.target.value }))}
              required
            />
          </div>
          <div className="doc-form-group">
            <label>Priority</label>
            <select 
              className="doc-select" 
              value={orderForm.priority} 
              onChange={(e) => setOrderForm(v => ({ ...v, priority: e.target.value }))}
            >
              <option value="Routine">Routine</option>
              <option value="Urgent">Urgent</option>
              <option value="STAT">STAT (Emergency)</option>
            </select>
          </div>
          <div className="doc-form-group">
            <label>Notes / Indications</label>
            <textarea 
              className="doc-textarea" 
              placeholder="Reason for order..." 
              value={orderForm.notes} 
              onChange={(e) => setOrderForm(v => ({ ...v, notes: e.target.value }))}
            />
          </div>
          <div className="doc-modal-actions" style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
            <button type="button" className="doc-btn" style={{ flex: 1 }} onClick={() => setOrderModalOpen(false)}>Cancel</button>
            <button type="submit" className="doc-primary" style={{ flex: 1 }} disabled={savingOrder}>
              {savingOrder ? 'Submitting...' : 'Submit Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const billOutModal = billOutOpen && (
    <div className="doc-modal-overlay" onClick={() => setBillOutOpen(false)}>
      <div className="doc-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '780px' }}>
        <div className="doc-modal-header">
          <div className="doc-modal-title">Bill Out to Cashier</div>
          <button type="button" className="doc-icon-btn" onClick={() => setBillOutOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="doc-form" style={{ marginTop: '16px' }}>
          <div className="doc-form-group">
            <label>Patient</label>
            <div style={{ fontWeight: 800, color: '#0f172a' }}>
              {selectedPatient ? `${selectedPatient.firstName || ''} ${selectedPatient.lastName || ''}`.trim() : '—'}
            </div>
          </div>

          <div className="doc-form-group">
            <label>Billable Items</label>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px 120px 90px', gap: 0, background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '10px 12px', fontWeight: 800, fontSize: '0.85rem', color: '#334155' }}>
                <div>On</div>
                <div>Description</div>
                <div style={{ textAlign: 'right' }}>Qty</div>
                <div style={{ textAlign: 'right' }}>Unit Price</div>
                <div style={{ textAlign: 'right' }}>Action</div>
              </div>
              {(Array.isArray(billOutItems) ? billOutItems : []).map((it) => (
                <div key={it.key} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px 120px 90px', gap: 0, padding: '10px 12px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(it.include)}
                    onChange={(e) => updateBillOutItem(it.key, { include: e.target.checked })}
                  />
                  <input
                    className="doc-input"
                    value={String(it.description || '')}
                    placeholder="e.g. Laboratory: CBC"
                    onChange={(e) => updateBillOutItem(it.key, { description: e.target.value })}
                  />
                  <input
                    className="doc-input"
                    style={{ textAlign: 'right' }}
                    type="number"
                    min="1"
                    value={String(it.quantity || 1)}
                    onChange={(e) => updateBillOutItem(it.key, { quantity: e.target.value })}
                  />
                  <input
                    className="doc-input"
                    style={{ textAlign: 'right' }}
                    type="number"
                    min="0"
                    step="0.01"
                    value={String(it.unitPrice ?? '')}
                    onChange={(e) => updateBillOutItem(it.key, { unitPrice: e.target.value })}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="doc-btn" onClick={() => removeBillOutItem(it.key)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="doc-btn" onClick={addBillOutItem}>
                  Add Item
                </button>
              </div>
            </div>
          </div>

          <div className="doc-form-group">
            <label>Notes</label>
            <textarea
              className="doc-textarea"
              placeholder="Optional notes for cashier..."
              value={billOutNotes}
              onChange={(e) => setBillOutNotes(e.target.value)}
            />
          </div>

          <div className="doc-modal-actions" style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
            <button type="button" className="doc-btn" style={{ flex: 1 }} onClick={() => setBillOutOpen(false)} disabled={billOutSaving}>
              Cancel
            </button>
            <button type="button" className="doc-primary" style={{ flex: 1 }} onClick={submitBillOut} disabled={billOutSaving}>
              {billOutSaving ? 'Sending...' : 'Send to Cashier'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const erClinicalActions = isERDoctor && selectedPatient && (
    <div className="doc-card er-clinical-card">
      <div className="doc-card-header" style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
        <div className="doc-card-title" style={{ color: '#0f172a' }}>
          <Activity size={18} />
          ER Triage & Clinical Actions
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            type="button" 
            className="doc-icon-btn" 
            onClick={() => fetchPatientVitalsAndTriage(selectedPatient._id)}
            title="Refresh Vitals/Triage"
          >
            <RotateCw size={14} />
          </button>
          {erTriage && (
            <div className={`doc-badge triage-level-${erTriage.triage_level}`} style={{ 
              background: erTriage.triage_level === 1 ? '#fee2e2' : erTriage.triage_level === 2 ? '#ffedd5' : '#f0f9ff',
              color: erTriage.triage_level === 1 ? '#991b1b' : erTriage.triage_level === 2 ? '#9a3412' : '#075985',
              fontWeight: 800,
              border: '1px solid currentColor'
            }}>
              LEVEL {erTriage.triage_level}: {erTriage.priority_label}
            </div>
          )}
        </div>
      </div>
      
      <div className="er-clinical-content" style={{ padding: '16px' }}>
        {/* Triage Summary */}
        {erTriage && (
          <div className="er-section" style={{ marginBottom: '20px' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} /> AI TRIAGE ANALYSIS
            </h4>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>Main Concern: {erTriage.main_concern}</div>
              <div style={{ fontSize: '0.85rem', color: '#475569', lineHeight: '1.4' }}>
                <strong>Reasoning:</strong> {(() => {
                  try {
                    const reasons = typeof erTriage.reasons === 'string' ? JSON.parse(erTriage.reasons) : erTriage.reasons;
                    return Array.isArray(reasons) ? reasons.join('. ') : String(reasons || 'N/A');
                  } catch (e) { return String(erTriage.reasons || 'N/A'); }
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ER Vitals */}
        {erVitals && (
          <div className="er-section" style={{ marginBottom: '20px' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HeartPulse size={14} /> INITIAL ER VITALS
            </h4>
            <div className="er-vitals-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '10px' }}>
              <div className={`er-vital-box ${Number(erVitals.spo2) < 95 ? 'critical' : ''}`}>
                <div className="label"><Wind size={12} /> SpO2</div>
                <div className="value">{erVitals.spo2 || '—'}%</div>
              </div>
              <div className={`er-vital-box ${(Number(erVitals.temp) > 37.8 || Number(erVitals.temp) < 35.5) ? 'critical' : ''}`}>
                <div className="label"><Thermometer size={12} /> TEMP</div>
                <div className="value">{erVitals.temp || '—'}°C</div>
              </div>
              <div className={`er-vital-box ${(Number(erVitals.hr) > 100 || Number(erVitals.hr) < 60) ? 'critical' : ''}`}>
                <div className="label"><Activity size={12} /> HR</div>
                <div className="value">{erVitals.hr || '—'} bpm</div>
              </div>
              <div className="er-vital-box">
                <div className="label"><Droplets size={12} /> BP</div>
                <div className="value" style={{ fontSize: '0.95rem' }}>{erVitals.bp || '—'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Clinical Actions */}
        <div className="er-section">
          <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Stethoscope size={14} /> INTERVENTIONS
          </h4>
          <div className="er-actions-buttons" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button 
              className="doc-btn er-action-btn" 
              onClick={() => {
                const el = document.getElementById('doc-sec-notes');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <FileText size={16} /> Write SOAP Note
            </button>
            <button 
              className="doc-btn er-action-btn" 
              onClick={() => setOrderModalOpen(true)}
            >
              <BriefcaseMedical size={16} /> Order Lab/Imaging
            </button>
            <button 
              className="doc-btn er-action-btn" 
              onClick={() => {
                const el = document.getElementById('doc-sec-prescriptions');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <ClipboardCheck size={16} /> Issue Prescription
            </button>
            <button
              className="doc-btn er-action-btn"
              onClick={openBillOut}
              disabled={erOrdersLoading}
            >
              <ClipboardCheck size={16} /> Bill Out to Cashier
            </button>
          </div>
        </div>

        <div className="er-section" style={{ marginTop: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', margin: 0 }}>ORDERS</h4>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="doc-icon-btn"
                onClick={() => fetchEROrders(selectedPatient._id)}
                title="Refresh Orders"
              >
                <RotateCw size={14} />
              </button>
            </div>
          </div>

          {erOrdersLoading ? (
            <div style={{ color: '#64748b', fontWeight: 600 }}>Loading orders…</div>
          ) : erOrdersError ? (
            <div style={{ color: '#b91c1c', fontWeight: 700 }}>{erOrdersError}</div>
          ) : (Array.isArray(erOrders) ? erOrders : []).length === 0 ? (
            <div style={{ color: '#64748b' }}>No clinical orders yet.</div>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              {(Array.isArray(erOrders) ? erOrders : []).slice(0, 8).map((o) => {
                const when = o.updatedAt || o.createdAt || null;
                const whenText = when ? new Date(when).toLocaleString() : '—';
                const st = String(o.status || 'Pending');
                const isStat = String(o.priority || '').toUpperCase() === 'STAT';
                const stLow = st.toLowerCase();
                const badgeBg =
                  stLow.includes('completed') ? '#dcfce7' :
                  stLow.includes('progress') ? '#e0f2fe' :
                  stLow.includes('cancel') || stLow.includes('reject') ? '#fee2e2' :
                  '#ffedd5';
                const badgeFg =
                  stLow.includes('completed') ? '#166534' :
                  stLow.includes('progress') ? '#075985' :
                  stLow.includes('cancel') || stLow.includes('reject') ? '#991b1b' :
                  '#9a3412';
                return (
                  <div key={String(o.id)} style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', gap: '12px', background: isStat ? '#fef2f2' : 'transparent' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isStat && <span style={{ padding: '2px 6px', background: '#ef4444', color: 'white', borderRadius: 4, fontSize: '0.7rem' }}>STAT</span>}
                        <span>{String(o.kind || 'Order')}{o.service ? `: ${String(o.service)}` : ''}</span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                        {whenText}{o.assignedRole ? ` • Assigned: ${String(o.assignedRole)}` : ''}{o.orderedByName ? ` • Ordered by: ${String(o.orderedByName)}` : ''}
                      </div>
                      {o.acknowledgedAt && (
                        <div style={{ fontSize: '0.82rem', color: '#16a34a', fontWeight: 700, marginTop: 4 }}>
                          <CheckCircle size={12} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> Acknowledged by {o.acknowledgedBy || 'Nurse'}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
                      <span style={{ padding: '6px 10px', borderRadius: 999, background: badgeBg, color: badgeFg, fontWeight: 900, fontSize: '0.75rem', border: `1px solid ${badgeFg}` }}>
                        {st}
                      </span>
                    </div>
                  </div>
                );
              })}
              {(Array.isArray(erOrders) ? erOrders : []).length > 8 && (
                <div style={{ padding: '10px 12px', color: '#64748b', fontWeight: 700 }}>
                  Showing latest 8 orders. Use Bill Out to include all.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Disposition */}
        <div className="er-section" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '2px solid #f1f5f9' }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', marginBottom: '12px' }}>FINAL DISPOSITION</h4>
          <div className="disposition-selector" style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {['Treatment', 'Admit', 'Discharge', 'Transfer'].map(d => (
              <button
                key={d}
                className={`dispo-chip ${disposition === d ? 'active' : ''}`}
                onClick={() => setDisposition(d)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: '1px solid #e2e8f0',
                  background: disposition === d ? '#0f172a' : 'white',
                  color: disposition === d ? 'white' : '#475569',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                {d}
              </button>
            ))}
          </div>
          {(disposition === 'Admit' || disposition === 'Transfer') && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#475569', marginBottom: 6 }}>Ward / Room</div>
              {wardsLoading ? (
                <div style={{ color: '#64748b' }}>Loading wards…</div>
              ) : (
                <select
                  className="doc-select"
                  value={selectedWard}
                  onChange={(e) => setSelectedWard(e.target.value)}
                >
                  <option value="">-- Select ward --</option>
                  {(Array.isArray(wards) ? wards : []).map((w) => (
                    <option key={String(w.id)} value={String(w.name || '')}>
                      {String(w.name || 'Ward')} ({Number(w.occupied || 0)}/{Number(w.totalCapacity || w.total_capacity || 0)})
                    </option>
                  ))}
                </select>
              )}
              {disposition === 'Transfer' && (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: '#64748b' }}>
                  Select the target ward/room for transfer.
                </div>
              )}
            </div>
          )}
          <button 
            className="doc-primary" 
            style={{ width: '100%', height: '48px', fontSize: '1rem', fontWeight: 800 }}
            onClick={finalizeERVisit}
            disabled={finalizingVisit}
          >
            {finalizingVisit ? 'Finalizing...' : `Finalize ER Visit (${disposition})`}
          </button>
        </div>
      </div>
    </div>
  );

  const patientQueueCard = (
    <div className="doc-card">
      <div className="doc-card-header" style={{flexDirection: 'column', alignItems: 'stretch'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div className="doc-card-title">
            <Calendar size={18} />
            Waiting Room
          </div>
          <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
            <button
              type="button"
              className={`doc-chip ${queueDateMode === 'upcoming' ? 'active' : ''}`}
              onClick={() => setQueueDateMode('upcoming')}
              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
            >
              All Bookings
            </button>
            <button
              type="button"
              className={`doc-chip ${queueDateMode === 'date' ? 'active' : ''}`}
              onClick={() => setQueueDateMode('date')}
              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
            >
              By Date
            </button>
            <input
              className="doc-date"
              type="date"
              value={formatDateParam(selectedDate)}
              onChange={(e) => setSelectedDate(new Date(`${e.target.value}T00:00:00`))}
              disabled={queueDateMode !== 'date'}
              style={{padding: '4px 8px', fontSize: '0.85rem'}}
            />
            <button
              type="button"
              className="doc-icon-btn"
              onClick={fetchAppointments}
              title="Refresh Queue"
            >
              <RotateCw size={16} />
            </button>
          </div>
        </div>
        <div className="doc-scope-chips" style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`doc-chip ${queueFilter === 'all' ? 'active' : ''}`}
            onClick={() => {
              setQueueFilter('all');
              if (!isERDoctor) setQueueScope('mine');
            }}
          >
            All
          </button>
          <button
            type="button"
            className={`doc-chip ${queueFilter === 'video' ? 'active' : ''}`}
            onClick={() => {
              setQueueFilter('video');
              if (!isERDoctor) setQueueScope('specialization');
            }}
          >
            Video Consultations
          </button>
        </div>
        {!isERDoctor && (
          <div className="doc-queue-toggles" style={{display: 'flex', gap: '10px', marginTop: '12px'}}>
            <button
              className={`doc-toggle-btn ${queueScope === 'mine' ? 'active' : ''}`}
              type="button"
              style={{flex: 1, fontSize: '0.75rem', padding: '6px', cursor: 'default'}}
              onClick={() => setQueueScope('mine')}
            >
              My Patients
            </button>
            <button
              className={`doc-toggle-btn ${queueScope === 'specialization' ? 'active' : ''}`}
              type="button"
              style={{flex: 1, fontSize: '0.75rem', padding: '6px'}}
              onClick={() => setQueueScope('specialization')}
            >
              My Department
            </button>
          </div>
        )}
      </div>

      <div className="doc-list" style={{maxHeight: '400px', overflowY: 'auto'}}>
        {loadingAppointments ? (
          <div className="doc-empty">Loading queue…</div>
        ) : appointmentsError ? (
          <div className="doc-empty">{appointmentsError}</div>
        ) : (
          (() => {
            const filtered = appointments.filter(apt => {
              if (queueFilter === 'video' && !isVideoConsult(apt)) return false;
              const st = String(apt.status || '').trim().toLowerCase();
              if (st.includes('cancel') || st.includes('no-show') || st.includes('no show') || st.includes('completed') || st.includes('done')) {
                return false;
              }
              const isVideo = isVideoConsult(apt);
              const doctorSpecKey = normalizeSpecKey(currentUser?.specialization || '');
              if (!isERDoctor && isVideo && doctorSpecKey) {
                const inferredKey = inferVideoSpecialization(apt.reason);
                if (inferredKey && inferredKey !== doctorSpecKey) return false;
              }
              const target = normalizeAssignee(doctorInboxName || doctorName);
              const aptDoctor = normalizeAssignee(apt.doctor || apt.preferredDoctor);
              const doctorUuid = String(currentUser?.id || '').trim();
              const aptUuid = String(apt.doctorUuid || apt.doctor_uuid || '').trim();
              if (doctorUuid && aptUuid && aptUuid === doctorUuid) return true;

              if (!isERDoctor && queueScope === 'specialization' && isVideo) {
                const inferredKey = inferVideoSpecialization(apt.reason);
                if (doctorSpecKey && inferredKey && inferredKey === doctorSpecKey) return true;
              }

              // Special rule for Medicine/ER doctors: show triage walk-ins
              const reason = String(apt.reason || '').toLowerCase();
              if (isERDoctor && reason.includes('[triage]')) {
                return true;
              }

              return aptDoctor === target;
            }).sort((a, b) => {
              if (isERDoctor) {
                const lvA = a.triageLevel || a.triage_level || 99;
                const lvB = b.triageLevel || b.triage_level || 99;
                if (lvA !== lvB) return lvA - lvB;
              }

              const aSeq = Number(a.walkinTicketSeq ?? 0) || 0;
              const bSeq = Number(b.walkinTicketSeq ?? 0) || 0;
              if (aSeq && bSeq) return aSeq - bSeq;
              if (aSeq && !bSeq) return -1;
              if (!aSeq && bSeq) return 1;

              const aDate = new Date(a.appointment_date || a.appointmentDate || 0).getTime() || 0;
              const bDate = new Date(b.appointment_date || b.appointmentDate || 0).getTime() || 0;
              return aDate - bDate;
            });

            if (filtered.length === 0) {
              return <div className="doc-empty">No patients in queue.</div>;
            }

            return filtered.map((apt) => (
              <div
                key={apt.id}
                className="doc-apt"
                onClick={() => {
                  const aptPatientId = String(apt.patientId || apt.patient_id || '').trim();
                  const aptEmail = String(apt.email || '').trim().toLowerCase();
                  const matched =
                    (aptPatientId ? patients.find((p) => String(p._id || p.id || '').trim() === aptPatientId) : null) ||
                    (aptEmail ? patients.find((p) => String(p.email || '').trim().toLowerCase() === aptEmail) : null) ||
                    null;
                  
                  // Merge info from appointment for completeness
                  const mergedPatient = {
                    ...(matched || {}),
                    _id: matched?._id || matched?.id || aptPatientId || apt.id,
                    firstName: matched?.firstName || matched?.first_name || apt.firstName || apt.first_name,
                    lastName: matched?.lastName || matched?.last_name || apt.lastName || apt.last_name,
                    email: matched?.email || apt.email,
                    contactNumber: matched?.contactNumber || matched?.contact_number || apt.phone || apt.contactNumber,
                    gender: matched?.gender || matched?.sex || apt.gender || apt.sex,
                    bloodType: matched?.bloodType || matched?.blood_type || apt.bloodType || apt.blood_type,
                    // Pass vitals from appointment as fallback
                    vitalsFallback: {
                      bp: apt.blood_pressure || apt.bp,
                      hr: apt.heart_rate || apt.hr,
                      rr: apt.respiratory_rate || apt.rr,
                      temp: apt.temperature || apt.temp,
                      spo2: apt.spo2
                    },
                    // Pass triage from appointment as fallback
                    triageFallback: {
                      triage_level: apt.triageLevel || apt.triage_level,
                      priority_label: apt.triageStatus || apt.triage_status
                    }
                  };

                  setSelectedPatient(mergedPatient);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  borderBottom: '1px solid #f1f5f9',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                    <span style={{fontWeight: '700', fontSize: '0.95rem'}}>{apt.firstName} {apt.lastName}</span>
                    {apt.walkinTicket ? (
                      <span className="doc-badge" style={{ background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', fontSize: '0.75rem', fontWeight: 900 }}>
                        {apt.walkinTicket}
                      </span>
                    ) : null}
                    {apt.patientWaitingAt ? (
                      <span className="doc-badge" style={{ background: '#dcfce7', borderColor: '#86efac', color: '#166534', fontSize: '0.7rem', fontWeight: 900 }}>
                        NOW
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={statusClass(apt.status)} style={{fontSize: '0.7rem'}}>{apt.status}</span>
                    {isVideoConsult(apt) ? (
                      <span className="doc-badge" style={{ background: '#e0f2fe', borderColor: 'rgba(14,165,233,0.35)', color: '#0369a1', fontSize: '0.7rem' }}>
                        VIDEO
                      </span>
                    ) : null}
                    {(() => {
                      const video = isVideoConsult(apt);
                      if (!video) return null;
                      const target = normalizeAssignee(doctorInboxName || doctorName);
                      const aptDoctor = normalizeAssignee(apt.doctor || apt.preferredDoctor);
                      if (!target) return null;
                      const doctorUuid = String(currentUser?.id || '').trim();
                      const aptUuid = String(apt.doctorUuid || apt.doctor_uuid || '').trim();
                      const isMine = (doctorUuid && aptUuid && aptUuid === doctorUuid) || aptDoctor === target;
                      const joinGate = getVideoJoinWindowState(apt);
                      const label = apt.meetingActive ? 'Join Call' : 'Start Call';
                      if (!isMine) {
                        if (queueScope !== 'specialization') return null;
                        const assignedTo = String(apt.doctor || apt.preferredDoctor || '').trim() || 'another doctor';
                        return (
                          <button
                            type="button"
                            className="doc-icon-btn"
                            title={`Assigned to ${assignedTo}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setToast({ type: 'error', message: `Assigned to ${assignedTo}. Switch to My Patients to start the call.` });
                            }}
                            style={{ padding: '6px 8px', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.75 }}
                          >
                            <Video size={16} />
                            <span style={{ fontSize: 12, fontWeight: 800 }}>Assigned</span>
                          </button>
                        );
                      }
                      return (
                        <button
                          type="button"
                          className="doc-icon-btn"
                          title={joinGate.allowed ? label : joinGate.reason}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!joinGate.allowed) {
                              setToast({ type: 'error', message: joinGate.reason || 'Join not allowed yet.' });
                              return;
                            }
                            startVideoCall(apt);
                          }}
                          disabled={!joinGate.allowed}
                          style={{ padding: '6px 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Video size={16} />
                          <span style={{ fontSize: 12, fontWeight: 800 }}>{label}</span>
                        </button>
                      );
                    })()}
                  </div>
                </div>
                <div style={{fontSize: '0.8rem', color: '#64748b', display: 'flex', justifyContent: 'space-between'}}>
                  <span>{apt.reason}</span>
                  <span>
                    {(() => {
                      const dRaw = apt.appointmentDate || apt.appointment_date || null;
                      const d = dRaw ? new Date(dRaw) : null;
                      const dateLabel = d && !Number.isNaN(d.getTime())
                        ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
                        : '—';
                      const timeLabel = String(apt.appointmentTime || apt.appointment_time || '').trim() || '—';
                      return `${dateLabel} • ${timeLabel}`;
                    })()}
                  </span>
                </div>
              </div>
            ));
          })()
        )}
      </div>
    </div>
  );

  const patientCard = (
    <div className="doc-card">
      <div className="doc-card-header">
        <div className="doc-card-title">
          <User size={18} />
          {isERDoctor && selectedPatient ? 'Active Case Info' : 'Patient Selector'}
        </div>
        <div className="doc-search-wrap">
          <Search size={16} className="doc-search-icon" />
          <input
            className="doc-search"
            placeholder="Search patient..."
            value={patientQuery}
            onChange={(e) => setPatientQuery(e.target.value)}
          />
          <button
            type="button"
            className="doc-icon-btn"
            onClick={async () => {
              const ok = await fetchPatients();
              setToast(ok ? { type: 'success', message: 'Patients refreshed.' } : { type: 'error', message: 'Unable to load patients.' });
            }}
            title="Refresh patients"
          >
            <RotateCw size={16} />
          </button>
          {loadingPatients && <div className="doc-muted" style={{ marginLeft: 8 }}>Loading…</div>}
          {!loadingPatients && patientsError ? <div className="doc-muted" style={{ marginLeft: 8 }}>{patientsError}</div> : null}
          {filteredPatientResults.length > 0 && (
            <div className="doc-search-results">
              {filteredPatientResults.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  className="doc-search-item"
                  onClick={() => {
                    setSelectedPatient(p);
                    setPatientQuery('');
                  }}
                >
                  <div className="doc-search-name">{p.firstName} {p.lastName}</div>
                  <div className="doc-search-sub">{p.email}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!selectedPatient ? (
        <div className="doc-empty">Search a patient to view details.</div>
      ) : (
        <div className="doc-patient">
          <div className="doc-patient-header">
            <div className="doc-patient-name">
              {`${selectedPatient.firstName} ${selectedPatient.lastName}`}
            </div>
            {(erTriage || selectedPatient?.triageFallback?.triage_level) && (
              <div className={`doc-badge triage-level-${erTriage?.triage_level || selectedPatient?.triageFallback?.triage_level}`} style={{ 
                background: (erTriage?.triage_level || selectedPatient?.triageFallback?.triage_level) === 1 ? '#fee2e2' : (erTriage?.triage_level || selectedPatient?.triageFallback?.triage_level) === 2 ? '#ffedd5' : '#f0f9ff',
                color: (erTriage?.triage_level || selectedPatient?.triageFallback?.triage_level) === 1 ? '#991b1b' : (erTriage?.triage_level || selectedPatient?.triageFallback?.triage_level) === 2 ? '#9a3412' : '#075985',
                fontWeight: 800,
                border: '1px solid currentColor',
                fontSize: '0.75rem',
                padding: '4px 8px'
              }}>
                LEVEL {erTriage?.triage_level || selectedPatient?.triageFallback?.triage_level}: {erTriage?.priority_label || selectedPatient?.triageFallback?.priority_label || 'Assessed'}
              </div>
            )}
          </div>

          <div className="doc-vitals-display" style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', 
            gap: '8px', 
            marginBottom: '16px',
            padding: '12px',
            background: '#f8fafc',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>BP</div>
              <div style={{ fontWeight: 800, color: '#0f172a' }}>{erVitals?.bp || selectedPatient?.vitalsFallback?.bp || '—'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>HR</div>
              <div style={{ fontWeight: 800, color: (Number(erVitals?.hr || selectedPatient?.vitalsFallback?.hr) > 100 || Number(erVitals?.hr || selectedPatient?.vitalsFallback?.hr) < 60) ? '#b91c1c' : '#0f172a' }}>{erVitals?.hr || selectedPatient?.vitalsFallback?.hr || '—'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Temp</div>
              <div style={{ fontWeight: 800, color: (Number(erVitals?.temp || selectedPatient?.vitalsFallback?.temp) > 37.8 || Number(erVitals?.temp || selectedPatient?.vitalsFallback?.temp) < 35.5) ? '#b91c1c' : '#0f172a' }}>{erVitals?.temp || selectedPatient?.vitalsFallback?.temp || '—'}°C</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>SpO2</div>
              <div style={{ fontWeight: 800, color: Number(erVitals?.spo2 || selectedPatient?.vitalsFallback?.spo2) < 95 ? '#b91c1c' : '#0f172a' }}>{erVitals?.spo2 || selectedPatient?.vitalsFallback?.spo2 || '—'}%</div>
            </div>
            {(erVitals?.rr || selectedPatient?.vitalsFallback?.rr) && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>RR</div>
                <div style={{ fontWeight: 800, color: '#0f172a' }}>{erVitals?.rr || selectedPatient?.vitalsFallback?.rr}</div>
              </div>
            )}
          </div>

          <div className="doc-patient-grid">
            <div className="doc-pill"><span className="doc-pill-k">Email</span><span className="doc-pill-v">{activePatientMeta.email || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Contact</span><span className="doc-pill-v">{activePatientMeta.contact || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Gender</span><span className="doc-pill-v">{activePatientMeta.gender || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Allergies</span><span className="doc-pill-v">{activePatientMeta.allergies || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Blood Type</span><span className="doc-pill-v">{recordProfile?.blood_type || recordProfile?.bloodType || selectedPatient?.bloodType || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Diagnosis</span><span className="doc-pill-v">{recordProfile?.diagnosis || selectedPatient?.diagnosis || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Ward</span><span className="doc-pill-v">{recordProfile?.ward_number || recordProfile?.wardNumber || selectedPatient?.wardNumber || '—'}</span></div>
            <div className="doc-pill"><span className="doc-pill-k">Admission</span><span className="doc-pill-v">{recordProfile?.admission_status || recordProfile?.admissionStatus || selectedPatient?.admissionStatus || '—'}</span></div>
          </div>

          <div className="doc-history">
            <div className="doc-history-title">Latest Summary</div>
            <div className="doc-history-item">
              <div className="doc-history-top">
                <span className="doc-history-doctor">Last Note</span>
                <span className="doc-muted">
                  {notes && notes[0] ? new Date(notes[0].created_at || notes[0].createdAt || Date.now()).toLocaleString() : '—'}
                </span>
              </div>
              <div className="doc-history-sub">{notes && notes[0] ? (notes[0].assessment || notes[0].subjective || '—') : 'No notes yet.'}</div>
            </div>
            <div className="doc-history-item">
              <div className="doc-history-top">
                <span className="doc-history-doctor">Last Prescription</span>
                <span className="doc-muted">
                  {prescriptions && prescriptions[0] ? new Date(prescriptions[0].created_at || prescriptions[0].createdAt || Date.now()).toLocaleString() : '—'}
                </span>
              </div>
              <div className="doc-history-sub">
                {prescriptions && prescriptions[0]
                  ? (prescriptions[0].diagnosis || (Array.isArray(prescriptions[0].items) && prescriptions[0].items[0]?.medication) || 'Prescription')
                  : 'No prescriptions yet.'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const labsCard = (
    <div className="doc-card">
      <div className="doc-card-header">
        <div className="doc-card-title">
          <FileText size={18} />
          Lab & Imaging
        </div>
      </div>
      {!selectedPatient ? (
        <div className="doc-empty">Select a patient to add lab or imaging results.</div>
      ) : (
        <div className="doc-form">
          <select className="doc-select" value={labForm.type} onChange={(e) => setLabForm((v) => ({ ...v, type: e.target.value }))}>
            <option value="Lab">Lab</option>
            <option value="Imaging">Imaging</option>
          </select>
          <input className="doc-input" placeholder="Title (e.g., CBC Result)" value={labForm.title} onChange={(e) => setLabForm((v) => ({ ...v, title: e.target.value }))} />
          <div className="doc-upload-row">
            <label className="doc-upload-btn">
              <Upload size={16} />
              Choose file
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                  setLabFile(f);
                }}
                style={{ display: 'none' }}
              />
            </label>
            <div className="doc-upload-name">{labFile ? labFile.name : 'No file selected'}</div>
            {labFile && (
              <button className="doc-btn" type="button" onClick={() => setLabFile(null)}>
                <X size={16} />
                Remove
              </button>
            )}
          </div>
          <input className="doc-input" placeholder="Or paste file URL (optional)" value={labForm.url} onChange={(e) => setLabForm((v) => ({ ...v, url: e.target.value }))} />
          <input className="doc-input" type="date" value={labForm.resultDate} onChange={(e) => setLabForm((v) => ({ ...v, resultDate: e.target.value }))} />
          <button className="doc-primary" type="button" onClick={saveLabResult} disabled={savingLab}>
            Add Result
          </button>

          <div className="doc-history">
            <div className="doc-history-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
              <span>Recent Results</span>
              <button
                className="doc-btn"
                type="button"
                onClick={() => saveStaffPrefs({ labsLastSeenAt: new Date().toISOString() })}
                disabled={loadingStaffSettings}
                title="Mark results as seen"
              >
                <Check size={16} />
                Mark Seen
              </button>
            </div>
            {labResultsError ? (
              <div className="doc-muted">{labResultsError}</div>
            ) : labResults.length === 0 ? (
              <div className="doc-muted">No lab/imaging results yet.</div>
            ) : (
              labResults.slice(0, 10).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`doc-history-item ${String(r.id) === String(selectedLabResultId) ? 'active' : ''}`}
                  onClick={() => openLabInterpretation(r.id)}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  <div className="doc-history-top">
                    <span className="doc-history-doctor">
                      {r.type || 'Result'}
                      {(() => {
                        const createdAt = new Date(r.created_at || r.createdAt || Date.now());
                        const isNew = labsLastSeenAt ? createdAt.getTime() > labsLastSeenAt.getTime() : false;
                        return isNew ? <span className="doc-badge doc-badge-new">New</span> : null;
                      })()}
                    </span>
                    <span className="doc-muted">{new Date(r.created_at || Date.now()).toLocaleDateString()}</span>
                  </div>
                  <div className="doc-history-sub">
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 800 }}>
                      {r.title}
                    </a>
                  </div>
                </button>
              ))
            )}
          </div>

          {selectedLabResultId && (
            <div className="doc-lab-interpret">
              <div className="doc-lab-interpret-head">
                <div style={{ fontWeight: 900 }}>Interpretation</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="doc-btn" type="button" onClick={() => setSelectedLabResultId(null)}>
                    <X size={16} />
                    Close
                  </button>
                  <button className="doc-primary" type="button" onClick={saveLabInterpretationNote} disabled={savingLabInterpretation || loadingLabInterpretation}>
                    Save
                  </button>
                </div>
              </div>
              {loadingLabInterpretation ? (
                <div className="doc-muted">Loading…</div>
              ) : (
                <>
                  <textarea
                    className="doc-textarea"
                    placeholder="Add your interpretation notes here…"
                    value={labInterpretation.note}
                    onChange={(e) => setLabInterpretation((v) => ({ ...v, note: e.target.value }))}
                  />
                  {labInterpretation.updatedAt ? (
                    <div className="doc-muted" style={{ fontWeight: 800 }}>
                      Last saved: {new Date(labInterpretation.updatedAt).toLocaleString()}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const certificatesCard = (
    <div className="doc-card">
      <div className="doc-card-header">
        <div className="doc-card-title">
          <ClipboardCheck size={18} />
          Medical Certificate
        </div>
      </div>
      {!selectedPatient ? (
        <div className="doc-empty">Select a patient to generate a medical certificate.</div>
      ) : (
        <div className="doc-form">
          <input className="doc-input" placeholder="Purpose (required)" value={certForm.purpose} onChange={(e) => setCertForm((v) => ({ ...v, purpose: e.target.value }))} />
          <input className="doc-input" placeholder="Diagnosis / Findings (optional)" value={certForm.diagnosis} onChange={(e) => setCertForm((v) => ({ ...v, diagnosis: e.target.value }))} />
          <input className="doc-input" placeholder="Recommendations (optional)" value={certForm.recommendations} onChange={(e) => setCertForm((v) => ({ ...v, recommendations: e.target.value }))} />
          <input className="doc-input" type="date" value={certForm.validUntil} onChange={(e) => setCertForm((v) => ({ ...v, validUntil: e.target.value }))} />
          <button className="doc-primary" type="button" onClick={saveCertificate} disabled={savingCert}>
            Create Certificate
          </button>

          <div className="doc-history">
            <div className="doc-history-title">Recent Certificates</div>
            {certificatesError ? (
              <div className="doc-muted">{certificatesError}</div>
            ) : certificates.length === 0 ? (
              <div className="doc-muted">No certificates yet.</div>
            ) : (
              certificates.slice(0, 10).map((c) => (
                <div key={c.id} className="doc-history-item rx-item">
                  <div className="doc-history-top">
                    <span className="doc-history-doctor">{c.doctorName || doctorName}</span>
                    <div className="rx-actions">
                      <button className="doc-btn" type="button" onClick={() => printCertificate(c)}>
                        <Printer size={16} />
                        Print
                      </button>
                    </div>
                  </div>
                  <div className="doc-history-sub">{c.purpose}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  const doctorProfileView = (
    <div className="doc-profile-module">
      <div className="doc-module-header">
        <div className="doc-module-title">
          <User size={24} />
          <h2>My Profile</h2>
        </div>
      </div>
      <div className="doc-module-content profile-centered">
        <div className="doc-profile-container-simple">
          <div className="doc-profile-header-new">
            <div className="doc-profile-avatar-section">
              <div className="doc-avatar-upload">
                {profilePreview || profileForm.profilePicture ? (
                  <img src={profilePreview || profileForm.profilePicture} alt="Profile" className="doc-avatar-large" />
                ) : (
                  <div className="doc-avatar-large placeholder">
                    {profileForm.firstName?.[0]}{profileForm.lastName?.[0]}
                  </div>
                )}
                <label className="doc-avatar-edit-btn">
                  <Upload size={16} />
                  <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
            <div className="doc-profile-main-info">
              <h3>Dr. {profileForm.firstName} {profileForm.lastName}</h3>
              <p className="specialization-text">{profileForm.specialization || 'ER'}</p>
              <div className="doc-profile-stats-mini">
                <div className="doc-stat-mini">
                  <span className="doc-stat-label">Member since</span>
                  <span className="doc-stat-value">2024</span>
                </div>
                <div className="doc-stat-mini">
                  <span className="doc-stat-label">Status</span>
                  <span className="doc-stat-value active">Active</span>
                </div>
              </div>
            </div>
          </div>

          <div className="doc-profile-form-simple">
            <div className="doc-profile-grid-compact">
              <div className="doc-form-group">
                <label>First Name</label>
                <input 
                  className="doc-input" 
                  value={profileForm.firstName} 
                  onChange={(e) => setProfileForm(v => ({ ...v, firstName: e.target.value }))} 
                />
              </div>
              <div className="doc-form-group">
                <label>Last Name</label>
                <input 
                  className="doc-input" 
                  value={profileForm.lastName} 
                  onChange={(e) => setProfileForm(v => ({ ...v, lastName: e.target.value }))} 
                />
              </div>
              <div className="doc-form-group">
                <label>Specialization</label>
                <input 
                  className="doc-input read-only" 
                  value={profileForm.specialization || 'ER'} 
                  readOnly
                />
              </div>
              <div className="doc-form-group">
                <label>Email Address</label>
                <input 
                  className="doc-input read-only" 
                  value={profileForm.email} 
                  readOnly
                />
              </div>
              <div className="doc-form-group">
                <label>New Password</label>
                <input 
                  type="password"
                  className="doc-input" 
                  placeholder="Leave blank to keep current"
                  value={profileForm.newPassword} 
                  onChange={(e) => setProfileForm(v => ({ ...v, newPassword: e.target.value }))} 
                />
              </div>
              <div className="doc-form-group">
                <label>Re-type New Password</label>
                <input 
                  type="password"
                  className="doc-input" 
                  placeholder="Confirm new password"
                  value={profileForm.confirmPassword} 
                  onChange={(e) => setProfileForm(v => ({ ...v, confirmPassword: e.target.value }))} 
                />
              </div>
            </div>
          </div>

          <div className="doc-profile-actions-simple">
            <button 
              className="doc-primary doc-save-profile-btn" 
              onClick={saveProfile} 
              disabled={savingProfile}
            >
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const patientRecordsView = (
    <div className="doc-records-module">
      <div className="doc-module-header">
        <div className="doc-module-title">
          <FileText size={24} />
          <h2>Patient Records</h2>
        </div>
        <div className="doc-module-actions">
          <div className="doc-search-wrap">
            <Search size={18} className="doc-search-icon" />
            <input 
              className="doc-search"
              placeholder="Search name or email..." 
              value={recordQuery}
              onChange={(e) => {
                setRecordQuery(e.target.value);
                setRecordSkip(0);
              }}
            />
          </div>
          {!isERDoctor && (
            <div className="doc-scope-chips">
              <button 
                type="button"
                className={`doc-chip ${recordScope === 'mine' ? 'active' : ''}`}
                onClick={() => { setRecordScope('mine'); setRecordSkip(0); }}
              >
                My Patients
              </button>
              <button
                type="button"
                className={`doc-chip ${recordScope === 'specialization' ? 'active' : ''}`}
                onClick={() => { setRecordScope('specialization'); setRecordSkip(0); }}
              >
                My Department
              </button>
              {(userRole === 'admin' || isERDoctor) && (
                <button 
                  type="button"
                  className={`doc-chip ${recordScope === 'all' ? 'active' : ''}`}
                  onClick={() => { setRecordScope('all'); setRecordSkip(0); }}
                >
                  All Patients
                </button>
              )}
            </div>
          )}
          {recordsTotal > recordTake && (
            <div className="patient-pagination" style={{ margin: 0 }}>
              <button 
                type="button"
                className="patient-page-btn"
                disabled={recordSkip === 0}
                onClick={() => setRecordSkip(Math.max(0, recordSkip - recordTake))}
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <button 
                type="button"
                className="patient-page-btn"
                disabled={recordSkip + recordTake >= recordsTotal}
                onClick={() => setRecordSkip(recordSkip + recordTake)}
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="doc-module-content">
        <div className="doc-table-container">
          <table className="doc-data-table">
            <thead>
              <tr>
                <th>Patient Name</th>
                <th>Patient ID</th>
                <th>Gender</th>
                <th>Blood Type</th>
                <th>Last Visit</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingRecords ? (
                <tr>
                  <td colSpan="6" className="doc-table-loading">Loading patients...</td>
                </tr>
              ) : recordList.length === 0 ? (
                <tr>
                  <td colSpan="6" className="doc-table-empty">No patients found.</td>
                </tr>
              ) : (
                recordList.map((row, idx) => {
                  const p = row.patient;
                  if (!p) return null;
                  return (
                    <tr key={p.id || idx} className={selectedRecord?.patient?.id === p.id ? 'active' : ''}>
                      <td>
                        <div className="doc-patient-cell">
                          <div className="doc-avatar-sm">
                            {(p.firstName || p.first_name || 'U')[0]}{(p.lastName || p.last_name || 'P')[0]}
                          </div>
                          <div className="doc-patient-info">
                            <div className="doc-name">{p.firstName || p.first_name} {p.lastName || p.last_name}</div>
                            <div className="doc-email">{p.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="doc-id-badge">{String(p.id || '').slice(0, 8)}</span></td>
                      <td>{p.gender || p.sex || '—'}</td>
                      <td>{p.bloodType || p.blood_type || '—'}</td>
                      <td>{row.lastVisitAt ? new Date(row.lastVisitAt).toLocaleDateString() : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="doc-table-btn"
                          onClick={() => {
                            setSelectedPatient({ ...p, _id: p.id });
                            setActiveNav('dashboard');
                          }}
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          className="doc-table-btn"
                          style={{ marginLeft: 10 }}
                          onClick={() => {
                            setCentralRecordPatientId(String(p.id));
                            setCentralRecordPatientLabel(`${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() || 'Patient');
                            setCentralRecordOpen(true);
                          }}
                        >
                          View Record
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

      {selectedRecord && (
        <div className="doc-record-detail-overlay" onClick={() => setSelectedRecord(null)}>
          <div className="doc-record-detail-content" onClick={e => e.stopPropagation()}>
            <div className="doc-detail-header">
              <div className="doc-detail-user">
                <div className="doc-avatar-lg">
                  {selectedRecord.patient.first_name[0]}{selectedRecord.patient.last_name[0]}
                </div>
                <div>
                  <h2>{selectedRecord.patient.first_name} {selectedRecord.patient.last_name}</h2>
                  <div className="doc-detail-meta">
                    <span>ID: {selectedRecord.patient.id}</span>
                    <span>{selectedRecord.patient.email}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="doc-close-btn" onClick={() => setSelectedRecord(null)}>
                <X size={24} />
              </button>
            </div>

            <div className="doc-detail-tabs">
              <button type="button" className={recordTab === 'overview' ? 'active' : ''} onClick={() => setRecordTab('overview')}>Overview</button>
              <button type="button" className={recordTab === 'history' ? 'active' : ''} onClick={() => setRecordTab('history')}>Timeline</button>
              <button type="button" className={recordTab === 'notes' ? 'active' : ''} onClick={() => setRecordTab('notes')}>SOAP Notes</button>
              <button type="button" className={recordTab === 'prescriptions' ? 'active' : ''} onClick={() => setRecordTab('prescriptions')}>Prescriptions</button>
              <button type="button" className={recordTab === 'labs' ? 'active' : ''} onClick={() => setRecordTab('labs')}>Lab/Imaging</button>
            </div>

            <div className="doc-detail-body">
              {loadingProfile ? (
                <div className="doc-loading">Loading details...</div>
              ) : recordProfile ? (
                <>
                  {recordTab === 'overview' && (
                    <div className="doc-overview-grid">
                      <div className="doc-info-card">
                        <h3>Personal Details</h3>
                        <div className="info-row"><span>Phone:</span> {selectedRecord.patient.contact_number}</div>
                        <div className="info-row"><span>DOB:</span> {new Date(selectedRecord.patient.date_of_birth).toLocaleDateString()}</div>
                        <div className="info-row"><span>Gender:</span> {selectedRecord.patient.gender}</div>
                        <div className="info-row"><span>Allergies:</span> {selectedRecord.patient.allergies || 'None'}</div>
                      </div>
                      <div className="doc-info-card">
                        <h3>Medical Summary</h3>
                        <div className="info-row"><span>Diagnosis:</span> {recordProfile.summary.diagnosis || 'None recorded'}</div>
                        <div className="doc-tag-cloud">
                          {recordProfile.summary.extractedKeywords.map((k, i) => (
                            <span key={i} className="doc-tag">{k}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {recordTab === 'history' && recordHistory && (
                    <div className="doc-timeline-v2">
                      {[
                        ...recordHistory.notes.map(n => ({ ...n, type: 'note', date: n.created_at })),
                        ...recordHistory.prescriptions.map(p => ({ ...p, type: 'prescription', date: p.created_at })),
                        ...recordHistory.labResults.map(l => ({ ...l, type: 'lab', date: l.created_at })),
                        ...recordHistory.certificates.map(c => ({ ...c, type: 'cert', date: c.created_at })),
                        ...recordHistory.appointments.map(a => ({ ...a, type: 'appointment', date: a.appointmentDate }))
                      ].sort((a, b) => new Date(b.date) - new Date(a.date)).map((item, idx) => (
                        <div key={idx} className={`timeline-entry ${item.type}`}>
                          <div className="entry-dot"></div>
                          <div className="entry-content">
                            <div className="entry-header">
                              <span className="entry-type">{item.type}</span>
                              <span className="entry-date">{new Date(item.date).toLocaleDateString()}</span>
                            </div>
                            <div className="entry-text">
                              {item.type === 'note' && `Consultation by Dr. ${item.doctorName}`}
                              {item.type === 'prescription' && `Prescription issued for ${item.diagnosis || 'patient'}`}
                              {item.type === 'lab' && `Lab result: ${item.title}`}
                              {item.type === 'cert' && `Medical certificate for ${item.purpose}`}
                              {item.type === 'appointment' && `Appointment: ${item.reason}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {recordTab === 'notes' && (
                    <div className="doc-list-v2">
                      {recordHistory?.notes.map(n => (
                        <div key={n.id} className="list-entry">
                          <div className="entry-head">
                            <strong>Dr. {n.doctorName}</strong>
                            <span>{new Date(n.created_at).toLocaleString()}</span>
                          </div>
                          <div className="entry-body">
                            <p><strong>Assessment:</strong> {n.assessment}</p>
                            <div className="entry-vitals">
                              {n.vitals?.bp && <span>BP: {n.vitals.bp}</span>}
                              {n.vitals?.hr && <span>HR: {n.vitals.hr}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {recordTab === 'prescriptions' && (
                    <div className="doc-list-v2">
                      {recordHistory?.prescriptions.map(p => (
                        <div key={p.id} className="list-entry">
                          <div className="entry-head">
                            <strong>Dr. {p.doctorName}</strong>
                            <span>{new Date(p.created_at).toLocaleString()}</span>
                          </div>
                          <div className="entry-body">
                            <p><strong>Diagnosis:</strong> {p.diagnosis || 'N/A'}</p>
                            <div className="entry-rx-list">
                              {p.items?.map((it, i) => (
                                <div key={i} className="rx-item-v2">{it.medication} - {it.dosage} ({it.frequency})</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {recordTab === 'labs' && (
                    <div className="doc-list-v2">
                      {recordHistory?.labResults.map(l => (
                        <div key={l.id} className="list-entry">
                          <div className="entry-head">
                            <strong>{l.type}</strong>
                            <span>{new Date(l.created_at).toLocaleString()}</span>
                          </div>
                          <div className="entry-body">
                            <a href={l.url} target="_blank" rel="noreferrer" className="doc-link-btn">View Result: {l.title}</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="doctor-shell" style={{ paddingTop: backendHealth.checked && !backendHealth.ok ? 44 : 0 }}>
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
      <aside className={`doc-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="doc-sidebar-head">
          <div className="doc-brand">
            <img className="doc-brand-logo" src="/images/pgh%20logo.png" alt="PASCUALINGA" />
            {!isCollapsed ? <span className="doc-brand-text">PASCUALINGA</span> : null}
          </div>
          <button type="button" className="doc-sidebar-toggle" onClick={() => setIsCollapsed((v) => !v)}>
            <Menu size={18} />
          </button>
        </div>

        <nav className="doc-nav">
          {doctorNavItems.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`doc-nav-item ${activeNav === it.key ? 'active' : ''}`}
              onClick={() => setActiveNav(it.key)}
            >
              {it.icon}
              {!isCollapsed && <span>{it.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="doc-main">
        <div className="doctor-topbar">
          <div className="doctor-topbar-left">
            {isCollapsed ? (
              <button type="button" className="app-mobile-menu-btn" onClick={() => setIsCollapsed(false)} aria-label="Open menu">
                <Menu size={18} />
              </button>
            ) : null}
            <div className="doctor-topbar-meta">
              <div className="doctor-title">Doctor Panel</div>
              <div className="doctor-subtitle" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>Welcome back, {doctorName}</span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span style={{ fontWeight: 800, color: currentUser?.specialization ? '#0f172a' : '#b91c1c' }}>
                  {currentUser?.specialization ? currentUser.specialization : 'Specialization not set'}
                  {currentUser?.department ? ` • ${currentUser.department}` : ''}
                </span>
                {!currentUser?.specialization ? (
                  <button
                    type="button"
                    className="doc-chip"
                    onClick={() => setActiveNav('profile')}
                    style={{ padding: '4px 10px', fontSize: '0.78rem', fontWeight: 900, background: '#fff', border: '1px solid #fecaca', color: '#b91c1c' }}
                    title="Set your specialization to enable proper department routing."
                  >
                    Set now
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="doctor-topbar-right">
            <AccountHeaderActions 
              user={currentUser}
              showChangePasswordMenu={false}
              onSignOut={handleLogout} 
              onMyProfile={() => setActiveNav('profile')}
              onOpenNotification={(n) => {
                if (n?.type === 'approval' && n?.meta?.requestId) {
                  if (allowedDoctorNav.has('approval-inbox')) {
                    setActiveNav('approval-inbox');
                    openApprovalThread(n.meta.requestId);
                  } else {
                    setToast({ type: 'error', message: 'Approvals Inbox is not available for your department.' });
                    setActiveNav(defaultDoctorNav);
                  }
                } else if (String(n?.type || '').toLowerCase().includes('lab') || String(n?.type || '').toLowerCase().includes('result') || n?.type === 'lab_result') {
                  setActiveNav('labs');
                } else if (String(n?.type || '').toLowerCase().includes('patient') || n?.type === 'patient_update') {
                  setActiveNav('worklist');
                } else {
                  setActiveNav(defaultDoctorNav);
                }
              }}
            />
          </div>
        </div>

        {selectedPatient && (
          <div className="doc-sticky-container">
            <div className="doc-stickybar">
              <div className="doc-sticky-main">
                <div className="doc-sticky-name">{activePatientName || 'Selected patient'}</div>
                <div className="doc-sticky-meta">
                  {activePatientMeta.email && <span>{activePatientMeta.email}</span>}
                </div>
              </div>
              <div style={{display: 'flex', gap: '10px'}}>
                <button
                  type="button"
                  className="doc-sticky-action doc-primary"
                  onClick={printFullPatientRecord}
                >
                  <Printer size={16} />
                  Print Record
                </button>
                <button
                  type="button"
                  className="doc-sticky-action doc-primary"
                  style={{ background: '#0ea5e9' }}
                  onClick={() => setShowFullRecord(true)}
                >
                  <FileText size={16} />
                  View Full Record
                </button>
                <button
                  type="button"
                  className="doc-sticky-clear"
                  onClick={() => {
                    setSelectedPatient(null);
                    setPatientQuery('');
                  }}
                  title="Clear selection"
                >
                  <X size={16} />
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="doctor-content">
        {toast && (
          <div className={`doc-toast ${toast.type || 'success'}`}>
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {toast.message}
          </div>
        )}

        {activeNav === 'dashboard' && (
          <>
            <div className="doc-welcome-banner">
              <div className="doc-welcome-content">
                <div className="doc-welcome-main">
                  Ready to save lives, Dr. {doctorName}? 🩺
                </div>
                <div className="doc-welcome-sub">
                  Your dedication makes the difference. Here&apos;s your patient queue.
                </div>
              </div>
              <div className="doc-welcome-date-badge">
                {welcomeDateText}
              </div>
            </div>
            
            <div id="doc-sec-dashboard" className="doctor-grid doc-section">
              {patientQueueCard}
              {patientCard}
            </div>

            {isERDoctor && selectedPatient && (
              <div className="doctor-grid doctor-grid-2 doc-section">
                {erClinicalActions}
              </div>
            )}

            {/* MEDICAL PROFILE SECTION */}
              {selectedPatient && (
                <div className="doc-card" style={{ marginBottom: '15px' }}>
                  <div className="doc-card-header" style={{ cursor: 'pointer' }} onClick={() => setShowMedicalProfile(!showMedicalProfile)}>
                    <div className="doc-card-title">
                      <User size={18} />
                      Patient Medical History & Profile
                    </div>
                    <button className="doc-icon-btn" type="button">
                      {showMedicalProfile ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                  {showMedicalProfile && (
                    <div className="doc-form" style={{ padding: '15px' }}>
                      <div className="doctor-grid doctor-grid-2">
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>Allergies & Adverse Reactions <span style={{ color: '#ef4444' }}>*</span></label>
                          <textarea className="doc-textarea" style={{ minHeight: '60px', borderColor: medicalProfile.allergies && medicalProfile.allergies.toLowerCase() !== 'none' && medicalProfile.allergies.toLowerCase() !== 'n/a' ? '#ef4444' : '#cbd5e1' }} placeholder="e.g. Penicillin, Peanuts, None" value={medicalProfile.allergies} onChange={(e) => setMedicalProfile(v => ({...v, allergies: e.target.value}))} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>Past Medical & Surgical History</label>
                          <textarea className="doc-textarea" style={{ minHeight: '60px' }} placeholder="e.g. Hypertension, Appendectomy (2015)" value={medicalProfile.pastMedicalHistory} onChange={(e) => setMedicalProfile(v => ({...v, pastMedicalHistory: e.target.value}))} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>Family & Social History</label>
                          <textarea className="doc-textarea" style={{ minHeight: '60px' }} placeholder="e.g. Father: Diabetes. Smoker 10 years." value={medicalProfile.familyHistory} onChange={(e) => setMedicalProfile(v => ({...v, familyHistory: e.target.value}))} />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }}>Immunization Record</label>
                          <textarea className="doc-textarea" style={{ minHeight: '60px' }} placeholder="e.g. Fully vaccinated, Last Flu Shot 2025" value={medicalProfile.immunizations} onChange={(e) => setMedicalProfile(v => ({...v, immunizations: e.target.value}))} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                        <button type="button" className="doc-btn" style={{ background: 'var(--brand-primary-gradient)', color: 'white', border: 'none' }} onClick={saveMedicalProfile} disabled={savingMedicalProfile}>
                          <Save size={14} /> {savingMedicalProfile ? 'Saving...' : 'Save Medical Profile'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div id="doc-sec-notes" className="doctor-grid doctor-grid-2 doc-section">
              <div className="doc-card">
                <div className="doc-card-header">
                  <div className="doc-card-title">
                    <FileText size={18} />
                    Consultation Notes (SOAP)
                  </div>
                </div>

                {!selectedPatient ? (
                  <div className="doc-empty">Select a patient to record notes.</div>
                ) : (
                  <div className="doc-form">
                    <div className="doc-vitals-display" style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', padding: '12px', background: '#f8fafc', borderRadius: '8px', marginBottom: '15px', border: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
                      <div style={{fontWeight: 700, color: '#475569', width: '100%', marginBottom: '4px'}}><Activity size={14} style={{display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px'}}/> Vitals (Auto-Pulled from Triage)</div>
                      <div><span style={{color: '#64748b'}}>BP:</span> <strong>{selectedPatient?.vitals?.bp || '—'}</strong></div>
                      <div><span style={{color: '#64748b'}}>HR:</span> <strong>{selectedPatient?.vitals?.hr || '—'}</strong></div>
                      <div><span style={{color: '#64748b'}}>Temp:</span> <strong>{selectedPatient?.vitals?.temp || '—'}</strong></div>
                      <div><span style={{color: '#64748b'}}>Weight:</span> <strong>{selectedPatient?.vitals?.weight || '—'}</strong></div>
                      <div><span style={{color: '#64748b'}}>Height:</span> <strong>{selectedPatient?.vitals?.height || '—'}</strong></div>
                      <div><span style={{color: '#64748b'}}>SpO2:</span> <strong>{selectedPatient?.vitals?.o2 || selectedPatient?.vitals?.spo2 || '—'}</strong></div>
                    </div>

                    {doctorSpecialization.toLowerCase().includes('pediatric') && (
                      <div className="doc-vitals" style={{ marginTop: '10px' }}>
                        <input className="doc-input" placeholder="Vaccination History" value={noteForm.vaccinationHistory} onChange={(e) => setNoteForm(v => ({...v, vaccinationHistory: e.target.value}))} />
                        <input className="doc-input" placeholder="Developmental Milestones" value={noteForm.milestones || ''} onChange={(e) => setNoteForm(v => ({...v, milestones: e.target.value}))} />
                      </div>
                    )}
                    
                    {doctorSpecialization.toLowerCase().includes('cardiolog') && (
                      <div className="doc-vitals" style={{ marginTop: '10px' }}>
                        <input className="doc-input" placeholder="Heart Rate Rhythm" value={noteForm.heartRateRhythm} onChange={(e) => setNoteForm(v => ({...v, heartRateRhythm: e.target.value}))} />
                        <input className="doc-input" placeholder="ECG Notes" value={noteForm.ecgNotes} onChange={(e) => setNoteForm(v => ({...v, ecgNotes: e.target.value}))} />
                        <input className="doc-input" placeholder="Chest Pain Duration" value={noteForm.chestPainDuration || ''} onChange={(e) => setNoteForm(v => ({...v, chestPainDuration: e.target.value}))} />
                      </div>
                    )}

                    {doctorSpecialization.toLowerCase().includes('dermatolog') && (
                      <div className="doc-vitals" style={{ marginTop: '10px' }}>
                        <input className="doc-input" placeholder="Lesion Type" value={noteForm.lesionType} onChange={(e) => setNoteForm(v => ({...v, lesionType: e.target.value}))} />
                        <input className="doc-input" placeholder="Affected Area" value={noteForm.affectedArea} onChange={(e) => setNoteForm(v => ({...v, affectedArea: e.target.value}))} />
                        <input className="doc-input" placeholder="Skin Type" value={noteForm.skinType || ''} onChange={(e) => setNoteForm(v => ({...v, skinType: e.target.value}))} />
                      </div>
                    )}

                    {doctorSpecialization.toLowerCase().includes('obgyn') && (() => {
                      let edd = '';
                      let aog = '';
                      let trimester = '';
                      if (noteForm.lmp) {
                        const lmpDate = new Date(noteForm.lmp);
                        if (!isNaN(lmpDate)) {
                          const eddDate = new Date(lmpDate.getTime() + 280 * 24 * 60 * 60 * 1000);
                          edd = eddDate.toLocaleDateString();
                          const diffTime = Math.abs(new Date() - lmpDate);
                          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                          const weeks = Math.floor(diffDays / 7);
                          const days = diffDays % 7;
                          aog = `${weeks} weeks, ${days} days`;
                          if (weeks < 13) trimester = '1st Trimester';
                          else if (weeks <= 26) trimester = '2nd Trimester';
                          else trimester = '3rd Trimester';
                        }
                      }
                      return (
                        <div style={{ marginTop: '10px', background: '#fdf4ff', padding: '12px', borderRadius: '8px', border: '1px solid #f87171' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#be123c', marginBottom: '8px' }}>OB-GYN Calculator (LMP to EDD/AOG)</div>
                          <div className="doc-vitals">
                            <div>
                              <label style={{fontSize:'0.7rem', color:'#881337', fontWeight:600}}>LMP (Last Menstrual Period)</label>
                              <input type="date" className="doc-input" style={{ borderColor: '#fecdd3' }} value={noteForm.lmp || ''} onChange={(e) => setNoteForm(v => ({...v, lmp: e.target.value}))} />
                            </div>
                            <div>
                              <label style={{fontSize:'0.7rem', color:'#881337', fontWeight:600}}>Fetal Heart Rate (bpm)</label>
                              <input className="doc-input" placeholder="e.g. 140" style={{ borderColor: '#fecdd3' }} value={noteForm.fetalHeartRate || ''} onChange={(e) => setNoteForm(v => ({...v, fetalHeartRate: e.target.value}))} />
                            </div>
                          </div>
                          {noteForm.lmp && !isNaN(new Date(noteForm.lmp)) && (
                            <div style={{ marginTop: '10px', display: 'flex', gap: '15px', fontSize: '0.8rem', color: '#9f1239' }}>
                              <div><strong>EDD:</strong> {edd}</div>
                              <div><strong>AOG:</strong> {aog}</div>
                              <div><strong>Trimester:</strong> {trimester}</div>
                              <button type="button" onClick={() => {
                                setNoteForm(prev => ({
                                  ...prev,
                                  objective: (prev.objective ? prev.objective + ' ' : '') + `AOG: ${aog}. EDD: ${edd} (${trimester}).`
                                }));
                              }} style={{ background: '#be123c', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer' }}>
                                Copy to Notes
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {doctorSpecialization.toLowerCase().includes('surg') && (
                      <div className="doc-vitals" style={{ marginTop: '10px' }}>
                        <input className="doc-input" placeholder="Operation Type" value={noteForm.operationType || ''} onChange={(e) => setNoteForm(v => ({...v, operationType: e.target.value}))} />
                        <input className="doc-input" placeholder="Anesthesia Type" value={noteForm.anesthesiaType || ''} onChange={(e) => setNoteForm(v => ({...v, anesthesiaType: e.target.value}))} />
                        <input className="doc-input" placeholder="Surgical Site" value={noteForm.surgicalSite || ''} onChange={(e) => setNoteForm(v => ({...v, surgicalSite: e.target.value}))} />
                      </div>
                    )}

                    <div style={{ marginTop: '15px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>Quick Symptoms (Subjective)</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {["Fever", "Cough", "Headache", "Abdominal Pain", "Chest Pain", "Shortness of Breath", "Dizziness", "Vomiting", "Diarrhea"].map(chip => (
                          <StatusBadge
                            key={chip}
                            size="sm"
                            color="#475569"
                            uppercase={false}
                            showDot={false}
                            label={`+ ${chip}`}
                            onClick={() => {
                              setNoteForm(prev => {
                                const curr = prev.subjective || '';
                                const sep = curr ? ', ' : '';
                                return { ...prev, subjective: curr + sep + chip };
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>Quick Findings (Objective)</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {["Normal Exam", "Clear breath sounds", "Regular heart rhythm", "Soft abdomen", "No tenderness", "Alert & oriented"].map(chip => (
                          <StatusBadge
                            key={chip}
                            size="sm"
                            variant={chip === 'Normal Exam' ? 'duty' : 'scheduled'}
                            tone={chip === 'Normal Exam' ? 'duty' : undefined}
                            color={chip !== 'Normal Exam' ? '#475569' : undefined}
                            uppercase={false}
                            showDot={false}
                            style={chip === 'Normal Exam' ? { fontWeight: 700 } : undefined}
                            label={`+ ${chip}`}
                            onClick={() => {
                              setNoteForm(prev => {
                                const curr = prev.objective || '';
                                const sep = curr ? (curr.endsWith('.') ? ' ' : ', ') : '';
                                const text = chip === 'Normal Exam' ? 'Alert, coherent, oriented to 3 spheres, not in cardiorespiratory distress. Vital signs stable. Clear breath sounds bilaterally. Regular heart rhythm. Soft abdomen, no tenderness.' : chip;
                                return { ...prev, objective: curr + sep + text };
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <textarea className="doc-textarea" placeholder="Subjective" value={noteForm.subjective} onChange={(e) => setNoteForm((v) => ({ ...v, subjective: e.target.value }))} />
                    <textarea className="doc-textarea" placeholder="Objective" value={noteForm.objective} onChange={(e) => setNoteForm((v) => ({ ...v, objective: e.target.value }))} />
                    <textarea className="doc-textarea" placeholder="Assessment" value={noteForm.assessment} onChange={(e) => setNoteForm((v) => ({ ...v, assessment: e.target.value }))} />
                    <textarea className="doc-textarea" placeholder="Plan" value={noteForm.plan} onChange={(e) => setNoteForm((v) => ({ ...v, plan: e.target.value }))} />

                    <button className="doc-primary" type="button" onClick={saveNote} disabled={savingNote}>
                      Save Note
                    </button>

                    <div className="doc-history" style={{ marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
                      <div className="doc-history-title" style={{ marginBottom: '10px' }}>Recent Notes</div>
                      {notes.length === 0 ? (
                        <div className="doc-muted">No notes yet.</div>
                      ) : (
                        notes.slice(0, 5).map((n) => (
                          <div key={n.id} className="doc-history-item" style={{ position: 'relative', paddingRight: '80px' }}>
                            <div className="doc-history-top">
                              <span className="doc-history-doctor">{n.doctorName}</span>
                              <span className="doc-muted">{new Date(n.created_at || n.createdAt || n.timestamp || Date.now()).toLocaleString()}</span>
                            </div>
                            <div className="doc-history-sub">{n.assessment || '—'}</div>
                            <button
                              type="button"
                              className="doc-btn"
                              style={{ position: 'absolute', right: '10px', top: '10px', padding: '4px 8px', fontSize: '0.75rem' }}
                              onClick={() => {
                                setNoteForm(prev => ({
                                  ...prev,
                                  subjective: n.subjective || '',
                                  objective: n.objective || '',
                                  assessment: n.assessment || '',
                                  plan: n.plan || '',
                                  vaccinationHistory: n.vaccinationHistory || '',
                                  heartRateRhythm: n.heartRateRhythm || '',
                                  ecgNotes: n.ecgNotes || '',
                                  lesionType: n.lesionType || '',
                                  affectedArea: n.affectedArea || ''
                                }));
                                setToast({ type: 'success', message: 'Note copied to editor.' });
                              }}
                            >
                              <FileText size={12} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> Copy
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!doctorSpecialization.toLowerCase().includes('patholog') && !doctorSpecialization.toLowerCase().includes('radiolog') && (
                <div id="doc-sec-prescriptions" className="doc-card doc-section">
                  <div className="doc-card-header">
                    <div className="doc-card-title">
                      <ClipboardCheck size={18} />
                      Prescription
                    </div>
                  </div>

                {!selectedPatient ? (
                  <div className="doc-empty">Select a patient to create a prescription.</div>
                ) : (
                  <div className="doc-form">
                      {activePatientMeta.allergies && activePatientMeta.allergies.toLowerCase() !== 'none' && activePatientMeta.allergies.toLowerCase() !== 'n/a' && (
                        <div style={{ background: '#fef2f2', border: '1px solid #ef4444', padding: '12px', borderRadius: '8px', marginBottom: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b91c1c', fontWeight: 800, fontSize: '0.9rem' }}>
                            <AlertTriangle size={18} />
                            PATIENT ALLERGY ALERT
                          </div>
                          <div style={{ color: '#991b1b', fontSize: '0.85rem', marginTop: '4px' }}>
                            This patient is allergic to: <strong>{activePatientMeta.allergies}</strong>. Please review carefully before prescribing medications.
                          </div>
                        </div>
                      )}
                      <div className="doc-form-actions" style={{ justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <select className="doc-select" value={selectedRxTemplate} onChange={(e) => setSelectedRxTemplate(e.target.value)}>
                          <option value="">Templates (optional)</option>
                          {rxTemplates.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                        <button className="doc-btn" type="button" onClick={applySelectedRxTemplate} disabled={!selectedRxTemplate}>
                          <Check size={16} />
                          Apply
                        </button>
                        {rxDraftUpdatedAt ? (
                          <span className="doc-muted" style={{ fontWeight: 800 }}>
                            Draft saved: {new Date(rxDraftUpdatedAt).toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="doc-btn" type="button" onClick={saveRxDraft} disabled={!rxDraftKey}>
                          Save Draft
                        </button>
                        <button className="doc-btn" type="button" onClick={clearRxDraft} disabled={!rxDraftKey || !rxDraftUpdatedAt}>
                          Clear Draft
                        </button>
                      </div>
                    </div>

                    <input
                        className="doc-input"
                        list="icd10-codes"
                        placeholder="Diagnosis (ICD-10 Code or free text) e.g., J01.9"
                        value={prescriptionMeta.diagnosis}
                        onChange={(e) => setPrescriptionMeta((v) => ({ ...v, diagnosis: e.target.value }))}
                      />
                      <datalist id="icd10-codes">
                        <option value="J01.9 Acute sinusitis, unspecified" />
                        <option value="I10 Essential (primary) hypertension" />
                        <option value="E11.9 Type 2 diabetes mellitus without complications" />
                        <option value="J06.9 Acute upper respiratory infection, unspecified" />
                        <option value="J02.9 Acute pharyngitis, unspecified" />
                        <option value="J20.9 Acute tonsillitis, unspecified" />
                        <option value="J40 Acute bronchitis, unspecified" />
                        <option value="K21.9 Gastro-esophageal reflux disease without esophagitis" />
                        <option value="N39.0 Urinary tract infection, site not specified" />
                        <option value="A09 Infectious gastroenteritis and colitis, unspecified" />
                        <option value="R50.9 Fever, unspecified" />
                        <option value="R51 Headache" />
                        <option value="M54.5 Low back pain" />
                        <option value="J45.909 Unspecified asthma, uncomplicated" />
                        <option value="E78.5 Hyperlipidemia, unspecified" />
                      </datalist>

                    {doctorSpecialization.toLowerCase().includes('pediatric') && (() => {
                      const weightMatch = String(selectedPatient?.vitals?.weight || '').match(/(\d+(\.\d+)?)/);
                      const weightKg = weightMatch ? parseFloat(weightMatch[1]) : 0;
                      return (
                        <div style={{ background: '#f0fdfa', border: '1px solid #4ade80', padding: '12px', borderRadius: '8px', marginBottom: '15px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#166534', marginBottom: '8px' }}>Pediatric Auto-Dose Calculator</div>
                          {!weightKg ? (
                            <div style={{ fontSize: '0.75rem', color: '#b91c1c' }}>Weight not found in vitals. Please input weight manually in triage.</div>
                          ) : (
                            <div>
                              <div style={{ fontSize: '0.75rem', color: '#166534', marginBottom: '8px' }}><strong>Patient Weight:</strong> {weightKg} kg</div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {[
                                  { name: 'Paracetamol (250mg/5mL)', dose: '15mg/kg/dose', calc: (w) => `${((w * 15) / 250 * 5).toFixed(1)} mL every 4 hours for fever` },
                                  { name: 'Amoxicillin (250mg/5mL)', dose: '50mg/kg/day TID', calc: (w) => `${((w * 50 / 3) / 250 * 5).toFixed(1)} mL every 8 hours for 7 days` },
                                  { name: 'Cefuroxime (250mg/5mL)', dose: '30mg/kg/day BID', calc: (w) => `${((w * 30 / 2) / 250 * 5).toFixed(1)} mL every 12 hours for 7 days` },
                                  { name: 'Azithromycin (200mg/5mL)', dose: '10mg/kg OD', calc: (w) => `${((w * 10) / 200 * 5).toFixed(1)} mL once a day for 3 days` }
                                ].map(med => (
                                  <button key={med.name} type="button" onClick={() => {
                                    setPrescriptionMeta(prev => ({
                                      ...prev,
                                      instructions: (prev.instructions ? prev.instructions + '\n' : '') + `${med.name}: ${med.calc(weightKg)}`
                                    }));
                                  }} style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem', cursor: 'pointer' }}>
                                    + {med.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <input
                      className="doc-input"
                      placeholder="General instructions (optional)"
                      value={prescriptionMeta.instructions}
                      onChange={(e) => setPrescriptionMeta((v) => ({ ...v, instructions: e.target.value }))}
                    />

                    {(rxSafety.duplicateMeds.length > 0 || rxSafety.allergyHits.length > 0) && (
                      <div className="doc-alert doc-alert-warn">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <AlertCircle size={18} />
                          <div style={{ fontWeight: 900 }}>Safety checks</div>
                        </div>
                        <div className="doc-alert-body">
                          {rxSafety.duplicateMeds.length > 0 && (
                            <div>Duplicate medication entries: {rxSafety.duplicateMeds.join(', ')}</div>
                          )}
                          {rxSafety.allergyHits.length > 0 && (
                            <div>
                              Possible allergy match:{' '}
                              {rxSafety.allergyHits.slice(0, 4).map((h) => `${h.med}↔${h.allergy}`).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="doc-rx-items">
                      {prescriptionItems.map((it, idx) => (
                        <div key={idx} className="doc-rx-row">
                          <input className="doc-input" placeholder="Medication" value={it.medication} onChange={(e) => updatePrescriptionItem(idx, 'medication', e.target.value)} />
                          <input className="doc-input" placeholder="Dosage" value={it.dosage} onChange={(e) => updatePrescriptionItem(idx, 'dosage', e.target.value)} />
                          <input className="doc-input" placeholder="Frequency" value={it.frequency} onChange={(e) => updatePrescriptionItem(idx, 'frequency', e.target.value)} />
                          <input className="doc-input" placeholder="Duration" value={it.duration} onChange={(e) => updatePrescriptionItem(idx, 'duration', e.target.value)} />
                          <input className="doc-input" placeholder="Notes" value={it.notes} onChange={(e) => updatePrescriptionItem(idx, 'notes', e.target.value)} />
                          <button className="doc-icon-btn" type="button" onClick={() => removePrescriptionItem(idx)} disabled={prescriptionItems.length === 1}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="doc-form-actions">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <label htmlFor="rx-fulfillment" style={{ fontWeight: 700, color: '#475569' }}>
                          Fulfillment
                        </label>
                        <select
                          id="rx-fulfillment"
                          className="doc-select"
                          value={prescriptionFulfillment}
                          onChange={(e) => {
                            const next = String(e.target.value || 'not_sent');
                            setPrescriptionFulfillment(next);
                            setIsSentToPharmacy(next === 'hospital');
                          }}
                        >
                          <option value="not_sent">Prescription Only / Decide Later</option>
                          <option value="hospital">Send to Hospital Pharmacy</option>
                          <option value="external">Patient Will Buy Outside</option>
                        </select>
                        <span className="doc-muted" style={{ fontWeight: 700 }}>
                          {prescriptionFulfillment === 'hospital'
                            ? 'Pharmacist queue will receive this prescription.'
                            : prescriptionFulfillment === 'external'
                              ? 'This prescription will not be sent to the hospital pharmacy.'
                              : 'Save first, then decide later if it should go to pharmacy.'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="doc-btn" type="button" onClick={addPrescriptionItem}>
                          <Plus size={16} />
                          Add item
                        </button>
                        <button className="doc-primary" type="button" onClick={savePrescription} disabled={savingPrescription}>
                          Save Prescription
                        </button>
                      </div>
                    </div>

                    <div className="doc-history">
                      <div className="doc-history-title">Recent Prescriptions</div>
                      {prescriptions.length === 0 ? (
                        <div className="doc-muted">No prescriptions yet.</div>
                      ) : (
                        prescriptions.slice(0, 5).map((p) => (
                          <div key={p.id} className="doc-history-item rx-item">
                            <div className="doc-history-top">
                              <span className="doc-history-doctor">{p.doctorName}</span>
                              <div className="rx-actions">
                                <button className="doc-btn" type="button" onClick={() => copyToCurrentPrescription(p)} title="Copy items to current prescription">
                                  <Plus size={16} />
                                  Copy
                                </button>
                                <button className="doc-btn" type="button" onClick={() => printPrescription(p)}>
                                  <Printer size={16} />
                                  Print
                                </button>
                              </div>
                            </div>
                            <div className="doc-history-sub">
                              {(p.diagnosis || 'Prescription') + ' • ' + (p.pharmacyStatus || (p.is_sent_to_pharmacy ? 'Pending' : 'Not Sent'))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>
          </>
        )}

        {activeNav === 'worklist' && (
          <>
            <div className="doc-welcome-banner">
              <div className="doc-welcome-content">
                <div className="doc-welcome-main">Worklist</div>
                <div className="doc-welcome-sub">Appointments and approvals that need attention.</div>
              </div>
              <div className="doc-welcome-date-badge">{welcomeDateText}</div>
            </div>

            <div className="doctor-grid doctor-grid-2 doc-section">
              <div className="doc-card">
                <div className="doc-card-header">
                  <div className="doc-card-title">
                    <Calendar size={18} />
                    Appointments
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div className="doc-scope-chips">
                      <button type="button" className={`doc-chip ${worklistRange === 'today' ? 'active' : ''}`} onClick={() => setWorklistRange('today')}>
                        Today
                      </button>
                      <button type="button" className={`doc-chip ${worklistRange === 'week' ? 'active' : ''}`} onClick={() => setWorklistRange('week')}>
                        This week
                      </button>
                    </div>
                    <button className="doc-btn" type="button" onClick={fetchWorklist} disabled={worklistLoading}>
                      <RotateCw size={16} />
                      Refresh
                    </button>
                  </div>
                </div>

                {worklistLoading ? (
                  <div className="doc-muted">Loading…</div>
                ) : worklistError ? (
                  <div className="doc-muted">{worklistError}</div>
                ) : worklistAppointments.length === 0 ? (
                  <div className="doc-empty">No appointments found.</div>
                ) : (
                  <div className="doc-history">
                    {worklistAppointments.slice(0, 30).map((apt) => (
                      <button
                        key={apt.id}
                        type="button"
                        className="doc-history-item"
                        onClick={() => {
                          const aptPatientId = String(apt.patientId || apt.patient_id || '').trim();
                          const aptEmail = String(apt.email || '').trim().toLowerCase();
                          const matched =
                            (aptPatientId ? patients.find((p) => String(p._id || p.id || '').trim() === aptPatientId) : null) ||
                            (aptEmail ? patients.find((p) => String(p.email || '').trim().toLowerCase() === aptEmail) : null) ||
                            null;
                          if (matched) {
                            setSelectedPatient(matched);
                            setActiveNav('patient-summary');
                          } else {
                            setToast({ type: 'error', message: 'Patient record not found in system.' });
                          }
                        }}
                        style={{ width: '100%', textAlign: 'left' }}
                      >
                        <div className="doc-history-top">
                          <span className="doc-history-doctor">{apt.firstName} {apt.lastName}</span>
                          <span className="doc-muted">{apt.status || '—'}</span>
                        </div>
                        <div className="doc-history-sub" style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                          <span>{apt.reason || 'Appointment'}</span>
                          <span>{apt.appointmentTime || '—'}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="doc-card">
                <div className="doc-card-header">
                  <div className="doc-card-title">
                    <MessageSquare size={18} />
                    Pending Approvals
                  </div>
                  <button className="doc-btn" type="button" onClick={() => { setActiveNav('approval-inbox'); fetchApprovalInbox(); }}>
                    <ChevronRight size={16} />
                    Open Inbox
                  </button>
                </div>

                {worklistLoading ? (
                  <div className="doc-muted">Loading…</div>
                ) : worklistApprovals.length === 0 ? (
                  <div className="doc-empty">No approval requests.</div>
                ) : (
                  <div className="doc-history">
                    {worklistApprovals.slice(0, 30).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="doc-history-item"
                        onClick={() => {
                          setActiveNav('approval-inbox');
                          openApprovalThread(r.id);
                        }}
                        style={{ width: '100%', textAlign: 'left' }}
                      >
                        <div className="doc-history-top">
                          <span className="doc-history-doctor">{r.patientName || 'Patient'}</span>
                          <span className="doc-muted">
                            {Number(r.unreadCount || 0) > 0 ? `Unread: ${r.unreadCount}` : r.status || '—'}
                          </span>
                        </div>
                        <div className="doc-history-sub">{r.lastMessage || r.reason || '—'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeNav === 'patient-summary' && (
          <div className="doctor-grid doc-section">
            {patientCard}
            <div className="doc-card">
              <div className="doc-card-header">
                <div className="doc-card-title">
                  <FileText size={18} />
                  Patient Summary
                </div>
                {selectedPatient ? (
                  <button className="doc-btn" type="button" onClick={() => setShowFullRecord(true)}>
                    <ChevronRight size={16} />
                    Open Full Record
                  </button>
                ) : null}
              </div>

              {!selectedPatient ? (
                <div className="doc-empty">Select a patient to view summary.</div>
              ) : (
                <div className="doc-form">
                  <div className="doc-history">
                    <div className="doc-history-title">Timeline</div>
                    {[
                      ...notes.map((n) => ({ ...n, _kind: 'note' })),
                      ...prescriptions.map((p) => ({ ...p, _kind: 'prescription' })),
                      ...labResults.map((r) => ({ ...r, _kind: 'lab' })),
                      ...certificates.map((c) => ({ ...c, _kind: 'certificate' }))
                    ]
                      .sort(
                        (a, b) =>
                          new Date(b.created_at || b.createdAt || b.timestamp || 0) -
                          new Date(a.created_at || a.createdAt || a.timestamp || 0)
                      )
                      .slice(0, 25)
                      .map((item, idx) => {
                        const kind = item._kind;
                        const dateStr = new Date(item.created_at || item.createdAt || item.timestamp || Date.now()).toLocaleString();
                        const title = kind === 'note'
                          ? (item.assessment || item.subjective || 'Note')
                          : kind === 'prescription'
                            ? (item.diagnosis || 'Prescription')
                            : kind === 'lab'
                              ? (item.title || 'Result')
                              : (item.purpose || 'Certificate');
                        return (
                          <div key={item.id || idx} className="doc-history-item">
                            <div className="doc-history-top">
                              <span className="doc-history-doctor">
                                {kind === 'note' ? 'Note' : kind === 'prescription' ? 'Prescription' : kind === 'lab' ? (item.type || 'Lab') : 'Certificate'}
                              </span>
                              <span className="doc-muted">{dateStr}</span>
                            </div>
                            <div className="doc-history-sub">
                              {kind === 'lab' && item.url ? (
                                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 800 }}>
                                  {title}
                                </a>
                              ) : (
                                title
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeNav === 'approval-inbox' && (
          <div className="doctor-grid doctor-grid-2 doc-section">
            <div className="doc-card">
              <div className="doc-card-header">
                <div className="doc-card-title">
                  <MessageSquare size={18} />
                  Approvals Inbox
                </div>
                <button className="doc-btn" type="button" onClick={fetchApprovalInbox} disabled={approvalInboxLoading}>
                  <RotateCw size={16} />
                  Refresh
                </button>
              </div>
              {approvalInboxLoading ? (
                <div className="doc-muted">Loading…</div>
              ) : approvalInboxError ? (
                <div className="doc-muted">{approvalInboxError}</div>
              ) : approvalInbox.length === 0 ? (
                <div className="doc-empty">No approval requests.</div>
              ) : (
                <div className="doc-history">
                  {approvalInbox.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`doc-history-item ${String(r.id) === String(selectedApprovalId) ? 'active' : ''}`}
                      onClick={() => openApprovalThread(r.id)}
                      style={{ width: '100%', textAlign: 'left' }}
                    >
                      <div className="doc-history-top">
                        <span className="doc-history-doctor">{r.patientName || 'Patient'}</span>
                        <span className="doc-muted">
                          {Number(r.unreadCount || 0) > 0 ? `Unread: ${r.unreadCount}` : r.status || '—'}
                        </span>
                      </div>
                      <div className="doc-history-sub">{r.lastMessage || r.reason || '—'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="doc-card">
              <div className="doc-card-header">
                <div className="doc-card-title">
                  <ClipboardCheck size={18} />
                  Conversation
                </div>
              </div>
              {!selectedApprovalId ? (
                <div className="doc-empty">Select an approval request to view messages.</div>
              ) : approvalThreadLoading ? (
                <div className="doc-muted">Loading…</div>
              ) : (
                <>
                  <div className="doc-approval-panel">
                    <div className="doc-approval-panel-top">
                      <div>
                        <div className="doc-approval-title">{approvalThread?.patientName || 'Patient'}</div>
                        <div className="doc-approval-sub">
                          {approvalThread?.serviceType ? <span>{approvalThread.serviceType}</span> : null}
                          {approvalThread?.requestedDate ? <span>{new Date(approvalThread.requestedDate).toLocaleDateString()}</span> : null}
                          {approvalThread?.requestedTime ? <span>{new Date(approvalThread.requestedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
                        </div>
                        {approvalThread?.reason ? <div className="doc-muted" style={{ marginTop: '6px' }}>{approvalThread.reason}</div> : null}
                      </div>
                      <div className="doc-approval-status">
                        <span className="doc-badge">{approvalThread?.status || 'Pending'}</span>
                      </div>
                    </div>

                    <div className="doc-approval-actions">
                      <button
                        className="doc-primary"
                        type="button"
                        onClick={() => applyApprovalAction('Approved')}
                        disabled={approvalActionLoading || approvalThread?.status === 'Approved' || approvalThread?.status === 'Rejected'}
                      >
                        <Check size={16} />
                        Approve
                      </button>
                      <button
                        className="doc-btn"
                        type="button"
                        onClick={() => applyApprovalAction('Rejected')}
                        disabled={approvalActionLoading || approvalThread?.status === 'Approved' || approvalThread?.status === 'Rejected'}
                      >
                        <Ban size={16} />
                        Reject
                      </button>
                      <button
                        className="doc-btn"
                        type="button"
                        onClick={() => applyApprovalAction('Suggested')}
                        disabled={approvalActionLoading || approvalThread?.status === 'Approved' || approvalThread?.status === 'Rejected'}
                      >
                        <CornerUpRight size={16} />
                        Suggest schedule
                      </button>
                    </div>

                    {(approvalThread?.status !== 'Approved' && approvalThread?.status !== 'Rejected') && (
                      <div className="doc-approval-inputs">
                        <input
                          className="doc-input"
                          placeholder="Rejection reason (optional)"
                          value={approvalRejectNote}
                          onChange={(e) => setApprovalRejectNote(e.target.value)}
                        />
                        <div className="doc-approval-suggest-row">
                          <input
                            className="doc-input"
                            type="date"
                            value={approvalSuggest.date}
                            onChange={(e) => setApprovalSuggest((v) => ({ ...v, date: e.target.value }))}
                          />
                          <input
                            className="doc-input"
                            type="time"
                            value={approvalSuggest.time}
                            onChange={(e) => setApprovalSuggest((v) => ({ ...v, time: e.target.value }))}
                          />
                          <input
                            className="doc-input"
                            placeholder="Suggestion note (optional)"
                            value={approvalSuggest.note}
                            onChange={(e) => setApprovalSuggest((v) => ({ ...v, note: e.target.value }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="doc-history">
                    {approvalMessages.length === 0 ? (
                      <div className="doc-muted">No messages yet.</div>
                    ) : (
                      approvalMessages.map((m) => (
                        <div key={m.id} className="doc-history-item">
                          <div className="doc-history-top">
                            <span className="doc-history-doctor">{m.senderName || m.senderRole}</span>
                            <span className="doc-muted">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
                          </div>
                          <div className="doc-history-sub">{m.body}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="doc-form" style={{ marginTop: '12px' }}>
                    <textarea
                      className="doc-textarea"
                      placeholder="Reply…"
                      value={approvalReply}
                      onChange={(e) => setApprovalReply(e.target.value)}
                    />
                    <button className="doc-primary" type="button" onClick={sendApprovalReply} disabled={sendingApprovalReply || !String(approvalReply || '').trim()}>
                      <Send size={16} />
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {activeNav === 'doctor-chat' && (
          <div className="doctor-grid doc-section dc-chat-outer" style={{ flex: 1, minHeight: 0, height: 0 }}>
            <div className="doc-card dc-chat-card" style={{ overflow: 'hidden', minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <div className="doc-card-header" style={{ padding: '12px 16px 14px', borderBottom: doctorChatShowSearch || !doctorChatBannerDismissed ? '1px solid #f1f5f9' : '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div className="doc-card-title">
                        <MessageSquare size={18} />
                        {doctorChatSpecialty ? `Doctor Chat • ${doctorChatSpecialty}` : 'Doctor Chat'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.78rem', fontWeight: 600, color: '#475569', paddingLeft: 28 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className={`dc-dot dc-dot-on`} style={{ width: 9, height: 9, borderRadius: 999, background: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,0.18)' }} />
                          <strong style={{ color: '#0f172a' }}>{doctorChatOnlineCounts.on}</strong> Online
                          {doctorChatOnlineCounts.away > 0 && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                              <span className={`dc-dot dc-dot-away`} style={{ width: 8, height: 8, borderRadius: 999, background: '#eab308', boxShadow: '0 0 0 3px rgba(234,179,8,0.14)' }} />
                              {doctorChatOnlineCounts.away} Away
                            </span>
                          )}
                        </span>
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>• Total {doctorChatOnlineCounts.total} doctors seen</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {doctorChatPinnedMessages.length > 0 && (
                        <button
                          className={`doc-btn ${doctorChatPinOpen ? 'dc-btn-active' : ''}`}
                          type="button"
                          onClick={() => setDoctorChatPinOpen((v) => !v)}
                          title={`📌 Pinned (${doctorChatPinnedMessages.length})`}
                          style={{ position: 'relative' }}
                        >
                          <Pin size={14} />
                          <span style={{ fontSize: '0.76rem', fontWeight: 800, marginLeft: 4 }}>{doctorChatPinnedMessages.length}</span>
                        </button>
                      )}
                      <button className={`doc-btn ${doctorChatShowSearch ? 'dc-btn-active' : ''}`} type="button" onClick={() => setDoctorChatShowSearch((v) => !v)} title="Search messages">
                        <Search size={14} />
                      </button>
                      <button className="doc-btn" type="button" onClick={() => { loadDoctorChatMessages(); }} disabled={doctorChatLoading}>
                        <RotateCw size={16} />
                        Refresh
                      </button>
                    </div>
                  </div>

                  {doctorChatShowSearch && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                      <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', zIndex: 1 }} />
                        <input
                          className="doc-input"
                          placeholder="Search messages… (e.g., STAT, patient, xray)"
                          value={doctorChatSearch}
                          onChange={(e) => setDoctorChatSearch(e.target.value)}
                          style={{ paddingLeft: 36 }}
                        />
                      </div>
                      {doctorChatSearch && (
                        <button className="doc-btn" type="button" onClick={() => { setDoctorChatSearch(''); }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )}

                  {!doctorChatBannerDismissed && (
                    <div className="dc-banner" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid rgba(234,88,12,0.22)', background: 'linear-gradient(180deg,#fff7ed,#ffffff)', borderRadius: 12, color: '#7c2d12', fontSize: '0.78rem', lineHeight: 1.5 }}>
                      <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 2, color: '#c2410c' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: '#9a3412' }}>DOH / Data Privacy Act Reminder</div>
                        <div>Avoid posting patient full names, lab values, addresses, or confidential PHI in shared chat rooms. Use patient IDs only. Violations may breach RA 10173.</div>
                      </div>
                      <button
                        type="button"
                        className="doc-btn"
                        style={{ padding: '4px 8px', minHeight: 0, height: 26, fontWeight: 700, color: '#94a3b8' }}
                        onClick={() => {
                          try {
                            const n = (Number(localStorage.getItem('dc_phi_banner_closed') || 0) + 1);
                            localStorage.setItem('dc_phi_banner_closed', String(n));
                            if (n >= 3) setDoctorChatBannerDismissed(true);
                          } catch (_) { setDoctorChatBannerDismissed(true); }
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {doctorChatPinOpen && doctorChatPinnedMessages.length > 0 && (
                    <div className="dc-pinned-wrap" style={{ border: '1px solid rgba(234,88,12,0.18)', background: '#fff7ed', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(234,88,12,0.14)', fontWeight: 800, fontSize: '0.8rem', color: '#9a3412' }}>
                        <Pin size={13} /> 📌 Pinned Announcements <span style={{ marginLeft: 'auto', color: '#b45309', fontWeight: 700 }}>(max 3)</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {doctorChatPinnedMessages.map((m, i) => {
                          const preview = String(m?.body || m?.attachment_name || '(attachment)').slice(0, 140) + (String(m?.body || '').length > 140 ? '…' : '');
                          const sn = guessDisplayName(m);
                          return (
                            <button
                              key={`pin-${m?.id || i}`}
                              type="button"
                              onClick={() => doctorChatScrollToMsg(m?.id)}
                              style={{ textAlign: 'left', cursor: 'pointer', padding: '10px 12px', borderBottom: i < doctorChatPinnedMessages.length - 1 ? '1px dashed rgba(234,88,12,0.12)' : 'none', background: 'transparent', color: '#431407' }}
                              className="dc-pin-row"
                              onMouseEnter={(e) => { e.currentTarget.style.background = '#ffedd5'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#9a3412' }}>{sn}</div>
                                <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 600 }}>{formatDoctorChatTime(m.pinned_at || m.created_at)}</div>
                              </div>
                              <div style={{ fontSize: '0.88rem', lineHeight: 1.5, marginTop: 4, fontWeight: 500 }}>{preview}</div>
                              <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#c2410c', fontWeight: 700 }}>Jump →</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {doctorChatLoading ? (
                <div className="doc-muted" style={{ padding: '30px 16px', textAlign: 'center' }}><div style={{ opacity: 0.6, marginBottom: 6 }}>Loading chat…</div></div>
              ) : doctorChatError ? (
                <div className="doc-muted" style={{ padding: '20px 16px', color: '#991b1b', fontWeight: 600 }}>{doctorChatError}</div>
              ) : (
                <div
                  ref={doctorChatScrollRef}
                  className="dc-scroll-pane"
                  style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '14px 16px 16px', background: '#f8fafc', scrollBehavior: 'smooth' }}
                >
                  {doctorChatLoadingOlder && (
                    <div style={{ textAlign: 'center', padding: '10px 0 16px', color: '#64748b', fontSize: '0.76rem', fontWeight: 700 }}>
                      <RotateCw size={13} style={{ display: 'inline-block', animation: 'spin 1s linear infinite', verticalAlign: -2, marginRight: 6 }} /> Loading older messages…
                    </div>
                  )}
                  {!doctorChatLoadingOlder && !doctorChatOlderExhausted && (
                    <div style={{ textAlign: 'center', padding: '0 0 6px', color: '#94a3b8', fontSize: '0.72rem', fontWeight: 600 }}>⬆ Scroll up to load older messages</div>
                  )}
                  {doctorChatSearch && (
                    <div style={{ textAlign: 'center', padding: '6px 12px 14px', fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>
                      <Search size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
                      Search results: <strong style={{ color: '#0f172a' }}>{doctorChatFiltered.length}</strong> match{doctorChatFiltered.length === 1 ? '' : 'es'} for "{doctorChatSearch}"
                    </div>
                  )}

                  {doctorChatFiltered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '34px 12px', color: '#64748b' }}>
                      <MessageSquare size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#334155' }}>{doctorChatSearch ? 'No messages match your search.' : 'No messages yet.'}</div>
                      <div style={{ marginTop: 4, fontSize: '0.82rem' }}>{doctorChatSearch ? 'Try different keywords.' : 'Type a greeting below to start chatting with other doctors.'}</div>
                    </div>
                  ) : (
                    (() => {
                      const items = [];
                      let lastDay = '';
                      let lastSenderKey = '';
                      doctorChatFiltered.forEach((msg, idx) => {
                        if (msg?.deleted) {
                          const ts = msg.created_at || msg.createdAt;
                          const dayKey = formatDoctorChatDayKey(ts);
                          if (dayKey && dayKey !== lastDay) { lastDay = dayKey; lastSenderKey = ''; }
                          const mine = isDoctorChatMine(msg);
                          items.push(
                            <div key={msg?.id || `del-${idx}`} className="dc-bubble-row" style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                              <div className="dc-deleted-bubble" style={{ display: 'inline-block', padding: '8px 14px', borderRadius: 12, fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic', background: '#f1f5f9', border: '1px dashed #cbd5e1' }}>
                                {mine ? 'You' : guessDisplayName(msg)} deleted this message.
                              </div>
                            </div>
                          );
                          return;
                        }
                        const ts = msg?.created_at || msg?.createdAt || null;
                        const dayKey = formatDoctorChatDayKey(ts);
                        if (dayKey && dayKey !== lastDay) {
                          lastDay = dayKey;
                          lastSenderKey = '';
                          items.push(
                            <div key={`day-${dayKey}-${idx}`} className="dc-divider-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px 0 14px' }}>
                              <div className="dc-divider" style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                              <div className="dc-divider-label" style={{ margin: '0 10px', padding: '4px 10px', fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.02em', color: '#64748b', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 999 }}>
                                {formatDoctorChatDayLabel(dayKey)}
                              </div>
                              <div className="dc-divider" style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                            </div>
                          );
                        }
                        const mine = isDoctorChatMine(msg);
                        const displayName = guessDisplayName(msg);
                        const senderDeptRaw = String(msg?.sender_dept || msg?.senderDept || '').trim();
                        const senderDept = senderDeptRaw || (() => {
                          const specRaw = String(msg?.sender_specialization || msg?.senderSpecialization || '').trim();
                          return specRaw ? specRaw.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
                        })();
                        const onlineKey = normalizeSenderKey(displayName + '|' + senderDept);
                        const onlineInfo = doctorChatOnlineMap.get(onlineKey) || { level: 'off', label: 'Offline' };
                        const senderKey = `${mine ? 'ME' : 'OTHER'}-${displayName}|${senderDept}|${onlineInfo.level}`;
                        const showHeader = !mine && senderKey !== lastSenderKey;
                        lastSenderKey = senderKey;
                        const timeText = formatDoctorChatTime(ts);
                        const fullTs = formatDoctorChatFullTs(ts);
                        const msgId = msg?.id || idx;
                        const isPinned = !!msg?.pinned;
                        const replyToBody = String(msg?.reply_to_body || msg?.replyToBody || '').slice(0, 160);
                        const replyToSender = String(msg?.reply_to_sender || msg?.replyToSender || '').trim() || 'Doctor';
                        const hasAttach = msg?.attachment_kind || msg?.attachmentKind;
                        const attKind = String(msg?.attachment_kind || msg?.attachmentKind || '').toLowerCase();
                        const attName = String(msg?.attachment_name || msg?.attachmentName || '').trim();
                        const attSize = Number(msg?.attachment_size || msg?.attachmentSize || 0);
                        const attUrl = String(msg?.attachment_url || msg?.attachmentUrl || msg?.attachment_public_url || msg?.attachmentPublicUrl || '').trim();
                        const attPublic = String(msg?.attachment_public_url || msg?.attachmentPublicUrl || '').trim();
                        const sizeStr = attSize ? (attSize >= 1024 * 1024 ? `${(attSize / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(attSize / 1024))} KB`) : '';
                        const q = String(doctorChatSearch || '').trim().toLowerCase();
                        const searchHL = (text) => {
                          const raw = String(text || '');
                          if (!q) return raw;
                          const i = raw.toLowerCase().indexOf(q);
                          if (i < 0) return raw;
                          return (
                            <>
                              {raw.slice(0, i)}
                              <mark className="dc-highlight" style={{ background: 'rgba(250, 204, 21, 0.35)', padding: '1px 2px', borderRadius: 3 }}>{raw.slice(i, i + q.length)}</mark>
                              {raw.slice(i + q.length)}
                            </>
                          );
                        };

                        items.push(
                          <div
                            key={msgId}
                            data-dc-id={String(msgId)}
                            className={`dc-bubble-row ${mine ? 'dc-bubble-row-me' : 'dc-bubble-row-other'} ${isPinned ? 'dc-pin-highlight' : ''}`}
                            style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 12, position: 'relative' }}
                          >
                            {showHeader && (
                              <div className="dc-name-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', fontWeight: 800, color: '#334155', marginBottom: 5, paddingLeft: 2, paddingRight: 2 }}>
                                <span className={`dc-dot dc-dot-${onlineInfo.level}`} style={{ width: 8, height: 8, borderRadius: 999, background: onlineInfo.level === 'on' ? '#22c55e' : onlineInfo.level === 'away' ? '#eab308' : '#94a3b8', boxShadow: `0 0 0 3px ${onlineInfo.level === 'on' ? 'rgba(34,197,94,0.16)' : onlineInfo.level === 'away' ? 'rgba(234,179,8,0.14)' : 'rgba(148,163,184,0.14)'}` }} title={onlineInfo.label} />
                                <span>{searchHL(displayName)}</span>
                                {senderDept && <span style={{ color: '#94a3b8', fontWeight: 600 }}>• {senderDept}</span>}
                                <span style={{ color: '#94a3b8', fontWeight: 600, marginLeft: 4 }}>• {onlineInfo.label}</span>
                              </div>
                            )}

                            {replyToBody && (
                              <div
                                className="dc-reply-quote"
                                style={{
                                  maxWidth: '78%',
                                  marginBottom: 4,
                                  padding: '6px 10px',
                                  fontSize: '0.76rem',
                                  background: mine ? 'rgba(255,255,255,0.16)' : 'rgba(234,88,12,0.06)',
                                  color: mine ? '#fff7ed' : '#9a3412',
                                  borderLeft: `3px solid ${mine ? '#fb923c' : 'var(--primary, #ea580c)'}`,
                                  borderRadius: '10px 10px 10px 4px',
                                  fontWeight: 600,
                                  lineHeight: 1.45,
                                  alignSelf: mine ? 'flex-end' : 'flex-start'
                                }}>
                                  <div style={{ fontSize: '0.68rem', fontWeight: 800, marginBottom: 2, opacity: 0.92 }}>↩ Replying to {replyToSender}</div>
                                  <div style={{ opacity: 0.92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{replyToBody}</div>
                                </div>
                            )}

                            <div className="dc-message-wrap" style={{ position: 'relative', maxWidth: '100%' }}>
                              <div
                                className={`dc-bubble ${mine ? 'dc-bubble-me' : 'dc-bubble-other'}`}
                                title={fullTs}
                                style={{
                                  display: 'inline-block',
                                  position: 'relative',
                                  padding: isPinned ? '10px 14px 8px' : '11px 14px',
                                  borderRadius: mine ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
                                  background: isPinned ? (mine ? 'linear-gradient(180deg,#f59e0b,#ea580c)' : 'linear-gradient(180deg,#fff7ed,#ffffff)') : (mine ? 'var(--primary, #ea580c)' : '#ffffff'),
                                  color: isPinned ? (mine ? '#ffffff' : '#7c2d12') : (mine ? '#ffffff' : '#0f172a'),
                                  boxShadow: isPinned
                                    ? '0 6px 14px rgba(234,88,12,0.18), 0 2px 4px rgba(15,23,42,0.05)'
                                    : '0 2px 6px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
                                  maxWidth: '82%',
                                  minWidth: hasAttach ? 230 : 0,
                                  whiteSpace: 'pre-wrap',
                                  overflowWrap: 'anywhere',
                                  lineHeight: 1.5,
                                  fontSize: '0.95rem',
                                  fontWeight: 500,
                                  border: isPinned
                                    ? (mine ? '1px solid rgba(180,83,9,0.28)' : '1px solid rgba(234,88,12,0.28)')
                                    : (mine ? '1px solid rgba(0,0,0,0.06)' : '1px solid #e2e8f0')
                                }}
                              >
                                {isPinned && (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.68rem', fontWeight: 800, marginBottom: 5, letterSpacing: '0.03em', opacity: 0.92 }}>
                                    <Pin size={11} /> PINNED
                                  </div>
                                )}
                                {String(msg?.body || '').trim() && <div className="dc-bubble-body" style={{ marginTop: isPinned ? 2 : 0 }}>{searchHL(String(msg.body).trim())}</div>}

                                {hasAttach && (
                                  <div
                                    className="dc-attachment"
                                    style={{ marginTop: 9, display: 'block' }}
                                  >
                                    {attKind === 'image' && (
                                      <div
                                        className="dc-att-image"
                                        onClick={() => { if (attUrl || attPublic) setDoctorChatAttPreview({ kind: 'image', src: attUrl || attPublic, name: attName }); }}
                                        style={{ cursor: 'zoom-in', borderRadius: 12, overflow: 'hidden', border: mine ? '1px solid rgba(255,255,255,0.2)' : '1px solid #e2e8f0', maxWidth: 320 }}
                                      >
                                        <img src={attUrl || attPublic} alt={attName || 'image'} loading="lazy" style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 260, objectFit: 'cover', background: mine ? 'rgba(255,255,255,0.06)' : '#f8fafc' }} />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontWeight: 700, fontSize: '0.74rem', color: mine ? '#fff7ed' : '#475569', background: mine ? 'rgba(0,0,0,0.12)' : '#f8fafc', borderTop: mine ? '1px solid rgba(255,255,255,0.1)' : '1px solid #f1f5f9' }}>
                                          <ImageIcon size={12} />
                                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attName || 'Image'}</span>
                                          {sizeStr && <span style={{ opacity: 0.85 }}>{sizeStr}</span>}
                                        </div>
                                      </div>
                                    )}

                                    {attKind === 'pdf' && (
                                      <a
                                        className="dc-att-pdf"
                                        href={attUrl || attPublic}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
                                          background: mine ? 'rgba(0,0,0,0.14)' : '#f8fafc',
                                          color: mine ? '#fff7ed' : '#7c2d12',
                                          textDecoration: 'none',
                                          border: mine ? '1px solid rgba(255,255,255,0.15)' : '1px solid #f1f5f9',
                                          minWidth: 220, maxWidth: 320
                                        }}
                                      >
                                        <div style={{ width: 34, height: 34, borderRadius: 8, background: mine ? 'rgba(239,68,68,0.28)' : '#fef2f2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: mine ? '#fecaca' : '#dc2626', flex: '0 0 auto' }}>
                                          <File size={17} />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: '0.82rem', fontWeight: 800, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attName || 'Document.pdf'}</div>
                                          <div style={{ fontSize: '0.7rem', fontWeight: 600, marginTop: 2, opacity: 0.88 }}>
                                            {sizeStr || 'PDF'} • <span style={{ textDecoration: 'underline' }}>Open PDF</span>
                                          </div>
                                        </div>
                                        <Download size={13} style={{ opacity: 0.85 }} />
                                      </a>
                                    )}

                                    {attKind === 'video' && (
                                      <div className="dc-att-video" style={{ borderRadius: 12, overflow: 'hidden', maxWidth: 340, background: mine ? 'rgba(0,0,0,0.16)' : '#0f172a', border: mine ? '1px solid rgba(255,255,255,0.18)' : '1px solid #1e293b' }}>
                                        <video
                                          controls
                                          preload="metadata"
                                          src={attUrl || attPublic}
                                          style={{ display: 'block', width: '100%', maxHeight: 280, background: '#0f172a' }}
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', color: mine ? '#fff7ed' : '#cbd5e1', fontSize: '0.72rem', fontWeight: 700, background: mine ? 'rgba(0,0,0,0.2)' : '#0f172a' }}>
                                          <VideoIcon size={12} />
                                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attName || 'Video'}</span>
                                          {sizeStr && <span style={{ opacity: 0.85 }}>{sizeStr}</span>}
                                        </div>
                                      </div>
                                    )}

                                    {!['image', 'pdf', 'video'].includes(attKind) && attName && (
                                      <div style={{ marginTop: 6, fontSize: '0.76rem', opacity: 0.92, fontWeight: 600 }}>📎 {attName}</div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <button
                                type="button"
                                aria-label="Message options"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDoctorChatMsgMenu((prev) => (prev && prev.id === msgId) ? null : { id: msgId, msg, mine });
                                }}
                                className={`dc-msg-more ${doctorChatMsgMenu?.id === msgId ? 'dc-msg-more-open' : ''}`}
                                style={{
                                  position: 'absolute', top: 2, right: mine ? 'auto' : -4, left: mine ? -4 : 'auto',
                                  width: 26, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                                  background: mine ? 'rgba(0,0,0,0.06)' : 'rgba(148,163,184,0.12)',
                                  color: mine ? 'rgba(255,255,255,0.82)' : '#64748b',
                                  opacity: 0, transition: 'opacity 120ms ease',
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
                                onMouseLeave={(e) => { if (!(doctorChatMsgMenu && doctorChatMsgMenu.id === msgId)) e.currentTarget.style.opacity = 0; }}
                              >
                                <MoreHorizontal size={13} />
                              </button>

                              {doctorChatMsgMenu && doctorChatMsgMenu.id === msgId && (
                                <div
                                  className="dc-msg-menu"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    position: 'absolute',
                                    top: mine ? 30 : 30,
                                    right: mine ? -6 : 'auto',
                                    left: mine ? 'auto' : -6,
                                    zIndex: 30,
                                    minWidth: 190,
                                    background: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 12,
                                    padding: 6,
                                    boxShadow: '0 10px 24px rgba(15,23,42,0.14), 0 4px 8px rgba(15,23,42,0.07)',
                                    display: 'flex', flexDirection: 'column', gap: 2,
                                    fontSize: '0.8rem',
                                    fontWeight: 600
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => { const text = String(msg.body || attName || ''); if (msg?.attachment_url || msg?.attachment_public_url) { const u = msg.attachment_url || msg.attachment_public_url; window.open(u, '_blank', 'noopener'); setDoctorChatMsgMenu(null); return; } doctorChatCopyText(text); setDoctorChatMsgMenu(null); }}
                                    className="dc-menu-btn"
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: '#0f172a', fontWeight: 600 }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <Copy size={13} /> {hasAttach ? 'Open / Copy' : 'Copy text'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setDoctorChatReplying({ id: msg.id, body: String(msg.body || attName || '[message]'), sender: guessDisplayName(msg) }); setDoctorChatMsgMenu(null); setTimeout(() => { try { const input = document.querySelector('.dc-compose-input'); if (input) input.focus(); } catch(_) {} }, 40); }}
                                    className="dc-menu-btn"
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: '#0f172a', fontWeight: 600 }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <Reply size={13} /> Reply / Quote
                                  </button>
                                  {(!mine || doctorChatMessageDeletable(msg)) && (
                                    <button
                                      type="button"
                                      onClick={() => doctorChatTogglePin(msg)}
                                      className="dc-menu-btn"
                                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: isPinned ? '#9a3412' : '#7c2d12', fontWeight: 700 }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = '#fff7ed'}
                                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <Pin size={13} /> {isPinned ? 'Unpin (max 3)' : 'Pin announcement 📌'}
                                    </button>
                                  )}
                                  {mine && doctorChatMessageDeletable(msg) && (
                                    <button
                                      type="button"
                                      onClick={() => { setDoctorChatDeleteConfirm(msg); setDoctorChatMsgMenu(null); }}
                                      className="dc-menu-btn"
                                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: '#b91c1c', fontWeight: 700 }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      <Trash2 size={13} /> Delete (5-min rule)
                                    </button>
                                  )}
                                  {mine && !doctorChatMessageDeletable(msg) && (
                                    <div style={{ padding: '6px 10px', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>⏱ Deletion window closed</div>
                                  )}
                                </div>
                              )}
                            </div>

                            {timeText && (
                              <div className="dc-time-label" title={fullTs} style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 5, paddingLeft: 4, paddingRight: 4, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <Clock size={10} style={{ opacity: 0.8 }} /> {timeText}
                                {mine && <Check size={10} style={{ opacity: 0.65, color: '#22c55e' }} title="Delivered" />}
                              </div>
                            )}
                          </div>
                        );
                      });
                      return items;
                    })()
                  )}
                </div>
              )}

              {doctorChatShowFAB && (
                <button
                  type="button"
                  aria-label="Scroll to new messages"
                  onClick={() => { scrollDoctorChatToBottom(true); }}
                  style={{
                    position: 'absolute', bottom: 170, right: 28, zIndex: 20,
                    width: 44, height: 44, borderRadius: 22,
                    background: 'var(--primary, #ea580c)',
                    color: 'white',
                    border: 'none', cursor: 'pointer',
                    boxShadow: '0 10px 20px rgba(234,88,12,0.32), 0 4px 8px rgba(15,23,42,0.08)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0
                  }}
                  className="dc-fab-scroll"
                >
                  {doctorChatUnreadBadge > 0 && (
                    <span style={{
                      position: 'absolute', top: -6, right: -6, background: '#ef4444',
                      color: 'white', fontWeight: 800, fontSize: '0.68rem',
                      width: 22, height: 22, borderRadius: 11,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 0 0 2px #f8fafc', padding: 0, lineHeight: 1
                    }}>
                      {doctorChatUnreadBadge > 99 ? '99+' : doctorChatUnreadBadge}
                    </span>
                  )}
                  <ArrowDown size={17} />
                </button>
              )}

              {doctorChatReplying && (
                <div style={{
                  padding: '8px 16px 0',
                  background: 'linear-gradient(180deg,#f8fafc,transparent)'
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px 8px 12px',
                    background: '#fff7ed',
                    border: '1px solid rgba(234,88,12,0.18)',
                    borderRadius: 10,
                    fontSize: '0.78rem'
                  }}>
                    <CornerUpRight size={13} style={{ color: 'var(--primary, #ea580c)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, color: '#9a3412', fontSize: '0.72rem' }}>
                        Replying to {doctorChatReplying.sender || 'Doctor'}
                      </div>
                      <div style={{ color: '#7c2d12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {String(doctorChatReplying.body || '').slice(0, 140)}
                      </div>
                    </div>
                    <button type="button" className="doc-btn" onClick={() => setDoctorChatReplying(null)} style={{ padding: '4px 8px', height: 26, minHeight: 0, fontWeight: 700, color: '#b45309' }}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {doctorChatAttachment && (
                <div style={{ padding: '8px 16px 0', background: 'linear-gradient(180deg,#f8fafc,transparent)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    background: '#ecfdf5',
                    border: '1px solid rgba(34,197,94,0.2)',
                    borderRadius: 10
                  }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 8,
                      background: doctorChatAttachment.kind === 'image' ? '#fef3c7' : doctorChatAttachment.kind === 'pdf' ? '#fee2e2' : '#e0e7ff',
                      color: doctorChatAttachment.kind === 'image' ? '#b45309' : doctorChatAttachment.kind === 'pdf' ? '#b91c1c' : '#4f46e5',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto'
                    }}>
                      {doctorChatAttachment.kind === 'image' ? <ImageIcon size={16} /> : doctorChatAttachment.kind === 'pdf' ? <File size={16} /> : <VideoIcon size={16} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, color: '#065f46', fontSize: '0.8rem' }}>
                        {doctorChatAttachment.kind.toUpperCase()} ready to attach
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#047857', fontWeight: 600 }}>
                        {doctorChatAttachment.name} • {doctorChatAttachment.size >= 1024*1024 ? `${(doctorChatAttachment.size/1024/1024).toFixed(1)} MB` : `${Math.max(1, Math.round(doctorChatAttachment.size/1024))} KB`}
                      </div>
                    </div>
                    {doctorChatAttachmentUploading ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.76rem', color: '#065f46' }}>
                        <RotateCw size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Uploading…
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="doc-btn danger"
                        style={{ height: 28, minHeight: 0, padding: '4px 8px', fontWeight: 700, fontSize: '0.72rem', color: '#991b1b' }}
                        onClick={() => setDoctorChatAttachment(null)}
                        disabled={doctorChatAttachmentUploading}
                      >
                        <X size={12} /> Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div style={{ padding: '10px 16px 4px', background: 'linear-gradient(180deg,#f8fafc,transparent)' }}>
                <div className="dc-quick-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {doctorChatQuickReplies.map((qr) => (
                    <button
                      key={qr.id}
                      type="button"
                      onClick={() => { setDoctorChatText(qr.text); setTimeout(() => sendDoctorChatMessage(), 40); }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        border: '1px solid rgba(234,88,12,0.2)',
                        background: '#ffffff',
                        color: '#9a3412',
                        fontWeight: 700,
                        fontSize: '0.74rem',
                        cursor: 'pointer',
                        transition: 'all 120ms ease'
                      }}
                      className="dc-quick-chip"
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#fff7ed'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                      <Sparkles size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: -1, opacity: 0.7 }} /> {qr.label}
                    </button>
                  ))}
                </div>
              </div>

              <div ref={doctorChatComposeRef} className="doc-msg-compose dc-compose-wrap" style={{ padding: '12px 16px 16px', background: '#fff', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'flex-end' }}>
                  <input
                    ref={doctorChatFileInputRef}
                    type="file"
                    accept={`${doctorChatFileAllowed.image.accept},${doctorChatFileAllowed.pdf.accept},${doctorChatFileAllowed.video.accept}`}
                    onChange={doctorChatOnPickFile}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="doc-btn"
                    style={{ height: 44, width: 44, minHeight: 0, padding: 0, borderRadius: 14, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#475569', background: '#fff', flex: '0 0 auto' }}
                    title="📎 Attach image / PDF / video"
                    onClick={() => { try { doctorChatFileInputRef.current?.click(); } catch(_) {} }}
                  >
                    <Paperclip size={16} />
                  </button>
                  <div style={{ position: 'relative', minWidth: 0, width: '100%' }}>
                    <textarea
                      ref={(el) => { if (typeof doctorChatComposeRef === 'object' && doctorChatComposeRef) (doctorChatComposeRef._textarea = el); }}
                      className={`doc-textarea dc-compose-input ${doctorChatInputInvalid ? 'dc-input-shake' : ''}`}
                      rows={3}
                      placeholder={doctorChatSpecialty ? 'Type a message… (max 2000 chars) — Enter to send, ⇧ Enter for new line' : 'Set specialization to enable chat…'}
                      value={doctorChatText}
                      maxLength={2100}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDoctorChatText(val);
                        try {
                          const el = e.target;
                          if (el && typeof el.style !== 'undefined') {
                            el.style.height = 'auto';
                            const next = Math.max(62, Math.min(170, el.scrollHeight));
                            el.style.height = next + 'px';
                          }
                        } catch (_) {}
                        const atPos = val.lastIndexOf('@');
                        if (atPos >= 0 && /(^|\s)@\w*$/.test(val.slice(atPos - 1))) {
                          const after = val.slice(atPos + 1).toLowerCase();
                          setDoctorChatMentionOpen(true);
                          setDoctorChatMentionIdx(atPos);
                          setDoctorChatMentionQuery(after);
                        } else if (doctorChatMentionOpen) {
                          setDoctorChatMentionOpen(false);
                        }
                        if (doctorChatInputInvalid && String(val || '').trim()) setDoctorChatInputInvalid(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (e.shiftKey) return;
                          e.preventDefault();
                          if (doctorChatMentionOpen) return;
                          sendDoctorChatMessage();
                          try {
                            const el = (doctorChatComposeRef && doctorChatComposeRef._textarea) || document.querySelector('.dc-compose-input');
                            if (el) { el.style.height = 'auto'; el.blur(); setTimeout(() => el.focus(), 20); }
                          } catch(_) {}
                        } else if (e.key === 'Escape') {
                          if (doctorChatMentionOpen) setDoctorChatMentionOpen(false);
                          else if (doctorChatReplying) setDoctorChatReplying(null);
                          else if (doctorChatAttachment && !doctorChatAttachmentUploading) setDoctorChatAttachment(null);
                        } else if (e.key === 'ArrowDown' && doctorChatMentionOpen) {
                          e.preventDefault();
                        }
                      }}
                      disabled={!doctorChatSpecialty || doctorChatAttachmentUploading}
                      style={{ width: '100%', padding: '12px 110px 12px 16px', minHeight: 62, maxHeight: 170, borderRadius: 16, border: '1.5px solid #e2e8f0', fontSize: '0.95rem', resize: 'none', lineHeight: 1.5, background: '#fff', boxSizing: 'border-box' }}
                    />
                    <div style={{ position: 'absolute', right: 14, bottom: 10, display: 'inline-flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
                      {doctorChatAttachment && (
                        <Check size={11} style={{ color: '#22c55e', fontWeight: 800 }} title="Attachment queued" />
                      )}
                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: String(doctorChatText || '').length >= 1900 ? '#dc2626' : (String(doctorChatText || '').length >= 1700 ? '#d97706' : '#94a3b8') }}>
                        {String(doctorChatText || '').length}/2000
                      </span>
                    </div>

                    {doctorChatMentionOpen && (
                      <div
                        style={{
                          position: 'absolute', bottom: 'calc(100% + 10px)', left: 0,
                          zIndex: 35, minWidth: 240, maxWidth: 360, maxHeight: 220, overflowY: 'auto',
                          background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12,
                          padding: 6,
                          boxShadow: '0 12px 28px rgba(15,23,42,0.18)',
                          display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.8rem'
                        }}
                      >
                        {(() => {
                          const q = String(doctorChatMentionQuery || '').toLowerCase();
                          const list = doctorChatAllSenders.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.dept && s.dept.toLowerCase().includes(q))).slice(0, 8);
                          if (!list.length) return <div style={{ padding: '10px 8px', color: '#94a3b8', fontSize: '0.76rem', fontWeight: 600 }}>No doctors match "{q}"</div>;
                          return list.map((s, i) => (
                            <button
                              key={`men-${s.key}-${i}`}
                              type="button"
                              onClick={() => {
                                const t = String(doctorChatText || '');
                                const before = t.slice(0, doctorChatMentionIdx || 0);
                                const replaced = t.slice(doctorChatMentionIdx || 0).replace(/^@\S*/, `@${s.name} `);
                                setDoctorChatText(before + replaced);
                                setDoctorChatMentionOpen(false);
                                setTimeout(() => { try { const inp = document.querySelector('.dc-compose-input'); if (inp) inp.focus(); } catch(_) {} }, 30);
                              }}
                              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: '#0f172a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#fff7ed'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <span style={{ width: 22, height: 22, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(234,88,12,0.12)', color: 'var(--primary, #ea580c)', fontSize: '0.68rem', fontWeight: 800 }}>
                                <AtSign size={11} />
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                                {s.dept && <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 500 }}>{s.dept}</div>}
                              </div>
                            </button>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                  <button
                    className="doc-primary dc-send-btn"
                    type="button"
                    onClick={sendDoctorChatMessage}
                    disabled={!doctorChatSpecialty || doctorChatAttachmentUploading || (!String(doctorChatText || '').trim() && !doctorChatAttachment)}
                    style={{ height: 44, minHeight: 44, padding: '0 22px', borderRadius: 14, gap: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flex: '0 0 auto' }}
                  >
                    <Send size={16} /> {doctorChatAttachment ? 'Send + Attach' : 'Send'}
                  </button>
                </div>
              </div>

              {doctorChatDeleteConfirm && (
                <div className="doc-modal-overlay" style={{ zIndex: 80 }} onClick={() => setDoctorChatDeleteConfirm(null)}>
                  <div className="doc-modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
                    <div className="doc-modal-header" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2', color: '#dc2626', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={17} /></div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 900, fontSize: '1rem', color: '#0f172a' }}>Delete this message?</div>
                        <div style={{ fontSize: '0.78rem', marginTop: 2, color: '#64748b' }}>This cannot be undone. Other doctors will no longer see it.</div>
                      </div>
                      <button type="button" className="doc-icon-btn" onClick={() => setDoctorChatDeleteConfirm(null)}><X size={16} /></button>
                    </div>
                    <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid #f1f5f9', background: '#f8fafc', margin: '0 16px', color: '#334155', fontSize: '0.86rem', lineHeight: 1.5, fontWeight: 500, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {String(doctorChatDeleteConfirm?.body || doctorChatDeleteConfirm?.attachment_name || '').slice(0, 240) || 'Message preview unavailable'}
                    </div>
                    <div style={{ padding: '14px 16px 18px', display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                      <button type="button" className="doc-btn" onClick={() => setDoctorChatDeleteConfirm(null)}>Cancel</button>
                      <button type="button" className="doc-btn danger" style={{ fontWeight: 800, color: '#fff', background: '#dc2626', border: '1px solid #dc2626' }} onClick={() => doctorChatSoftDelete(doctorChatDeleteConfirm)}><Trash2 size={14} /> Delete</button>
                    </div>
                  </div>
                </div>
              )}

              {doctorChatAttPreview && (
                <div className="doc-modal-overlay" style={{ zIndex: 90 }} onClick={() => setDoctorChatAttPreview(null)}>
                  <div style={{ position: 'relative', maxWidth: 960, width: '90vw', maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="doc-icon-btn" style={{ position: 'absolute', top: -12, right: -12, zIndex: 3, background: '#0f172a', color: 'white' }} onClick={() => setDoctorChatAttPreview(null)}><X size={18} /></button>
                    {doctorChatAttPreview.kind === 'image' && (
                      <img src={doctorChatAttPreview.src} alt={doctorChatAttPreview.name || ''} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: '88vh', borderRadius: 14, objectFit: 'contain', background: '#0f172a', boxShadow: '0 20px 50px rgba(15,23,42,0.4)' }} />
                    )}
                    <div style={{ textAlign: 'center', paddingTop: 10, fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 700 }}>{doctorChatAttPreview.name || 'Preview'}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeNav === 'patient-records' && patientRecordsView}

        {activeNav === 'labs' && !doctorSpecialization.toLowerCase().includes('patholog') && !doctorSpecialization.toLowerCase().includes('radiolog') && (
          <div className="doctor-grid doc-section">
            {patientCard}
            {labsCard}
          </div>
        )}

        {activeNav === 'certificates' && !doctorSpecialization.toLowerCase().includes('patholog') && !doctorSpecialization.toLowerCase().includes('radiolog') && (
          <div className="doctor-grid doc-section">
            {patientCard}
            {certificatesCard}
          </div>
        )}

        {activeNav === 'profile' && doctorProfileView}

        <div className="doc-print-area">
        {printTarget && (
          <div className="doc-print-sheet">
            <div className="doc-print-header">
              <div>
                <div className="doc-print-brand">PASCUALINGA</div>
                <div className="doc-print-meta">Prescription</div>
              </div>
              <div className="doc-print-meta">{printTarget.created_at || printTarget.createdAt ? new Date(printTarget.created_at || printTarget.createdAt).toLocaleString() : new Date().toLocaleString()}</div>
            </div>

            <div className="doc-print-card">
              <div className="doc-print-title">Patient</div>
              <div className="doc-print-meta"><strong>Name:</strong> {selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : 'Patient'}</div>
              <div className="doc-print-meta"><strong>Email:</strong> {selectedPatient?.email || ''}</div>
              <div className="doc-print-meta"><strong>Doctor:</strong> {printTarget.doctorName || doctorName}</div>
              {printTarget.diagnosis && <div className="doc-print-meta"><strong>Diagnosis:</strong> {printTarget.diagnosis}</div>}
              {printTarget.instructions && <div className="doc-print-meta"><strong>Instructions:</strong> {printTarget.instructions}</div>}
            </div>

            <div className="doc-print-card">
              <div className="doc-print-title">Medication</div>
              <table className="doc-print-table">
                <thead>
                  <tr>
                    <th>Medication</th>
                    <th>Dosage</th>
                    <th>Frequency</th>
                    <th>Duration</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(printTarget.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.medication}</td>
                      <td>{it.dosage}</td>
                      <td>{it.frequency}</td>
                      <td>{it.duration}</td>
                      <td>{it.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="doc-print-signature">
              <div className="doc-print-signature-line">{printTarget.doctorName || doctorName}</div>
            </div>
          </div>
        )}
        {printCertificateTarget && (
          <div className="doc-print-sheet">
            <div className="doc-print-header">
              <div>
                <div className="doc-print-brand">PASCUALINGA</div>
                <div className="doc-print-meta">Medical Certificate</div>
              </div>
              <div className="doc-print-meta">{printCertificateTarget.created_at || printCertificateTarget.createdAt ? new Date(printCertificateTarget.created_at || printCertificateTarget.createdAt).toLocaleString() : new Date().toLocaleString()}</div>
            </div>

            <div className="doc-print-card">
              <div className="doc-print-title">Patient</div>
              <div className="doc-print-meta"><strong>Name:</strong> {selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : 'Patient'}</div>
              <div className="doc-print-meta"><strong>Email:</strong> {selectedPatient?.email || ''}</div>
              <div className="doc-print-meta"><strong>Doctor:</strong> {printCertificateTarget.doctorName || doctorName}</div>
            </div>

            <div className="doc-print-card">
              <div className="doc-print-title">Details</div>
              <div className="doc-print-meta"><strong>Purpose:</strong> {printCertificateTarget.purpose}</div>
              {printCertificateTarget.diagnosis && <div className="doc-print-meta"><strong>Diagnosis / Findings:</strong> {printCertificateTarget.diagnosis}</div>}
              {printCertificateTarget.recommendations && <div className="doc-print-meta"><strong>Recommendations:</strong> {printCertificateTarget.recommendations}</div>}
              {printCertificateTarget.valid_until && <div className="doc-print-meta"><strong>Valid Until:</strong> {new Date(printCertificateTarget.valid_until).toLocaleDateString()}</div>}
            </div>

            <div className="doc-print-signature">
              <div className="doc-print-signature-line">{printCertificateTarget.doctorName || doctorName}</div>
            </div>
          </div>
        )}

        <PatientFullRecordModal
          open={centralRecordOpen}
          onClose={() => setCentralRecordOpen(false)}
          patientId={centralRecordPatientId}
          patientLabel={centralRecordPatientLabel}
          role="doctor"
          user={currentUser}
        />
        </div>

        {showFullRecord && (
          <div className="doc-modal-overlay" onClick={() => setShowFullRecord(false)}>
            <div className="doc-modal-card doc-modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="doc-modal-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px'}}>
                <div className="doc-modal-title">Full Medical Record</div>
                <button type="button" className="doc-icon-btn" onClick={() => setShowFullRecord(false)}>
                  <X size={18} />
                </button>
              </div>
              
              <div className="doc-record-content" style={{maxHeight: '65vh', overflowY: 'auto', paddingRight: '10px'}}>
                <div style={{marginBottom: '20px'}}>
                  <h3 style={{fontSize: '1rem', fontWeight: '900', marginBottom: '8px'}}>Patient Information</h3>
                  <div className="doc-patient-grid">
                    <div className="doc-pill"><span className="doc-pill-k">Name</span><span className="doc-pill-v">{activePatientName}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Email</span><span className="doc-pill-v">{activePatientMeta.email || '—'}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Contact</span><span className="doc-pill-v">{activePatientMeta.contact || '—'}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Allergies</span><span className="doc-pill-v">{activePatientMeta.allergies || '—'}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Blood Type</span><span className="doc-pill-v">{selectedPatient?.bloodType || '—'}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Diagnosis</span><span className="doc-pill-v">{selectedPatient?.diagnosis || '—'}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Ward</span><span className="doc-pill-v">{selectedPatient?.wardNumber || '—'}</span></div>
                    <div className="doc-pill"><span className="doc-pill-k">Admission</span><span className="doc-pill-v">{selectedPatient?.admissionStatus || '—'}</span></div>
                  </div>
                </div>

                <div className="doc-timeline">
                  <h3 style={{fontSize: '1rem', fontWeight: '900', marginBottom: '12px'}}>Medical History Timeline</h3>
                  {[
                    ...notes.map((n) => ({ ...n, _kind: 'note' })),
                    ...prescriptions.map((p) => ({ ...p, _kind: 'prescription' })),
                    ...labResults.map((r) => ({ ...r, _kind: 'lab' })),
                    ...certificates.map((c) => ({ ...c, _kind: 'certificate' }))
                  ]
                    .sort(
                      (a, b) =>
                        new Date(b.created_at || b.createdAt || b.timestamp || 0) -
                        new Date(a.created_at || a.createdAt || a.timestamp || 0)
                    )
                    .map((item, idx) => {
                      const kind = item._kind;
                      const dateStr = new Date(item.created_at || item.createdAt || item.timestamp || Date.now()).toLocaleString();
                      const doctorLabel = item.doctorName || item.doctor_name || item.uploaded_by || doctorName;

                      return (
                        <div key={item.id || idx} className="doc-timeline-item" style={{
                          borderLeft: `4px solid ${kind === 'note' ? '#2563eb' : kind === 'lab' ? '#7e22ce' : '#16a34a'}`,
                          borderRadius: '8px', 
                          padding: '16px', 
                          marginBottom: '20px', 
                          background: '#ffffff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          position: 'relative'
                        }}>
                          <div style={{
                            position: 'absolute',
                            left: '-10px',
                            top: '20px',
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: kind === 'note' ? '#2563eb' : kind === 'lab' ? '#7e22ce' : '#16a34a',
                            border: '3px solid #f8fafc'
                          }}></div>

                          <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center'}}>
                            <div style={{fontWeight: '900', color: kind === 'note' ? '#2563eb' : kind === 'lab' ? '#7e22ce' : '#16a34a', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem'}}>
                              {kind === 'note' && <FileText size={18} />}
                              {kind === 'prescription' && <ClipboardCheck size={18} />}
                              {kind === 'lab' && <Search size={18} />}
                              {kind === 'certificate' && <FileText size={18} />}
                              <span style={{textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                                {kind === 'note' && 'Consultation Note'}
                                {kind === 'prescription' && 'Prescription'}
                                {kind === 'lab' && (item.type || 'Result')}
                                {kind === 'certificate' && 'Medical Certificate'}
                              </span>
                            </div>
                            <div style={{fontSize: '0.8rem', color: '#64748b', fontWeight: '600'}}>
                              {dateStr} • Dr. {doctorLabel}
                            </div>
                          </div>

                          {kind === 'note' && (
                            <div style={{display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9rem'}}>
                              {item.vitals && Object.values(item.vitals).some((v) => v) && (
                                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '8px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0'}}>
                                  {item.vitals.bp && <div><strong>BP:</strong> {item.vitals.bp}</div>}
                                  {item.vitals.hr && <div><strong>HR:</strong> {item.vitals.hr}</div>}
                                  {item.vitals.temp && <div><strong>Temp:</strong> {item.vitals.temp}</div>}
                                  {item.vitals.weight && <div><strong>Wt:</strong> {item.vitals.weight}</div>}
                                </div>
                              )}
                              {item.subjective && <div><strong style={{color: '#475569'}}>S:</strong> {item.subjective}</div>}
                              {item.objective && <div><strong style={{color: '#475569'}}>O:</strong> {item.objective}</div>}
                              {item.assessment && <div><strong style={{color: '#475569'}}>A:</strong> {item.assessment}</div>}
                              {item.plan && <div><strong style={{color: '#475569'}}>P:</strong> {item.plan}</div>}
                              {item.vaccinationHistory && <div><strong style={{color: '#475569'}}>Vaccinations:</strong> {item.vaccinationHistory}</div>}
                              {item.heartRateRhythm && <div><strong style={{color: '#475569'}}>HR Rhythm:</strong> {item.heartRateRhythm}</div>}
                              {item.ecgNotes && <div><strong style={{color: '#475569'}}>ECG:</strong> {item.ecgNotes}</div>}
                              {item.lesionType && <div><strong style={{color: '#475569'}}>Lesion:</strong> {item.lesionType}</div>}
                              {item.affectedArea && <div><strong style={{color: '#475569'}}>Affected Area:</strong> {item.affectedArea}</div>}
                            </div>
                          )}

                          {kind === 'prescription' && (
                            <div style={{fontSize: '0.9rem'}}>
                              {item.diagnosis && <div style={{marginBottom: '4px'}}><strong>Diagnosis:</strong> {item.diagnosis}</div>}
                              {item.instructions && <div style={{marginBottom: '8px'}}><strong>Instructions:</strong> {item.instructions}</div>}
                              <div style={{background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '10px'}}>
                                {(item.items || []).map((rx, rIdx) => (
                                  <div key={rIdx} style={{borderBottom: rIdx < (item.items || []).length - 1 ? '1px solid #f1f5f9' : 'none', paddingBottom: rIdx < (item.items || []).length - 1 ? '6px' : '0', marginBottom: rIdx < (item.items || []).length - 1 ? '6px' : '0'}}>
                                    <strong>{rx.medication}</strong> {rx.dosage} • {rx.frequency} ({rx.duration})
                                    {rx.notes && <span style={{color: '#64748b'}}> - {rx.notes}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {kind === 'lab' && (
                            <div style={{fontSize: '0.9rem'}}>
                              <div style={{marginBottom: '6px'}}><strong>Title:</strong> {item.title}</div>
                              {item.result_date && <div style={{marginBottom: '6px'}}><strong>Date:</strong> {new Date(item.result_date).toLocaleDateString()}</div>}
                              <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 800 }}>
                                Open file
                              </a>
                            </div>
                          )}

                          {kind === 'certificate' && (
                            <div style={{fontSize: '0.9rem'}}>
                              <div style={{marginBottom: '6px'}}><strong>Purpose:</strong> {item.purpose}</div>
                              {item.diagnosis && <div style={{marginBottom: '6px'}}><strong>Diagnosis / Findings:</strong> {item.diagnosis}</div>}
                              {item.recommendations && <div style={{marginBottom: '6px'}}><strong>Recommendations:</strong> {item.recommendations}</div>}
                              {item.valid_until && <div><strong>Valid Until:</strong> {new Date(item.valid_until).toLocaleDateString()}</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  {notes.length === 0 && prescriptions.length === 0 && labResults.length === 0 && certificates.length === 0 && (
                    <div className="doc-muted" style={{textAlign: 'center', padding: '20px'}}>No records found for this patient.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {videoModalOpen && (
          <div
            className="doc-modal-overlay"
            style={{ padding: 'clamp(6px, 1vh, 14px)' }}
            onClick={() => {
              setVideoModalOpen(false);
              setVideoMeetingUrl('');
              setVideoMeetingTitle('');
            }}
          >
            <div
              className="doc-modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(1780px, 98vw)', height: '98vh', maxHeight: '98vh', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div className="doc-modal-title" style={{ margin: 0 }}>
                    {videoMeetingTitle || 'Video Consultation'}
                  </div>
                  <button
                    type="button"
                    className="doc-icon-btn"
                    style={{ background: '#ecfeff', color: '#155e75', borderColor: 'rgba(21,94,117,0.18)', padding: '6px 10px', fontSize: '12px', fontWeight: 700 }}
                    onClick={() => {
                      const wrap = document.getElementById('doctor-video-wrapper');
                      if (wrap && wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
                    }}
                    title="Enter Fullscreen (FHD video view)"
                  >
                    <Maximize2 size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} /> Fullscreen
                  </button>
                  <button
                    type="button"
                    className="doc-icon-btn"
                    style={{ background: '#e0f2fe', color: '#0369a1', borderColor: 'rgba(3,105,161,0.2)', padding: '6px 10px', fontSize: '12px', fontWeight: 700 }}
                    onClick={() => window.open(videoMeetingUrl, '_blank')}
                    title="Troubleshooting: Open in new tab"
                  >
                    Open in New Tab
                  </button>
                  <button
                    type="button"
                    className="doc-icon-btn"
                    style={{ background: '#fef2f2', color: '#dc2626', borderColor: 'rgba(220,38,38,0.2)', padding: '6px 10px', fontSize: '12px', fontWeight: 700 }}
                    onClick={() => window.open('https://test.webrtc.org/', '_blank')}
                    title="Test Camera/Mic Hardware"
                  >
                    Test Hardware
                  </button>
                </div>
                <button
                  type="button"
                  className="doc-icon-btn"
                  onClick={() => {
                    setVideoModalOpen(false);
                    setVideoMeetingUrl('');
                    setVideoMeetingTitle('');
                  }}
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div id="doctor-video-wrapper" style={{ flex: 1, marginTop: 8, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', minHeight: 0 }}>
                {(() => {
                  const url = String(videoMeetingUrl || '').trim();
                  const looksValid = /^https?:\/\//i.test(url) && /[a-z0-9\-]+\.[a-z]{2,}/i.test(url);
                  if (!looksValid) {
                    return (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg,#f8fafc,#eef2f7)', padding: 'clamp(20px, 4vh, 60px)' }}>
                        <div style={{ maxWidth: 620, textAlign: 'center' }}>
                          <div style={{ width: 54, height: 54, borderRadius: 27, background: '#fff', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#ea580c', boxShadow: '0 10px 30px rgba(234,88,12,0.12)' }}>
                            <Video size={24} />
                          </div>
                          <div style={{ marginTop: 16, fontSize: '1.08rem', fontWeight: 800, color: '#0f172a' }}>Video Call Not Ready Yet</div>
                          <div style={{ marginTop: 6, color: '#475569', lineHeight: 1.55, fontSize: '0.88rem' }}>
                            The teleconsultation room has not been started or the room link could not be retrieved. Please try:
                          </div>
                          <ul style={{ marginTop: 14, textAlign: 'left', paddingLeft: 18, color: '#334155', fontSize: '0.86rem', lineHeight: 1.7, listStyle: 'disc' }}>
                            <li>Ask the patient to tap <b>"Join Video Call"</b> again if you are the doctor.</li>
                            <li>Try <b>Open in New Tab</b> button if a room URL exists but iframe is blocked by browser privacy settings.</li>
                            <li>Run <b>Test Hardware</b> to verify camera/mic permissions are allowed for this site.</li>
                            <li>Check hospital network firewall settings — ensure <code>*.daily.co</code> + <code>*.sydney.twilio.com</code> are whitelisted on port 443.</li>
                            <li>If using Safari, enable <b>Settings → Privacy → Allow cross-site tracking</b> temporarily for iframe-based calls.</li>
                          </ul>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <iframe
                      title="Video Consultation"
                      src={url}
                      allowFullScreen
                      style={{ width: '100%', height: '100%', border: 0 }}
                      allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write; encrypted-media; speaker-selection; picture-in-picture; geolocation; midi; gyroscope; accelerometer; magnetometer"
                      referrerPolicy="no-referrer-when-downgrade"
                      loading="eager"
                    />
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {orderModal}
        {billOutModal}
        </div>
      </main>
    </div>
  );
}

export default DoctorDashboard;
