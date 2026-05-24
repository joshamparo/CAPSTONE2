import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, MessageCircleMore, Send, ShieldCheck, X } from 'lucide-react';
import { API_BASE, buildAuthHeaders, getCurrentUser } from '../utils/api';
import './AssistantWidget.css';

const ROLE_LABELS = {
  public: 'Public Visitor',
  admin: 'Administrator',
  doctor: 'Doctor',
  nurse: 'Nurse',
  pharmacist: 'Pharmacist',
  cashier: 'Cashier',
  doctor_secretary: 'Doctor Secretary',
  medtech: 'Medtech',
  radiographer: 'Radiographer',
  ecg_operator: 'ECG Operator',
  physical_therapist: 'Physical Therapist',
  staff: 'Staff',
  patient: 'Patient'
};

const ROLE_QUICK_QUESTIONS = {
  public: [
    'What services does the hospital offer?',
    'Where is the hospital located?',
    'What is the emergency contact number?',
    'What are your visiting hours?'
  ],
  admin: [
    'How do I post announcements?',
    'How do I manage staff accounts?',
    'How do I change role permissions?'
  ],
  doctor: [
    'How do I use the patient queue?',
    'How do I create orders?',
    'How do I check approvals?'
  ],
  nurse: [
    'How do I update patient records?',
    'How do I check ward tasks?'
  ],
  pharmacist: [
    'How do I check prescriptions?',
    'How do I use the pharmacy POS?'
  ],
  cashier: [
    'How do I check billing records?',
    'How do I update payment status?'
  ],
  doctor_secretary: [
    'How do I manage doctor appointments?',
    'How do I check schedules?'
  ],
  medtech: [
    'How do I view lab-related tasks?',
    'How do I update request status?'
  ],
  radiographer: [
    'How do I view imaging requests?',
    'How do I update imaging workflow status?'
  ],
  ecg_operator: [
    'How do I check ECG tasks?',
    'How do I update ECG request status?'
  ],
  physical_therapist: [
    'How do I check therapy-related tasks?',
    'How do I update therapy workflow status?'
  ],
  staff: [
    'How do I use this page?',
    'What can I do in this dashboard?'
  ],
  patient: [
    'How can I contact the hospital?',
    'What services does the hospital offer?'
  ]
};

const PATH_TITLES = [
  { pattern: /^\/$/, title: 'Hospital Information Assistant', subtitle: 'Ask about services, contact details, location, and important public hospital information.' },
  { pattern: /^\/admin/, title: 'Admin Help Assistant', subtitle: 'Get guided help for announcements, staff management, settings, and dashboard workflows.' },
  { pattern: /^\/doctor$/, title: 'Doctor Workflow Assistant', subtitle: 'Get help with patient queue, records, approvals, and doctor-side workflow steps.' },
  { pattern: /^\/nurse$/, title: 'Nurse Workflow Assistant', subtitle: 'Ask about current nursing workflows, records, and page-level navigation.' },
  { pattern: /^\/pharmacist$/, title: 'Pharmacy Assistant', subtitle: 'Get support for prescriptions, dispensing, stock workflow, and pharmacy POS tasks.' },
  { pattern: /^\/cashier$/, title: 'Cashier Workflow Assistant', subtitle: 'Ask about billing records, payment updates, and cashier-side workflow guidance.' },
  { pattern: /^\/doctor-secretary$/, title: 'Secretary Workflow Assistant', subtitle: 'Get help with appointments, doctor schedules, approvals, and coordination tasks.' },
  { pattern: /^\/medtech/, title: 'Medtech Workflow Assistant', subtitle: 'Ask about laboratory-related workflow guidance and clinical-staff task support.' },
  { pattern: /^\/radiographer/, title: 'Radiographer Workflow Assistant', subtitle: 'Get role-aware help for imaging requests, task flow, and assigned workflows.' },
  { pattern: /^\/ecg/, title: 'ECG Workflow Assistant', subtitle: 'Ask about ECG-related task handling and request navigation inside your workflow.' },
  { pattern: /^\/pt/, title: 'PT Workflow Assistant', subtitle: 'Get guidance for therapy-related tasks, workflow status, and role-appropriate navigation.' },
  { pattern: /^\/staff/, title: 'Staff Workflow Assistant', subtitle: 'Ask for role-appropriate guidance on the current page and the system tools available to you.' },
  { pattern: /^\/patient/, title: 'Patient Help Assistant', subtitle: 'Ask about visible patient-facing information and public hospital details.' }
];

function normalizeRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'public';
  if (raw.includes('doctor') && raw.includes('secretary')) return 'doctor_secretary';
  if (raw.includes('physical') && raw.includes('therap')) return 'physical_therapist';
  if (raw.includes('radiograph') || raw.includes('x-ray') || raw.includes('xray')) return 'radiographer';
  if (raw.includes('medtech')) return 'medtech';
  if (raw.includes('ecg')) return 'ecg_operator';
  if (raw.includes('cashier')) return 'cashier';
  if (raw.includes('pharmacist')) return 'pharmacist';
  if (raw.includes('nurse')) return 'nurse';
  if (raw.includes('doctor')) return 'doctor';
  if (raw.includes('admin')) return 'admin';
  if (raw.includes('patient')) return 'patient';
  if (raw.includes('staff')) return 'staff';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'public';
}

function getAssistantRole() {
  const user = getCurrentUser() || {};
  return normalizeRole(user?.role || user?.account_type || user?.accountType || user?.roles || 'public');
}

function getPanelMeta(pathname) {
  return PATH_TITLES.find((item) => item.pattern.test(pathname || '/')) || PATH_TITLES[0];
}

function initialGreeting(role, pathname) {
  const meta = getPanelMeta(pathname);
  if (role === 'public' || pathname === '/') {
    return `Hello. I’m Pascualinga Assistant. I can quickly help with hospital services, contact details, location, visiting information, and public updates.`;
  }
  return `Hello. I’m Pascualinga Assistant for ${ROLE_LABELS[role] || 'your account'}. I can guide you using role-appropriate help for this page and your workflow.`;
}

