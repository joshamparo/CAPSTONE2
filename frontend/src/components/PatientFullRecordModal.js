import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ClipboardList,
  CreditCard,
  FileText,
  FlaskConical,
  Receipt,
  Stethoscope,
  UserRound,
  X
} from 'lucide-react';
import { API_BASE, buildAuthHeaders, fetchJson, getCurrentUser } from '../utils/api';
import './PatientFullRecordModal.css';

const DASH = '—';

const fmtDate = (value, fallback = DASH) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString();
};

const fmtDateTime = (value, fallback = DASH) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
};

const fmtMoney = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 'PHP 0.00';
  return `PHP ${amount.toFixed(2)}`;
};

const summarizeAddress = (patient) => {
  return [
    patient?.street,
    patient?.city,
    patient?.province,
    patient?.postal_code || patient?.postalCode,
    patient?.country
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(', ');
};

const readEmergencyContacts = (patient) => {
  if (Array.isArray(patient?.emergency_contacts)) return patient.emergency_contacts;
  if (Array.isArray(patient?.emergencyContacts)) return patient.emergencyContacts;
  return [];
};

const canSeeBilling = (role) =>
  new Set(['admin', 'cashier', 'staff', 'doctor_secretary', 'office_staff']).has(String(role || '').toLowerCase());

const canSeeNotes = (role) => !new Set(['cashier']).has(String(role || '').toLowerCase());

const sectionEmpty = (message) => <div className="patient-record-empty">{message}</div>;
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export default function PatientFullRecordModal({
  open,
  onClose,
  patientId,
  patientLabel,
  role,
  user,
  extraHeaders
}) {
  const currentUser = useMemo(() => user || getCurrentUser() || {}, [user]);
  const headers = useMemo(
    () => ({ ...buildAuthHeaders(currentUser, role), ...(extraHeaders || {}) }),
    [currentUser, role, extraHeaders]
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    if (!open) {
      setTab('overview');
      return undefined;
    }
    if (!patientId) {
      setRecord(null);
      setError('Missing patient ID.');
      return undefined;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchJson(`/api/patients/${encodeURIComponent(String(patientId).trim())}/full-record`, {
          apiBase: API_BASE,
          headers,
          timeoutMs: 45000
        });
        if (!cancelled) setRecord(data || null);
      } catch (e) {
        if (!cancelled) {
          setRecord(null);
          setError(String(e?.message || 'Unable to load patient record.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, patientId, headers]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const patient = record?.patient || {};
  const overview = record?.overview || {};
  const encounters = Array.isArray(record?.encounters) ? record.encounters : [];
  const notes = Array.isArray(record?.notes) ? record.notes : [];
  const prescriptions = Array.isArray(record?.prescriptions) ? record.prescriptions : [];
  const results = Array.isArray(record?.results) ? record.results : [];
  const orders = Array.isArray(record?.orders) ? record.orders : [];
  const invoices = Array.isArray(record?.billing?.invoices) ? record.billing.invoices : [];
  const certificates = Array.isArray(record?.certificates) ? record.certificates : [];
  const serviceRequests = Array.isArray(record?.requests) ? record.requests : [];
  const timeline = Array.isArray(record?.timeline) ? record.timeline : [];
  const walkIns = Array.isArray(record?.clinicalRecords?.walkInIntakes) ? record.clinicalRecords.walkInIntakes : [];
  const erRegistration = record?.clinicalRecords?.erRegistration;
  const emergencyContacts = readEmergencyContacts(patient);

  const tabs = [
    { key: 'overview', label: 'Overview', icon: <UserRound size={16} /> },
    { key: 'vitals', label: 'Vitals & Triage', icon: <Activity size={16} /> },
    { key: 'encounters', label: 'Encounters', icon: <Stethoscope size={16} /> },
    { key: 'timeline', label: 'Timeline', icon: <ClipboardList size={16} /> },
    ...(canSeeNotes(role) ? [{ key: 'notes', label: 'Clinical Notes', icon: <FileText size={16} /> }] : []),
    { key: 'orders', label: 'Orders & Results', icon: <FlaskConical size={16} /> },
    { key: 'prescriptions', label: 'Prescriptions', icon: <FileText size={16} /> },
    { key: 'admission', label: 'Admission', icon: <Receipt size={16} /> },
    { key: 'documents', label: 'Documents', icon: <FileText size={16} /> },
    ...(canSeeBilling(role) ? [{ key: 'billing', label: 'Billing', icon: <CreditCard size={16} /> }] : [])
  ];

  const displayName = overview.displayName || patient.displayName || patientLabel || 'Patient';

  const handlePrintRecord = () => {
    if (!record) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const profileRows = [
      ['Patient ID', patient.id || patientId || DASH],
      ['Full Name', displayName],
      ['Gender', patient.gender || 'Unspecified'],
      ['Date of Birth', patient.dateOfBirth ? fmtDate(patient.dateOfBirth) : 'DOB not set'],
      ['Contact', patient.contactNumber || patient.contact_number || 'No contact number'],
      ['Email', patient.email || DASH],
      ['Blood Type', patient.blood_type || patient.bloodType || DASH],
      ['Allergies', patient.allergies || 'None recorded'],
      ['Address', summarizeAddress(patient) || 'No address recorded']
    ];

    const renderRows = (rows) =>
      rows
        .map(
          ([label, value]) =>
            `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
        )
        .join('');

    const renderList = (items, renderItem, emptyText) =>
      items.length
        ? `<div class="print-list">${items.map(renderItem).join('')}</div>`
        : `<div class="print-empty">${escapeHtml(emptyText)}</div>`;

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(displayName)} - Patient Record</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
            .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; }
            .brand { font-size: 24px; font-weight: 800; color:#ea580c; }
            .sub { color:#64748b; margin-top:4px; }
            .section { margin-top: 22px; page-break-inside: avoid; }
            .section h2 { font-size: 18px; margin: 0 0 12px; border-bottom: 2px solid #fed7aa; padding-bottom: 6px; }
            table { width:100%; border-collapse: collapse; }
            th, td { border: 1px solid #e2e8f0; padding: 10px; text-align:left; vertical-align: top; }
            th { width: 28%; background:#fff7ed; font-weight:700; }
            .chips span { display:inline-block; margin: 4px 6px 0 0; padding: 6px 10px; border-radius: 999px; background:#eff6ff; color:#1d4ed8; font-size:12px; }
            .item { border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
            .item-head { display:flex; justify-content:space-between; gap:12px; font-weight:700; margin-bottom:6px; }
            .muted { color:#64748b; font-size:12px; }
            .print-empty { color:#64748b; font-style: italic; }
            .toolbar { margin-bottom: 20px; }
            .toolbar button { background:#ea580c; color:#fff; border:none; padding:10px 16px; border-radius:10px; font-weight:700; cursor:pointer; }
            @media print { .toolbar { display:none; } body { margin: 12px; } }
          </style>
        </head>
        <body>
          <div class="toolbar"><button onclick="window.print()">Print Record</button></div>
          <div class="header">
            <div>
              <div class="brand">PASCUALINGA</div>
              <div class="sub">Centralized Patient Record</div>
            </div>
            <div class="sub">Generated ${escapeHtml(new Date().toLocaleString())}</div>
          </div>

          <div class="section">
            <h2>Patient Profile</h2>
            <table>${renderRows(profileRows)}</table>
          </div>

          <div class="section">
            <h2>Care Overview</h2>
            <table>${renderRows([
              ['Current Doctor', overview.currentDoctor || 'Unassigned'],
              ['Admission Status', overview.admissionStatus || 'Outpatient'],
              ['Ward / Room', overview.wardNumber || DASH],
              ['Diagnosis', overview.diagnosis || patient.diagnosis || 'No diagnosis yet'],
              ['Encounter Count', overview?.counts?.encounters || 0],
              ['Orders', overview?.counts?.orders || 0],
              ['Results', overview?.counts?.results || 0]
            ])}</table>
          </div>

          <div class="section">
            <h2>Encounters</h2>
            ${renderList(
              encounters,
              (encounter) => `
                <div class="item">
                  <div class="item-head">
                    <span>${escapeHtml(encounter.type || encounter.consultationMode || 'Encounter')}</span>
                    <span>${escapeHtml(fmtDateTime(encounter.createdAt || encounter.appointmentDate))}</span>
                  </div>
                  <div class="muted">${escapeHtml(encounter.status || 'Status not set')} • ${escapeHtml(encounter.doctorName || encounter.assignedDoctor || 'Doctor not assigned')}</div>
                  <div>${escapeHtml(encounter.reason || encounter.mainConcern || 'No reason recorded')}</div>
                </div>
              `,
              'No encounter history yet.'
            )}
          </div>

          <div class="section">
            <h2>Clinical Notes</h2>
            ${renderList(
              canSeeNotes(role) ? notes : [],
              (note) => `
                <div class="item">
                  <div class="item-head">
                    <span>${escapeHtml(note.doctorName || 'Doctor note')}</span>
                    <span>${escapeHtml(fmtDateTime(note.createdAt))}</span>
                  </div>
                  <div><strong>Assessment:</strong> ${escapeHtml(note.assessment || DASH)}</div>
                  ${note.subjective ? `<div><strong>Subjective:</strong> ${escapeHtml(note.subjective)}</div>` : ''}
                  ${note.objective ? `<div><strong>Objective:</strong> ${escapeHtml(note.objective)}</div>` : ''}
                  ${note.plan ? `<div><strong>Plan:</strong> ${escapeHtml(note.plan)}</div>` : ''}
                </div>
              `,
              'No doctor notes recorded yet.'
            )}
          </div>

          <div class="section">
            <h2>Orders & Results</h2>
            ${renderList(
              orders,
              (order) => `
                <div class="item">
                  <div class="item-head">
                    <span>${escapeHtml(order.service || order.kind || 'Order')}</span>
                    <span>${escapeHtml(order.status || DASH)}</span>
                  </div>
                  <div class="muted">${escapeHtml(order.assignedRole || DASH)} • ${escapeHtml(fmtDateTime(order.createdAt))}</div>
                </div>
              `,
              'No clinical orders.'
            )}
            ${renderList(
              results,
              (result) => `
                <div class="item">
                  <div class="item-head">
                    <span>${escapeHtml(result.title || result.type || 'Result')}</span>
                    <span>${escapeHtml(fmtDate(result.resultDate || result.createdAt))}</span>
                  </div>
                  <div class="muted">${escapeHtml(result.type || DASH)}</div>
                </div>
              `,
              'No lab or test results uploaded.'
            )}
          </div>

          <div class="section">
            <h2>Prescriptions</h2>
            ${renderList(
              prescriptions,
              (prescription) => `
                <div class="item">
                  <div class="item-head">
                    <span>${escapeHtml(prescription.doctorName || 'Prescription')}</span>
                    <span>${escapeHtml(fmtDateTime(prescription.createdAt))}</span>
                  </div>
                  <div><strong>Diagnosis:</strong> ${escapeHtml(prescription.diagnosis || DASH)}</div>
                  <div><strong>Instructions:</strong> ${escapeHtml(prescription.instructions || DASH)}</div>
                  ${
                    Array.isArray(prescription.items) && prescription.items.length
                      ? `<div class="chips">${prescription.items
                          .map(
                            (item) =>
                              `<span>${escapeHtml(
                                [item?.medication || 'Medicine', item?.dosage, item?.frequency]
                                  .filter(Boolean)
                                  .join(' • ')
                              )}</span>`
                          )
                          .join('')}</div>`
                      : ''
                  }
                </div>
              `,
              'No prescriptions recorded yet.'
            )}
          </div>

          <div class="section">
            <h2>Admission & Ward</h2>
            <table>${renderRows([
              ['Current Status', overview.admissionStatus || 'Outpatient'],
              ['Ward / Room', overview.wardNumber || DASH],
              ['Attending Doctor', patient.attending_doctor || patient.attendingDoctor || overview.currentDoctor || DASH],
              ['Admission Date', fmtDate(patient.admission_date || patient.admissionDate)]
            ])}</table>
          </div>

          <div class="section">
            <h2>Timeline</h2>
            ${renderList(
              timeline,
              (entry) => `
                <div class="item">
                  <div class="item-head">
                    <span>${escapeHtml(entry.title || 'Timeline entry')}</span>
                    <span>${escapeHtml(fmtDateTime(entry.date))}</span>
                  </div>
                  <div class="muted">${escapeHtml(String(entry.type || '').replace(/_/g, ' '))}</div>
                </div>
              `,
              'No timeline entries yet.'
            )}
          </div>

          ${
            canSeeBilling(role)
              ? `
                <div class="section">
                  <h2>Billing</h2>
                  <table>${renderRows([
                    ['Total Invoiced', fmtMoney(record?.billing?.totals?.invoiced)],
                    ['Total Paid', fmtMoney(record?.billing?.totals?.paid)],
                    ['Open Invoices', invoices.filter((invoice) => Number(invoice.balance || 0) > 0).length]
                  ])}</table>
                  ${renderList(
                    invoices,
                    (invoice) => `
                      <div class="item">
                        <div class="item-head">
                          <span>${escapeHtml(`Invoice #${invoice.id}`)}</span>
                          <span>${escapeHtml(invoice.status || 'Draft')}</span>
                        </div>
                        <div class="muted">Total ${escapeHtml(fmtMoney(invoice.totalAmount))} • Paid ${escapeHtml(fmtMoney(invoice.paidAmount))} • Balance ${escapeHtml(fmtMoney(invoice.balance))}</div>
                      </div>
                    `,
                    'No billing invoices yet.'
                  )}
                </div>
              `
              : ''
          }
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  return (
    <div className="patient-record-overlay" onClick={onClose}>
      <div className="patient-record-modal" onClick={(e) => e.stopPropagation()}>
        <div className="patient-record-head">
          <div>
            <div className="patient-record-title">Patient Record Center</div>
            <div className="patient-record-sub">
              {displayName} • {patient.id || patientId}
            </div>
          </div>
          <div className="patient-record-head-actions">
            <button type="button" className="patient-record-print" onClick={handlePrintRecord}>
              Print Record
            </button>
            <button type="button" className="patient-record-close" onClick={onClose} aria-label="Close patient record">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="patient-record-summary">
          <div className="patient-record-hero">
            <div className="patient-record-name">{displayName}</div>
            <div className="patient-record-meta">
              <span>{patient.gender || 'Unspecified'}</span>
              <span>{patient.dateOfBirth ? fmtDate(patient.dateOfBirth) : 'DOB not set'}</span>
              <span>{patient.contactNumber || patient.contact_number || 'No contact number'}</span>
            </div>
          </div>
          <div className="patient-record-kpis">
            <div className="patient-record-kpi">
              <span className="label">Current Doctor</span>
              <strong>{overview.currentDoctor || 'Unassigned'}</strong>
            </div>
            <div className="patient-record-kpi">
              <span className="label">Admission</span>
              <strong>{overview.admissionStatus || 'Outpatient'}</strong>
            </div>
            <div className="patient-record-kpi">
              <span className="label">Ward / Room</span>
              <strong>{overview.wardNumber || DASH}</strong>
            </div>
            <div className="patient-record-kpi">
              <span className="label">Encounters</span>
              <strong>{overview?.counts?.encounters || 0}</strong>
            </div>
          </div>
        </div>

        <div className="patient-record-tabs">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`patient-record-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="patient-record-body">
          {loading ? <div className="patient-record-empty">Loading patient record...</div> : null}
          {!loading && error ? <div className="patient-record-error">{error}</div> : null}

          {!loading && !error && record ? (
            <>
              {tab === 'overview' ? (
                <div className="patient-record-grid">
                  <section className="patient-record-card">
                    <div className="card-title">Profile</div>
                    <div className="patient-record-info-grid">
                      <div><span className="muted">Email</span><strong>{patient.email || DASH}</strong></div>
                      <div><span className="muted">Blood Type</span><strong>{patient.blood_type || patient.bloodType || DASH}</strong></div>
                      <div><span className="muted">Allergies</span><strong>{patient.allergies || 'None recorded'}</strong></div>
                      <div><span className="muted">PhilHealth</span><strong>{patient.philHealthNumber || patient.philhealth_number || DASH}</strong></div>
                      <div className="full"><span className="muted">Address</span><strong>{summarizeAddress(patient) || 'No address recorded'}</strong></div>
                    </div>
                  </section>

                  <section className="patient-record-card">
                    <div className="card-title">Clinical Snapshot</div>
                    <div className="patient-record-info-grid">
                      <div><span className="muted">Diagnosis</span><strong>{overview.diagnosis || patient.diagnosis || 'No diagnosis yet'}</strong></div>
                      <div><span className="muted">Attending Doctor</span><strong>{patient.attending_doctor || patient.attendingDoctor || overview.currentDoctor || DASH}</strong></div>
                      <div><span className="muted">Orders</span><strong>{overview?.counts?.orders || 0}</strong></div>
                      <div><span className="muted">Results</span><strong>{overview?.counts?.results || 0}</strong></div>
                      <div className="full"><span className="muted">ER / Walk-in history</span><strong>{walkIns.length} intake record(s)</strong></div>
                    </div>
                  </section>

                  <section className="patient-record-card full-width">
                    <div className="card-title">Emergency Contacts</div>
                    {emergencyContacts.length === 0 ? (
                      <div className="patient-record-empty-inline">No emergency contacts recorded.</div>
                    ) : (
                      <div className="patient-record-list compact">
                        {emergencyContacts.map((contact, index) => (
                          <div key={`${contact?.name || 'contact'}-${index}`} className="patient-record-list-item">
                            <strong>{contact?.name || 'Unnamed contact'}</strong>
                            <span>{contact?.relationship || 'Relationship not set'}</span>
                            <span>{contact?.contactNumber || contact?.phone || 'No phone'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {tab === 'vitals' ? (
                <div className="patient-record-grid">
                  {erRegistration && erRegistration.vitals ? (
                    <section className="patient-record-card full-width" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)' }}>
                      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Latest ER Vitals</span>
                        <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'normal' }}>{fmtDateTime(erRegistration.createdAt)}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginTop: '16px' }}>
                        <div style={{ padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Blood Pressure</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: erRegistration.triage?.reasons?.includes('Critical Blood Pressure') ? '#dc2626' : '#0f172a' }}>
                            {erRegistration.vitals.bloodPressure || DASH} <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>mmHg</span>
                          </div>
                        </div>
                        <div style={{ padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Heart Rate</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: erRegistration.triage?.reasons?.includes('Abnormal Heart Rate') ? '#dc2626' : '#0f172a' }}>
                            {erRegistration.vitals.heartRate || DASH} <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>bpm</span>
                          </div>
                        </div>
                        <div style={{ padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Temperature</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: erRegistration.triage?.reasons?.includes('Abnormal Temperature') ? '#dc2626' : '#0f172a' }}>
                            {erRegistration.vitals.temperature || DASH} <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>°C</span>
                          </div>
                        </div>
                        <div style={{ padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>SpO2</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: erRegistration.triage?.reasons?.includes('Low Oxygen Saturation') ? '#dc2626' : '#0f172a' }}>
                            {erRegistration.vitals.spo2 || DASH} <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>%</span>
                          </div>
                        </div>
                      </div>
                      {erRegistration.triage && (
                        <div style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', background: '#fff', border: '1px solid #e2e8f0' }}>
                          <strong style={{ fontSize: '0.85rem', color: '#475569', textTransform: 'uppercase' }}>Triage Assessment:</strong>
                          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ padding: '6px 12px', borderRadius: '8px', background: erRegistration.triage.level <= 2 ? '#fee2e2' : '#f1f5f9', color: erRegistration.triage.level <= 2 ? '#b91c1c' : '#475569', fontWeight: 800, fontSize: '0.85rem' }}>
                              Level {erRegistration.triage.level} ({erRegistration.triage.label})
                            </span>
                            {erRegistration.triage.reasons?.map((reason, i) => (
                              <span key={i} style={{ fontSize: '0.85rem', color: '#dc2626', background: '#fff', border: '1px solid #fecaca', padding: '4px 10px', borderRadius: '6px' }}>⚠️ {reason}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  ) : (
                    <div className="patient-record-card full-width">
                      {sectionEmpty('No ER vitals recorded.')}
                    </div>
                  )}

                  {walkIns.length > 0 && (
                    <section className="patient-record-card full-width">
                      <div className="card-title">Walk-In Intake History</div>
                      <div className="patient-record-list compact">
                        {walkIns.map((w, idx) => (
                          <div key={idx} className="patient-record-list-item">
                            <div className="list-head">
                              <strong>{w.mainConcern || 'Walk-in Intake'}</strong>
                              <span>{fmtDateTime(w.createdAt)}</span>
                            </div>
                            <div className="list-meta" style={{ marginTop: '12px', display: 'flex', gap: '16px', background: '#fff', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                               {w.vitals?.bloodPressure && <div><span style={{color: '#94a3b8', fontSize: '0.75rem', textTransform:'uppercase', fontWeight: 700}}>BP</span> <strong style={{color:'#0f172a', display:'block'}}>{w.vitals.bloodPressure}</strong></div>}
                               {w.vitals?.heartRate && <div><span style={{color: '#94a3b8', fontSize: '0.75rem', textTransform:'uppercase', fontWeight: 700}}>HR</span> <strong style={{color:'#0f172a', display:'block'}}>{w.vitals.heartRate} bpm</strong></div>}
                               {w.vitals?.temperature && <div><span style={{color: '#94a3b8', fontSize: '0.75rem', textTransform:'uppercase', fontWeight: 700}}>Temp</span> <strong style={{color:'#0f172a', display:'block'}}>{w.vitals.temperature} °C</strong></div>}
                               {w.vitals?.spo2 && <div><span style={{color: '#94a3b8', fontSize: '0.75rem', textTransform:'uppercase', fontWeight: 700}}>SpO2</span> <strong style={{color:'#0f172a', display:'block'}}>{w.vitals.spo2} %</strong></div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : null}

              {tab === 'encounters' ? (
                <div className="patient-record-list">
                  {encounters.length === 0
                    ? sectionEmpty('No encounters recorded yet.')
                    : encounters.map((encounter) => (
                        <div key={encounter.id} className="patient-record-list-item">
                          <div className="list-head">
                            <strong>{encounter.reason || encounter.mainConcern || 'Consultation encounter'}</strong>
                            <span>{fmtDate(encounter.appointmentDate)}</span>
                          </div>
                          <div className="list-meta">
                            <span>{encounter.status || DASH}</span>
                            <span>{encounter.consultationMode || DASH}</span>
                            <span>{encounter.doctorName || 'No doctor assigned'}</span>
                          </div>
                        </div>
                      ))}
                </div>
              ) : null}

              {tab === 'timeline' ? (
                <div className="patient-record-timeline">
                  {timeline.length === 0
                    ? sectionEmpty('No timeline entries yet.')
                    : timeline.map((entry) => (
                        <div key={entry.id} className="timeline-item">
                          <div className="timeline-dot" />
                          <div className="timeline-content">
                            <div className="timeline-head">
                              <strong>{entry.title}</strong>
                              <span>{fmtDateTime(entry.date)}</span>
                            </div>
                            <div className="timeline-type">{String(entry.type || '').replace(/_/g, ' ')}</div>
                          </div>
                        </div>
                      ))}
                </div>
              ) : null}

              {tab === 'notes' && canSeeNotes(role) ? (
                <div className="patient-record-list">
                  {notes.length === 0
                    ? sectionEmpty('No doctor notes recorded yet.')
                    : notes.map((note) => (
                        <div key={note.id} className="patient-record-list-item">
                          <div className="list-head">
                            <strong>{note.doctorName || 'Doctor note'}</strong>
                            <span>{fmtDateTime(note.createdAt)}</span>
                          </div>
                          <div className="patient-record-note">
                            <p><strong>Assessment:</strong> {note.assessment || DASH}</p>
                            {note.subjective ? <p><strong>Subjective:</strong> {note.subjective}</p> : null}
                            {note.objective ? <p><strong>Objective:</strong> {note.objective}</p> : null}
                            {note.plan ? <p><strong>Plan:</strong> {note.plan}</p> : null}
                          </div>
                        </div>
                      ))}
                </div>
              ) : null}

              {tab === 'orders' ? (
                <div className="patient-record-grid">
                  <section className="patient-record-card">
                    <div className="card-title">Clinical Orders</div>
                    {orders.length === 0 ? (
                      <div className="patient-record-empty-inline">No clinical orders.</div>
                    ) : (
                      <div className="patient-record-list compact">
                        {orders.map((order) => (
                          <div key={order.id} className="patient-record-list-item">
                            <div className="list-head">
                              <strong>{order.service || order.kind || 'Order'}</strong>
                              <span>{order.status || DASH}</span>
                            </div>
                            <div className="list-meta">
                              <span>{order.kind || DASH}</span>
                              <span>{order.assignedRole || DASH}</span>
                              <span>{fmtDateTime(order.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="patient-record-card">
                    <div className="card-title">Lab / Test Results</div>
                    {results.length === 0 ? (
                      <div className="patient-record-empty-inline">No results uploaded.</div>
                    ) : (
                      <div className="patient-record-list compact">
                        {results.map((result) => (
                          <div key={result.id} className="patient-record-list-item">
                            <div className="list-head">
                              <strong>{result.title || result.type || 'Result'}</strong>
                              <span>{fmtDate(result.resultDate || result.createdAt)}</span>
                            </div>
                            <div className="list-meta">
                              <span>{result.type || DASH}</span>
                              {result.url ? <a href={result.url} target="_blank" rel="noreferrer">Open file</a> : <span>No file</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {tab === 'prescriptions' ? (
                <div className="patient-record-list">
                  {prescriptions.length === 0
                    ? sectionEmpty('No prescriptions recorded yet.')
                    : prescriptions.map((prescription) => (
                        <div key={prescription.id} className="patient-record-list-item">
                          <div className="list-head">
                            <strong>{prescription.doctorName || 'Prescription'}</strong>
                            <span>{fmtDateTime(prescription.createdAt)}</span>
                          </div>
                          <div className="patient-record-note">
                            <p><strong>Diagnosis:</strong> {prescription.diagnosis || DASH}</p>
                            <p><strong>Instructions:</strong> {prescription.instructions || DASH}</p>
                            {Array.isArray(prescription.items) && prescription.items.length > 0 ? (
                              <div className="patient-record-chip-wrap">
                                {prescription.items.map((item, index) => (
                                  <span key={`${item?.medication || 'item'}-${index}`} className="patient-record-chip">
                                    {item?.medication || 'Medicine'}
                                    {item?.dosage ? ` • ${item.dosage}` : ''}
                                    {item?.frequency ? ` • ${item.frequency}` : ''}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                </div>
              ) : null}

              {tab === 'admission' ? (
                <div className="patient-record-grid">
                  <section className="patient-record-card">
                    <div className="card-title">Admission Status</div>
                    <div className="patient-record-info-grid">
                      <div><span className="muted">Current Status</span><strong>{overview.admissionStatus || 'Outpatient'}</strong></div>
                      <div><span className="muted">Ward / Room</span><strong>{overview.wardNumber || DASH}</strong></div>
                      <div><span className="muted">Attending Doctor</span><strong>{patient.attending_doctor || patient.attendingDoctor || overview.currentDoctor || DASH}</strong></div>
                      <div><span className="muted">Admission Date</span><strong>{fmtDate(patient.admission_date || patient.admissionDate)}</strong></div>
                    </div>
                  </section>
                  <section className="patient-record-card">
                    <div className="card-title">Walk-in / ER Intake</div>
                    {walkIns.length === 0
                      ? <div className="patient-record-empty-inline">No walk-in or ER intake history.</div>
                      : (
                        <div className="patient-record-list compact">
                          {walkIns.map((entry, index) => (
                            <div key={`${entry?.createdAt || 'walkin'}-${index}`} className="patient-record-list-item">
                              <div className="list-head">
                                <strong>{entry?.label || entry?.type || 'Walk-in intake'}</strong>
                                <span>{fmtDateTime(entry?.createdAt)}</span>
                              </div>
                              <div className="list-meta">
                                <span>{entry?.mainConcern || 'No concern recorded'}</span>
                                <span>{entry?.triage?.label || 'No triage label'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                  </section>
                </div>
              ) : null}

              {tab === 'documents' ? (
                <div className="patient-record-grid">
                  <section className="patient-record-card">
                    <div className="card-title">Certificates</div>
                    {certificates.length === 0 ? (
                      <div className="patient-record-empty-inline">No certificates recorded.</div>
                    ) : (
                      <div className="patient-record-list compact">
                        {certificates.map((certificate) => (
                          <div key={certificate.id} className="patient-record-list-item">
                            <div className="list-head">
                              <strong>{certificate.purpose || 'Medical certificate'}</strong>
                              <span>{fmtDateTime(certificate.createdAt || certificate.validUntil)}</span>
                            </div>
                            <div className="list-meta">
                              <span>{certificate.doctorName || 'No doctor'}</span>
                              <span>{certificate.diagnosis || DASH}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="patient-record-card">
                    <div className="card-title">Related Service Requests</div>
                    {serviceRequests.length === 0 ? (
                      <div className="patient-record-empty-inline">No related service requests.</div>
                    ) : (
                      <div className="patient-record-list compact">
                        {serviceRequests.map((request) => (
                          <div key={request.id} className="patient-record-list-item">
                            <div className="list-head">
                              <strong>{request.message || 'Service request'}</strong>
                              <span>{fmtDateTime(request.createdAt)}</span>
                            </div>
                            <div className="list-meta">
                              <span>{request.status || DASH}</span>
                              <span>{request.service || request.department || DASH}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}

              {tab === 'billing' && canSeeBilling(role) ? (
                <div className="patient-record-grid">
                  <section className="patient-record-card">
                    <div className="card-title">Billing Summary</div>
                    <div className="patient-record-info-grid">
                      <div><span className="muted">Total Invoiced</span><strong>{fmtMoney(record?.billing?.totals?.invoiced)}</strong></div>
                      <div><span className="muted">Total Paid</span><strong>{fmtMoney(record?.billing?.totals?.paid)}</strong></div>
                      <div><span className="muted">Open Invoices</span><strong>{invoices.filter((invoice) => Number(invoice.balance || 0) > 0).length}</strong></div>
                    </div>
                  </section>
                  <section className="patient-record-card">
                    <div className="card-title">Invoices</div>
                    {invoices.length === 0 ? (
                      <div className="patient-record-empty-inline">No billing invoices yet.</div>
                    ) : (
                      <div className="patient-record-list compact">
                        {invoices.map((invoice) => (
                          <div key={invoice.id} className="patient-record-list-item">
                            <div className="list-head">
                              <strong>Invoice #{invoice.id}</strong>
                              <span>{invoice.status || 'Draft'}</span>
                            </div>
                            <div className="list-meta">
                              <span>Total {fmtMoney(invoice.totalAmount)}</span>
                              <span>Paid {fmtMoney(invoice.paidAmount)}</span>
                              <span>Balance {fmtMoney(invoice.balance)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
