import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Bot, Download, Edit, History, RefreshCw, Save, Search, X } from 'lucide-react';
import { API_BASE, buildAuthHeaders, fetchJson, getCurrentUser } from '../utils/api';

const ROLES = ['public', 'patient', 'admin', 'doctor', 'nurse', 'pharmacist', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'staff'];
const EMPTY = { key: '', type: 'faq', title: '', answerEn: '', answerTl: '', keywordsText: '', audienceRoles: ['public'], department: '', module: '', pricePHP: '', status: 'draft', effectiveFrom: '', expiresAt: '', lastVerifiedAt: '' };

export default function AssistantKnowledgeManager() {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [history, setHistory] = useState([]);
  const headers = () => ({ 'Content-Type': 'application/json', ...buildAuthHeaders(getCurrentUser(), 'admin') });
  const field = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await fetchJson('/api/assistant-knowledge', { apiBase: API_BASE, headers: headers() });
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch (err) { setError(String(err?.message || 'Unable to load chatbot knowledge.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? entries.filter((entry) => [entry.key, entry.title, entry.type, entry.department, entry.module, ...(entry.keywords || [])].join(' ').toLowerCase().includes(needle)) : entries;
  }, [entries, query]);

  const edit = (entry) => {
    const date = (value) => value ? String(value).slice(0, 10) : '';
    setEditingId(entry.id);
    setForm({ ...EMPTY, ...entry, keywordsText: (entry.keywords || []).join(', '), pricePHP: entry.pricePHP ?? '', effectiveFrom: date(entry.effectiveFrom), expiresAt: date(entry.expiresAt), lastVerifiedAt: date(entry.lastVerifiedAt) });
    setNotice(''); setError('');
  };
  const reset = () => { setEditingId(''); setForm(EMPTY); setNotice(''); setError(''); };
  const save = async () => {
    setSaving(true); setNotice(''); setError('');
    try {
      const payload = { ...form, keywords: String(form.keywordsText || '').split(',').map((item) => item.trim()).filter(Boolean), pricePHP: form.pricePHP === '' ? null : Number(form.pricePHP) };
      await fetchJson(editingId ? `/api/assistant-knowledge/${editingId}` : '/api/assistant-knowledge', { apiBase: API_BASE, method: editingId ? 'PUT' : 'POST', headers: headers(), body: JSON.stringify(payload) });
      setNotice(editingId ? 'Knowledge entry updated.' : 'Draft knowledge entry created.'); setEditingId(''); setForm(EMPTY); await load();
    } catch (err) { setError(String(err?.message || 'Unable to save chatbot knowledge.')); }
    finally { setSaving(false); }
  };
  const loadAnalytics = async () => { try { setAnalytics(await fetchJson('/api/assistant-knowledge/analytics', { apiBase: API_BASE, headers: headers() })); } catch (err) { setError(String(err?.message || 'Unable to load feedback analytics.')); } };
  const loadHistory = async (entry) => { try { const data = await fetchJson(`/api/assistant-knowledge/${entry.id}/history`, { apiBase: API_BASE, headers: headers() }); setHistory(Array.isArray(data?.history) ? data.history : []); } catch (err) { setError(String(err?.message || 'Unable to load change history.')); } };
  const exportEntries = () => { const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `chatbot-knowledge-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); };
  const toggleRole = (role) => setForm((current) => ({ ...current, audienceRoles: current.audienceRoles.includes(role) ? current.audienceRoles.filter((item) => item !== role) : [...current.audienceRoles, role] }));

  return <div className="settings-section-card full-width-card">
    <div className="section-card-header"><h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={18} /> Chatbot Knowledge</h3><p className="section-card-desc">Draft, verify, and publish approved answers. Published answers are matched by role and current module.</p></div>
    <div className="section-card-body" style={{ padding: 24 }}>
      {(error || notice) && <div style={{ marginBottom: 14, color: error ? '#b91c1c' : '#047857', fontSize: 14 }}>{error || notice}</div>}
      <div className="form-grid-2-col" style={{ margin: 0 }}>
        <div className="input-group"><label className="form-label">Unique key</label><input className="settings-input" value={form.key} onChange={(e) => field('key', e.target.value)} placeholder="faq_opd_requirements" /></div>
        <div className="input-group"><label className="form-label">Type</label><select className="settings-select" value={form.type} onChange={(e) => field('type', e.target.value)}>{['faq', 'service', 'contact', 'schedule', 'workflow'].map((item) => <option key={item}>{item}</option>)}</select></div>
        <div className="input-group"><label className="form-label">Title</label><input className="settings-input" value={form.title} onChange={(e) => field('title', e.target.value)} /></div>
        <div className="input-group"><label className="form-label">Department</label><input className="settings-input" value={form.department || ''} onChange={(e) => field('department', e.target.value)} /></div>
        <div className="input-group"><label className="form-label">Dashboard module</label><input className="settings-input" value={form.module || ''} onChange={(e) => field('module', e.target.value)} placeholder="Appointments, Billing, Patient Queue" /></div>
        <div className="input-group"><label className="form-label">Publishing status</label><select className="settings-select" value={form.status} onChange={(e) => field('status', e.target.value)}><option value="draft">Draft</option><option value="active">Published</option><option value="archived">Archived</option></select></div>
        <div className="input-group"><label className="form-label">English answer</label><textarea className="settings-input" rows="4" value={form.answerEn} onChange={(e) => field('answerEn', e.target.value)} /></div>
        <div className="input-group"><label className="form-label">Tagalog / Taglish answer</label><textarea className="settings-input" rows="4" value={form.answerTl || ''} onChange={(e) => field('answerTl', e.target.value)} /></div>
        <div className="input-group"><label className="form-label">Keywords (comma-separated)</label><input className="settings-input" value={form.keywordsText} onChange={(e) => field('keywordsText', e.target.value)} /></div>
        <div className="input-group"><label className="form-label">Reference price</label><input type="number" min="0" className="settings-input" value={form.pricePHP} onChange={(e) => field('pricePHP', e.target.value)} /></div>
        {['effectiveFrom', 'expiresAt', 'lastVerifiedAt'].map((name) => <div className="input-group" key={name}><label className="form-label">{{ effectiveFrom: 'Effective from', expiresAt: 'Expires on', lastVerifiedAt: 'Last verified' }[name]}</label><input type="date" className="settings-input" value={form[name] || ''} onChange={(e) => field(name, e.target.value)} /></div>)}
      </div>
      <div style={{ marginTop: 14 }}><label className="form-label">Audience roles</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{ROLES.map((role) => <label key={role} style={{ fontSize: 12, padding: '6px 9px', border: '1px solid #e2e8f0', borderRadius: 8 }}><input type="checkbox" checked={form.audienceRoles.includes(role)} onChange={() => toggleRole(role)} /> {role}</label>)}</div></div>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}><button type="button" className="btn-orange-sm" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : editingId ? 'Update entry' : 'Create draft'}</button>{editingId && <button type="button" className="btn-orange-sm" style={{ background: '#64748b' }} onClick={reset}><X size={15} /> Cancel</button>}</div>
      <div style={{ marginTop: 26, borderTop: '1px solid #e2e8f0', paddingTop: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}><div style={{ position: 'relative', flex: 1, minWidth: 220 }}><Search size={16} style={{ position: 'absolute', left: 12, top: 12 }} /><input className="settings-input" style={{ paddingLeft: 36 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search knowledge…" /></div><button type="button" className="btn-orange-sm" onClick={load}><RefreshCw size={15} /> Refresh</button><button type="button" className="btn-orange-sm" onClick={loadAnalytics}><BarChart3 size={15} /> Feedback</button><button type="button" className="btn-orange-sm" onClick={exportEntries}><Download size={15} /> Export</button></div>
        {analytics && <div style={{ padding: 12, marginBottom: 12, background: '#fff7ed', borderRadius: 10, fontSize: 13 }}><strong>Last 30 days:</strong> {(analytics.summary || []).map((item) => `${item.rating}: ${item.count}`).join(' · ') || 'No feedback yet'}{(analytics.unresolved || []).length > 0 && <div>Needs review: {analytics.unresolved.map((item) => `${item.topic} (${item.count})`).join(', ')}</div>}</div>}
        {history.length > 0 && <div style={{ padding: 12, marginBottom: 12, background: '#f8fafc', borderRadius: 10, fontSize: 12 }}><strong>Recent change history</strong>{history.slice(0, 5).map((item) => <div key={item.id}>{new Date(item.changed_at).toLocaleString()} · {item.action} · {item.changed_by}</div>)}</div>}
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>{visible.map((entry) => <div key={entry.id} style={{ display: 'flex', gap: 10, padding: 12, borderBottom: '1px solid #f1f5f9', opacity: entry.status === 'active' ? 1 : 0.6 }}><div style={{ flex: 1 }}><strong>{entry.title}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{entry.key} · {entry.type} · {entry.status || 'draft'}{entry.module ? ` · ${entry.module}` : ''}</div><div style={{ fontSize: 13, marginTop: 4 }}>{entry.answerEn}</div></div><button type="button" aria-label={`History ${entry.title}`} onClick={() => loadHistory(entry)}><History size={16} /></button><button type="button" aria-label={`Edit ${entry.title}`} onClick={() => edit(entry)}><Edit size={16} /></button></div>)}</div>
        {!loading && visible.length === 0 && <div style={{ color: '#64748b', fontSize: 14, padding: 12 }}>No managed knowledge entries yet. Existing safe chatbot answers remain active as fallback.</div>}
      </div>
    </div>
  </div>;
}
