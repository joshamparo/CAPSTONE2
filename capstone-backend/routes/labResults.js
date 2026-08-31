const express = require('express');
const router = express.Router();
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const requireRole = require('../middleware/requireRole');
const { parseLimit, parseOffset } = require('../utils/normalize');
const { normalizeEmail } = require('../utils/normalize');
const { enforceDoctorPatientAccess } = require('../utils/doctorPatientAccess');

const uploadDir = path.join(__dirname, '..', 'uploads', 'lab-results');
fs.mkdirSync(uploadDir, { recursive: true });

let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
  return supabaseAdmin;
}

async function ensureBucket(sb, bucket) {
  const existing = await sb.storage.listBuckets().catch(() => null);
  const hasBucket = Array.isArray(existing?.data) && existing.data.some((b) => b.name === bucket);
  if (!hasBucket) {
    await sb.storage.createBucket(bucket, { public: true }).catch(() => {});
  }
}

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function safeId(v) {
  return String(v || 'patient').replace(/[^a-zA-Z0-9_-]/g, '');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

const serialize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

function splitName(full, fallbackEmail) {
  const raw = String(full || '').trim();
  if (raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || 'Patient';
    if (first) return { first, last };
  }
  const email = normalizeEmail(String(fallbackEmail || '').trim());
  const prefix = email ? String(email).split('@')[0] : '';
  const safePrefix = String(prefix || '').trim();
  return { first: safePrefix || 'Unknown', last: 'Patient' };
}

async function ensurePatientByEmail({ email, name }) {
  const normalized = normalizeEmail(String(email || '').trim());
  if (!normalized) return null;
  const found = await prisma.patients
    .findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } }, select: { id: true } })
    .catch(() => null);
  if (found?.id) return found;

  const parsed = splitName(name, normalized);
  try {
    const created = await prisma.patients.create({
      data: {
        first_name: parsed.first,
        last_name: parsed.last,
        email: normalized
      },
      select: { id: true }
    });
    return created;
  } catch (_) {
    const retry = await prisma.patients
      .findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } }, select: { id: true } })
      .catch(() => null);
    return retry;
  }
}

async function resolvePatientId({ patientId, patientEmail, patientName }) {
  const rawId = String(patientId || '').trim();
  if (rawId) return rawId;
  const patient = await ensurePatientByEmail({ email: patientEmail, name: patientName });
  return patient?.id ? String(patient.id) : '';
}

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (_) {
  pdfParse = null;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mt = String(file.mimetype || '').toLowerCase();
    const ok =
      mt === 'application/pdf' ||
      mt.startsWith('image/') ||
      mt === 'text/plain' ||
      mt === 'application/octet-stream' ||
      mt === '';
    cb(ok ? null : new Error('Invalid file type'), ok);
  }
});

async function ensureInterpretationsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lab_result_interpretations (
      id BIGSERIAL PRIMARY KEY,
      lab_result_id BIGINT NOT NULL REFERENCES lab_results(id) ON DELETE CASCADE,
      doctor_email TEXT NOT NULL,
      doctor_name TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (lab_result_id, doctor_email)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS lab_result_interpretations_lab_idx
    ON lab_result_interpretations(lab_result_id, updated_at DESC);
  `);
}

ensureInterpretationsTable().catch(() => {});

async function ensureLabResultsVerificationColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS verification_score INTEGER;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS verification_flags JSONB;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS extracted_fields JSONB;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS verified_at timestamptz;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS verification_error TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS file_hash TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS file_meta JSONB;`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS lab_results_patient_created_idx ON lab_results(patient_id, created_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS lab_results_verification_status_idx ON lab_results(verification_status, created_at DESC);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS lab_results_file_hash_idx ON lab_results(file_hash);`);
}

ensureLabResultsVerificationColumns().catch(() => {});

const STAFF_ROLES = new Set(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']);

function getRequesterRole(req) {
  return String(req.headers['x-user-role'] || '').trim().toLowerCase() || 'patient';
}

function isStaffRole(role) {
  return STAFF_ROLES.has(String(role || '').trim().toLowerCase());
}

function uniqueFlags(flags) {
  return Array.from(new Set((Array.isArray(flags) ? flags : []).filter(Boolean)));
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function decideStatus(score, flags) {
  const s = clampInt(score, 0, 100);
  const f = uniqueFlags(flags);
  if (f.includes('patient_mismatch') || f.includes('duplicate_hash_other_patient')) {
    return { status: 'rejected', score: Math.min(s, 30), flags: f };
  }
  if (f.includes('document_type_mismatch')) {
    return { status: 'flagged', score: Math.min(Math.max(s, 45), 70), flags: f };
  }
  if (s >= 80 && !f.includes('verification_timeout') && !f.includes('verification_error')) {
    return { status: 'verified', score: s, flags: f };
  }
  if (s < 50) return { status: 'rejected', score: s, flags: f };
  return { status: 'flagged', score: s, flags: f };
}

function truncateText(s, maxChars) {
  const raw = String(s || '');
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars);
}

async function fetchWithTimeout(url, timeoutMs) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch_unavailable');
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchWithTimeoutInit(url, timeoutMs, init) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch_unavailable');
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAiEnabled() {
  const enabled = String(process.env.AI_VERIFICATION_ENABLED || '').trim().toLowerCase();
  if (!enabled) return false;
  if (enabled === '1' || enabled === 'true' || enabled === 'yes') return true;
  return false;
}

function getOpenAiConfig() {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;
  const model = String(process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini';
  return { key, model };
}

async function openAiAnalyzeText({ text, expectedPatientName, expectedPatientDob, expectedType }) {
  const cfg = getOpenAiConfig();
  if (!cfg) return null;
  const payload = {
    model: cfg.model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text:
              'You verify whether an uploaded medical test result document is likely legitimate, matches the expected result type, and belongs to the expected patient. Output must be strict JSON only, with this shape: {"score":number,"patientMatch":boolean,"flags":string[],"documentType":string,"extractedFields":{"patientName":string|null,"patientDob":string|null,"facilityName":string|null,"resultDate":string|null,"doctorName":string|null,"testNames":string[]|null}}. Use flags like: patient_mismatch, document_type_mismatch, missing_facility_header, no_text_extracted, suspicious_format.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                expected: {
                  patientName: expectedPatientName || null,
                  patientDob: expectedPatientDob || null,
                  resultType: expectedType || null
                },
                extractedText: truncateText(text, 12000)
              },
              null,
              2
            )
          }
        ]
      }
    ]
  };

  let json = null;
  try {
    const res = await fetchWithTimeoutInit('https://api.openai.com/v1/responses', 20000, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`
      },
      body: JSON.stringify(payload)
    });
    json = await res.json().catch(() => null);
    if (!res.ok) return null;
  } catch (_) {
    return null;
  }

  const outText =
    json?.output_text ||
    (Array.isArray(json?.output)
      ? json.output
          .flatMap((o) => o?.content || [])
          .map((c) => c?.text)
          .filter(Boolean)
          .join('\n')
      : '');
  if (!outText) return null;
  try {
    return JSON.parse(outText);
  } catch (_) {
    return null;
  }
}

