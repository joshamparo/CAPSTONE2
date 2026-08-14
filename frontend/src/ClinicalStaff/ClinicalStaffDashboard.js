import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, LayoutDashboard, RefreshCw, ShieldAlert, Upload, UserRound, X, XCircle, Menu, User, Mail, Briefcase, Phone, Key, Save, Shield, Eye, EyeOff, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ClinicalStaffDashboard.css';
import AccountHeaderActions from '../components/AccountHeaderActions';
import SignOutConfirmModal from '../components/SignOutConfirmModal';
import PatientFullRecordModal from '../components/PatientFullRecordModal';
import { checkBackendHealth, fetchJson } from '../utils/api';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const ROLE_CONFIG = {
  medtech: {
    label: 'MedTech',
    kind: 'Lab',
    resultType: 'Lab'
  },
  radiographer: {
    label: 'Radiographer',
    kind: 'Imaging',
    resultType: 'Imaging'
  },
  ecg_operator: {
    label: 'ECG Operator',
    kind: 'ECG',
    resultType: 'ECG'
  },
  physical_therapist: {
    label: 'Physical Therapist',
    kind: 'PT',
    resultType: 'PT'
  }
};

const safeJson = (v) => {
  try {
    return JSON.parse(v);
  } catch (_) {
    return null;
  }
};

const fmtWhen = (v) => {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

const statusBadgeClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'cs-badge green';
  if (s === 'paid') return 'cs-badge green';
  if (s === 'result') return 'cs-badge green';
  if (s === 'for payment') return 'cs-badge orange';
  if (s === 'in progress') return 'cs-badge blue';
  if (s === 'exam') return 'cs-badge blue';
  if (s === 'scheduled') return 'cs-badge orange';
  return 'cs-badge';
};

const buildHeaders = (user) => {
  const role = String(user?.role || '').toLowerCase();
  const email = String(user?.email || '').trim();
  const name = String(user?.name || user?.first_name || user?.firstName || '').trim();
  return {
    'Content-Type': 'application/json',
    'x-user-role': role,
    ...(email ? { 'x-user-email': email } : {}),
    ...(name ? { 'x-user-name': name } : {})
  };
};

const buildAuthHeaders = (user) => {
  const role = String(user?.role || '').toLowerCase();
  const email = String(user?.email || '').trim();
  const name = String(user?.name || user?.first_name || user?.firstName || '').trim();
  return {
    'x-user-role': role,
    ...(email ? { 'x-user-email': email } : {}),
    ...(name ? { 'x-user-name': name } : {})
  };
};

const CLINICAL_PAGE_SIZE = 8;

