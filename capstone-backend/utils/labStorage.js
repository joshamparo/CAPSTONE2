const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX_BYTES = 10 * 1024 * 1024;
const PRIVATE_BUCKET = 'private-lab-results';
const localRoot = path.join(__dirname, '..', 'uploads', 'lab-results');

function parts(value) {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.includes('\\') || /[\x00-\x1f]/.test(decoded)
    || decoded.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid medical file reference.');
  return decoded;
}

function parseReference(value, env = process.env) {
  const raw = String(value || '').trim();
  if (raw.startsWith('lab-local:')) {
    const key = parts(raw.slice(10));
    if (key.includes('/')) throw new Error('Invalid local medical file.');
    return { kind: 'local', key };
  }
  if (raw.startsWith('lab-storage:')) {
    const key = parts(raw.slice(12));
    if (!key.startsWith('lab-results/')) throw new Error('Invalid medical file path.');
    return { kind: 'storage', bucket: PRIVATE_BUCKET, key };
  }
  const url = new URL(raw, 'http://legacy-local.invalid');
  // A legacy local URL is resolved from disk, never fetched from its supplied host.
  if (url.pathname.startsWith('/uploads/lab-results/')) {
    return parseReference(`lab-local:${url.pathname.slice('/uploads/lab-results/'.length)}`, env);
  }
  const configured = env.SUPABASE_URL ? new URL(env.SUPABASE_URL) : null;
  if (!configured || url.origin !== configured.origin || url.username || url.password) throw new Error('Upload the medical file instead of using an external URL.');
  const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
  if (!match) throw new Error('Invalid medical storage URL.');
  const bucket = parts(match[1]);
  const allowed = new Set([PRIVATE_BUCKET, env.SUPABASE_LAB_RESULTS_BUCKET || env.SUPABASE_STORAGE_BUCKET || 'lab-results']);
  const key = parts(match[2]);
  if (!allowed.has(bucket) || !key.startsWith('lab-results/')) throw new Error('Invalid medical storage location.');
  return { kind: 'storage', bucket, key };
}

function contentType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new Error('Unsupported medical file content.');
}

async function ensurePrivateBucket(sb) {
  const found = await sb.storage.getBucket(PRIVATE_BUCKET);
  if (found.error) {
    const created = await sb.storage.createBucket(PRIVATE_BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (created.error) {
      const retry = await sb.storage.getBucket(PRIVATE_BUCKET);
      if (retry.error || retry.data?.public !== false) throw new Error('Private medical storage is unavailable.');
    }
  } else if (found.data?.public !== false) {
    throw new Error('Medical storage must be private before uploads are accepted.');
  }
}

async function readMedicalFile(reference, sb, options = {}) {
  const location = parseReference(reference, options.env || process.env);
  let buffer;
  if (location.kind === 'local') {
    const root = await fs.promises.realpath(options.localRoot || localRoot);
    const filename = await fs.promises.realpath(path.join(root, location.key));
    if (path.dirname(filename) !== root) throw new Error('Invalid local medical file.');
    const handle = await fs.promises.open(filename, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Medical file exceeds the size limit.');
      buffer = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      buffer = buffer.subarray(0, size);
    } finally { await handle.close(); }
  } else {
    if (!sb) throw new Error('Medical storage is unavailable.');
    // Only the configured storage service may issue a download URL.
    let signed = await sb.storage.from(PRIVATE_BUCKET).createSignedUrl(location.key, 60);
    if ((signed.error || !signed.data?.signedUrl) && location.bucket !== PRIVATE_BUCKET) {
      signed = await sb.storage.from(location.bucket).createSignedUrl(location.key, 60);
    }
    if (signed.error || !signed.data?.signedUrl) throw new Error('Medical file unavailable.');
    const target = new URL(signed.data.signedUrl);
    if (target.origin !== new URL((options.env || process.env).SUPABASE_URL).origin) throw new Error('Invalid storage destination.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await (options.fetch || fetch)(target.href, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Medical file unavailable.');
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { controller.abort(); throw new Error('Medical file exceeds the size limit.'); }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) { controller.abort(); throw new Error('Medical file exceeds the size limit.'); }
        chunks.push(Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    } finally { clearTimeout(timer); }
  }
  if (buffer.length > MAX_BYTES) throw new Error('Medical file exceeds the size limit.');
  return { buffer, mimeType: contentType(buffer), filename: path.basename(location.key), location };
}

async function writeMedicalFile(sb, patientId, originalName, buffer) {
  if (buffer.length > MAX_BYTES) throw new Error('Medical file exceeds the size limit.');
  const mimeType = contentType(buffer);
  const name = `${crypto.randomUUID()}_${String(originalName || 'result').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) throw new Error('Invalid patient ID.');
  if (sb) {
    await ensurePrivateBucket(sb);
    const key = `lab-results/${patientId}/${name}`;
    const uploaded = await sb.storage.from(PRIVATE_BUCKET).upload(key, buffer, { contentType: mimeType, upsert: false, cacheControl: '0' });
    if (uploaded.error) throw new Error('Medical upload failed.');
    return { url: `lab-storage:${key}`, filename: key };
  }
  await fs.promises.mkdir(localRoot, { recursive: true });
  const filename = `${patientId}_${name}`;
  await fs.promises.writeFile(path.join(localRoot, filename), buffer, { flag: 'wx' });
  return { url: `lab-local:${filename}`, filename };
}

module.exports = { MAX_BYTES, PRIVATE_BUCKET, parseReference, contentType, ensurePrivateBucket, readMedicalFile, writeMedicalFile };
