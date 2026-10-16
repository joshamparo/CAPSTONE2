'use strict';

const crypto = require('crypto');
const prisma = require('./prisma');

const TYPES = new Set(['service', 'faq', 'contact', 'schedule', 'workflow']);
const ROLES = new Set(['public', 'admin', 'doctor', 'nurse', 'pharmacist', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'staff', 'patient']);
const STATUSES = new Set(['draft', 'active', 'archived']);
const CACHE_MS = Math.max(5000, Math.min(300000, Number(process.env.ASSISTANT_KNOWLEDGE_CACHE_MS || 60000)));
let cache = null;
let cacheExpiresAt = 0;

function cleanText(value, max, required = false) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !text) throw Object.assign(new Error('Required knowledge field is missing.'), { statusCode: 400 });
  if (text.length > max) throw Object.assign(new Error(`Knowledge field exceeds ${max} characters.`), { statusCode: 400 });
  if (/<\/?(script|iframe|object|embed)|javascript:/i.test(text)) throw Object.assign(new Error('Unsafe content is not allowed.'), { statusCode: 400 });
  return text;
}

function normalizeList(value, allowed, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  const result = [...new Set(value.map((item) => cleanText(item, 80).toLowerCase()).filter(Boolean))].slice(0, maxItems);
  if (allowed && result.some((item) => !allowed.has(item))) throw Object.assign(new Error('Unsupported knowledge audience role.'), { statusCode: 400 });
  return result;
}

function parseDate(value, field) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${field} must be a valid date.`), { statusCode: 400 });
  return date;
}

function validateKnowledgeEntry(input = {}, options = {}) {
  const type = cleanText(input.type, 30, true).toLowerCase();
  if (!TYPES.has(type)) throw Object.assign(new Error('Unsupported knowledge type.'), { statusCode: 400 });
  const key = cleanText(input.key, 100, true).toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) throw Object.assign(new Error('A valid knowledge key is required.'), { statusCode: 400 });
  const audienceRoles = normalizeList(input.audienceRoles ?? input.audience_roles, ROLES, 13);
  const effectiveFrom = parseDate(input.effectiveFrom ?? input.effective_from, 'effectiveFrom');
  const expiresAt = parseDate(input.expiresAt ?? input.expires_at, 'expiresAt');
  if (effectiveFrom && expiresAt && expiresAt <= effectiveFrom) throw Object.assign(new Error('expiresAt must be later than effectiveFrom.'), { statusCode: 400 });
  const priceRaw = input.pricePHP ?? input.price_php;
  const pricePHP = priceRaw == null || priceRaw === '' ? null : Number(priceRaw);
  if (pricePHP != null && (!Number.isFinite(pricePHP) || pricePHP < 0 || pricePHP > 10000000)) {
    throw Object.assign(new Error('pricePHP must be a valid non-negative amount.'), { statusCode: 400 });
  }
  const status = cleanText(input.status || (input.active === false ? 'draft' : 'draft'), 20).toLowerCase();
  if (!STATUSES.has(status)) throw Object.assign(new Error('Unsupported publishing status.'), { statusCode: 400 });
  const answerEn = cleanText(input.answerEn ?? input.answer_en, 2000, true);
  const answerTl = cleanText(input.answerTl ?? input.answer_tl, 2000);
  const unsafeClaim = /\b(guaranteed|100% guaranteed|definitely available|diagnos(?:e|is) you|prescribe(?:d|s)?\s+(?:you|an?|antibiotic)|take\s+\d+\s*(?:mg|ml))\b/i;
  if (unsafeClaim.test(`${answerEn} ${answerTl}`)) throw Object.assign(new Error('Medical instructions or guaranteed claims cannot be published as chatbot knowledge.'), { statusCode: 400 });
  const moduleName = cleanText(input.module, 80) || null;
  const lastVerifiedAt = parseDate(input.lastVerifiedAt ?? input.last_verified_at, 'lastVerifiedAt');
  return {
    key,
    type,
    title: cleanText(input.title, 160, true),
    answerEn,
    answerTl,
    keywords: normalizeList(input.keywords, null, 30),
    audienceRoles: audienceRoles.length ? audienceRoles : ['public'],
    department: cleanText(input.department, 120) || null,
    pricePHP,
    notes: cleanText(input.notes, 1000) || null,
    active: status === 'active',
    status,
    module: moduleName,
    lastVerifiedAt,
    effectiveFrom,
    expiresAt
  };
}

function mapRow(row) {
  return {
    id: String(row.id), key: String(row.key), type: String(row.type), title: String(row.title),
    answerEn: String(row.answer_en || ''), answerTl: String(row.answer_tl || ''),
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    audienceRoles: Array.isArray(row.audience_roles) ? row.audience_roles : [],
    department: row.department || null,
    pricePHP: row.price_php == null ? null : Number(row.price_php), notes: row.notes || null,
    active: Boolean(row.active), status: row.status || (row.active ? 'active' : 'draft'), module: row.module || null,
    effectiveFrom: row.effective_from || null, expiresAt: row.expires_at || null,
    reviewedBy: row.reviewed_by || null, reviewedAt: row.reviewed_at || null, lastVerifiedAt: row.last_verified_at || null,
    updatedBy: row.updated_by || null, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function readEntries({ force = false, includeInactive = false } = {}) {
  if (!process.env.DATABASE_URL) return [];
  const now = Date.now();
  if (!includeInactive && !force && cache && cacheExpiresAt > now) return cache;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, key, type, title, answer_en, answer_tl, keywords, audience_roles,
           department, price_php, notes, active, status, module, effective_from, expires_at,
           reviewed_by, reviewed_at, last_verified_at, updated_by, created_at, updated_at
    FROM public.assistant_knowledge_entries
    ${includeInactive ? '' : "WHERE active = true AND status = 'active'"}
    ORDER BY updated_at DESC
    LIMIT 1000
  `);
  const entries = (Array.isArray(rows) ? rows : []).map(mapRow);
  if (!includeInactive) {
    cache = entries;
    cacheExpiresAt = now + CACHE_MS;
  }
  return entries;
}

