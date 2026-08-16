import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { installApiFetchShim } from './utils/api';

const BOOT_ID = '__pascualinga_boot';

function getBootEl() {
  try {
    return document.getElementById(BOOT_ID);
  } catch (_) {
    return null;
  }
}

function hideBootShell() {
  try {
    const boot = getBootEl();
    if (!boot) return;
    boot.setAttribute('hidden', '');
    boot.style.display = 'none';
  } catch (_) {}
}

function paintBootError(msg, stack) {
  try {
    if (window.__PASCUALINGA_RECOVERY__ && typeof window.__PASCUALINGA_RECOVERY__.show === 'function') {
      const payload = String(msg || 'Unexpected boot error occurred while loading Pascualinga.') +
        (stack ? '\n' + String(stack).slice(0, 1800) : '') +
        '\nnavigator: ' + (typeof navigator !== 'undefined' ? String(navigator.userAgent || 'unknown') : 'unknown');
      window.__PASCUALINGA_RECOVERY__.show(payload);
      return;
    }
    const boot = getBootEl();
    if (!boot) return;
    boot.setAttribute('data-state', 'error');
    boot.style.display = 'block';
  } catch (_) {}
}

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    try {
      // eslint-disable-next-line no-console
      console.error('[RootErrorBoundary] caught a root render error', error, info);
      const stack = error && error.stack ? String(error.stack) : '';
      const infoStack = (info && info.componentStack) ? String(info.componentStack) : '';
      const combined = (stack ? (stack + '\n---\n') : '') + infoStack;
      paintBootError(error && error.message ? error.message : String(error || 'Root render crashed.'), combined);
      this.setState({ errorInfo: infoStack });
    } catch (_) {}
  }

  handleReset() {
    try {
      if (window.__PASCUALINGA_RECOVERY__ && typeof window.__PASCUALINGA_RECOVERY__.hardReset === 'function') {
        window.__PASCUALINGA_RECOVERY__.hardReset();
        return;
      }
    } catch (_) {}
    try { window.sessionStorage.clear(); } catch (_) {}
    try { window.localStorage.removeItem('currentUser'); } catch (_) {}
    try { window.location.href = '/'; } catch (_) {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', background: '#f8fafc', color: '#0f172a',
          fontFamily: 'Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
        }}>
          <div style={{
            maxWidth: 620, width: '100%', borderRadius: 20, background: '#ffffff',
            border: '1px solid #e2e8f0', boxShadow: '0 24px 80px rgba(15,23,42,.10)', padding: 28
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{
                width: 44, height: 44, borderRadius: 12, fontWeight: 800, letterSpacing: '.3px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg,#ea580c,#c2410c)', color: '#fff', fontSize: 18
              }}>PGH</span>
              <div>
                <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#9a3412', letterSpacing: '.3px' }}>
                  PASCUALINGA MEDICAL LINK
                </div>
                <h1 style={{ margin: 0, fontSize: '1.28rem' }}>The dashboard hit a temporary issue</h1>
              </div>
            </div>
            <p style={{ margin: '6px 0 18px', color: '#64748b', fontSize: '.88rem' }}>
              This is usually fixed by clearing the current cached session and starting fresh. We caught the issue below.
            </p>
            <div style={{
              background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12,
              padding: '10px 12px', fontSize: '.82rem', color: '#881337'
            }}>
              <div style={{ fontWeight: 600 }}>What went wrong</div>
              <pre style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto',
                background: 'rgba(136,19,55,.06)', borderRadius: 8, padding: '8px 10px', marginTop: 6, marginBottom: 0
              }}>{String(this.state.error?.message || this.state.error || 'No details').slice(0, 2400)}</pre>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              <button onClick={() => this.handleReset()} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10,
                cursor: 'pointer', fontWeight: 600, fontSize: '.88rem', border: 'none',
                background: 'linear-gradient(135deg,#ea580c,#c2410c)', color: '#fff',
                boxShadow: '0 10px 24px rgba(234,88,12,.22)'
              }}>🔄 Reset session &amp; go home</button>
              <button onClick={() => { try { window.location.href = '/'; } catch (_) {} }} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10,
                cursor: 'pointer', fontWeight: 600, fontSize: '.88rem',
                background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0'
              }}>🏠 Back to homepage</button>
              <button onClick={() => { try { window.location.reload(true); } catch (_) {} }} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10,
                cursor: 'pointer', fontWeight: 600, fontSize: '.88rem',
                background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1'
              }}>↻ Reload page</button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function bootApp() {
  try {
    try {
      document.documentElement.dataset.theme = 'light';
    } catch (_) {}
    try {
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('appTheme', 'light'); } catch (_) {}
      }
    } catch (_) {}

    try { installApiFetchShim(); } catch (apiShimError) {
      try {
        // eslint-disable-next-line no-console
        console.error('installApiFetchShim failed — continuing anyway', apiShimError);
      } catch (_) {}
    }

    const rootEl = document.getElementById('root');
    if (!rootEl) {
      paintBootError('The app root element (#root) could not be found on this page. The page may have been modified.', '');
      return;
    }

    const root = ReactDOM.createRoot(rootEl);
    root.render(
      <React.StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </React.StrictMode>
    );

    try {
      window.__PASCUALINGA_APP_MOUNTED_SUCCESSFULLY__ = true;
    } catch (_) {}

    // Hide the boot shell after a tiny delay to allow first React paint
    try {
      setTimeout(hideBootShell, 50);
      // Belt & suspenders: run again in case the first setTimeout runs before a heavy first paint.
      setTimeout(hideBootShell, 350);
      setTimeout(hideBootShell, 900);
    } catch (_) {}
  } catch (rootError) {
    try {
      // eslint-disable-next-line no-console
      console.error('Fatal boot error', rootError);
    } catch (_) {}
    paintBootError(
      rootError && rootError.message ? rootError.message : String(rootError || 'Pascualinga failed to boot.'),
      rootError && rootError.stack ? rootError.stack : ''
    );
  }

  try {
    // Measure Vitals if desired
    reportWebVitals();
  } catch (_) {}
}

// Run boot on DOMContentLoaded when possible; otherwise immediately.
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function onDomReady() {
      document.removeEventListener('DOMContentLoaded', onDomReady);
      bootApp();
    });
  } else {
    bootApp();
  }
} catch (e) {
  try {
    // eslint-disable-next-line no-console
    console.error('Boot hook failed', e);
  } catch (_) {}
  try { paintBootError(e && e.message ? e.message : String(e || 'Failed to start boot sequence.'), e && e.stack ? e.stack : ''); } catch (_) {}
}
