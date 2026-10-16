import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Edit, Plus, RefreshCw, Save, Search, X } from 'lucide-react';
import { API_BASE, buildAuthHeaders, fetchJson, getCurrentUser } from '../utils/api';

const ROLES = ['public', 'patient', 'admin', 'doctor', 'nurse', 'pharmacist', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'staff'];
const EMPTY = { key: '', type: 'faq', title: '', answerEn: '', answerTl: '', keywordsText: '', audienceRoles: ['public'], department: '', pricePHP: '', notes: '', active: true };

export default function AssistantKnowledgeManager() {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const headers = () => ({ 'Content-Type': 'application/json', ...buildAuthHeaders(getCurrentUser(), 'admin') });
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
    if (!needle) return entries;
    return entries.filter((entry) => [entry.key, entry.title, entry.type, entry.department, ...(entry.keywords || [])].join(' ').toLowerCase().includes(needle));
  }, [entries, query]);

  const edit = (entry) => {
    setEditingId(entry.id);
    setForm({ ...EMPTY, ...entry, keywordsText: (entry.keywords || []).join(', '), pricePHP: entry.pricePHP ?? '' });
    setMessage(''); setError('');
  };

  const reset = () => { setEditingId(''); setForm(EMPTY); setMessage(''); setError(''); };
  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    try {
      const payload = {
        ...form,
        keywords: String(form.keywordsText || '').split(',').map((item) => item.trim()).filter(Boolean),
        pricePHP: form.pricePHP === '' ? null : Number(form.pricePHP)
      };
      const path = editingId ? `/api/assistant-knowledge/${editingId}` : '/api/assistant-knowledge';
      await fetchJson(path, { apiBase: API_BASE, method: editingId ? 'PUT' : 'POST', headers: headers(), body: JSON.stringify(payload) });
      setMessage(editingId ? 'Knowledge entry updated.' : 'Knowledge entry created.');
      setEditingId(''); setForm(EMPTY); await load();
    } catch (err) { setError(String(err?.message || 'Unable to save chatbot knowledge.')); }
    finally { setSaving(false); }
  };

  const toggleRole = (role) => setForm((current) => ({
    ...current,
    audienceRoles: current.audienceRoles.includes(role) ? current.audienceRoles.filter((item) => item !== role) : [...current.audienceRoles, role]
  }));

  return (
    <div className="settings-section-card full-width-card">
      <div className="section-card-header">
        <h3 className="section-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bot size={18} /> Chatbot Knowledge</h3>
        <p className="section-card-desc">Manage approved answers used before AI. Changes are audited and cached for up to one minute.</p>
      </div>
      <div className="section-card-body" style={{ padding: 24 }}>
        {(error || message) && <div style={{ marginBottom: 14, color: error ? '#b91c1c' : '#047857', fontSize: 14 }}>{error || message}</div>}
        <div className="form-grid-2-col" style={{ margin: 0 }}>
          <div className="input-group"><label className="form-label">Unique key</label><input className="settings-input" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="faq_opd_requirements" /></div>
          <div className="input-group"><label className="form-label">Type</label><select className="settings-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="faq">FAQ</option><option value="service">Service</option><option value="contact">Contact</option><option value="schedule">Schedule</option><option value="workflow">Workflow</option></select></div>
          <div className="input-group"><label className="form-label">Title</label><input className="settings-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="input-group"><label className="form-label">Department</label><input className="settings-input" value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div className="input-group"><label className="form-label">English answer</label><textarea className="settings-input" rows="4" value={form.answerEn} onChange={(e) => setForm({ ...form, answerEn: e.target.value })} /></div>
          <div className="input-group"><label className="form-label">Tagalog / Taglish answer</label><textarea className="settings-input" rows="4" value={form.answerTl || ''} onChange={(e) => setForm({ ...form, answerTl: e.target.value })} /></div>
          <div className="input-group"><label className="form-label">Keywords (comma-separated)</label><input className="settings-input" value={form.keywordsText} onChange={(e) => setForm({ ...form, keywordsText: e.target.value })} placeholder="opd, requirements, ano ang dadalhin" /></div>
          <div className="input-group"><label className="form-label">Reference price (optional)</label><input type="number" min="0" className="settings-input" value={form.pricePHP} onChange={(e) => setForm({ ...form, pricePHP: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 14 }}><label className="form-label">Audience roles</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{ROLES.map((role) => <label key={role} style={{ fontSize: 12, padding: '6px 9px', border: '1px solid #e2e8f0', borderRadius: 8 }}><input type="checkbox" checked={form.audienceRoles.includes(role)} onChange={() => toggleRole(role)} /> {role}</label>)}</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <label style={{ fontSize: 14 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
          <button type="button" className="btn-orange-sm" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : editingId ? 'Update entry' : 'Create entry'}</button>
          {editingId && <button type="button" className="btn-orange-sm" style={{ background: '#64748b' }} onClick={reset}><X size={15} /> Cancel</button>}
        </div>
        <div style={{ marginTop: 26, borderTop: '1px solid #e2e8f0', paddingTop: 18 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}><div style={{ position: 'relative', flex: 1 }}><Search size={16} style={{ position: 'absolute', left: 12, top: 12 }} /><input className="settings-input" style={{ paddingLeft: 36 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search knowledge…" /></div><button type="button" className="btn-orange-sm" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>{visible.map((entry) => <div key={entry.id} style={{ display: 'flex', gap: 12, padding: 12, borderBottom: '1px solid #f1f5f9', opacity: entry.active ? 1 : 0.55 }}><div style={{ flex: 1 }}><strong>{entry.title}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{entry.key} · {entry.type} · {(entry.audienceRoles || []).join(', ')}</div><div style={{ fontSize: 13, marginTop: 4 }}>{entry.answerEn}</div></div><button type="button" aria-label={`Edit ${entry.title}`} onClick={() => edit(entry)} style={{ border: 0, background: '#fff7ed', color: '#ea580c', borderRadius: 8, padding: 8, height: 36 }}><Edit size={16} /></button></div>)}</div>
          {!loading && visible.length === 0 && <div style={{ color: '#64748b', fontSize: 14, padding: 12 }}>No managed knowledge entries yet. Existing safe chatbot answers remain active as fallback.</div>}
        </div>
      </div>
    </div>
  );
}
