import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, MessageCircleMore, RefreshCw, Send, ShieldCheck, Square, X } from 'lucide-react';
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
    'May lagnat ang baby ko — ano gagawin?',
    'Magkano ang CBC at Urinalysis?',
    'Paano magpa-appointment o mag-WALK-IN bukas?',
    'Nasaan ang result ng X-ray / lab ko?',
    'Emergency contact number at location?'
  ],
  patient: [
    'Nasaan ang result ng lab / x-ray ko?',
    'Paano magpa-follow up na OPD check up?',
    'Magkano ang follow up consultation?',
    'What services does the hospital offer?'
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
  if (role === 'public' || pathname === '/') {
    return `Hello! I’m your Pascualinga Assistant. I can help you with hospital info, services, location, or explain how our whole system works. Magtanong ka lang!`;
  }
  return `Hello! I’m your ${ROLE_LABELS[role] || 'User'} Assistant. I can guide you through your current dashboard and specific tasks. Ano ang matutulong ko?`;
}

export default function AssistantWidget({ pathname = '/' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showQuickQuestions, setShowQuickQuestions] = useState(true);
  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const [lastFailedMessage, setLastFailedMessage] = useState('');
  const messagesRef = useRef(null);
  const requestControllerRef = useRef(null);
  const requestSequenceRef = useRef(0);

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
    requestSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    setMessages(buildWelcomeMessages());
    setError('');
    setLoading(false);
    setDraft('');
    setShowQuickQuestions(true);
    setSuggestedQuestions([]);
    setLastFailedMessage('');
  }, [role, pathname]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

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
    setLastFailedMessage('');
    setSuggestedQuestions([]);

    const requestSequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(currentUser, role === 'public' ? '' : role)
      };

      const computePreferredLanguage = (lastText) => {
        const text = String(lastText || '').toLowerCase();
        if (!text) return 'english';
        const tlSignals = [' ano ', ' paano ', ' bakit ', ' saan ', ' sino ', ' pwede ', ' puwede ', ' lagnat ', ' sipon ', ' ubo ', ' magkano ', ' presyo ', ' hospital ', ' ospital ', ' serbisyo ', ' appointment ', ' resulta ', ' ng ', ' mga ', ' yung ', ' lang ', ' naman ', ' kasi ', ' ba ', ' po ', ' opo ', ' salamat ', ' kamusta ', ' kumusta ', ' umaga ', ' hapon ', ' gabi '];
        let hits = 0;
        tlSignals.forEach((s) => { if (text.includes(s)) hits += 1; });
        if (/\b(tagalog|taglish|filipino|nagtatagalog)\b/i.test(text) || hits >= 2) return 'tagalog';
        return 'english';
      };
      const preferredLanguage = computePreferredLanguage(text);
      const res = await fetch(`${API_BASE}/api/assistant/chat`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          role,
          pathname,
          preferredLanguage,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        })
      });

      const data = await res.json().catch(() => null);
      if (requestSequence !== requestSequenceRef.current) return;
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
      setSuggestedQuestions(
        Array.isArray(data?.suggestions)
          ? data.suggestions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
          : []
      );
    } catch (err) {
      if (requestSequence !== requestSequenceRef.current) return;
      const timedOut = err?.name === 'AbortError';
      const safeError = timedOut
        ? 'The request took too long. You can retry your question.'
        : String(err?.message || 'Unable to contact the assistant right now.');
      setError(safeError);
      setLastFailedMessage(content);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: timedOut
            ? 'The response timed out. Your question was kept so you can retry it.'
            : 'I’m having trouble responding right now. Please try again in a moment.',
          meta: 'Temporary issue'
        }
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
      if (requestSequence === requestSequenceRef.current) setLoading(false);
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
    requestSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    setMessages(buildWelcomeMessages());
    setDraft('');
    setError('');
    setLoading(false);
    setShowQuickQuestions(true);
    setSuggestedQuestions([]);
    setLastFailedMessage('');
    setIsOpen(true);
  };

  const displayedQuestions = showQuickQuestions ? quickQuestions : suggestedQuestions;

  const pageClass = useMemo(() => {
    const currentPath = String(pathname || '').trim();
    if (/^\/(admin|patient|staff|nurse|doctor|pharmacist|cashier|doctor-secretary|medtech|radiographer|ecg|pt)(\/|$)/.test(currentPath)) {
      return 'assistant-widget-page-dashboard';
    }
    return '';
  }, [pathname]);

  return (
    <div className={`assistant-widget-root ${pageClass} ${isOpen ? 'assistant-widget-is-open' : ''}`.trim()}>
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
              <div className="assistant-widget-header-actions">
                <button type="button" className="assistant-widget-header-button" onClick={reopenFreshChat} aria-label="Start a new conversation" title="New conversation">
                  <RefreshCw size={17} />
                </button>
                {loading ? (
                  <button type="button" className="assistant-widget-header-button" onClick={() => requestControllerRef.current?.abort()} aria-label="Stop generating response" title="Stop response">
                    <Square size={16} />
                  </button>
                ) : null}
                <button type="button" className="assistant-widget-close" onClick={() => setIsOpen(false)} aria-label="Close assistant">
                  <X size={18} />
                </button>
              </div>
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

            {displayedQuestions.length ? (
              <div className="assistant-widget-quick">
                <span className="assistant-widget-quick-label">{showQuickQuestions ? 'Quick questions' : 'You may also ask'}</span>
                <div className="assistant-widget-quick-grid">
                  {displayedQuestions.map((question) => (
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
                  placeholder={role === 'public' ? 'Ask about the hospital or the system...' : 'Ask about your dashboard or tasks...'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  maxLength={1000}
                  aria-describedby="assistant-privacy-note"
                />
                <button type="submit" className="assistant-widget-send" disabled={loading || !String(draft || '').trim()} aria-label="Send message">
                  <Send size={18} />
                </button>
              </div>
              {lastFailedMessage && !loading ? (
                <button type="button" className="assistant-widget-retry" onClick={() => sendMessage(lastFailedMessage)}>
                  <RefreshCw size={14} /> Retry last question
                </button>
              ) : null}
              <div id="assistant-privacy-note" className="assistant-widget-footer-note">
                {error || 'Do not enter patient names, IDs, results, or other private health information. This assistant does not provide diagnosis or prescriptions.'}
                <span className="assistant-widget-character-count">{draft.length}/1000</span>
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
