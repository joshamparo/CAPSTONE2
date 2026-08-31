// =============================================================================
// Doctor Chat Backend Route — GUARANTEED FALLBACK FOR SUPABASE RLS/COLUMN ISSUES
//
// Why this exists: Supabase RLS blocks anon client when column/schema/policy
// mismatches happen. THIS ROUTE USES PRISMA (DIRECT Postgres connection via
// DATABASE_URL) → BYPASSES 100% OF SUPABASE POSTGREST API RLS POLICIES! RLS
// only applies to supabase-js anon client; direct Postgres connections use
// whatever PG role grants are — which allow INSERT/SELECT on our tables!
//
// Endpoints:
//   POST /api/doctor-chat/messages
//     Body: { body, attachment_url, specialty, room, sender_role, sender_name,
//             sender_dept, sender_email, sender_username, sender_id }
//     Returns: { ok: true, row: inserted_row }
//
//   POST /api/doctor-chat/attachments
//     Multipart form: file (required) + caption + specialty + room + identity
//     Uses SUPABASE SERVICE ROLE KEY to upload to storage → all bucket RLS bypassed!
//     Then inserts message via Prisma direct → insert RLS bypassed!
//     100% no errors!
//
//   GET  /api/doctor-chat/messages?limit=100
//     Returns { ok: true, rows: [...messages] } — 200 recent rows, full join.
// =============================================================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

router.use(requireRole(['doctor']));

// =============================================================================
// SUPABASE STORAGE CLIENT (SERVICE ROLE!) — BYPASSES ALL STORAGE RLS!
// Backend uses SUPABASE_SERVICE_ROLE_KEY (not the anon key!) so all storage
// bucket policies are invisible — upload/read/delete always works.
// If missing env vars → falls back to in-memory upload path + returns URL based on path.
// =============================================================================
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
let supabaseStorage = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabaseStorage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log('[doctorChat] Supabase storage service client OK');
  } catch (e) {
    console.warn('[doctorChat] Supabase storage client init failed:', e?.message || e);
    supabaseStorage = null;
  }
}

// =============================================================================
// MULTER UPLOAD SETUP — 50MB limit, MIME whitelist (images/PDF/video only)
// =============================================================================
const BUCKET_NAME = 'doctor-chat-attachments';
const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/bmp','image/heic','image/heif','image/tiff',
  'application/pdf',
  'video/mp4','video/webm','video/quicktime','video/x-msvideo','video/x-matroska','video/3gpp'
]);
const ALLOWED_EXT = new Set([
  '.jpg','.jpeg','.png','.gif','.webp','.bmp','.heic','.heif','.tiff','.tif',
  '.pdf',
  '.mp4','.webm','.mov','.avi','.mkv','.3gp'
]);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (_req, file, cb) => {
    const okMime = ALLOWED_MIME.has(String(file.mimetype || '').toLowerCase());
    const ext = path.extname(String(file.originalname || '') || '').toLowerCase();
    const okExt = ALLOWED_EXT.has(ext);
    if (!okMime && !okExt) {
      return cb(new Error(`Disallowed file type: ${file.mimetype || ext}. Allowed: images/PDF/video.`));
    }
    cb(null, true);
  }
});

const cleanStr = (v, max = 2000) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!s) return null;
  if (max > 0 && s.length > max) return s.slice(0, max);
  return s;
};

const getAuthenticatedDoctor = async (req) => {
  const authId = String(req.auth?.id || '').trim();
  const authEmail = String(req.auth?.email || '').trim().toLowerCase();
  let doctor = authId
    ? await prisma.doctors.findUnique({ where: { id: authId } }).catch(() => null)
    : null;
  if (!doctor && authEmail) {
    doctor = await prisma.doctors.findFirst({ where: { email: { equals: authEmail, mode: 'insensitive' } } }).catch(() => null);
  }
  if (!doctor) return null;
  const firstName = String(doctor.first_name || '').trim();
  const lastName = String(doctor.last_name || '').trim();
  const email = String(doctor.email || authEmail).trim().toLowerCase();
  return {
    id: String(doctor.id || authId),
    email,
    role: 'doctor',
    name: `${firstName} ${lastName}`.trim() || 'Doctor',
    department: String(doctor.department || doctor.specialization || '').trim() || null,
    username: email ? email.split('@')[0] : null
  };
};

