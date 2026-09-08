import React, { useEffect, useState } from 'react';
import { loadMedicalFile } from '../utils/medicalFiles';

// Fetch with a bearer header; neither permanent storage URLs nor login tokens
// are put into a tab URL. Blob URLs are released when the viewer closes.
export default function MedicalFileLink({ href, children = 'Open file', className, style }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { if (file?.url) URL.revokeObjectURL(file.url); }, [file]);
  const open = async () => {
    setLoading(true);
    setError('');
    try { setFile(await loadMedicalFile(href)); }
    catch (err) { setError(err.name === 'AbortError' ? 'The file request timed out. Please try again.' : err.message); }
    finally { setLoading(false); }
  };
  return <>
    <button type="button" className={className} style={style} onClick={open} disabled={loading}>{loading ? 'Loading…' : children}</button>
    {error && <span role="alert"> {error}</span>}
    {file && <div role="dialog" aria-modal="true" aria-label="Medical result" onClick={() => setFile(null)} style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 12000, display: 'grid', placeItems: 'center' }}>
      <div onClick={event => event.stopPropagation()} style={{ background: 'white', width: '94vw', maxWidth: 1000, height: '88vh', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <strong style={{ flex: 1 }}>Medical result</strong>
          <a href={file.url} target="_blank" rel="noreferrer">Open</a>
          <a href={file.url} download={file.filename}>Download</a>
          <button type="button" autoFocus onClick={() => setFile(null)}>Close</button>
        </div>
        {file.mimeType === 'application/pdf'
          ? <iframe src={file.url} title="Medical result PDF" style={{ flex: 1, width: '100%', border: 0 }} />
          : <img src={file.url} alt="Medical result" style={{ minHeight: 0, flex: 1, objectFit: 'contain' }} />}
      </div>
    </div>}
  </>;
}
