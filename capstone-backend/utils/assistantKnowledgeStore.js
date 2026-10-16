'use strict';

const crypto = require('crypto');
const prisma = require('./prisma');

const TYPES = new Set(['service', 'faq', 'contact', 'schedule', 'workflow']);
const ROLES = new Set(['public', 'admin', 'doctor', 'nurse', 'pharmacist', 'cashier', 'doctor_secretary', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'staff', 'patient']);
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
  return {
    key,
    type,
    title: cleanText(input.title, 160, true),
    answerEn: cleanText(input.answerEn ?? input.answer_en, 2000, true),
    answerTl: cleanText(input.answerTl ?? input.answer_tl, 2000),
    keywords: normalizeList(input.keywords, null, 30),
    audienceRoles: audienceRoles.length ? audienceRoles : ['public'],
    department: cleanText(input.department, 120) || null,
    pricePHP,
    notes: cleanText(input.notes, 1000) || null,
    active: options.existing ? Boolean(input.active) : input.active !== false,
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
    active: Boolean(row.active), effectiveFrom: row.effective_from || null, expiresAt: row.expires_at || null,
    updatedBy: row.updated_by || null, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function readEntries({ force = false, includeInactive = false } = {}) {
  if (!process.env.DATABASE_URL) return [];
  const now = Date.now();
  if (!includeInactive && !force && cache && cacheExpiresAt > now) return cache;
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, key, type, title, answer_en, answer_tl, keywords, audience_roles,
           department, price_php, notes, active, effective_from, expires_at,
           updated_by, created_at, updated_at
    FROM public.assistant_knowledge_entries
    ${includeInactive ? '' : 'WHERE active = true'}
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

async function findKnowledgeAnswer({ role = 'public', text = '', preferredLanguage = 'english' }) {
  let entries;
  try { entries = await readEntries(); } catch (error) {
    console.warn('[Assistant knowledge] Static fallback:', String(error?.message || error));
    // Brief negative cache prevents a database outage from adding one failed
    // query to every chatbot request. Static answers remain immediately usable.
    cache = [];
    cacheExpiresAt = Date.now() + Math.min(CACHE_MS, 10000);
    return null;
  }
  const now = Date.now();
  const query = String(text || '').trim().toLowerCase();
  const tokens = tokenize(query);
  if (!query || tokens.length === 0) return null;
  let best = null;
  for (const entry of entries) {
    if (!entry.active) continue;
    if (entry.effectiveFrom && new Date(entry.effectiveFrom).getTime() > now) continue;
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) continue;
    if (!entry.audienceRoles.includes('public') && !entry.audienceRoles.includes(role)) continue;
    const aliases = [entry.key, entry.title, ...(entry.keywords || [])].map((item) => String(item).toLowerCase());
    let score = aliases.some((alias) => alias === query) ? 20 : 0;
    for (const alias of aliases) {
      if (alias.length >= 3 && query.includes(alias)) score += 8;
      const aliasTokens = tokenize(alias);
      score += aliasTokens.filter((token) => tokens.includes(token)).length * 2;
    }
    if (!best || score > best.score) best = { entry, score };
  }
  if (!best || best.score < 4) return null;
  const answer = preferredLanguage === 'tagalog' && best.entry.answerTl ? best.entry.answerTl : best.entry.answerEn;
  return { answer, source: 'knowledge', grounded: true, knowledgeKey: best.entry.key, lastUpdated: best.entry.updatedAt, suggestions: [] };
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
      (id, key, type, title, answer_en, answer_tl, keywords, audience_roles, department, price_php, notes, active, effective_from, expires_at, updated_by)
    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `, id, item.key, item.type, item.title, item.answerEn, item.answerTl, JSON.stringify(item.keywords), JSON.stringify(item.audienceRoles), item.department, item.pricePHP, item.notes, item.active, item.effectiveFrom, item.expiresAt, actor);
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
      audience_roles=$8::jsonb, department=$9, price_php=$10, notes=$11, active=$12,
      effective_from=$13, expires_at=$14, updated_by=$15, updated_at=now()
    WHERE id=$1::uuid RETURNING *
  `, id, item.key, item.type, item.title, item.answerEn, item.answerTl, JSON.stringify(item.keywords), JSON.stringify(item.audienceRoles), item.department, item.pricePHP, item.notes, item.active, item.effectiveFrom, item.expiresAt, actor);
  if (!rows[0]) throw Object.assign(new Error('Knowledge entry not found.'), { statusCode: 404 });
  const updated = mapRow(rows[0]);
  await writeHistory(id, item.active ? 'update' : 'deactivate', updated, actor);
  invalidateKnowledgeCache();
  return updated;
}

async function knowledgeHistory(id) {
  return prisma.$queryRawUnsafe(`SELECT id, action, snapshot, changed_by, changed_at FROM public.assistant_knowledge_history WHERE entry_id=$1::uuid ORDER BY changed_at DESC LIMIT 100`, id);
}

module.exports = { validateKnowledgeEntry, readEntries, findKnowledgeAnswer, createKnowledgeEntry, updateKnowledgeEntry, knowledgeHistory, invalidateKnowledgeCache, TYPES, ROLES };