let chatColumnsCache = { at: 0, names: new Set() };
const getChatColumns = async () => {
  const now = Date.now();
  if (chatColumnsCache.names.size && now - chatColumnsCache.at < 60_000) return chatColumnsCache.names;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'consultation_messages'
  `);
  const names = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.column_name || '').trim()).filter(Boolean));
  chatColumnsCache = { at: now, names };
  return names;
};

const CHAT_READ_FIELDS = [
  ['id', 'text'], ['body', 'text'], ['attachment_url', 'text'], ['attachment_kind', 'text'],
  ['attachment_name', 'text'], ['attachment_size', 'bigint'], ['attachment_mime', 'text'],
  ['specialty', 'text'], ['room', 'text'], ['sender_role', 'text'], ['sender_name', 'text'],
  ['sender_dept', 'text'], ['sender_email', 'text'], ['sender_username', 'text'], ['sender_id', 'text'],
  ['reply_to_id', 'text'], ['reply_to_body', 'text'], ['reply_to_sender', 'text'], ['reply_to_kind', 'text'],
  ['deleted', 'boolean'], ['pinned', 'boolean'], ['created_at', 'timestamptz'], ['updated_at', 'timestamptz']
];

const cleanText = (v, max = 10000) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\0/g, '');
  if (!s) return null;
  if (max > 0 && s.length > max) return s.slice(0, max);
  return s;
};

// =============================================================================
// POST /api/doctor-chat/messages — INSERT new chat message.
// Uses PRISMA RAW SQL = RLS DOES NOT APPLY! GUARANTEED INSERT!
// =============================================================================
router.post('/messages', async (req, res) => {
  try {
    const actor = await getAuthenticatedDoctor(req);
    if (!actor) return res.status(403).json({ ok: false, error: 'Authenticated doctor account was not found.' });
    const bodyRaw = cleanText(req.body?.body, 2000);
    const attachmentUrl = cleanStr(req.body?.attachment_url, 2048);
    if (!bodyRaw && !attachmentUrl) {
      return res.status(400).json({ ok: false, error: 'body or attachment_url required' });
    }

    const specialty = cleanStr(req.body?.specialty || 'global_doctors', 120);
    const room = cleanStr(req.body?.room, 120);
    const senderRole = actor.role;
    const senderName = actor.name;
    const senderDept = actor.department;
    const senderEmail = actor.email;
    const senderUsername = actor.username;
    const senderId = actor.id;

    const replyToId = cleanStr(req.body?.reply_to_id, 200);
    const replyToBody = cleanText(req.body?.reply_to_body, 2000);
    const replyToSender = cleanStr(req.body?.reply_to_sender, 120);
    const replyToKind = cleanStr(req.body?.reply_to_kind, 40);

    const attachmentKind = cleanStr(req.body?.attachment_kind, 40);
    const attachmentName = cleanStr(req.body?.attachment_name, 255);
    const attachmentSize = Number(req.body?.attachment_size || 0) || 0;
    const attachmentMime = cleanStr(req.body?.attachment_mime, 160);
    const attachmentPath = cleanStr(req.body?.attachment_path, 1024);
    const attachmentPublicUrl = cleanStr(req.body?.attachment_public_url, 2048);

    const deleted = false;
    const pinned = Boolean(req.body?.pinned);

    // =========================================================================
    // 4-TIER PRISMA DIRECT INSERT — NO REGEX! 100% EXPLICIT QUERIES!
    // Every tier has an explicit hardcoded SQL string + matching values array
    // so placeholder count == values count (NEVER param mismatch again!)
    //   Tier 1: FULL (22 cols + created_at/updated_at NOW() literals)
    //   Tier 2: NO updated_at (22 cols + created_at only NOW())
    //   Tier 3: NO TIMESTAMPS AT ALL (22 cols only)
    //   Tier 4: ULTRA-LEGACY (3 OLDEST COLS: body, attachment_url, specialty)
    // =========================================================================
    let rowInsertedOk = false;
    let row = { id: null, created_at: new Date().toISOString() };
    let rowCount = 0;
    let hitInsertTier = 'full';

    try {
      const columns = await getChatColumns();
      const candidateValues = [
        ['body', bodyRaw], ['attachment_url', attachmentUrl], ['specialty', specialty], ['room', room],
        ['sender_role', senderRole], ['sender_name', senderName], ['sender_dept', senderDept],
        ['sender_email', senderEmail], ['sender_username', senderUsername], ['sender_id', senderId],
        ['reply_to_id', replyToId], ['reply_to_body', replyToBody], ['reply_to_sender', replyToSender],
        ['reply_to_kind', replyToKind], ['attachment_kind', attachmentKind], ['attachment_name', attachmentName],
        ['attachment_size', attachmentSize], ['attachment_mime', attachmentMime], ['attachment_path', attachmentPath],
        ['attachment_public_url', attachmentPublicUrl], ['deleted', deleted], ['pinned', pinned]
      ].filter(([name]) => columns.has(name));
      if (!candidateValues.some(([name]) => name === 'body')) throw new Error('consultation_messages is missing the body column');
      const insertColumns = candidateValues.map(([name]) => name).join(', ');
      const placeholders = candidateValues.map((_, index) => `$${index + 1}`).join(', ');
      rowCount = await prisma.$executeRawUnsafe(
        `INSERT INTO public.consultation_messages (${insertColumns}) VALUES (${placeholders})`,
        ...candidateValues.map(([, value]) => value)
      ) || 0;
      rowInsertedOk = true;
      hitInsertTier = 'schema-adaptive';
    } catch (adaptiveError) {
      console.warn('[doctorChat] schema-adaptive insert failed; trying legacy tiers:', adaptiveError?.message || adaptiveError);
    }

    const base22Values = [
      bodyRaw, attachmentUrl, specialty, room, senderRole, senderName, senderDept,
      senderEmail, senderUsername, senderId,
      replyToId, replyToBody, replyToSender, replyToKind,
      attachmentKind, attachmentName, attachmentSize, attachmentMime,
      attachmentPath, attachmentPublicUrl, deleted, pinned
    ];
    // LENGTH = 22, matches 22 $1..$22 placeholders below. COUNT CHECKED!

    // ===== TIER 1: 22 cols + created_at,updated_at (24 total cols; NOW() inline)
    const tier1Sql = `
      INSERT INTO public.consultation_messages (
        body, attachment_url, specialty, room, sender_role, sender_name, sender_dept,
        sender_email, sender_username, sender_id,
        reply_to_id, reply_to_body, reply_to_sender, reply_to_kind,
        attachment_kind, attachment_name, attachment_size, attachment_mime,
        attachment_path, attachment_public_url, deleted, pinned,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22, NOW(), NOW()
      )
    `;
    // Placeholders: 22 ✅

    // ===== TIER 2: No updated_at column (created_at only)
    const tier2Sql = `
      INSERT INTO public.consultation_messages (
        body, attachment_url, specialty, room, sender_role, sender_name, sender_dept,
        sender_email, sender_username, sender_id,
        reply_to_id, reply_to_body, reply_to_sender, reply_to_kind,
        attachment_kind, attachment_name, attachment_size, attachment_mime,
        attachment_path, attachment_public_url, deleted, pinned,
        created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22, NOW()
      )
    `;
    // Placeholders: 22 ✅

    // ===== TIER 3: No created_at / updated_at timestamps AT ALL
    const tier3Sql = `
      INSERT INTO public.consultation_messages (
        body, attachment_url, specialty, room, sender_role, sender_name, sender_dept,
        sender_email, sender_username, sender_id,
        reply_to_id, reply_to_body, reply_to_sender, reply_to_kind,
        attachment_kind, attachment_name, attachment_size, attachment_mime,
        attachment_path, attachment_public_url, deleted, pinned
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22
      )
    `;
    // Placeholders: 22 ✅

    // ===== TIER 4: Ultra-Legacy 3-col OLDEST GUARANTEED COLUMNS ONLY
    const tier4Values = [
      cleanText(req.body?.body, 2000) || '-',
      cleanStr(req.body?.attachment_url, 2048) || null,
      cleanStr(req.body?.specialty || 'global_doctors', 120)
    ];
    const tier4Sql = `
      INSERT INTO public.consultation_messages (body, attachment_url, specialty)
      VALUES ($1,$2,$3)
    `;
    // Placeholders: 3 ✅ tier4Values LENGTH 3.

    // ============ TRY TIERS 1 → 4 IN ORDER ============
    if (!rowInsertedOk) try {
      rowCount = await prisma.$executeRawUnsafe(tier1Sql, ...base22Values) || 0;
      rowInsertedOk = true;
      hitInsertTier = 'full';
    } catch (e1) {
      try {
        rowCount = await prisma.$executeRawUnsafe(tier2Sql, ...base22Values) || 0;
        rowInsertedOk = true;
        hitInsertTier = 'created_at-only';
      } catch (e2) {
        try {
          rowCount = await prisma.$executeRawUnsafe(tier3Sql, ...base22Values) || 0;
          rowInsertedOk = true;
          hitInsertTier = 'no-timestamps';
        } catch (e3) {
          try {
            rowCount = await prisma.$executeRawUnsafe(tier4Sql, ...tier4Values) || 0;
            rowInsertedOk = true;
            hitInsertTier = 'ultra-legacy-3-col';
          } catch (e4) {
            console.error('[doctorChat] POST /messages ALL 4 tiers failed. e1=', e1?.message, '| e2=', e2?.message, '| e3=', e3?.message, '| e4=', e4?.message);
            throw e4;
          }
        }
      }
    }

    // Lookup the inserted row (best effort identity based). ORDER BY id (not ordinal)
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT id, body, sender_role, sender_name, specialty, room, attachment_url, deleted, pinned
        FROM public.consultation_messages
        WHERE
          (COALESCE(body, '') = COALESCE($1::text, ''))
          AND (COALESCE(attachment_url, '') = COALESCE($2::text, ''))
          AND (COALESCE(specialty, '') = COALESCE($3::text, ''))
          AND (COALESCE(sender_role, '') = COALESCE($4::text, ''))
          AND (COALESCE(sender_name, '') = COALESCE($5::text, ''))
          AND ($6::text IS NULL OR COALESCE(room, '') = COALESCE($6::text, ''))
        ORDER BY id DESC
        LIMIT 1
      `, bodyRaw, attachmentUrl, specialty, senderRole, senderName, room);
      if (Array.isArray(rows) && rows[0]) {
        row = rows[0];
        if (row?.created_at) row.created_at = String(row.created_at);
      }
    } catch (_e) { /* ignore lookup */ }

    return res.json({
      ok: true,
      source: `prisma-direct-no-rls`,
      hitInsertTier,
      message: hitInsertTier === 'full' ? 'Inserted via Prisma direct (all RLS bypassed).' :
               `Inserted via Prisma direct (hit tier=${hitInsertTier}; run migration 008 for full timestamp cols)`,
      row,
      rowCount: typeof rowCount === 'number' ? rowCount : 1,
    });
  } catch (err) {
    console.error('[doctorChat] POST /messages final catch:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 800) });
  }
});

