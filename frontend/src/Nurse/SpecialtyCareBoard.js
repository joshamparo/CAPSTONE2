import React, { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../utils/api';
import './SpecialtyCareBoard.css';

export default function SpecialtyCareBoard({ apiBase, getHeaders, patients, onViewRecord }) {
  const headers = useRef(getHeaders);
  headers.current = getHeaders;
  const [config, setConfig] = useState(null);
  const [patientId, setPatientId] = useState('');
  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const request = (path, options = {}) => fetchJson(`/api/nurse-workflow/specialty-care${path}`, {
    apiBase, headers: { ...headers.current(), 'Content-Type': 'application/json' }, ...options
  });
  useEffect(() => {
    let cancelled = false;
    fetchJson('/api/nurse-workflow/specialty-care/config', { apiBase, headers: headers.current() })
      .then(value => { if (!cancelled) setConfig(value); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [apiBase]);
  useEffect(() => {
    let cancelled = false;
    setRecords([]); setOrders([]); setForm(null); setHistoryPage(1); setError(''); setNotice('');
    if (!patientId || !config) return undefined;
    setLoading(true);
    Promise.all([
      fetchJson(`/api/nurse-workflow/specialty-care/${patientId}`, { apiBase, headers: headers.current() }),
      fetchJson(`/api/nurse-workflow/specialty-care/${patientId}/orders`, { apiBase, headers: headers.current() })
    ]).then(([rows, linkedOrders]) => { if (!cancelled) { setRecords(rows); setOrders(linkedOrders); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId, config, apiBase, reload]);
  const visible = patients.filter(p => `${p.firstName} ${p.lastName} ${p._id}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(visible.length / 8));
  const currentPage = Math.min(page, pageCount);
  const historyPageCount = Math.max(1, Math.ceil(records.length / 8));
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const active = records.find(r => r.department === config?.department && !['Completed', 'Cancelled'].includes(r.stage));
  const edit = row => {
    setNotice('');
    setForm(row ? { id: row.id, version: row.version, stage: row.stage, checks: row.checks, notes: row.notes, handoffTo: row.handoff_to, orderId: row.order_id || '' }
      : { stage: config.stages[0], checks: config.checks.map(() => false), notes: config.fields.map(() => ''), handoffTo: '', orderId: '' });
  };
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request(`/${patientId}`, { method: 'POST', body: JSON.stringify(form) });
      setRecords(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
      setForm(null); setNotice('Care record saved. Authorized care teams can see it in this patient’s timeline.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="specialty-care-board">
    <h1>{config?.title || 'Specialty Care'}</h1>
    <p>Document preparation, nursing observations, and the receiving team for each care episode.</p>
    {error && <p role="alert" className="specialty-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="specialty-toolbar">
      <label>Find department patient <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
      <div aria-label="Patient pagination">
        <button type="button" aria-label="Previous patient page" disabled={currentPage <= 1 || busy} onClick={() => setPage(currentPage - 1)}>&lt;</button>
        <span> {currentPage} / {pageCount} · {visible.length} patients </span>
        <button type="button" aria-label="Next patient page" disabled={currentPage >= pageCount || busy} onClick={() => setPage(currentPage + 1)}>&gt;</button>
      </div>
    </div>
    <table><thead><tr><th>Patient</th><th>Ward / room</th><th>Actions</th></tr></thead><tbody>
      {visible.slice((currentPage - 1) * 8, currentPage * 8).map(p => <tr key={p._id} aria-selected={patientId === p._id}>
        <td>{p.firstName} {p.lastName}<small>{p._id}</small></td><td>{p.wardNumber || 'Outpatient'}</td>
        <td><button disabled={busy} onClick={() => setPatientId(p._id)}>Care timeline</button> <button onClick={() => onViewRecord(p)}>View record</button></td>
      </tr>)}
      {!visible.length && <tr><td colSpan="3">No patients assigned to this department match your search.</td></tr>}
    </tbody></table>
    {patientId && config && <div className="specialty-episode">
      <h2>Care timeline — {patients.find(p => p._id === patientId)?.firstName} {patients.find(p => p._id === patientId)?.lastName}</h2>
      <button disabled={busy || loading} onClick={() => setReload(v => v + 1)}>Reload timeline</button>
      {loading ? <p role="status">Loading care records…</p> : <>
        {!form && !error && <button onClick={() => edit(active)}>{active ? 'Continue department episode' : 'Start department episode'}</button>}
        {form && <form onSubmit={save}>
          <fieldset disabled={busy}><legend>{config.title}</legend>
            <label>Stage <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>
              {config.stages.map(stage => <option key={stage}>{stage}</option>)}
            </select></label>
            <label>Linked patient order (optional) <select value={form.orderId} disabled={Boolean(form.id)} onChange={e => setForm({ ...form, orderId: e.target.value })}>
              <option value="">Routine nursing care — no order reference</option>
              {orders.map(order => <option key={order.id} value={order.id}>#{order.id} · {order.service || order.kind} · {order.status}{order.scheduled_at ? ` · ${new Date(order.scheduled_at).toLocaleString()}` : ''}</option>)}
            </select></label>
            {config.checks.map((check, i) => <label className="specialty-check" key={check}><input type="checkbox" checked={form.checks[i]} onChange={e => setForm({ ...form, checks: form.checks.map((v, j) => j === i ? e.target.checked : v) })} />{check}</label>)}
            {config.fields.map((field, i) => <label key={field}>{field}<textarea maxLength={2000} value={form.notes[i]} onChange={e => setForm({ ...form, notes: form.notes.map((v, j) => i === j ? e.target.value : v) })} /></label>)}
            <label>Receiving team / staff <input maxLength={120} value={form.handoffTo} onChange={e => setForm({ ...form, handoffTo: e.target.value })} /></label>
            <button type="submit">{busy ? 'Saving…' : 'Save care record'}</button> <button type="button" onClick={() => setForm(null)}>Cancel</button>
          </fieldset>
        </form>}
        <div className="specialty-toolbar" aria-label="Care history pagination">
          <button aria-label="Previous care history page" disabled={currentHistoryPage <= 1} onClick={() => setHistoryPage(currentHistoryPage - 1)}>&lt;</button>
          <span>Care history {currentHistoryPage} / {historyPageCount}</span>
          <button aria-label="Next care history page" disabled={currentHistoryPage >= historyPageCount} onClick={() => setHistoryPage(currentHistoryPage + 1)}>&gt;</button>
        </div>
        {records.slice((currentHistoryPage - 1) * 8, currentHistoryPage * 8).map(row => <article key={row.id}>
          <h3>{row.department} · {row.stage}</h3>
          <p>Updated {new Date(row.updated_at).toLocaleString()}{row.order_id ? ` · Order ${row.order_id}` : ''}{row.handoff_to ? ` · Receiving team: ${row.handoff_to}` : ''}</p>
          {row.notes.map((note, i) => <p key={i} className="specialty-note">{note || 'No observation recorded.'}</p>)}
          <details><summary>Audit history ({row.history.length})</summary>{row.history.map((entry, i) => <p key={i}>{new Date(entry.at).toLocaleString()} · {entry.by} · {entry.stage}{entry.handoffTo ? ` → ${entry.handoffTo}` : ''}</p>)}</details>
        </article>)}
        {!records.length && <p>No specialty care episodes recorded yet.</p>}
      </>}
    </div>}
  </section>;
}
