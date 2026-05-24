const LOCAL_API_BASE = 'http://localhost:5000';
const PROD_API_BASE = 'https://api.pascualinga.com';
const PROD_WEB_HOSTS = new Set(['pascualinga.com', 'www.pascualinga.com']);

const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

export const resolveApiBase = () => {
  const explicit = trimTrailingSlash(process.env.REACT_APP_API_BASE_URL);

  if (typeof window === 'undefined') {
    return explicit || LOCAL_API_BASE;
  }

  const hostname = String(window.location.hostname || '').toLowerCase();
  const origin = trimTrailingSlash(window.location.origin);
  const isProdWebHost = PROD_WEB_HOSTS.has(hostname);
  const isApiHost = hostname === 'api.pascualinga.com';
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (isApiHost) return explicit || PROD_API_BASE;

  if (isProdWebHost) {
    if (!explicit) return PROD_API_BASE;
    if (explicit === origin || explicit.includes('localhost') || explicit.includes('pascualinga.com/api')) return PROD_API_BASE;
    return explicit;
  }

  if (isLocalHost) return explicit || LOCAL_API_BASE;

  return explicit || origin || LOCAL_API_BASE;
};

export const API_BASE = resolveApiBase();
const DEFAULT_API_BASE = API_BASE;

const rewriteUrlForApiBase = (rawUrl, apiBase = API_BASE) => {
  const base = trimTrailingSlash(apiBase);
  const value = String(rawUrl || '').trim();
  if (!value || !base || typeof window === 'undefined') return value;

  const webOrigin = trimTrailingSlash(window.location.origin);

  if (value.startsWith('/api/') || value.startsWith('/uploads/')) {
    return `${base}${value}`;
  }

  try {
    const parsed = new URL(value, webOrigin || undefined);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const isSameOriginApi = trimTrailingSlash(parsed.origin) === webOrigin && (parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/uploads/'));
    const isLocalApi = /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname) && (parsed.port === '5000' || !parsed.port);
    const isWrongProdWebApi = PROD_WEB_HOSTS.has(String(parsed.hostname || '').toLowerCase()) && parsed.pathname.startsWith('/api/');
    if (isSameOriginApi || isLocalApi || isWrongProdWebApi) {
      return `${base}${path}`;
    }
    return value;
  } catch (_) {
    return value;
  }
};

export const normalizeApiAssetUrl = (rawUrl, apiBase = API_BASE) => rewriteUrlForApiBase(rawUrl, apiBase);

export const installApiFetchShim = () => {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (window.__PASCUALINGA_API_SHIM_INSTALLED__) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string') {
      return originalFetch(rewriteUrlForApiBase(input), init);
    }

    if (input instanceof Request) {
      const nextUrl = rewriteUrlForApiBase(input.url);
      if (nextUrl === input.url) return originalFetch(input, init);
      const nextRequest = new Request(nextUrl, input);
      return originalFetch(nextRequest, init);
    }

    return originalFetch(input, init);
  };

  window.__PASCUALINGA_API_SHIM_INSTALLED__ = true;
};

export const safeJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

export const getCurrentUser = () => {
  return safeJson(localStorage.getItem('currentUser') || 'null') || null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const buildAuthHeaders = (user, fallbackRole) => {
  const u = user || getCurrentUser() || {};
  const role = String(u?.role || u?.account_type || u?.accountType || fallbackRole || '').trim().toLowerCase();
  const email = String(u?.email || '').trim();
  const name = String(u?.name || `${u?.first_name || u?.firstName || ''} ${u?.last_name || u?.lastName || ''}`.trim() || '').trim();
  const idCandidates = [u?.patientId, u?.patient_id, u?.id, u?._id];
  const patientId = idCandidates.find((v) => UUID_PATTERN.test(String(v || '').trim())) || '';
  return {
    ...(role ? { 'x-user-role': role } : {}),
    ...(email ? { 'x-user-email': email } : {}),
    ...(name ? { 'x-user-name': name } : {}),
    ...(patientId ? { 'x-patient-id': String(patientId) } : {})
  };
};

export const fetchJson = async (urlOrPath, opts = {}) => {
  const {
    apiBase = DEFAULT_API_BASE,
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 45000,
    parseJson = true
  } = opts;

  const url = String(urlOrPath || '').startsWith('http') ? String(urlOrPath) : `${apiBase}${urlOrPath}`;

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      ...(ctrl ? { signal: ctrl.signal } : {})
    });

    const data = parseJson ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) ? (data.message || data.error) : `Request failed (${res.status})`;
      const err = new Error(String(msg));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    const raw = String(e?.message || 'Request failed');
    const name = String(e?.name || '');
    const isAbort = name === 'AbortError' || /aborted/i.test(raw);
    const isNetwork = /failed to fetch/i.test(raw) || /networkerror/i.test(raw);

    if (isAbort) {
      const err = new Error('Request timed out. Please try again.');
      err.name = 'AbortError';
      throw err;
    }

    if (isNetwork) {
      const err = new Error('Cannot reach the server right now. Please try again.');
      err.name = 'NetworkError';
      throw err;
    }

    throw e;
  } finally {
    if (t) clearTimeout(t);
  }
};

export const checkBackendHealth = async (apiBase = DEFAULT_API_BASE) => {
  try {
    const data = await fetchJson('/api/health', { apiBase, timeoutMs: 4000 });
    if (!data || data.ok !== true) return { ok: false, error: `Backend health check failed at ${apiBase}.` };
    if (data.dbConfigured === false || data.directConfigured === false) {
      return { ok: false, error: 'Database is not configured. Set DATABASE_URL and DIRECT_URL in backend/.env.' };
    }
    if (data.dbConnected === false) {
      const extra = data.dbError ? ` (${String(data.dbError)})` : '';
      return { ok: false, error: `Database is not connected${extra}` };
    }
    return { ok: true, data };
  } catch (e) {
    const raw = String(e?.message || 'Backend offline');
    const name = String(e?.name || '');
    const isAbort = name === 'AbortError' || /aborted/i.test(raw);
    const isNetwork = /failed to fetch/i.test(raw) || /networkerror/i.test(raw);
    const msg = isAbort
      ? `Request timed out. Cannot reach backend at ${apiBase}.`
      : isNetwork
        ? `Cannot reach backend at ${apiBase}.`
        : raw;
    return { ok: false, error: msg };
  }
};