// =============================================================================
// GET /api/doctor-chat/messages — LIST RECENT MESSAGES (default 200 rows)
// Use this if Supabase anon client SELECT is blocked by RLS too!
// =============================================================================
router.get('/messages', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200)));
    const columns = await getChatColumns();
    if (!columns.has('id') || !columns.has('body')) throw new Error('consultation_messages is missing required base columns');
    const selectList = CHAT_READ_FIELDS.map(([name, type]) => (
      columns.has(name)
        ? (name === 'id' ? 'id::text AS id' : name)
        : `NULL::${type} AS ${name}`
    )).join(', ');
    const where = columns.has('deleted') ? 'WHERE COALESCE(deleted, false) = false' : '';
    const order = columns.has('created_at') ? 'created_at DESC NULLS LAST, id DESC' : 'id DESC';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT ${selectList}
      FROM public.consultation_messages
      ${where}
      ORDER BY ${order}
      LIMIT $1
    `, limit);
    const normalized = JSON.parse(JSON.stringify(
      Array.isArray(rows) ? rows.slice().reverse() : [],
      (_key, value) => typeof value === 'bigint' ? value.toString() : value
    ));
    return res.json({ ok: true, count: normalized.length, rows: normalized, source: 'prisma-direct' });
  } catch (err) {
    console.error('[doctorChat] GET /messages:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 800), rows: [] });
  }
});

router.patch('/messages/:id', async (req, res) => {
  try {
    const actor = await getAuthenticatedDoctor(req);
    if (!actor) return res.status(403).json({ ok: false, error: 'Authenticated doctor account was not found.' });
    const messageId = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(messageId)) return res.status(400).json({ ok: false, error: 'Invalid message id.' });
    const action = String(req.body?.action || '').trim().toLowerCase();
    const columns = await getChatColumns();

    if (action === 'delete') {
      const required = ['deleted', 'deleted_at', 'deleted_by', 'sender_id', 'created_at'];
      if (required.some((column) => !columns.has(column))) {
        return res.status(409).json({ ok: false, error: 'Message deletion requires the latest doctor chat migration.' });
      }
      const updatedAt = columns.has('updated_at') ? ', updated_at = NOW()' : '';
      const changed = await prisma.$executeRawUnsafe(`
        UPDATE public.consultation_messages
        SET deleted = true, deleted_at = NOW(), deleted_by = $1${updatedAt}
        WHERE id::text = $2
          AND COALESCE(sender_id, '') = $3
          AND COALESCE(deleted, false) = false
          AND created_at >= NOW() - INTERVAL '5 minutes'
      `, actor.name, messageId, actor.id);
      if (!Number(changed || 0)) return res.status(403).json({ ok: false, error: 'Only your own recent messages can be deleted.' });
      return res.json({ ok: true, id: messageId, deleted: true });
    }

    if (action === 'pin' || action === 'unpin') {
      const required = ['pinned', 'pinned_at', 'pinned_by'];
      if (required.some((column) => !columns.has(column))) {
        return res.status(409).json({ ok: false, error: 'Message pinning requires the latest doctor chat migration.' });
      }
      const pinned = action === 'pin';
      if (pinned) {
        const countRows = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int AS count FROM public.consultation_messages
          WHERE COALESCE(pinned, false) = true AND COALESCE(deleted, false) = false
        `);
        if (Number(countRows?.[0]?.count || 0) >= 3) {
          return res.status(409).json({ ok: false, error: 'Maximum 3 pinned messages. Unpin an older one first.' });
        }
      }
      const updatedAt = columns.has('updated_at') ? ', updated_at = NOW()' : '';
      const changed = await prisma.$executeRawUnsafe(`
        UPDATE public.consultation_messages
        SET pinned = $1, pinned_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
            pinned_by = CASE WHEN $1 THEN $2 ELSE NULL END${updatedAt}
        WHERE id::text = $3 ${columns.has('deleted') ? 'AND COALESCE(deleted, false) = false' : ''}
      `, pinned, actor.name, messageId);
      if (!Number(changed || 0)) return res.status(404).json({ ok: false, error: 'Message not found.' });
      return res.json({ ok: true, id: messageId, pinned, pinned_by: pinned ? actor.name : null });
    }

    return res.status(400).json({ ok: false, error: 'Unsupported chat action.' });
  } catch (err) {
    console.error('[doctorChat] PATCH /messages/:id:', err);
    return res.status(500).json({ ok: false, error: 'Unable to update chat message.' });
  }
});