function tokenize(value) {
  return [...new Set(String(value || '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter((word) => word.length > 1))];
}

function rankKnowledgeEntries(entries, { role = 'public', text = '', currentModule = '' } = {}) {
  const now = Date.now();
  const query = String(text || '').trim().toLowerCase();
  const tokens = tokenize(query);
  const moduleText = cleanText(currentModule, 80).toLowerCase();
  if (!query || tokens.length === 0) return [];
  return entries.flatMap((entry) => {
    if (!entry.active || (entry.status && entry.status !== 'active')) return [];
    if (entry.effectiveFrom && new Date(entry.effectiveFrom).getTime() > now) return [];
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) return [];
    if (!entry.audienceRoles.includes('public') && !entry.audienceRoles.includes(role)) return [];
    const aliases = [entry.key, entry.title, ...(entry.keywords || [])].map((item) => String(item).toLowerCase());
    let score = aliases.some((alias) => alias === query) ? 30 : 0;
    for (const alias of aliases) {
      if (alias.length >= 3 && query.includes(alias)) score += 10;
      const aliasTokens = tokenize(alias);
      const hits = aliasTokens.filter((token) => tokens.includes(token)).length;
      score += hits * 3;
      if (aliasTokens.length && hits === aliasTokens.length) score += 4;
    }
    if (entry.module && moduleText) {
      const wanted = entry.module.toLowerCase();
      score += moduleText.includes(wanted) || wanted.includes(moduleText) ? 12 : -3;
    }
    if (entry.audienceRoles.includes(role)) score += 2;
    return [{ entry, score }];
  }).sort((a, b) => b.score - a.score);
}

async function findKnowledgeAnswer({ role = 'public', text = '', preferredLanguage = 'english', currentModule = '' }) {
  let entries;
  try { entries = await readEntries(); } catch (error) {
    console.warn('[Assistant knowledge] Static fallback:', String(error?.message || error));
    // Brief negative cache prevents a database outage from adding one failed
    // query to every chatbot request. Static answers remain immediately usable.
    cache = [];
    cacheExpiresAt = Date.now() + Math.min(CACHE_MS, 10000);
    return null;
  }
  const ranked = rankKnowledgeEntries(entries, { role, text, currentModule });
  const best = ranked[0];
  if (!best || best.score < 6) return null;
  const second = ranked[1];
  if (second && best.score < 18 && best.score - second.score <= 2) {
    const titles = [best.entry.title, second.entry.title];
    return { answer: `I found two possible topics. Do you mean ${titles[0]} or ${titles[1]}?`, source: 'knowledge', grounded: true, clarification: true, suggestions: titles };
  }
  const answer = preferredLanguage === 'tagalog' && best.entry.answerTl ? best.entry.answerTl : best.entry.answerEn;
  return { answer, source: 'knowledge', grounded: true, knowledgeKey: best.entry.key, lastUpdated: best.entry.updatedAt, confidence: Math.min(1, best.score / 30), suggestions: [] };
}

function invalidateKnowledgeCache() { cache = null; cacheExpiresAt = 0; }

async function writeHistory(entryId, action, snapshot, actor) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.assistant_knowledge_history (id, entry_id, action, snapshot, changed_by) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5)`,
    crypto.randomUUID(), entryId, action, JSON.stringify(snapshot), actor
  );
}

async function createKnowledgeEntry(input, actor) {
  const item = validateKnowledgeEntry(input);
  const id = crypto.randomUUID();
  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO public.assistant_knowledge_entries
      (id, key, type, title, answer_en, answer_tl, keywords, audience_roles, department, price_php, notes, active, status, module, effective_from, expires_at, last_verified_at, reviewed_by, reviewed_at, updated_by)
    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *
  `, id, item.key, item.type, item.title, item.answerEn, item.answerTl, JSON.stringify(item.keywords), JSON.stringify(item.audienceRoles), item.department, item.pricePHP, item.notes, item.active, item.status, item.module, item.effectiveFrom, item.expiresAt, item.lastVerifiedAt, item.active ? actor : null, item.active ? new Date() : null, actor);
  const created = mapRow(rows[0]);
  await writeHistory(id, 'create', created, actor);
  invalidateKnowledgeCache();
  return created;
}

