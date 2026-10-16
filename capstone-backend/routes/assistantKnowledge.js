'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const prisma = require('../utils/prisma');
const { createRateLimiter } = require('../utils/rateLimit');
const { sendError } = require('../utils/httpErrors');
const { readEntries, createKnowledgeEntry, updateKnowledgeEntry, knowledgeHistory } = require('../utils/assistantKnowledgeStore');

const router = express.Router();
const writeLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, key: (req) => req.auth?.email || 'admin' });

router.use(requireRole(['admin']));

router.get('/', async (_req, res) => {
  try { res.json({ entries: await readEntries({ force: true, includeInactive: true }) }); }
  catch (error) { sendError(res, error, 'Unable to load chatbot knowledge.'); }
});

router.post('/', writeLimit, async (req, res) => {
  try {
    const entry = await createKnowledgeEntry(req.body, req.auth.email);
    await prisma.activity_logs.create({ data: { actor_name: req.auth.email, role: 'Admin', action: 'Create Chatbot Knowledge', target: entry.key, details: `Created ${entry.type} knowledge entry.` } }).catch(() => {});
    res.status(201).json(entry);
  } catch (error) { sendError(res, error, 'Unable to create chatbot knowledge.', error.statusCode || 400); }
});

router.put('/:id', writeLimit, async (req, res) => {
  try {
    const entry = await updateKnowledgeEntry(String(req.params.id || ''), req.body, req.auth.email);
    await prisma.activity_logs.create({ data: { actor_name: req.auth.email, role: 'Admin', action: 'Update Chatbot Knowledge', target: entry.key, details: `Updated ${entry.type} knowledge entry; active=${entry.active}.` } }).catch(() => {});
    res.json(entry);
  } catch (error) { sendError(res, error, 'Unable to update chatbot knowledge.', error.statusCode || 400); }
});

router.get('/:id/history', async (req, res) => {
  try { res.json({ history: await knowledgeHistory(String(req.params.id || '')) }); }
  catch (error) { sendError(res, error, 'Unable to load chatbot knowledge history.'); }
});

module.exports = router;