export default function ClinicalStaffDashboard({ forcedRole }) {
  const navigate = useNavigate();
  const user = useMemo(() => safeJson(localStorage.getItem('currentUser') || 'null') || {}, []);
  const role = String(forcedRole || user.role || '').toLowerCase();
  const cfg = ROLE_CONFIG[role] || { label: 'Clinical Staff', kind: 'Procedure', resultType: 'Lab' };
  const isEcgOperator = role === 'ecg_operator';
  const [backendHealth, setBackendHealth] = useState({ checked: false, ok: true, error: '' });

  const [activeTab, setActiveTab] = useState('dashboard');

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('All');
  const [orderRangeFilter, setOrderRangeFilter] = useState('All');
  const [ordersPage, setOrdersPage] = useState(1);

  const [approvals, setApprovals] = useState([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [approvalsError, setApprovalsError] = useState('');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [approvalActionLoading, setApprovalActionLoading] = useState(false);
  const [approvalActionError, setApprovalActionError] = useState('');
  const [approvalRangeFilter, setApprovalRangeFilter] = useState('All');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState('All');
  const [approvalsPage, setApprovalsPage] = useState(1);

  const [patients, setPatients] = useState([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [patientsError, setPatientsError] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [centralRecordOpen, setCentralRecordOpen] = useState(false);
  const [centralRecordPatientId, setCentralRecordPatientId] = useState(null);
  const [centralRecordPatientLabel, setCentralRecordPatientLabel] = useState('');
  const [patientsPage, setPatientsPage] = useState(1);

  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ title: '', startAt: '', endAt: '', location: '', notes: '' });

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

  const [viewingOrder, setViewingOrder] = useState(null);
  const [orderDetail, setOrderDetail] = useState(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);

  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [orderCreating, setOrderCreating] = useState(false);
  const [orderCreateError, setOrderCreateError] = useState('');
  const [orderForm, setOrderForm] = useState({
    patientId: '',
    service: '',
    priority: 'Routine',
    notes: '',
    scheduledAt: ''
  });

  const [scheduleWhen, setScheduleWhen] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [resultTitle, setResultTitle] = useState('');
  const [resultDate, setResultDate] = useState('');
  const [resultFile, setResultFile] = useState(null);
  const [resultSaving, setResultSaving] = useState(false);
  const [resultError, setResultError] = useState('');
  const [resultNotice, setResultNotice] = useState('');
  
  // File Viewer Modal State
  const [viewingFileUrl, setViewingFileUrl] = useState(null);

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const refreshOrders = async () => {
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const params = new URLSearchParams();
      params.set('role', role);
      const data = await fetchJson(`/api/clinical-orders?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders(user)
      });
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      setOrders([]);
      setOrdersError(String(e.message || 'Unable to load orders'));
    } finally {
      setOrdersLoading(false);
    }
  };

  const refreshApprovals = async () => {
    setApprovalsLoading(true);
    setApprovalsError('');
    try {
      const params = new URLSearchParams();
      params.set('role', role);
      params.set('take', '80');
      const data = await fetchJson(`/api/approval-requests/inbox?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders(user)
      });
      setApprovals(Array.isArray(data) ? data : []);
    } catch (e) {
      setApprovals([]);
      setApprovalsError(String(e.message || 'Unable to load approvals'));
    } finally {
      setApprovalsLoading(false);
    }
  };

  const refreshPatients = async () => {
    setPatientsLoading(true);
    setPatientsError('');
    try {
      const data = await fetchJson(`/api/patients`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders(user)
      });
      setPatients(Array.isArray(data) ? data : []);
    } catch (e) {
      setPatients([]);
      setPatientsError(String(e.message || 'Unable to load patients'));
    } finally {
      setPatientsLoading(false);
    }
  };

  const refreshSchedule = async () => {
    setScheduleLoading(true);
    setScheduleError('');
    try {
      const params = new URLSearchParams();
      params.set('role', role);
      if (user.email) params.set('staffEmail', user.email);
      const data = await fetchJson(`/api/clinical-schedule?${params.toString()}`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders(user)
      });
      setSchedule(Array.isArray(data) ? data : []);
    } catch (e) {
      setSchedule([]);
      setScheduleError(String(e.message || 'Unable to load schedule'));
    } finally {
      setScheduleLoading(false);
    }
  };

  useEffect(() => {
    refreshOrders();
    refreshSchedule();
    refreshApprovals();
    if (!isEcgOperator) refreshPatients();
    const t = setInterval(() => {
      refreshOrders();
      refreshSchedule();
      refreshApprovals();
    }, 20000);
    return () => clearInterval(t);
  }, [role, orderStatusFilter, isEcgOperator]);

  useEffect(() => {
    if (!isEcgOperator) return;
    if (activeTab === 'appointments' || activeTab === 'patients') {
      setActiveTab('dashboard');
    }
  }, [activeTab, isEcgOperator]);

  const filteredPatients = useMemo(() => {
    const q = String(patientSearch || '').trim().toLowerCase();
    if (!q) return patients;
    return (patients || []).filter((p) => {
      const name = `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.toLowerCase();
      const email = String(p.email || '').toLowerCase();
      return name.includes(q) || email.includes(q) || String(p.id || p._id || '').toLowerCase().includes(q);
    });
  }, [patients, patientSearch]);

  const metrics = useMemo(() => {
    const all = Array.isArray(orders) ? orders : [];
    const pending = all.filter((o) => String(o.status || '').toLowerCase() === 'pending').length;
    const forPayment = all.filter((o) => String(o.status || '').toLowerCase() === 'for payment').length;
    const paid = all.filter((o) => String(o.status || '').toLowerCase() === 'paid').length;
    const exam = all.filter((o) => String(o.status || '').toLowerCase() === 'exam').length;
    const result = all.filter((o) => String(o.status || '').toLowerCase() === 'result').length;
    const scheduled = all.filter((o) => String(o.status || '').toLowerCase() === 'scheduled').length;
    const inProgress = all.filter((o) => String(o.status || '').toLowerCase() === 'in progress').length;
    const completed = all.filter((o) => String(o.status || '').toLowerCase() === 'completed').length;
    const upcoming = (schedule || []).filter((ev) => {
      const d = ev?.startAt ? new Date(ev.startAt) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      return d.getTime() >= Date.now() - 15 * 60 * 1000;
    }).length;
    return { pending, forPayment, paid, exam, result, scheduled, inProgress, completed, upcoming };
  }, [orders, schedule]);

  const inRange = (dateValue, range) => {
    const d = dateValue ? new Date(dateValue) : null;
    if (!d || Number.isNaN(d.getTime())) return false;
    if (range === 'Today') {
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }
    if (range === 'Week') {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);
      return d >= start && d <= now;
    }
    return true;
  };

  const displayedOrders = useMemo(() => {
    const list = Array.isArray(orders) ? orders : [];
    const myKind = String(cfg.kind || '').toLowerCase();
    const roleFiltered = list.filter((o) => {
      const oKind = String(o.kind || o.category || o.serviceType || '').toLowerCase();
      if (oKind && oKind === myKind) return true;
      const service = String(o.service || '');
      const name = String(o.serviceType || o.testName || '');
      const hay = `${service} ${name}`.toLowerCase();
      if (myKind === 'lab') {
        return /(lab|cbc|urinalysis|urine|hematology|blood|chemistry|stool|microscopy|culture|gram|wbc|rbc|hba1c|fbs|creatinine|lipid|sgot|sgpt|potassium|sodium|bun|bilirubin|protein|albumin|platelet|clotting|ptt|pt|inr|t3|t4|tsh|hiv|std|urine culture|blood culture)/i.test(hay);
      }
      if (myKind === 'imaging') {
        return /(imaging|xray|x-ray|radiograph|radiology|ct|mri|ultrasound|sonogram|doppler|bone scan|contrast|cervical|thoracic|lumbar|skull|abdomen|pelvis|chest|mamograph|fluoroscop)/i.test(hay);
      }
      if (myKind === 'ecg') {
        return /(ecg|ekg|electrocardiograph|ecograph|12 lead|12-lead|cardio|heart rhythm|arrhythmia)/i.test(hay);
      }
      if (myKind === 'pt' || myKind === 'physical') {
        return /(pt|physical therap|rehab|tens|therapy session|exercise session|modalit|therapeutic|manipulation|mobilization|stretching|massage|ultrasound therap|cold pack|hot pack|paraffin|electrical stimulation|traction)/i.test(hay);
      }
      return false;
    });
    const statusFiltered =
      orderStatusFilter && orderStatusFilter !== 'All'
        ? roleFiltered.filter((o) => String(o.status || '').toLowerCase() === String(orderStatusFilter).toLowerCase())
        : roleFiltered;
    if (orderRangeFilter === 'All') return statusFiltered;
    return statusFiltered.filter((o) => inRange(o.scheduledAt || o.createdAt, orderRangeFilter));
  }, [orders, orderRangeFilter, orderStatusFilter, cfg.kind]);

  const displayedApprovals = useMemo(() => {
    const list = Array.isArray(approvals) ? approvals : [];
    let out = list;
    if (approvalStatusFilter !== 'All') {
      out = out.filter((r) => String(r.status || 'Pending').toLowerCase() === String(approvalStatusFilter).toLowerCase());
    }
    if (approvalRangeFilter !== 'All') {
      out = out.filter((r) => inRange(r.requestedDate || r.createdAt, approvalRangeFilter));
    }
    return out;
  }, [approvals, approvalRangeFilter, approvalStatusFilter]);

  useEffect(() => { setOrdersPage(1); }, [orderStatusFilter, orderRangeFilter]);
  useEffect(() => { setApprovalsPage(1); }, [approvalStatusFilter, approvalRangeFilter]);
  useEffect(() => { setPatientsPage(1); }, [patientSearch]);

  const paginatedOrders = useMemo(() => {
    const total = displayedOrders.length;
    const totalPages = Math.max(1, Math.ceil(total / CLINICAL_PAGE_SIZE));
    const p = Math.min(Math.max(1, ordersPage), totalPages);
    const start = (p - 1) * CLINICAL_PAGE_SIZE;
    return { items: displayedOrders.slice(start, start + CLINICAL_PAGE_SIZE), page: p, totalPages, total };
  }, [displayedOrders, ordersPage]);

  const paginatedApprovals = useMemo(() => {
    const total = displayedApprovals.length;
    const totalPages = Math.max(1, Math.ceil(total / CLINICAL_PAGE_SIZE));
    const p = Math.min(Math.max(1, approvalsPage), totalPages);
    const start = (p - 1) * CLINICAL_PAGE_SIZE;
    return { items: displayedApprovals.slice(start, start + CLINICAL_PAGE_SIZE), page: p, totalPages, total };
  }, [displayedApprovals, approvalsPage]);

  const paginatedPatients = useMemo(() => {
    const list = Array.isArray(filteredPatients) ? filteredPatients : [];
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / CLINICAL_PAGE_SIZE));
    const p = Math.min(Math.max(1, patientsPage), totalPages);
    const start = (p - 1) * CLINICAL_PAGE_SIZE;
    return { items: list.slice(start, start + CLINICAL_PAGE_SIZE), page: p, totalPages, total };
  }, [filteredPatients, patientsPage]);

  const openOrder = async (o) => {
    setViewingOrder(o);
    setOrderDetail(null);
    setOrderDetailLoading(true);
    setResultError('');
    setResultFile(null);
    setResultTitle('');
    setResultDate('');
    setScheduleWhen(o?.scheduledAt ? new Date(o.scheduledAt).toISOString().slice(0, 16) : '');
    try {
      const data = await fetchJson(`/api/clinical-orders/${o.id}`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders(user)
      });
      setOrderDetail(data);
    } catch (e) {
      setOrderDetail(null);
    } finally {
      setOrderDetailLoading(false);
    }
  };

  const hasPendingVerification = useMemo(() => {
    const list = Array.isArray(orderDetail?.results) ? orderDetail.results : [];
    return list.some((r) => String(r?.verificationStatus || r?.verification_status || 'pending').toLowerCase() === 'pending');
  }, [orderDetail?.results]);

  const refreshViewingOrderDetail = async () => {
    if (!viewingOrder?.id) return;
    try {
      const data = await fetchJson(`/api/clinical-orders/${viewingOrder.id}`, {
        apiBase: API_BASE,
        headers: buildAuthHeaders(user)
      });
      setOrderDetail(data);
    } catch (_) {}
  };

  const orderHasResult = useMemo(() => {
    return Array.isArray(orderDetail?.results) && orderDetail.results.length > 0;
  }, [orderDetail?.results]);

  useEffect(() => {
    if (!viewingOrder?.id) return;
    if (!hasPendingVerification) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 180000) return;
      await refreshViewingOrderDetail();
    };
    tick();
    const t = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [viewingOrder?.id, hasPendingVerification, user]);

  const updateOrder = async (id, patch) => {
    const payload = {
      ...patch,
      actorName: user.name || user.first_name || user.firstName || user.email || cfg.label,
      actorRole: role
    };
    return await fetchJson(`/api/clinical-orders/${id}`, {
      apiBase: API_BASE,
      method: 'PATCH',
      headers: buildHeaders(user),
      body: JSON.stringify(payload)
    });
  };

  const handleQuickStatus = async (id, nextStatus) => {
    try {
      await updateOrder(id, { status: nextStatus });
      await refreshOrders();
      if (viewingOrder && String(viewingOrder.id) === String(id)) {
        await openOrder({ ...viewingOrder, status: nextStatus });
      }
    } catch (_) {}
  };

  const handleAcknowledge = async (id) => {
    try {
      await updateOrder(id, { acknowledged: true });
      await refreshOrders();
      if (viewingOrder && String(viewingOrder.id) === String(id)) {
        await openOrder({ ...viewingOrder, acknowledgedAt: new Date().toISOString() });
      }
    } catch (_) {}
  };

  const handleScheduleSave = async () => {
    if (!viewingOrder) return;
    setScheduleSaving(true);
    try {
      const when = scheduleWhen ? new Date(scheduleWhen).toISOString() : null;
      await updateOrder(viewingOrder.id, {
        scheduledAt: when,
        status: viewingOrder.status || 'Pending',
        assignedRole: role,
        assignedTo: user.email || null
      });
      await refreshOrders();
      await refreshSchedule();
      await openOrder({ ...viewingOrder, scheduledAt: when, status: viewingOrder.status });
    } catch (_) {
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleUploadResult = async () => {
    if (!viewingOrder) return;
    setResultSaving(true);
    setResultError('');
    setResultNotice('');
    try {
      let currentStatus = String(viewingOrder.status || '').trim().toLowerCase();
      if (currentStatus === 'paid') {
        await updateOrder(viewingOrder.id, {
          status: 'Exam',
          eventNote: `Auto-start exam • Result upload • ${String(resultTitle || '').trim() || cfg.resultType}`
        });
        currentStatus = 'exam';
      }
      const allowed = new Set(['paid', 'exam', 'in progress', 'result', 'completed']);
      if (!allowed.has(currentStatus)) throw new Error('Order must be Paid or Exam before uploading a result.');
      if (!resultFile) throw new Error('Choose a file first.');
      const fd = new FormData();
      fd.append('file', resultFile);
      fd.append('patientId', viewingOrder.patientId || '');

      const uploadRes = await fetch(`${API_BASE}/api/lab-results/upload`, {
        method: 'POST',
        headers: { 'x-user-role': role },
        body: fd
      });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadData.message || 'Upload failed');

      const createData = await fetchJson(`/api/lab-results`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildHeaders(user),
        body: JSON.stringify({
          patientId: viewingOrder.patientId,
          orderId: viewingOrder.id,
          type: cfg.resultType,
          title: String(resultTitle || '').trim() || `${cfg.resultType} Result`,
          url: uploadData.url,
          resultDate: resultDate || null,
          uploadedBy: user.name || user.email || cfg.label,
          fileHash: uploadData.hash || null,
          fileMeta: {
            originalName: uploadData.originalName || null,
            mimeType: uploadData.mimeType || null,
            size: uploadData.size || null
          }
        })
      });

      await updateOrder(viewingOrder.id, {
        status: String(viewingOrder.status || '').toLowerCase() === 'completed' ? 'Completed' : 'Result',
        eventNote: `Result uploaded • ${String(resultTitle || '').trim() || cfg.resultType}`
      });

      setResultFile(null);
      setResultTitle('');
      setResultDate('');
      const st = String(createData?.verificationStatus || createData?.verification_status || '').trim().toLowerCase();
      const score = createData?.verificationScore ?? createData?.verification_score ?? null;
      const flags = Array.isArray(createData?.verificationFlags) ? createData.verificationFlags : (Array.isArray(createData?.verification_flags) ? createData.verification_flags : []);
      const detail = `${score !== null && score !== undefined ? ` Score: ${score}.` : ''}${flags.length ? ` Flags: ${flags.slice(0, 6).join(', ')}.` : ''}`;
      setResultNotice(
        st === 'verified'
          ? `Result uploaded and verified.${detail}`
          : st === 'rejected'
            ? `Result uploaded but rejected as invalid.${detail} Check Notifications for details.`
            : st === 'flagged'
              ? `Result uploaded but flagged for review.${detail} Check Notifications for details.`
              : `Result uploaded. Verification is pending.${detail} Check Notifications for updates.`
      );
      await openOrder(viewingOrder);
      await refreshOrders();
    } catch (e) {
      setResultError(String(e.message || 'Upload failed'));
    } finally {
      setResultSaving(false);
    }
  };

  const handleCompleteOrder = async () => {
    if (!viewingOrder) return;
    if (!orderHasResult) {
      setResultError('Upload the result first before marking this order as Completed.');
      return;
    }
    await handleQuickStatus(viewingOrder.id, 'Completed');
  };

  const handleCreateEvent = async () => {
    setCreatingEvent(true);
    try {
      await fetchJson(`/api/clinical-schedule`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildHeaders(user),
        body: JSON.stringify({
          role,
          staffEmail: user.email || null,
          title: String(eventForm.title || '').trim() || `${cfg.kind} Schedule`,
          startAt: eventForm.startAt ? new Date(eventForm.startAt).toISOString() : null,
          endAt: eventForm.endAt ? new Date(eventForm.endAt).toISOString() : null,
          location: eventForm.location || null,
          notes: eventForm.notes || null,
          createdBy: user.name || user.email || null
        })
      });
      setEventForm({ title: '', startAt: '', endAt: '', location: '', notes: '' });
      await refreshSchedule();
    } catch (_) {
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleCreateOrder = async () => {
    setOrderCreating(true);
    setOrderCreateError('');
    try {
      const patientId = String(orderForm.patientId || '').trim();
      if (!patientId) throw new Error('Select a patient.');
      const service = String(orderForm.service || '').trim();
      if (!service) throw new Error('Service is required.');

      const p = (patients || []).find((x) => String(x.id || x._id || '') === patientId);
      const patientName = p
        ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim()
        : '';

      const scheduledAt = orderForm.scheduledAt ? new Date(orderForm.scheduledAt).toISOString() : null;

      await fetchJson(`/api/clinical-orders`, {
        apiBase: API_BASE,
        method: 'POST',
        headers: buildHeaders(user),
        body: JSON.stringify({
          patientId,
          patientName: patientName || null,
          kind: cfg.kind,
          service,
          priority: orderForm.priority || 'Routine',
          notes: orderForm.notes || null,
          assignedRole: role,
          assignedTo: user.email || null,
          scheduledAt,
          orderedByName: user.name || user.email || cfg.label,
          orderedByRole: role,
          actorName: user.name || user.email || cfg.label,
          actorRole: role
        })
      });

      setOrderForm({ patientId: '', service: '', priority: 'Routine', notes: '', scheduledAt: '' });
      setOrderFormOpen(false);
      await refreshOrders();
      await refreshSchedule();
    } catch (e) {
      setOrderCreateError(String(e.message || 'Create failed'));
    } finally {
      setOrderCreating(false);
    }
  };

  const TabButton = ({ id, icon, label }) => (
    <button type="button" className={`cs-nav-btn ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
      {icon}
      <span>{label}</span>
    </button>
  );

  const handleLogout = () => {
    setLogoutConfirmOpen(true);
  };

  const openApproval = (r) => {
    setSelectedApproval(r);
    setApprovalNote('');
    setApprovalActionError('');
  };

  const applyApproval = async (nextStatus) => {
    if (!selectedApproval?.id) return;
    setApprovalActionLoading(true);
    setApprovalActionError('');
    try {
      await fetchJson(`/api/approval-requests/${selectedApproval.id}`, {
        apiBase: API_BASE,
        method: 'PATCH',
        headers: buildHeaders(user),
        body: JSON.stringify({
          status: nextStatus,
          role,
          actor: user.name || user.email || cfg.label,
          note: approvalNote || null
        })
      });
      setSelectedApproval(null);
      setApprovalNote('');
      await refreshApprovals();
      await refreshOrders();
    } catch (e) {
      setApprovalActionError(String(e.message || 'Update failed'));
    } finally {
      setApprovalActionLoading(false);
    }
  };

  const confirmLogout = () => {
    try {
      localStorage.removeItem('currentUser');
    } catch (_) {}
    navigate('/login');
  };

  return (
    <div className="cs-layout" style={{ paddingTop: backendHealth.checked && !backendHealth.ok ? 44 : 0 }}>
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
      <aside className={`cs-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="cs-brand">
          <div className="cs-brand-row">
            <div className="cs-brand-main">
              <img className="cs-brand-logo" src="/images/pgh%20logo.png" alt="PASCUALINGA" />
              {!sidebarCollapsed ? (
                <div className="cs-brand-texts">
                  <div className="cs-brand-title">PASCUALINGA</div>
                  <div className="cs-brand-sub">{cfg.label}</div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="cs-collapse-btn"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
        </div>

        <nav className="cs-nav">
          <TabButton id="dashboard" icon={<LayoutDashboard size={18} />} label="Dashboard" />
          <TabButton id="approvals" icon={<ClipboardList size={18} />} label="Approvals" />
          {!isEcgOperator ? <TabButton id="appointments" icon={<Calendar size={18} />} label="Appointments" /> : null}
          {!isEcgOperator ? <TabButton id="patients" icon={<UserRound size={18} />} label="Patient Records" /> : null}
          <TabButton id="orders" icon={<ClipboardList size={18} />} label="Medical Orders" />
        </nav>

        <div className="cs-sidebar-footer">
          <button type="button" className="cs-logout-btn" onClick={() => setLogoutConfirmOpen(true)}>
            Logout
          </button>
        </div>
      </aside>

      <main className="cs-main">
        <div className="cs-topbar">
          <div className="cs-topbar-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {sidebarCollapsed ? (
                <button type="button" className="app-mobile-menu-btn" onClick={() => setSidebarCollapsed(false)} aria-label="Open menu">
                  <Menu size={18} />
                </button>
              ) : null}
              <div>
                <div className="cs-title">{cfg.label}</div>
                <div className="cs-subtitle">Connected to Supabase via the backend API</div>
              </div>
            </div>
          </div>
          <div className="cs-topbar-right">
            <div className="cs-pill">
              <span className={statusBadgeClass('Scheduled')}>Upcoming</span>
              <span>{metrics.upcoming}</span>
            </div>
            <AccountHeaderActions user={user} showChangePasswordMenu={false} onSignOut={handleLogout} onMyProfile={() => setActiveTab('profile')} onOpenNotification={(n) => {
              const type = String(n?.type || '').toLowerCase();
              if (type.includes('lab') || type.includes('result') || type.includes('imaging') || type.includes('radiology') || type.includes('ecg')) {
                setActiveTab('orders');
              } else if (type.includes('patient')) {
                setActiveTab('dashboard');
              } else {
                setActiveTab('dashboard');
              }
            }} />
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <div className="cs-grid">
            <div className="cs-card" style={{ gridColumn: 'span 12' }}>
              <div className="cs-card-title">Today at a Glance</div>
              <div className="cs-metrics">
                <div className="cs-metric">
                  <div className="cs-metric-k">Pending Orders</div>
                  <div className="cs-metric-v">{metrics.pending}</div>
                </div>
                <div className="cs-metric">
                  <div className="cs-metric-k">For Payment</div>
                  <div className="cs-metric-v">{metrics.forPayment}</div>
                </div>
                <div className="cs-metric">
                  <div className="cs-metric-k">Paid</div>
                  <div className="cs-metric-v">{metrics.paid}</div>
                </div>
                <div className="cs-metric">
                  <div className="cs-metric-k">Exam</div>
                  <div className="cs-metric-v">{metrics.exam}</div>
                </div>
                <div className="cs-metric">
                  <div className="cs-metric-k">Result</div>
                  <div className="cs-metric-v">{metrics.result}</div>
                </div>
                <div className="cs-metric">
                  <div className="cs-metric-k">Scheduled</div>
                  <div className="cs-metric-v">{metrics.scheduled}</div>
                </div>
                <div className="cs-metric">
                  <div className="cs-metric-k">In Progress</div>
                  <div className="cs-metric-v">{metrics.inProgress}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="cs-card">
            <div className="cs-card-title">Medical Orders</div>
            <div className="cs-toolbar" style={{ marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <select className="cs-select" value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}>
                <option value="All">All Status</option>
                <option value="Pending">Pending</option>
                <option value="For Payment">For Payment</option>
                <option value="Paid">Paid</option>
                <option value="Exam">Exam</option>
                <option value="Result">Result</option>
                <option value="Scheduled">Scheduled</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <select className="cs-select" value={orderRangeFilter} onChange={(e) => setOrderRangeFilter(e.target.value)} style={{ minWidth: 160 }}>
                <option value="All">All Dates</option>
                <option value="Today">Today</option>
                <option value="Week">This Week</option>
              </select>
              <button type="button" className="cs-btn secondary" onClick={refreshOrders} disabled={ordersLoading}>
                Refresh
              </button>
              {!isEcgOperator ? (
                <button type="button" className="cs-btn" onClick={() => setOrderFormOpen(true)}>
                  New Order
                </button>
              ) : null}
              {ordersError ? <span className="cs-muted">{ordersError}</span> : null}
              {paginatedOrders.totalPages > 1 ? (
                <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="cs-btn secondary"
                    onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                    disabled={paginatedOrders.page <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    className="cs-btn secondary"
                    onClick={() => setOrdersPage((p) => Math.min(paginatedOrders.totalPages, p + 1))}
                    disabled={paginatedOrders.page >= paginatedOrders.totalPages}
                    aria-label="Next page"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              ) : null}
            </div>

            {ordersLoading ? (
              <div className="cs-muted">Loading orders…</div>
            ) : displayedOrders.length === 0 ? (
              <div className="cs-muted">No orders match your filters.</div>
            ) : (
              <table className="cs-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Scheduled</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.items.map((o) => {
                    const statusLower = String(o.status || '').toLowerCase();
                    const isStat = String(o.priority || '').toUpperCase() === 'STAT';
                    const disableExam = statusLower !== 'paid';
                    const acknowledged = Boolean(o.acknowledgedAt || o.acknowledged_at || o.acknowledged);
                    return (
                    <tr key={String(o.id)} style={{ background: isStat ? '#fef2f2' : 'transparent' }}>
                      <td>{o.patientName || o.patientId || '—'}</td>
                      <td>
                        {isStat && <span style={{ padding: '2px 6px', background: '#ef4444', color: 'white', borderRadius: 4, fontSize: '0.7rem', marginRight: 8 }}>STAT</span>}
                        {o.service || o.kind || '—'}
                        {acknowledged ? (
                          <span style={{ marginLeft: 6, padding: '2px 6px', background: '#16a34a', color: 'white', borderRadius: 4, fontSize: '0.7rem' }}>Acknowledged</span>
                        ) : (
                          <span style={{ marginLeft: 6, padding: '2px 6px', background: '#f59e0b', color: 'white', borderRadius: 4, fontSize: '0.7rem' }}>New</span>
                        )}
                      </td>
                      <td><span className={statusBadgeClass(o.status)}>{o.status || '—'}</span></td>
                      <td>{o.scheduledAt ? fmtWhen(o.scheduledAt) : '—'}</td>
                      <td>
                        <div className="cs-row-actions">
                          <button type="button" className="cs-btn secondary" onClick={() => openOrder(o)}>View</button>
                          {!acknowledged && (
                            <button type="button" className="cs-btn secondary" onClick={() => handleAcknowledge(o.id)}>
                              <CheckCircle2 size={14} />
                              Ack
                            </button>
                          )}
                          <button type="button" className="cs-btn secondary" onClick={() => handleQuickStatus(o.id, 'Exam')} disabled={disableExam}>
                            Start Exam
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="cs-card">
            <div className="cs-card-title">Incoming Requests</div>
            <div className="cs-toolbar" style={{ marginBottom: 12 }}>
              <button type="button" className="cs-btn secondary" onClick={refreshApprovals} disabled={approvalsLoading}>
                <RefreshCw size={16} />
                Refresh
              </button>
              <select className="cs-select" value={approvalStatusFilter} onChange={(e) => setApprovalStatusFilter(e.target.value)} style={{ minWidth: 160 }}>
                <option value="All">All Status</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
              <select className="cs-select" value={approvalRangeFilter} onChange={(e) => setApprovalRangeFilter(e.target.value)} style={{ minWidth: 160 }}>
                <option value="All">All Dates</option>
                <option value="Today">Today</option>
                <option value="Week">This Week</option>
              </select>
              {approvalsError ? <span className="cs-muted">{approvalsError}</span> : null}
            </div>

            <div className="cs-two-col">
              <div className="cs-card" style={{ boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: 12, flexWrap: 'wrap' }}>
                  <div className="cs-card-title" style={{ margin: 0 }}>Approval Inbox</div>
                  {paginatedApprovals.totalPages > 1 ? (
                    <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="cs-btn secondary"
                        onClick={() => setApprovalsPage((p) => Math.max(1, p - 1))}
                        disabled={paginatedApprovals.page <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        type="button"
                        className="cs-btn secondary"
                        onClick={() => setApprovalsPage((p) => Math.min(paginatedApprovals.totalPages, p + 1))}
                        disabled={paginatedApprovals.page >= paginatedApprovals.totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  ) : null}
                </div>
                {approvalsLoading ? (
                  <div className="cs-muted">Loading…</div>
                ) : displayedApprovals.length === 0 ? (
                  <div className="cs-muted">No requests match your filters.</div>
                ) : (
                  <table className="cs-table">
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedApprovals.items.map((r) => (
                        <tr key={String(r.id)}>
                          <td>{r.patientName || 'Patient'}</td>
                          <td>{r.reason || r.serviceType || '—'}</td>
                          <td><span className={statusBadgeClass(String(r.status || '').includes('Pending') ? 'Pending' : r.status)}>{r.status || 'Pending'}</span></td>
                          <td>
                            <button type="button" className="cs-btn secondary" onClick={() => openApproval(r)}>
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="cs-card" style={{ boxShadow: 'none' }}>
                <div className="cs-card-title">Review</div>
                {!selectedApproval ? (
                  <div className="cs-muted">Select a request to review.</div>
                ) : (
                  <>
                    <div className="cs-field">
                      <div className="cs-field-label">Patient</div>
                      <div className="cs-muted">{selectedApproval.patientName || 'Patient'}</div>
                    </div>
                    <div className="cs-field">
                      <div className="cs-field-label">Reason</div>
                      <div className="cs-muted">{selectedApproval.reason || selectedApproval.serviceType || '—'}</div>
                    </div>
                    <div className="cs-field">
                      <div className="cs-field-label">Requested</div>
                      <div className="cs-muted">
                        {selectedApproval.requestedDate ? new Date(selectedApproval.requestedDate).toLocaleDateString() : '—'}{' '}
                        {selectedApproval.requestedTime ? String(selectedApproval.requestedTime).slice(0, 5) : ''}
                      </div>
                    </div>

                    <div className="cs-field">
                      <div className="cs-field-label">Note (optional)</div>
                      <textarea className="cs-input" rows={3} value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} />
                    </div>

                    {approvalActionError ? (
                      <div className="cs-muted" style={{ color: '#b91c1c', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <ShieldAlert size={16} />
                        {approvalActionError}
                      </div>
                    ) : null}

                    <div className="cs-row-actions" style={{ marginTop: 12 }}>
                      <button type="button" className="cs-btn secondary" onClick={() => setSelectedApproval(null)} disabled={approvalActionLoading}>
                        <XCircle size={16} />
                        Close
                      </button>
                      <button type="button" className="cs-btn secondary" onClick={() => applyApproval('Rejected')} disabled={approvalActionLoading}>
                        <XCircle size={16} />
                        Reject
                      </button>
                      <button type="button" className="cs-btn" onClick={() => applyApproval('Approved')} disabled={approvalActionLoading}>
                        <CheckCircle2 size={16} />
                        Approve
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'appointments' && (
          <div className="cs-card">
            <div className="cs-card-title">Appointments (Procedure Schedule)</div>
            <div className="cs-muted" style={{ marginBottom: 10 }}>
              This view is driven by scheduled clinical orders and your schedule events.
            </div>
            {scheduleLoading ? (
              <div className="cs-muted">Loading…</div>
            ) : scheduleError ? (
              <div className="cs-muted">{scheduleError}</div>
            ) : schedule.length === 0 ? (
              <div className="cs-muted">No schedule items yet.</div>
            ) : (
              <table className="cs-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Title</th>
                    <th>Notes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((ev) => (
                    <tr key={String(ev.id)}>
                      <td>{fmtWhen(ev.startAt)}</td>
                      <td>{ev.title || '—'}</td>
                      <td>{ev.notes || '—'}</td>
                      <td><span className={statusBadgeClass(ev.status)}>{ev.status || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'patients' && (
          <div className="cs-card">
            <div className="cs-card-title">Patient Records</div>
            <div className="cs-toolbar" style={{ marginBottom: 12 }}>
              <input className="cs-input" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patient name/email/id" />
              <button type="button" className="cs-btn secondary" onClick={refreshPatients} disabled={patientsLoading}>
                Refresh
              </button>
              {patientsError ? <span className="cs-muted">{patientsError}</span> : null}
            </div>

            <div className="cs-two-col">
              <div className="cs-card" style={{ boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: 12, flexWrap: 'wrap' }}>
                  <div className="cs-card-title" style={{ margin: 0 }}>Patients</div>
                  {paginatedPatients.totalPages > 1 ? (
                    <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="cs-btn secondary"
                        onClick={() => setPatientsPage((p) => Math.max(1, p - 1))}
                        disabled={paginatedPatients.page <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        type="button"
                        className="cs-btn secondary"
                        onClick={() => setPatientsPage((p) => Math.min(paginatedPatients.totalPages, p + 1))}
                        disabled={paginatedPatients.page >= paginatedPatients.totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  ) : null}
                </div>
                {patientsLoading ? (
                  <div className="cs-muted">Loading…</div>
                ) : filteredPatients.length === 0 ? (
                  <div className="cs-muted">No matches.</div>
                ) : (
                  <table className="cs-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedPatients.items.map((p) => {
                        const name = `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() || 'Patient';
                        return (
                          <tr key={String(p.id || p._id)}>
                            <td>{name}</td>
                            <td>{p.email || '—'}</td>
                            <td>
                              <button type="button" className="cs-btn secondary" onClick={() => setSelectedPatient(p)}>
                                View
                              </button>
                              <button
                                type="button"
                                className="cs-btn secondary"
                                style={{ marginLeft: 10 }}
                                onClick={() => {
                                  const pid = String(p.id || p._id || '').trim();
                                  if (!pid) return;
                                  setCentralRecordPatientId(pid);
                                  setCentralRecordPatientLabel(name);
                                  setCentralRecordOpen(true);
                                }}
                                disabled={!String(p.id || p._id || '').trim()}
                              >
                                Record
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="cs-card" style={{ boxShadow: 'none' }}>
                <div className="cs-card-title">Selected Patient</div>
                {!selectedPatient ? (
                  <div className="cs-muted">Select a patient to view details.</div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 1000, color: '#0f172a' }}>
                      {(`${selectedPatient.first_name || selectedPatient.firstName || ''} ${selectedPatient.last_name || selectedPatient.lastName || ''}`).trim() || 'Patient'}
                    </div>
                    <div className="cs-muted" style={{ marginTop: 6 }}>Email: {selectedPatient.email || '—'}</div>
                    <div className="cs-muted" style={{ marginTop: 6 }}>Gender: {selectedPatient.gender || '—'}</div>
                    <div className="cs-muted" style={{ marginTop: 6 }}>Contact: {selectedPatient.contact_number || selectedPatient.contactNumber || '—'}</div>
                    <div className="cs-muted" style={{ marginTop: 6 }}>Diagnosis: {selectedPatient.diagnosis || '—'}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'schedule' && (
          <div className="cs-card">
            <div className="cs-card-title">Schedule Management</div>
            <div className="cs-two-col">
              <div className="cs-card" style={{ boxShadow: 'none' }}>
                <div className="cs-card-title">Create Schedule Event</div>
                <div className="cs-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <input className="cs-input" value={eventForm.title} onChange={(e) => setEventForm((p) => ({ ...p, title: e.target.value }))} placeholder="Title" />
                  <input className="cs-input" type="datetime-local" value={eventForm.startAt} onChange={(e) => setEventForm((p) => ({ ...p, startAt: e.target.value }))} />
                  <input className="cs-input" type="datetime-local" value={eventForm.endAt} onChange={(e) => setEventForm((p) => ({ ...p, endAt: e.target.value }))} placeholder="End time (optional)" />
                  <input className="cs-input" value={eventForm.location} onChange={(e) => setEventForm((p) => ({ ...p, location: e.target.value }))} placeholder="Location (optional)" />
                  <input className="cs-input" value={eventForm.notes} onChange={(e) => setEventForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" />
                  <button type="button" className="cs-btn" onClick={handleCreateEvent} disabled={creatingEvent || !eventForm.startAt}>
                    Create
                  </button>
                </div>
              </div>

              <div className="cs-card" style={{ boxShadow: 'none' }}>
                <div className="cs-card-title">My Schedule</div>
                {scheduleLoading ? (
                  <div className="cs-muted">Loading…</div>
                ) : scheduleError ? (
                  <div className="cs-muted">{scheduleError}</div>
                ) : schedule.length === 0 ? (
                  <div className="cs-muted">No schedule items.</div>
                ) : (
                  <table className="cs-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Title</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((ev) => (
                        <tr key={String(ev.id)}>
                          <td>{fmtWhen(ev.startAt)}</td>
                          <td>{ev.title || '—'}</td>
                          <td><span className={statusBadgeClass(ev.status)}>{ev.status || '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      
        {activeTab === 'profile' && (

        <div className="admin-profile-container">
          <div className="admin-profile-header-card">
            <div className="profile-image-section">
              <div className="large-avatar-circle">
                <User size={64} color="#cbd5e1" />
              </div>
              <button type="button" className="btn-neutral-sm shadow-btn">Update Avatar</button>
            </div>
            <div className="profile-info-section">
              <h1>{user?.name || user?.username || user?.firstName || 'Clinical Staff'}</h1>
              <p className="admin-role-badge">Clinical Staff</p>
            </div>
          </div>

          <form className="admin-profile-form">
            <div className="profile-form-grid">
              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <User size={20} color="#475569" />
                    Personal Information
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Email Address</label>
                    <div className="input-wrapper-relative">
                      <Mail size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="email" 
                        value={user?.email || ''}
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Department / Role</label>
                    <div className="input-wrapper-relative">
                      <Briefcase size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="text" 
                        value="Clinical Staff"
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Phone Number</label>
                    <div className="input-wrapper-relative">
                      <Phone size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="tel" 
                        value={user?.phone || user?.contactNumber || ''}
                        readOnly
                        className="profile-input input-with-icon-padding input-disabled-bg"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="profile-column">
                <div className="profile-card">
                  <h3 className="column-title">
                    <Shield size={20} color="#475569" />
                    Security & Password
                  </h3>
                  
                  <div className="profile-input-group">
                    <label>Current Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="password"
                        className="profile-input input-with-icon-padding"
                        placeholder="Enter current password"
                      />
                      <button type="button" className="toggle-password-btn">
                        <Eye size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>New Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="password"
                        className="profile-input input-with-icon-padding"
                        placeholder="Enter new password"
                      />
                      <button type="button" className="toggle-password-btn">
                        <Eye size={20} />
                      </button>
                    </div>
                    
                    <div className="password-checklist">
                      <div className="checklist-item valid">
                        <X size={14} />
                        <span>At least 11 characters</span>
                      </div>
                      <div className="checklist-item valid">
                        <X size={14} />
                        <span>Contains special characters</span>
                      </div>
                      <div className="checklist-item valid">
                        <X size={14} />
                        <span>Contains numbers</span>
                      </div>
                    </div>
                  </div>

                  <div className="profile-input-group">
                    <label>Confirm New Password</label>
                    <div className="input-wrapper-relative">
                      <Key size={18} className="absolute-icon-left text-slate-400" />
                      <input 
                        type="password"
                        className="profile-input input-with-icon-padding"
                        placeholder="Confirm new password"
                      />
                      <button type="button" className="toggle-password-btn">
                        <Eye size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions-row">
              <button type="submit" className="btn-neutral-large flex-center-gap-8">
                <Save size={18} />
                Save Changes
              </button>
            </div>
          </form>
        </div>

        )}
      </main>

      {viewingOrder && (
        <div className="cs-modal-overlay" onClick={() => setViewingOrder(null)}>
          <div className="cs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cs-modal-head">
              <div className="cs-modal-title">Order Details</div>
              <button type="button" className="cs-btn secondary" onClick={() => setViewingOrder(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="cs-modal-body">
              {orderDetailLoading ? (
                <div className="cs-muted">Loading…</div>
              ) : (
                <>
                  <div className="cs-two-col">
                    <div className="cs-card" style={{ boxShadow: 'none' }}>
                      <div className="cs-card-title">Summary</div>
                      <div className="cs-muted">Patient: {viewingOrder.patientName || viewingOrder.patientId || '—'}</div>
                      <div className="cs-muted" style={{ marginTop: 6 }}>Service: {viewingOrder.service || viewingOrder.kind || '—'}</div>
                      <div className="cs-muted" style={{ marginTop: 6 }}>
                        Status: <span className={statusBadgeClass(viewingOrder.status)}>{viewingOrder.status || '—'}</span>
                      </div>
                      <div className="cs-muted" style={{ marginTop: 6 }}>Scheduled: {viewingOrder.scheduledAt ? fmtWhen(viewingOrder.scheduledAt) : '—'}</div>
                      <div className="cs-toolbar" style={{ marginTop: 10 }}>
                        <button type="button" className="cs-btn secondary" onClick={() => handleQuickStatus(viewingOrder.id, 'In Progress')} disabled={String(viewingOrder.status || '').toLowerCase() === 'completed'}>
                          Start
                        </button>
                        <button type="button" className="cs-btn" onClick={handleCompleteOrder} disabled={String(viewingOrder.status || '').toLowerCase() === 'completed'}>
                          Complete
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="cs-card" style={{ marginTop: 12 }}>
                    <div className="cs-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Upload Result</span>
                      <span className="cs-badge">{cfg.resultType}</span>
                    </div>
                    <div className="cs-two-col" style={{ marginTop: 10 }}>
                      <div className="cs-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <input className="cs-input" value={resultTitle} onChange={(e) => setResultTitle(e.target.value)} placeholder="Result title" />
                        <input className="cs-input" type="date" value={resultDate} onChange={(e) => setResultDate(e.target.value)} />
                        <input className="cs-input" type="file" onChange={(e) => setResultFile(e.target.files?.[0] || null)} />
                        <button type="button" className="cs-btn" onClick={handleUploadResult} disabled={resultSaving || !resultFile}>
                          <Upload size={16} />
                          Upload
                        </button>
                        {resultNotice ? <div className="cs-muted">{resultNotice}</div> : null}
                        {resultError ? <div className="cs-muted">{resultError}</div> : null}
                      </div>

                      <div>
                        <div className="cs-muted" style={{ marginBottom: 8 }}>Results for this order</div>
                        {orderDetail?.results?.length ? (
                          <table className="cs-table">
                            <thead>
                              <tr>
                                <th>Title</th>
                                <th>Date</th>
                                <th>Verification</th>
                                <th>Link</th>
                              </tr>
                            </thead>
                            <tbody>
                              {orderDetail.results.map((r) => (
                                <tr key={String(r.id)}>
                                  <td>{r.title || '—'}</td>
                                  <td>{r.resultDate ? new Date(r.resultDate).toLocaleDateString() : '—'}</td>
                                  <td>
                                    {r.verificationStatus ? (
                                      <span className={`cs-badge ${String(r.verificationStatus).toLowerCase() === 'verified' ? 'green' : 'orange'}`}>
                                        {r.verificationStatus}{r.verificationScore !== null && r.verificationScore !== undefined ? ` • ${r.verificationScore}` : ''}
                                      </span>
                                    ) : (
                                      <span className="cs-badge orange">pending</span>
                                    )}
                                  </td>
                                  <td>
                                    {r.url ? (
                                      <button type="button" className="cs-btn secondary" onClick={() => setViewingFileUrl(r.url)}>
                                        View Result
                                      </button>
                                    ) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="cs-muted">No results yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingFileUrl && (() => {
        const clean = viewingFileUrl.split('?')[0].split('#')[0].toLowerCase();
        const isImage = /\.(jpeg|jpg|gif|png|webp|bmp|svg|tif|tiff|avif)$/.test(clean);
        const isPdf = /\.pdf$/.test(clean);
        const filename = (() => {
          try {
            const u = new URL(viewingFileUrl);
            const last = decodeURIComponent(u.pathname.split('/').pop() || 'result');
            return last || 'result';
          } catch (_) {
            return 'result';
          }
        })();
        return (
          <div className="cs-modal-overlay" onClick={() => setViewingFileUrl(null)} style={{ zIndex: 9999 }}>
            <div className="cs-modal" style={{ maxWidth: '980px', width: '94vw', height: '88vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
              <div className="cs-modal-head">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div className="cs-modal-title">Result Viewer</div>
                  <div className="cs-muted" style={{ fontSize: '0.78rem' }}>{filename}</div>
                </div>
                <div className="cs-toolbar" style={{ gap: 6 }}>
                  <a
                    href={viewingFileUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="cs-btn secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    Open
                  </a>
                  <a
                    href={viewingFileUrl}
                    download={filename}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="cs-btn secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    Download
                  </a>
                  <button type="button" className="cs-btn secondary" onClick={() => setViewingFileUrl(null)}>
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="cs-modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden', background: '#f8fafc', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {isImage ? (
                  <img src={viewingFileUrl} alt="Result" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : isPdf ? (
                  <iframe src={viewingFileUrl} title="Result PDF" style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
                ) : (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <div className="cs-muted" style={{ marginBottom: 12 }}>Preview is not available for this file type.</div>
                    <div className="cs-toolbar" style={{ justifyContent: 'center', gap: 8 }}>
                      <a href={viewingFileUrl} target="_blank" rel="noreferrer noopener" className="cs-btn">Open in New Tab</a>
                      <a href={viewingFileUrl} download={filename} className="cs-btn secondary">Download File</a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {orderFormOpen && !isEcgOperator && (
        <div className="cs-modal-overlay" onClick={() => setOrderFormOpen(false)}>
          <div className="cs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cs-modal-head">
              <div className="cs-modal-title">Create Medical Order</div>
              <button type="button" className="cs-btn secondary" onClick={() => setOrderFormOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="cs-modal-body">
              <div className="cs-two-col">
                <div className="cs-card" style={{ boxShadow: 'none' }}>
                  <div className="cs-card-title">Order Info</div>
                  <div className="cs-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <select
                      className="cs-select"
                      value={orderForm.patientId}
                      onChange={(e) => setOrderForm((p) => ({ ...p, patientId: e.target.value }))}
                      disabled={patientsLoading}
                    >
                      <option value="">Select patient</option>
                      {(patients || []).slice(0, 200).map((p) => {
                        const id = String(p.id || p._id || '');
                        const name = `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() || 'Patient';
                        return (
                          <option key={id} value={id}>
                            {name}{p.email ? ` • ${p.email}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <input
                      className="cs-input"
                      value={orderForm.service}
                      onChange={(e) => setOrderForm((p) => ({ ...p, service: e.target.value }))}
                      placeholder={`Service (e.g. ${cfg.kind})`}
                    />
                    <select
                      className="cs-select"
                      value={orderForm.priority}
                      onChange={(e) => setOrderForm((p) => ({ ...p, priority: e.target.value }))}
                    >
                      <option value="Routine">Routine</option>
                      <option value="Urgent">Urgent</option>
                      <option value="STAT">STAT (Emergency)</option>
                    </select>
                    <input
                      className="cs-input"
                      type="datetime-local"
                      value={orderForm.scheduledAt}
                      onChange={(e) => setOrderForm((p) => ({ ...p, scheduledAt: e.target.value }))}
                    />
                    <input
                      className="cs-input"
                      value={orderForm.notes}
                      onChange={(e) => setOrderForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Notes (optional)"
                    />
                    <button type="button" className="cs-btn" onClick={handleCreateOrder} disabled={orderCreating}>
                      Create
                    </button>
                    {orderCreateError ? <div className="cs-muted">{orderCreateError}</div> : null}
                  </div>
                </div>

                <div className="cs-card" style={{ boxShadow: 'none' }}>
                  <div className="cs-card-title">Assigned To</div>
                  <div className="cs-muted">Role: {role}</div>
                  <div className="cs-muted" style={{ marginTop: 6 }}>Email: {user.email || '—'}</div>
                  <div className="cs-muted" style={{ marginTop: 10 }}>
                    Orders created here are assigned to your role and show up in Medical Orders immediately.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <PatientFullRecordModal
        open={centralRecordOpen}
        onClose={() => setCentralRecordOpen(false)}
        patientId={centralRecordPatientId}
        patientLabel={centralRecordPatientLabel}
        role={role}
        user={user}
      />

      <SignOutConfirmModal
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          confirmLogout();
        }}
      />
    </div>
  );
}