async function updateKnowledgeEntry(id, input, actor) {
  const item = validateKnowledgeEntry(input, { existing: true });
  const rows = await prisma.$queryRawUnsafe(`
    UPDATE public.assistant_knowledge_entries SET
      key=$2, type=$3, title=$4, answer_en=$5, answer_tl=$6, keywords=$7::jsonb,
      audience_roles=$8::jsonb, department=$9, price_php=$10, notes=$11, active=$12, status=$13,
      module=$14, effective_from=$15, expires_at=$16, last_verified_at=$17,
      reviewed_by=CASE WHEN $12 THEN $18 ELSE reviewed_by END,
      reviewed_at=CASE WHEN $12 THEN now() ELSE reviewed_at END, updated_by=$18, updated_at=now()
    WHERE id=$1::uuid RETURNING *
  `, id, item.key, item.type, item.title, item.answerEn, item.answerTl, JSON.stringify(item.keywords), JSON.stringify(item.audienceRoles), item.department, item.pricePHP, item.notes, item.active, item.status, item.module, item.effectiveFrom, item.expiresAt, item.lastVerifiedAt, actor);
  if (!rows[0]) throw Object.assign(new Error('Knowledge entry not found.'), { statusCode: 404 });
  const updated = mapRow(rows[0]);
  await writeHistory(id, item.active ? 'update' : 'deactivate', updated, actor);
  invalidateKnowledgeCache();
  return updated;
}

async function knowledgeHistory(id) {
  return prisma.$queryRawUnsafe(`SELECT id, action, snapshot, changed_by, changed_at FROM public.assistant_knowledge_history WHERE entry_id=$1::uuid ORDER BY changed_at DESC LIMIT 100`, id);
}

function validateFeedback(input = {}) {
  const requestId = cleanText(input.requestId, 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId)) throw Object.assign(new Error('Invalid assistant request ID.'), { statusCode: 400 });
  const rating = cleanText(input.rating, 20, true).toLowerCase();
  if (!['helpful', 'not_helpful'].includes(rating)) throw Object.assign(new Error('Invalid feedback rating.'), { statusCode: 400 });
  const reason = cleanText(input.reason, 30).toLowerCase() || null;
  if (reason && !['outdated', 'wrong_language', 'did_not_answer', 'other'].includes(reason)) throw Object.assign(new Error('Invalid feedback reason.'), { statusCode: 400 });
  return { requestId, rating, reason, knowledgeKey: cleanText(input.knowledgeKey, 100) || null, role: cleanText(input.role, 40) || 'public', module: cleanText(input.currentModule, 80) || null, source: cleanText(input.source, 30) || 'unknown' };
}

async function recordFeedback(input) {
  const item = validateFeedback(input);
  await prisma.$executeRawUnsafe(`INSERT INTO public.assistant_feedback (id, request_id, knowledge_key, role, module, source, rating, reason) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8) ON CONFLICT (request_id) DO UPDATE SET rating=EXCLUDED.rating, reason=EXCLUDED.reason`, crypto.randomUUID(), item.requestId, item.knowledgeKey, item.role, item.module, item.source, item.rating, item.reason);
  return { recorded: true };
}

async function feedbackAnalytics() {
  const summary = await prisma.$queryRawUnsafe(`SELECT rating, count(*)::int AS count FROM public.assistant_feedback WHERE created_at >= now() - interval '30 days' GROUP BY rating`);
  const unresolved = await prisma.$queryRawUnsafe(`SELECT COALESCE(knowledge_key, source) AS topic, count(*)::int AS count FROM public.assistant_feedback WHERE rating='not_helpful' AND created_at >= now() - interval '30 days' GROUP BY COALESCE(knowledge_key, source) ORDER BY count DESC LIMIT 10`);
  return { periodDays: 30, summary, unresolved };
}

module.exports = { validateKnowledgeEntry, validateFeedback, rankKnowledgeEntries, readEntries, findKnowledgeAnswer, createKnowledgeEntry, updateKnowledgeEntry, knowledgeHistory, recordFeedback, feedbackAnalytics, invalidateKnowledgeCache, TYPES, ROLES, STATUSES };