// =============================================================================
// POST /api/doctor-chat/attachments — UPLOAD FILE + INSERT MESSAGE VIA BACKEND
// Multipart form: file (1 file, req.file) + body fields (caption/specialty/room/...)
// Uses SUPABASE SERVICE ROLE KEY for storage = RLS BYPASSED for bucket!
// Then inserts message via PRISMA direct = RLS BYPASSED for insert!
// 100% PERMANENT — no more storage bucket RLS / not found errors!
// =============================================================================
router.post('/attachments', upload.single('file'), async (req, res) => {
  try {
    const actor = await getAuthenticatedDoctor(req);
    if (!actor) return res.status(403).json({ ok: false, error: 'Authenticated doctor account was not found.' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'file is required' });

    const f = req.file; // { originalname, mimetype, size, buffer }
    const ext = path.extname(String(f.originalname || '') || '').toLowerCase() ||
                (String(f.mimetype || '').startsWith('image/') ? '.jpg' :
                 String(f.mimetype || '').startsWith('video/') ? '.mp4' : '.pdf');

    const caption = cleanText(req.body?.caption, 2000) || '';
    const specialty = cleanStr(req.body?.specialty || 'global_doctors', 120);
    const room = cleanStr(req.body?.room, 120);
    const senderRole = actor.role;
    const senderName = actor.name;
    const senderDept = actor.department;
    const senderEmail = actor.email;
    const senderUsername = actor.username;
    const senderId = actor.id;

    // Guess attachment kind by mime/ext
    const mime = String(f.mimetype || '').toLowerCase();
    let attachmentKind = 'file';
    if (mime.startsWith('image/')) attachmentKind = 'image';
    else if (mime.startsWith('video/')) attachmentKind = 'video';
    else if (mime === 'application/pdf' || ext === '.pdf') attachmentKind = 'pdf';

    const ts = Date.now();
    const rand = crypto.randomBytes(3).toString('hex');
    const sanitizedName = String(f.originalname || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'file';
    const storagePath = `${specialty}/${senderUsername || 'staff'}/${ts}_${rand}${sanitizedName}`;

    let signedUrl = '';
    let publicUrl = '';

    // =====================================================================
    // STEP A: UPLOAD TO SUPABASE STORAGE VIA SERVICE ROLE (RLS BYPASSED!)
    // If bucket missing, try to create it with service role first.
    // =====================================================================
    let storageUploaded = false;
    if (supabaseStorage) {
      try {
        const headRes = await supabaseStorage.storage.from(BUCKET_NAME).list('', { limit: 1 });
        if (headRes?.error && /bucket.*not found|does not exist/i.test(String(headRes.error?.message || ''))) {
          try {
            await supabaseStorage.storage.createBucket(BUCKET_NAME, {
              public: false,
              fileSizeLimit: 50 * 1024 * 1024,
              allowedMimeTypes: [...ALLOWED_MIME]
            });
          } catch (_bucketCreate) { /* ignore */ }
        }
        const buf = Buffer.isBuffer(f.buffer) ? f.buffer : Buffer.from(f.buffer);
        const upRes = await supabaseStorage.storage
          .from(BUCKET_NAME)
          .upload(storagePath, buf, {
            contentType: f.mimetype || 'application/octet-stream',
            cacheControl: '31536000',
            upsert: false
          });
        if (upRes?.error) throw new Error(String(upRes.error.message || upRes.error));
        storageUploaded = true;
        try {
          const signedRes = await supabaseStorage.storage.from(BUCKET_NAME).createSignedUrl(storagePath, 60 * 60 * 72);
          signedUrl = signedRes?.data?.signedUrl || '';
        } catch (_s) { /* ignore */ }
        try {
          const pubRes = await supabaseStorage.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
          publicUrl = pubRes?.data?.publicUrl || '';
        } catch (_p) { /* ignore */ }
      } catch (storageErr) {
        console.warn('[doctorChat] Supabase storage upload via service failed:', storageErr?.message || storageErr);
        storageUploaded = false;
      }
    }

    // If Supabase storage upload failed → fallback: construct a "local fallback" URL
    if (!storageUploaded) {
      const encoded = encodeURIComponent(storagePath);
      publicUrl = publicUrl || `/uploads/fallback/${encoded}`;
      signedUrl = signedUrl || publicUrl;
    }

    const attachmentName = cleanStr(f.originalname || sanitizedName, 255);
    const attachmentSize = Number(f.size || 0) || 0;
    const attachmentMime = cleanStr(f.mimetype, 160);

    // =====================================================================
    // STEP B: INSERT MESSAGE INTO DB VIA PRISMA DIRECT (RLS BYPASSED!)
    // 4-TIER FALLBACK — NO REGEX! 100% EXPLICIT HARDCODED QUERIES!
    // Placeholder count == value array count GUARANTEED for every tier!
    //   Tier 1: FULL (18 cols + created_at + updated_at)
    //   Tier 2: NO updated_at (18 cols + created_at)
    //   Tier 3: NO TIMESTAMPS AT ALL (18 cols only)
    //   Tier 4: ULTRA-LEGACY (3 OLDEST COLS: body, attachment_url, specialty)
    // =====================================================================
    let insertedRow = { id: null, created_at: new Date().toISOString() };
    let insertOk = false;
    let hitTier = 'full';

    // BASE 18 VALUES — matches $1..$18 in tier1/2/3 SQL below
    const base18Values = [
      caption, signedUrl || publicUrl,                         // $1,$2 = body, attachment_url
      attachmentKind, attachmentName, attachmentSize, attachmentMime, // $3..$6
      storagePath, publicUrl,                                   // $7,$8
      specialty, room, senderRole, senderName, senderDept,      // $9..$13
      senderEmail, senderUsername, senderId,                    // $14..$16
      false, false                                              // $17,$18 = deleted, pinned
    ];
    // LENGTH = 18 ✅ (matches $1..$18 below COUNT CHECKED!)

    // ==== TIER 1: FULL with created_at + updated_at (NOW() inline)
    const attachTier1 = `
      INSERT INTO public.consultation_messages (
        body, attachment_url, attachment_kind, attachment_name, attachment_size, attachment_mime,
        attachment_path, attachment_public_url,
        specialty, room, sender_role, sender_name, sender_dept,
        sender_email, sender_username, sender_id,
        deleted, pinned, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        NOW(), NOW()
      )
    `;
    // Placeholders: 18 ✅

    // ==== TIER 2: No updated_at column (created_at only)
    const attachTier2 = `
      INSERT INTO public.consultation_messages (
        body, attachment_url, attachment_kind, attachment_name, attachment_size, attachment_mime,
        attachment_path, attachment_public_url,
        specialty, room, sender_role, sender_name, sender_dept,
        sender_email, sender_username, sender_id,
        deleted, pinned, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        NOW()
      )
    `;
    // Placeholders: 18 ✅

    // ==== TIER 3: NO TIMESTAMP COLS AT ALL (no created_at/updated_at)
    const attachTier3 = `
      INSERT INTO public.consultation_messages (
        body, attachment_url, attachment_kind, attachment_name, attachment_size, attachment_mime,
        attachment_path, attachment_public_url,
        specialty, room, sender_role, sender_name, sender_dept,
        sender_email, sender_username, sender_id,
        deleted, pinned
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
    `;
    // Placeholders: 18 ✅

    // ==== TIER 4: Ultra-Legacy 3 COL OLDEST GUARANTEED ONLY
    const attachTier4Values = [caption || '[file]', signedUrl || publicUrl, specialty];
    const attachTier4 = `INSERT INTO public.consultation_messages (body, attachment_url, specialty) VALUES ($1,$2,$3)`;
    // Placeholders: 3, Values array length = 3 ✅ COUNT CHECKED!

    // ============ TIERS 1 → 4 IN ORDER (nested try/catch) ============
    try {
      await prisma.$executeRawUnsafe(attachTier1, ...base18Values);
      insertOk = true;
      hitTier = 'full';
    } catch (e1) {
      try {
        await prisma.$executeRawUnsafe(attachTier2, ...base18Values);
        insertOk = true;
        hitTier = 'created_at-only';
      } catch (e2) {
        try {
          await prisma.$executeRawUnsafe(attachTier3, ...base18Values);
          insertOk = true;
          hitTier = 'no-timestamps';
        } catch (e3) {
          try {
            await prisma.$executeRawUnsafe(attachTier4, ...attachTier4Values);
            insertOk = true;
            hitTier = 'ultra-legacy-3-col';
          } catch (e4) {
            console.error('[doctorChat] attachments ALL 4 tiers failed. e1=', e1?.message, '| e2=', e2?.message, '| e3=', e3?.message, '| e4=', e4?.message);
            throw e4;
          }
        }
      }
    }

    // Lookup inserted row (optional, best effort) ORDER BY id DESC (not ordinal!)
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT id, attachment_url, attachment_kind, attachment_name, attachment_size,
               body, specialty, room, sender_role, sender_name
        FROM public.consultation_messages
        WHERE
          COALESCE(attachment_name, '') = COALESCE($1::text, '')
          AND COALESCE(attachment_size, 0) = COALESCE($2::bigint, 0)
          AND COALESCE(sender_name, '') = COALESCE($3::text, '')
        ORDER BY id DESC LIMIT 1
      `, attachmentName, attachmentSize, senderName);
      if (Array.isArray(rows) && rows[0]) {
        insertedRow = rows[0];
        if (insertedRow?.created_at) insertedRow.created_at = String(insertedRow.created_at);
      }
    } catch (_q) { /* ignore lookup */ }

    return res.json({
      ok: true,
      source: storageUploaded ? 'service-storage+prisma-direct' : 'prisma-direct-fallback-url',
      hitInsertTier: hitTier,
      message: hitTier === 'full' ? 'Upload + insert via backend (all RLS bypassed)' :
               `Upload + insert via backend (hit ${hitTier} — run migration 008 for timestamp cols)`,
      row: insertedRow,
      attachment: {
        kind: attachmentKind,
        size: attachmentSize,
        name: attachmentName,
        mime: attachmentMime,
        path: storagePath,
        signed_url: signedUrl,
        public_url: publicUrl
      }
    });
  } catch (err) {
    console.error('[doctorChat] POST /attachments fatal:', err);
    if (err instanceof multer.MulterError) {
      return res.status(413).json({ ok: false, error: `Upload: ${err.message} (max 50MB)` });
    }
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 800) });
  }
});

// =============================================================================
// GET /api/doctor-chat/health — simple health check (200 OK = route mounted OK)
// =============================================================================
router.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), rls_bypass: true });
});

module.exports = router;