async function openAiAnalyzeImage({ dataUrl, expectedPatientName, expectedPatientDob, expectedType }) {
  const cfg = getOpenAiConfig();
  if (!cfg) return null;

  const payload = {
    model: cfg.model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text:
              'You verify whether an uploaded medical test result image is likely legitimate, matches the expected result type, and belongs to the expected patient. Output must be strict JSON only, with this shape: {"score":number,"patientMatch":boolean,"flags":string[],"documentType":string,"extractedFields":{"patientName":string|null,"patientDob":string|null,"facilityName":string|null,"resultDate":string|null,"doctorName":string|null,"testNames":string[]|null}}. Use flags like: patient_mismatch, document_type_mismatch, missing_facility_header, suspicious_format.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                expected: {
                  patientName: expectedPatientName || null,
                  patientDob: expectedPatientDob || null,
                  resultType: expectedType || null
                }
              },
              null,
              2
            )
          },
          { type: 'input_image', image_url: dataUrl }
        ]
      }
    ]
  };

  let json = null;
  try {
    const res = await fetchWithTimeoutInit('https://api.openai.com/v1/responses', 20000, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`
      },
      body: JSON.stringify(payload)
    });
    json = await res.json().catch(() => null);
    if (!res.ok) return null;
  } catch (_) {
    return null;
  }

  const outText =
    json?.output_text ||
    (Array.isArray(json?.output)
      ? json.output
          .flatMap((o) => o?.content || [])
          .map((c) => c?.text)
          .filter(Boolean)
          .join('\n')
      : '');
  if (!outText) return null;
  try {
    return JSON.parse(outText);
  } catch (_) {
    return null;
  }
}

function heuristicVerify({ text, expectedPatientName, expectedType, fileMeta }) {
  const flags = [];
  let score = 55;
  const t = String(text || '');
  const low = t.toLowerCase();

  if (!t || t.trim().length < 50) {
    flags.push('no_text_extracted');
    score -= 25;
  }
  const keySignals = ['reference range', 'result', 'laboratory', 'patient', 'specimen', 'impression', 'findings', 'radiology'];
  const hits = keySignals.filter((k) => low.includes(k)).length;
  score += Math.min(20, hits * 4);

  const expected = String(expectedPatientName || '').trim().toLowerCase();
  if (expected) {
    const tokens = expected.split(/\s+/).filter(Boolean);
    const matched = tokens.length ? tokens.filter((w) => low.includes(w)).length : 0;
    if (matched >= Math.min(2, tokens.length)) {
      score += 20;
    } else {
      flags.push('patient_name_missing');
      score -= 20;
    }
  }

  const originalName = String(fileMeta?.originalName || '').toLowerCase();
  if (originalName && (originalName.includes('edit') || originalName.includes('scan') || originalName.includes('copy'))) {
    score -= 2;
  }

  const typeRaw = String(expectedType || '').trim().toLowerCase();
  const wantsEcg = typeRaw === 'ecg' || typeRaw.includes('ecg') || typeRaw.includes('ekg') || typeRaw.includes('electrocardio');
  if (wantsEcg) {
    const hints = ['ecg', 'ekg', 'electrocardiogram', 'electro cardio', '12-lead', '12 lead'];
    const hasHint = hints.some((h) => low.includes(h)) || hints.some((h) => originalName.includes(h));
    if (hasHint) score += 18;
    else {
      flags.push('document_type_mismatch');
      score -= 18;
    }
  }
  return { score: clampInt(score, 0, 100), flags };
}

function heuristicVerifyImage({ expectedType, fileMeta }) {
  const flags = [];
  let score = 62;
  const originalName = String(fileMeta?.originalName || '').toLowerCase();
  const mimeType = String(fileMeta?.mimeType || '').toLowerCase();

  flags.push('image_no_ocr');
  if (!originalName) flags.push('missing_filename');
  if (mimeType && !mimeType.startsWith('image/')) flags.push('mime_mismatch');

  const typeRaw = String(expectedType || '').trim().toLowerCase();
  const wantsEcg = typeRaw === 'ecg' || typeRaw.includes('ecg') || typeRaw.includes('ekg') || typeRaw.includes('electrocardio');
  if (wantsEcg) {
    const hints = ['ecg', 'ekg', 'electrocardiogram', 'electro cardio', '12-lead', '12 lead'];
    const hasHint = hints.some((h) => originalName.includes(h));
    if (hasHint) {
      score = 84;
    } else {
      flags.push('document_type_mismatch');
      score = 40;
    }
  }

  return { score: clampInt(score, 0, 100), flags };
}

function looksLikeEcgDocument({ expectedType, documentType, extractedFields, fileMeta }) {
  const typeRaw = String(expectedType || '').trim().toLowerCase();
  const wantsEcg = typeRaw === 'ecg' || typeRaw.includes('ecg') || typeRaw.includes('ekg') || typeRaw.includes('electrocardio');
  if (!wantsEcg) return true;

  const dt = String(documentType || '').trim().toLowerCase();
  const tn = Array.isArray(extractedFields?.testNames) ? extractedFields.testNames.map((x) => String(x || '').toLowerCase()) : [];
  const original = String(fileMeta?.originalName || '').toLowerCase();

  const hints = ['ecg', 'ekg', 'electrocardiogram', 'electro cardio', '12-lead', '12 lead'];
  const hit = hints.some((h) => dt.includes(h)) || tn.some((name) => hints.some((h) => name.includes(h))) || hints.some((h) => original.includes(h));
  return hit;
}

const verificationQueue = [];
let verificationRunning = false;
const verificationInProgress = new Set();

async function updateVerificationResult(id, { status, score, flags, extractedFields, verificationError }) {
  const safeStatus = String(status || '').trim() || 'flagged';
  const safeScore = score === null || score === undefined ? null : clampInt(score, 0, 100);
  const safeFlags = uniqueFlags(flags);
  const safeFlagsJson = JSON.stringify(safeFlags);
  const safeExtracted = extractedFields && typeof extractedFields === 'object' ? extractedFields : null;
  const safeExtractedJson = safeExtracted ? JSON.stringify(safeExtracted) : null;
  const err = verificationError ? String(verificationError).slice(0, 800) : null;

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE lab_results
      SET verification_status = ${safeStatus},
          verification_score = ${safeScore},
          verification_flags = ${safeFlagsJson}::jsonb,
          extracted_fields = ${safeExtractedJson}::jsonb,
          verified_at = now(),
          verification_error = ${err}
      WHERE id = ${BigInt(id)}
    `
  );
}