export default function AssistantWidget({ pathname = '/' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showQuickQuestions, setShowQuickQuestions] = useState(true);
  const messagesRef = useRef(null);

  const role = useMemo(() => getAssistantRole(), [pathname]);
  const meta = useMemo(() => getPanelMeta(pathname), [pathname]);
  const quickQuestions = useMemo(() => ROLE_QUICK_QUESTIONS[role] || ROLE_QUICK_QUESTIONS.public, [role]);
  const currentUser = useMemo(() => getCurrentUser(), [pathname]);

  const buildWelcomeMessages = () => ([
    {
      id: 'welcome',
      role: 'assistant',
      content: initialGreeting(role, pathname),
      meta: role === 'public' ? 'Public mode' : `${ROLE_LABELS[role] || 'User'} mode`
    }
  ]);

  useEffect(() => {
    setMessages(buildWelcomeMessages());
    setError('');
    setLoading(false);
    setDraft('');
    setShowQuickQuestions(true);
  }, [role, pathname]);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, loading]);

  const sendMessage = async (text) => {
    const content = String(text || draft).trim();
    if (!content || loading) return;
    setShowQuickQuestions(false);

    const nextMessages = [
      ...messages,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content
      }
    ];

    setMessages(nextMessages);
    setDraft('');
    setLoading(true);
    setError('');

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(currentUser, role === 'public' ? '' : role)
      };

      const res = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          role,
          pathname,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || 'Unable to contact the assistant right now.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: String(data?.answer || 'I could not prepare a response right now.').trim(),
          meta: data?.source === 'openai'
            ? 'AI-assisted answer'
            : data?.source === 'knowledge'
              ? 'Knowledge-guided answer'
              : data?.source === 'fallback'
                ? 'Fallback answer'
                : undefined
        }
      ]);
    } catch (err) {
      setError(String(err?.message || 'Unable to contact the assistant right now.'));
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: 'I’m having trouble responding right now. Please try again in a moment or ask a simpler hospital or workflow question.',
          meta: 'Temporary issue'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await sendMessage(draft);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const reopenFreshChat = () => {
    setMessages(buildWelcomeMessages());
    setDraft('');
    setError('');
    setLoading(false);
    setShowQuickQuestions(true);
    setIsOpen(true);
  };

  const pageClass = useMemo(() => {
    const currentPath = String(pathname || '').trim();
    if (/^\/(admin|patient|staff|nurse|doctor|pharmacist|cashier|doctor-secretary|medtech|radiographer|ecg|pt)(\/|$)/.test(currentPath)) {
      return 'assistant-widget-page-dashboard';
    }
    return '';
  }, [pathname]);

  return (
    <div className={`assistant-widget-root ${pageClass}`.trim()}>
      {isOpen ? (
        <div className="assistant-widget-panel" role="dialog" aria-label="Pascualinga Assistant">
          <div className="assistant-widget-header">
            <div className="assistant-widget-header-top">
              <div>
                <div className="assistant-widget-badge">
                  <ShieldCheck size={14} />
                  {role === 'public' ? 'Public Website Mode' : `${ROLE_LABELS[role] || 'User'} Mode`}
                </div>
                <h2 className="assistant-widget-title">{meta.title}</h2>
                <p className="assistant-widget-subtitle">{meta.subtitle}</p>
              </div>
              <button type="button" className="assistant-widget-close" onClick={() => setIsOpen(false)} aria-label="Close assistant">
                <X size={18} />
              </button>
            </div>
            <div className="assistant-widget-status">
              <span className="assistant-widget-status-dot" />
              Scope-aware and role-aware assistance
            </div>
          </div>

          <div className="assistant-widget-body">
            <div className="assistant-widget-messages" ref={messagesRef}>
              {messages.map((message) => (
                <div key={message.id} className={`assistant-widget-message ${message.role}`}>
                  {message.content}
                  {message.meta ? <div className="assistant-widget-message-meta">{message.meta}</div> : null}
                </div>
              ))}

              {loading ? (
                <div className="assistant-widget-message assistant">
                  <div className="assistant-widget-typing" aria-label="Assistant is typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : null}
            </div>

            {showQuickQuestions ? (
              <div className="assistant-widget-quick">
                <span className="assistant-widget-quick-label">Quick questions</span>
                <div className="assistant-widget-quick-grid">
                  {quickQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="assistant-widget-chip"
                      onClick={() => sendMessage(question)}
                      disabled={loading}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="assistant-widget-input-wrap" onSubmit={handleSubmit}>
              <div className="assistant-widget-input-row">
                <textarea
                  className="assistant-widget-textarea"
                  placeholder={role === 'public' ? 'Ask about services, location, contact details, or updates...' : 'Ask about your current page or workflow...'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                />
                <button type="submit" className="assistant-widget-send" disabled={loading || !String(draft || '').trim()} aria-label="Send message">
                  <Send size={18} />
                </button>
              </div>
              <div className="assistant-widget-footer-note">
                {error || 'The assistant answers hospital information and role-appropriate workflow questions only. It does not provide diagnosis or prescription advice.'}
              </div>
            </form>
          </div>
        </div>
      ) : (
        <button type="button" className="assistant-widget-trigger" onClick={reopenFreshChat}>
          <Bot size={20} />
          <span className="assistant-widget-trigger-label">
            Pascualinga Assistant
            <small>{role === 'public' ? 'Need help?' : `${ROLE_LABELS[role] || 'User'} support`}</small>
          </span>
          <MessageCircleMore size={18} />
        </button>
      )}
    </div>
  );
}