async function verifyLabResult(id, { force } = {}) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT id, patient_id, type, title, url, result_date, uploaded_by, created_at, verification_status, file_hash, file_meta
      FROM lab_results
      WHERE id = ${BigInt(id)}
      LIMIT 1
    `
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return;
  const currentStatus = String(row.verification_status || '').trim().toLowerCase() || 'pending';
  if (!force && currentStatus !== 'pending') return;

  const patientId = row.patient_id ? String(row.patient_id) : null;
  let expectedName = null;
  let expectedDob = null;
  if (patientId) {
    const pRows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT first_name, last_name, date_of_birth
        FROM patients
        WHERE id = ${patientId}::uuid
        LIMIT 1
      `
    );
    const p = Array.isArray(pRows) ? pRows[0] : null;
    expectedName = p?.first_name ? `${p.first_name} ${p.last_name || ''}`.trim() : null;
    expectedDob = p?.date_of_birth ? new Date(p.date_of_birth).toISOString().slice(0, 10) : null;
  }

  const url = String(row.url || '').trim();
  if (!url) {
    await updateVerificationResult(id, decideStatus(0, ['missing_url']));
    return;
  }

  let buf = null;
  let contentType = '';
  try {
    let res = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      res = await fetchWithTimeout(url, 15000).catch(() => null);
      if (res && res.ok) break;
      await waitMs(350 + attempt * 350);
    }
    if (!res || !res.ok) {
      await updateVerificationResult(id, decideStatus(35, ['file_unreachable', 'verification_error']));
      return;
    }
    contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (e) {
    await updateVerificationResult(id, { ...decideStatus(35, ['file_unreachable', 'verification_error']), verificationError: String(e?.message || 'fetch_failed') });
    return;
  }

  const fileMeta = row.file_meta || null;
  const fileHash = row.file_hash ? String(row.file_hash) : null;
  const computedHash = buf ? sha256Hex(buf) : null;
  const finalHash = fileHash || computedHash || null;

  const flags = [];
  if (fileHash && computedHash && fileHash !== computedHash) flags.push('hash_mismatch');

  if (finalHash) {
    const dupRows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT patient_id
        FROM lab_results
        WHERE file_hash = ${finalHash}
          AND id <> ${BigInt(id)}
        LIMIT 5
      `
    );
    const dupOtherPatient = (Array.isArray(dupRows) ? dupRows : []).some((d) => String(d?.patient_id || '') !== String(patientId || ''));
    if (dupOtherPatient) flags.push('duplicate_hash_other_patient');
  }

  const isPdf = contentType.includes('pdf') || url.toLowerCase().includes('.pdf');
  const isImage = contentType.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif)$/i.test(url);

  let extractedFields = {};
  let score = 55;

  try {
    if (isAiEnabled() && getOpenAiConfig()) {
      if (isImage) {
        if (buf.length > 3 * 1024 * 1024) {
          flags.push('file_too_large_for_ai');
          const h = heuristicVerify({ text: '', expectedPatientName: expectedName, expectedType: row.type || null, fileMeta });
          score = h.score;
          extractedFields = {};
        } else {
          const mime = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/png';
          const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
          const ai = await openAiAnalyzeImage({
            dataUrl,
            expectedPatientName: expectedName,
            expectedPatientDob: expectedDob,
            expectedType: row.type || null
          });
          if (ai) {
            score = clampInt(ai?.score ?? 60, 0, 100);
            extractedFields = ai?.extractedFields && typeof ai.extractedFields === 'object' ? ai.extractedFields : {};
            (Array.isArray(ai?.flags) ? ai.flags : []).forEach((f) => flags.push(String(f)));
            if (ai?.patientMatch === false) flags.push('patient_mismatch');
            if (!looksLikeEcgDocument({ expectedType: row.type || null, documentType: ai?.documentType, extractedFields, fileMeta })) {
              flags.push('document_type_mismatch');
              score = clampInt(score - 18, 0, 100);
            }
          } else {
            flags.push('ai_unavailable');
            const h = heuristicVerify({ text: '', expectedPatientName: expectedName, expectedType: row.type || null, fileMeta });
            score = h.score;
          }
        }
      } else if (isPdf && pdfParse) {
        const parsed = await pdfParse(buf).catch(() => null);
        const text = parsed?.text || '';
        const ai = await openAiAnalyzeText({
          text,
          expectedPatientName: expectedName,
          expectedPatientDob: expectedDob,
          expectedType: row.type || null
        });
        if (ai) {
          score = clampInt(ai?.score ?? 60, 0, 100);
          extractedFields = ai?.extractedFields && typeof ai.extractedFields === 'object' ? ai.extractedFields : {};
          (Array.isArray(ai?.flags) ? ai.flags : []).forEach((f) => flags.push(String(f)));
          if (ai?.patientMatch === false) flags.push('patient_mismatch');
          if (!looksLikeEcgDocument({ expectedType: row.type || null, documentType: ai?.documentType, extractedFields, fileMeta })) {
            flags.push('document_type_mismatch');
            score = clampInt(score - 18, 0, 100);
          }
        } else {
          flags.push('ai_unavailable');
          const h = heuristicVerify({ text, expectedPatientName: expectedName, expectedType: row.type || null, fileMeta });
          score = h.score;
          h.flags.forEach((f) => flags.push(f));
        }
      } else {
        flags.push(isPdf && !pdfParse ? 'pdf_text_extractor_missing' : 'unsupported_file_type');
        const h = heuristicVerify({ text: '', expectedPatientName: expectedName, expectedType: row.type || null, fileMeta });
        score = h.score;
        h.flags.forEach((f) => flags.push(f));
      }
    } else if (isPdf && pdfParse) {
      const parsed = await pdfParse(buf).catch(() => null);
      const text = parsed?.text || '';
      const h = heuristicVerify({ text, expectedPatientName: expectedName, expectedType: row.type || null, fileMeta });
      score = h.score;
      h.flags.forEach((f) => flags.push(f));
    } else {
      if (isImage) {
        const h = heuristicVerifyImage({ expectedType: row.type || null, fileMeta });
        score = h.score;
        h.flags.forEach((f) => flags.push(f));
      } else {
        flags.push(isPdf && !pdfParse ? 'pdf_text_extractor_missing' : 'unsupported_file_type');
        const h = heuristicVerify({ text: '', expectedPatientName: expectedName, expectedType: row.type || null, fileMeta });
        score = h.score;
        h.flags.forEach((f) => flags.push(f));
      }
    }
  } catch (e) {
    flags.push('verification_error');
    await updateVerificationResult(id, { ...decideStatus(40, flags), extractedFields: extractedFields || null, verificationError: String(e?.message || 'verification_failed') });
    return;
  }

  extractedFields = extractedFields && typeof extractedFields === 'object' ? extractedFields : {};
  extractedFields.expectedPatientName = expectedName || null;
  extractedFields.fileHash = finalHash || null;

  const final = decideStatus(score, flags);
  await updateVerificationResult(id, { ...final, extractedFields: extractedFields || null, verificationError: null });
}

async function runVerificationWithTimeout(id, timeoutMs) {
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('verification_timeout'));
    }, timeoutMs);
  });
  try {
    await Promise.race([verifyLabResult(id), timeout]);
  } catch (e) {
    if (timedOut) {
      await updateVerificationResult(id, { ...decideStatus(55, ['verification_timeout']), extractedFields: null, verificationError: null });
    } else {
      await updateVerificationResult(id, { ...decideStatus(45, ['verification_error']), extractedFields: null, verificationError: String(e?.message || 'verification_failed') });
    }
  }
}

async function processVerificationQueue() {
  if (verificationRunning) return;
  verificationRunning = true;
  try {
    while (verificationQueue.length) {
      const id = verificationQueue.shift();
      if (!id) continue;
      if (verificationInProgress.has(id)) continue;
      verificationInProgress.add(id);
      try {
        await runVerificationWithTimeout(id, 120000);
      } finally {
        verificationInProgress.delete(id);
      }
    }
  } finally {
    verificationRunning = false;
  }
}

function enqueueVerification(id) {
  const key = String(id);
  if (!key) return;
  if (verificationInProgress.has(key)) return;
  if (verificationQueue.includes(key)) return;
  verificationQueue.push(key);
  processVerificationQueue().catch(() => {});
}

async function markTimedOutPending() {
  await prisma.$executeRawUnsafe(`
    UPDATE lab_results
    SET verification_status = 'flagged',
        verification_score = COALESCE(verification_score, 55),
        verification_flags = COALESCE(verification_flags, '[]'::jsonb) || '["verification_timeout"]'::jsonb,
        verified_at = now()
    WHERE verification_status = 'pending'
      AND created_at < (now() - interval '2 minutes')
  `);
}

setInterval(() => {
  markTimedOutPending().catch(() => {});
}, 60000);

router.post('/upload', requireRole(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const sb = getSupabaseAdmin();
    const derivedPatientId = await resolvePatientId({
      patientId: req.body.patientId,
      patientEmail: req.body.patientEmail,
      patientName: req.body.patientName
    });
    if (!derivedPatientId) return res.status(400).json({ message: 'Missing patientId' });
    if (req.auth?.role === 'doctor') {
      const access = await enforceDoctorPatientAccess(req, res, derivedPatientId);
      if (!access.allowed) return;
    }
    const patientId = safeId(derivedPatientId);
    const originalName = String(req.file.originalname || 'file');
    const name = `${Date.now()}_${safeFilename(originalName)}`;
    const fileHash = sha256Hex(req.file.buffer);
    const mimeType = String(req.file.mimetype || '');
    const size = Number(req.file.size || req.file.buffer?.length || 0);


    if (sb) {
      const bucket = process.env.SUPABASE_LAB_RESULTS_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'lab-results';
      await ensureBucket(sb, bucket).catch(() => {});
      const objectPath = `lab-results/${patientId}/${name}`;

      const uploadRes = await sb.storage.from(bucket).upload(objectPath, req.file.buffer, {
        contentType: req.file.mimetype || 'application/octet-stream',
        upsert: true,
        cacheControl: '3600'
      });
      if (uploadRes?.error) {
        return res.status(400).json({ message: 'Upload failed' });
      }

      const publicUrl = sb.storage.from(bucket).getPublicUrl(objectPath)?.data?.publicUrl || null;
      if (!publicUrl) return res.status(400).json({ message: 'Upload failed' });
      return res.json({ url: publicUrl, filename: objectPath, originalName, hash: fileHash, mimeType, size });
    }

    const filename = `${patientId}_${name}`;
    const fullPath = path.join(uploadDir, filename);
    await fs.promises.writeFile(fullPath, req.file.buffer);
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/uploads/lab-results/${encodeURIComponent(filename)}`;
    res.json({ url, filename, originalName, hash: fileHash, mimeType, size });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get('/mine', requireRole(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'patient']), async (req, res) => {
  try {
    const requesterRole = getRequesterRole(req);
    if (requesterRole === 'patient') {
      const explicitPatientId = String(req.headers['x-patient-id'] || '').trim();
      const requesterEmail = normalizeEmail(String(req.headers['x-user-email'] || ''));
      const requesterName = String(req.headers['x-user-name'] || '').trim();

      let patient = null;
      if (isUuid(explicitPatientId)) {
        patient = await prisma.patients
          .findFirst({ where: { id: explicitPatientId }, select: { id: true, email: true } })
          .catch(() => null);
      }

      if (patient?.id && requesterEmail) {
        const stored = normalizeEmail(String(patient.email || ''));
        if (!stored) {
          await prisma.patients
            .update({ where: { id: String(patient.id) }, data: { email: requesterEmail } })
            .then(() => {
              patient.email = requesterEmail;
            })
            .catch(() => {});
        }
        if (stored && stored !== requesterEmail) {
          return res.status(403).json({ message: 'Forbidden' });
        }
      }

      if (!patient?.id) {
        if (!requesterEmail) return res.status(401).json({ message: 'Missing user email or x-patient-id' });
        patient = await ensurePatientByEmail({ email: requesterEmail, name: requesterName });
      }
      if (!patient?.id) return res.status(404).json({ message: 'Patient not found' });

      const { take, status, includeRejected } = req.query;
      const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
      const st = String(status || '').trim().toLowerCase();
      const allowed = new Set(['pending', 'verified', 'flagged', 'rejected']);
      const statusFilter = st && allowed.has(st) ? st : '';

      const includeRej = String(includeRejected || '').trim().toLowerCase();
      const allowRejected = includeRej === '1' || includeRej === 'true' || includeRej === 'yes';

      const conditions = [Prisma.sql`r.patient_id = ${String(patient.id)}::uuid`];
      if (statusFilter) {
        conditions.push(Prisma.sql`lower(coalesce(r.verification_status, 'pending')) = ${statusFilter}`);
      } else if (!allowRejected) {
        conditions.push(Prisma.sql`lower(coalesce(r.verification_status, 'pending')) <> 'rejected'`);
      }
      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, Prisma.sql` AND `)}`;

      const rows = await prisma.$queryRaw(
        Prisma.sql`
          SELECT
            r.id,
            r.patient_id,
            r.order_id,
            r.type,
            r.title,
            r.url,
            r.result_date,
            r.uploaded_by,
            r.created_at,
            r.verification_status,
            r.verification_score,
            r.verification_flags,
            r.extracted_fields,
            r.verified_at
          FROM lab_results r
          ${whereClause}
          ORDER BY r.created_at DESC
          LIMIT ${limit}
        `
      );

      const serialized = (Array.isArray(rows) ? rows : []).map((r) => {
        const raw = serialize(r);
        return {
          ...raw,
          id: String(raw.id),
          patientId: raw.patient_id,
          orderId: raw.order_id ? String(raw.order_id) : null,
          fileUrl: raw.url ?? null,
          pdfUrl: raw.url ?? null,
          resultDate: raw.result_date ?? null,
          uploadedBy: raw.uploaded_by ?? null,
          createdAt: raw.created_at ?? null,
          verificationStatus: raw.verification_status || 'pending',
          verificationScore: raw.verification_score ?? null,
          verificationFlags: raw.verification_flags ?? null,
          extractedFields: raw.extracted_fields ?? null,
          verifiedAt: raw.verified_at ?? null
        };
      });

      return res.json(serialized);
    }

    if (!isStaffRole(requesterRole)) return res.status(403).json({ message: 'Forbidden' });
    const actorName = String(req.headers['x-user-name'] || '').trim();
    const actorEmail = normalizeEmail(String(req.headers['x-user-email'] || ''));
    if (!actorName && !actorEmail) return res.status(400).json({ message: 'Missing x-user-name or x-user-email' });

    const { take, status } = req.query;
    const limit = parseLimit(take, { min: 1, max: 200, fallback: 50 });
    const st = String(status || '').trim().toLowerCase();
    const allowed = new Set(['pending', 'verified', 'flagged', 'rejected']);
    const statusFilter = st && allowed.has(st) ? st : '';

    const conditions = [];
    if (actorName && actorEmail) {
      conditions.push(Prisma.sql`(r.uploaded_by = ${actorName} OR r.uploaded_by = ${actorEmail})`);
    } else if (actorName) {
      conditions.push(Prisma.sql`r.uploaded_by = ${actorName}`);
    } else {
      conditions.push(Prisma.sql`r.uploaded_by = ${actorEmail}`);
    }
    if (statusFilter) {
      conditions.push(Prisma.sql`lower(coalesce(r.verification_status, 'pending')) = ${statusFilter}`);
    }
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, Prisma.sql` AND `)}`;

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          r.id::text AS id,
          r.patient_id AS "patientId",
          r.type,
          r.title,
          r.url,
          r.result_date AS "resultDate",
          r.uploaded_by AS "uploadedBy",
          r.created_at AS "createdAt",
          r.verification_status AS "verificationStatus",
          r.verification_score AS "verificationScore",
          r.verification_flags AS "verificationFlags",
          r.verified_at AS "verifiedAt",
          p.first_name AS "patientFirstName",
          p.last_name AS "patientLastName"
        FROM lab_results r
        LEFT JOIN patients p ON p.id = r.patient_id
        ${whereClause}
        ORDER BY r.created_at DESC
        LIMIT ${limit}
      `
    );

    const mapped = (Array.isArray(rows) ? rows : []).map((r) => ({
      ...r,
      patientName: `${String(r.patientFirstName || '')} ${String(r.patientLastName || '')}`.trim() || null
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', requireRole(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'patient']), async (req, res) => {
  try {
    const { patientId, orderId, take, skip } = req.query;
    if (!patientId) return res.json([]);
    const requesterRole = getRequesterRole(req);
    if (requesterRole === 'patient') {
      const requesterEmail = normalizeEmail(String(req.headers['x-user-email'] || ''));
      if (!requesterEmail) return res.status(401).json({ message: 'Missing user email' });
      const own = await prisma.patients.findFirst({
        where: { email: { equals: requesterEmail, mode: 'insensitive' } },
        select: { id: true }
      });
      if (!own) return res.status(404).json({ message: 'Patient not found' });
      if (String(own.id) !== String(patientId)) return res.status(403).json({ message: 'Forbidden' });
    }
    if (requesterRole === 'doctor') {
      const access = await enforceDoctorPatientAccess(req, res, patientId);
      if (!access.allowed) return;
    }
    const limit = parseLimit(take, { min: 1, max: 500, fallback: 100 });
    const offset = parseOffset(skip, { min: 0, max: 5000, fallback: 0 });

    const conditions = [Prisma.sql`patient_id = ${String(patientId)}::uuid`];
    if (orderId) {
      const raw = String(orderId);
      if (!/^\d+$/.test(raw)) return res.status(400).json({ message: 'Invalid orderId' });
      conditions.push(Prisma.sql`order_id = ${BigInt(raw)}`);
    }
    if (!isStaffRole(requesterRole)) {
      conditions.push(Prisma.sql`verification_status = 'verified'`);
    }
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, Prisma.sql` AND `)}`;

    const results = await prisma.$queryRaw(
      Prisma.sql`
        SELECT id, patient_id, order_id, type, title, url, result_date, uploaded_by, created_at,
               verification_status, verification_score, verification_flags, extracted_fields, verified_at
        FROM lab_results
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
    );

    const serialized = (Array.isArray(results) ? results : []).map((r) => {
      const raw = serialize(r);
      return {
        ...raw,
        id: String(raw.id),
        patientId: raw.patient_id,
        orderId: raw.order_id ? String(raw.order_id) : null,
        fileUrl: raw.url ?? null,
        pdfUrl: raw.url ?? null,
        verificationStatus: raw.verification_status || 'pending',
        verificationScore: raw.verification_score ?? null,
        verificationFlags: raw.verification_flags ?? null,
        extractedFields: raw.extracted_fields ?? null,
        verifiedAt: raw.verified_at ?? null
      };
    });

    res.json(serialized);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', requireRole(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']), async (req, res) => {
  try {
    const { patientId, patientEmail, patientName, orderId, type, title, url, resultDate, uploadedBy, fileHash, fileMeta } = req.body;
    const resolvedPatientId = await resolvePatientId({ patientId, patientEmail, patientName });
    if (!resolvedPatientId || !title || !url) {
      return res.status(400).json({ message: 'patientId (or patientEmail), title, and url are required' });
    }
    if (req.auth?.role === 'doctor') {
      const access = await enforceDoctorPatientAccess(req, res, resolvedPatientId);
      if (!access.allowed) return;
    }

    const rows = await prisma.$queryRaw`
      INSERT INTO lab_results (patient_id, order_id, type, title, url, result_date, uploaded_by, verification_status, file_hash, file_meta)
      VALUES (
        ${resolvedPatientId}::uuid,
        ${orderId ? BigInt(String(orderId)) : null},
        ${type || 'Lab'},
        ${title},
        ${url},
        ${resultDate ? new Date(resultDate) : null}::date,
        ${uploadedBy || null},
        'pending',
        ${fileHash ? String(fileHash) : null},
        ${fileMeta && typeof fileMeta === 'object' ? fileMeta : null}::jsonb
      )
      RETURNING id, patient_id, order_id, type, title, url, result_date, uploaded_by, created_at,
                verification_status, verification_score, verification_flags, extracted_fields, verified_at
    `;
    const created = Array.isArray(rows) ? rows[0] : rows;

    if (uploadedBy) {
      prisma.activity_logs.create({
        data: {
          actor_name: uploadedBy,
          role: 'ClinicalStaff',
          action: 'Create',
          target: `Patient:${resolvedPatientId}`,
          details: 'Added lab/imaging result'
        }
      }).catch(() => {});
    }

    const createdSafe = serialize(created);
    const payload = {
      ...createdSafe,
      id: String(createdSafe.id),
      patientId: createdSafe.patient_id,
      orderId: createdSafe.order_id ? String(createdSafe.order_id) : null,
      fileUrl: createdSafe.url ?? null,
      pdfUrl: createdSafe.url ?? null,
      verificationStatus: createdSafe.verification_status || 'pending',
      verificationScore: createdSafe.verification_score ?? null,
      verificationFlags: createdSafe.verification_flags ?? null,
      extractedFields: createdSafe.extracted_fields ?? null,
      verifiedAt: createdSafe.verified_at ?? null
    };

    enqueueVerification(payload.id);
    res.status(201).json(payload);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get('/:id', requireRole(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'patient']), async (req, res) => {
  try {
    const idRaw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(idRaw)) return res.status(400).json({ message: 'Invalid lab result id.' });
    const id = BigInt(idRaw);

    const requesterRole = getRequesterRole(req);
    if (requesterRole === 'patient') {
      const explicitPatientId = String(req.headers['x-patient-id'] || '').trim();
      const requesterEmail = normalizeEmail(String(req.headers['x-user-email'] || ''));
      const requesterName = String(req.headers['x-user-name'] || '').trim();

      let patient = null;
      if (isUuid(explicitPatientId)) {
        patient = await prisma.patients
          .findFirst({ where: { id: explicitPatientId }, select: { id: true, email: true } })
          .catch(() => null);
      }

      if (patient?.id && requesterEmail) {
        const stored = normalizeEmail(String(patient.email || ''));
        if (!stored) {
          await prisma.patients
            .update({ where: { id: String(patient.id) }, data: { email: requesterEmail } })
            .then(() => {
              patient.email = requesterEmail;
            })
            .catch(() => {});
        }
        if (stored && stored !== requesterEmail) {
          return res.status(403).json({ message: 'Forbidden' });
        }
      }

      if (!patient?.id) {
        if (!requesterEmail) return res.status(401).json({ message: 'Missing user email or x-patient-id' });
        patient = await ensurePatientByEmail({ email: requesterEmail, name: requesterName });
      }
      if (!patient?.id) return res.status(404).json({ message: 'Patient not found' });

      const rows = await prisma.$queryRaw(
        Prisma.sql`
          SELECT
            r.id,
            r.patient_id,
            r.order_id,
            r.type,
            r.title,
            r.url,
            r.result_date,
            r.uploaded_by,
            r.created_at,
            r.verification_status,
            r.verification_score,
            r.verification_flags,
            r.extracted_fields,
            r.verified_at
          FROM lab_results r
          WHERE r.id = ${id}
            AND r.patient_id = ${String(patient.id)}::uuid
          LIMIT 1
        `
      );
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!row) return res.status(404).json({ message: 'Lab result not found' });
      const raw = serialize(row);
      return res.json({
        ...raw,
        id: String(raw.id),
        patientId: raw.patient_id,
        orderId: raw.order_id ? String(raw.order_id) : null,
        fileUrl: raw.url ?? null,
        pdfUrl: raw.url ?? null,
        resultDate: raw.result_date ?? null,
        uploadedBy: raw.uploaded_by ?? null,
        createdAt: raw.created_at ?? null,
        verificationStatus: raw.verification_status || 'pending',
        verificationScore: raw.verification_score ?? null,
        verificationFlags: raw.verification_flags ?? null,
        extractedFields: raw.extracted_fields ?? null,
        verifiedAt: raw.verified_at ?? null
      });
    }

    if (!isStaffRole(requesterRole)) return res.status(403).json({ message: 'Forbidden' });

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          r.id::text AS id,
          r.patient_id AS "patientId",
          r.order_id AS "orderId",
          r.type,
          r.title,
          r.url,
          r.result_date AS "resultDate",
          r.uploaded_by AS "uploadedBy",
          r.created_at AS "createdAt",
          r.verification_status AS "verificationStatus",
          r.verification_score AS "verificationScore",
          r.verification_flags AS "verificationFlags",
          r.extracted_fields AS "extractedFields",
          r.verified_at AS "verifiedAt"
        FROM lab_results r
        WHERE r.id = ${id}
        LIMIT 1
      `
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return res.status(404).json({ message: 'Lab result not found' });
    if (requesterRole === 'doctor') {
      const access = await enforceDoctorPatientAccess(req, res, row.patientId);
      if (!access.allowed) return;
    }
    return res.json({
      ...row,
      fileUrl: row.url ?? null,
      pdfUrl: row.url ?? null
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/interpretation', requireRole(['doctor']), async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const rawEmail = req.headers['x-user-email'];
    const email = normalizeEmail(rawEmail);
    if (!email) return res.status(401).json({ message: 'Missing user email.' });

    const exists = await prisma.$queryRaw`
      SELECT patient_id FROM lab_results WHERE id = ${id} LIMIT 1
    `;
    if (!Array.isArray(exists) || exists.length === 0) {
      return res.status(404).json({ message: 'Lab result not found.' });
    }
    const access = await enforceDoctorPatientAccess(req, res, exists[0].patient_id);
    if (!access.allowed) return;

    const rows = await prisma.$queryRaw`
      SELECT note, doctor_name, updated_at
      FROM lab_result_interpretations
      WHERE lab_result_id = ${id}
        AND doctor_email = ${email}
      LIMIT 1
    `;
    const row = Array.isArray(rows) ? rows[0] : null;
    res.json({ note: row?.note || '', doctorName: row?.doctor_name || null, updatedAt: row?.updated_at || null });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id/interpretation', requireRole(['doctor']), async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const rawEmail = req.headers['x-user-email'];
    const rawName = req.headers['x-user-name'];
    const email = normalizeEmail(rawEmail);
    if (!email) return res.status(401).json({ message: 'Missing user email.' });

    const note = String(req.body.note || '').trim();
    const doctorName = String(req.body.doctorName || rawName || '').trim() || null;

    const exists = await prisma.$queryRaw`
      SELECT patient_id FROM lab_results WHERE id = ${id} LIMIT 1
    `;
    if (!Array.isArray(exists) || exists.length === 0) {
      return res.status(404).json({ message: 'Lab result not found.' });
    }
    const access = await enforceDoctorPatientAccess(req, res, exists[0].patient_id);
    if (!access.allowed) return;

    const rows = await prisma.$queryRaw`
      INSERT INTO lab_result_interpretations (lab_result_id, doctor_email, doctor_name, note, created_at, updated_at)
      VALUES (${id}, ${email}, ${doctorName}, ${note}, now(), now())
      ON CONFLICT (lab_result_id, doctor_email)
      DO UPDATE SET note = EXCLUDED.note, doctor_name = EXCLUDED.doctor_name, updated_at = now()
      RETURNING note, doctor_name, updated_at
    `;
    const row = Array.isArray(rows) ? rows[0] : rows;
    res.json({ note: row?.note || '', doctorName: row?.doctor_name || null, updatedAt: row?.updated_at || null });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id/verify', requireRole(['doctor', 'admin', 'nurse', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist']), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ message: 'Invalid lab result id.' });
    if (req.auth?.role === 'doctor') {
      const rows = await prisma.$queryRaw`SELECT patient_id FROM lab_results WHERE id = ${BigInt(id)} LIMIT 1`;
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ message: 'Lab result not found.' });
      const access = await enforceDoctorPatientAccess(req, res, rows[0].patient_id);
      if (!access.allowed) return;
    }
    enqueueVerification(id);
    res.json({ ok: true, message: 'Verification queued.' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.patch('/:id/verification', requireRole(['doctor', 'admin', 'nurse']), async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    if (req.auth?.role === 'doctor') {
      const rows = await prisma.$queryRaw`SELECT patient_id FROM lab_results WHERE id = ${id} LIMIT 1`;
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ message: 'Lab result not found.' });
      const access = await enforceDoctorPatientAccess(req, res, rows[0].patient_id);
      if (!access.allowed) return;
    }
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['verified', 'flagged', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }
    const score = req.body.score === null || req.body.score === undefined ? null : clampInt(req.body.score, 0, 100);
    const flags = uniqueFlags(req.body.flags);
    const extractedFields = req.body.extractedFields && typeof req.body.extractedFields === 'object' ? req.body.extractedFields : null;
    const flagsJson = JSON.stringify(flags);
    const extractedJson = extractedFields ? JSON.stringify(extractedFields) : null;

    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE lab_results
        SET verification_status = ${status},
            verification_score = ${score},
            verification_flags = ${flagsJson}::jsonb,
            extracted_fields = ${extractedJson}::jsonb,
            verified_at = now(),
            verification_error = NULL
        WHERE id = ${id}
      `
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
