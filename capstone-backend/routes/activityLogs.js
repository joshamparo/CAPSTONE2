const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { createRateLimiter } = require('../utils/rateLimit');

router.use(requireRole(['admin']));
const auditWriteRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120, key: (req) => req.auth?.email || 'admin' });

let activityLogsCache = { key: '', fetchedAt: 0, payload: null, promise: null };
const ACTIVITY_LOGS_CACHE_MS = 5 * 1000;

// @route   GET api/activity-logs
// @desc    Get all activity logs sorted by newest
// @access  Admin only
router.get('/', async (req, res) => {
    try {
        const takeRaw = Number(req.query.take);
        const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 500) : 200;
        const skipRaw = Number(req.query.skip);
        const skip = Number.isFinite(skipRaw) ? Math.min(Math.max(skipRaw, 0), 5000) : 0;

        const startRaw = req.query.start;
        const endRaw = req.query.end;
        const start = typeof startRaw === 'string' ? new Date(startRaw) : null;
        const end = typeof endRaw === 'string' ? new Date(endRaw) : null;
        const hasStart = start && !Number.isNaN(start.getTime());
        const hasEnd = end && !Number.isNaN(end.getTime());

        const where = hasStart || hasEnd ? {
            timestamp: {
                ...(hasStart ? { gte: start } : {}),
                ...(hasEnd ? { lte: end } : {})
            }
        } : undefined;

        const cacheKey = JSON.stringify({ take, skip, start: hasStart ? start.toISOString() : '', end: hasEnd ? end.toISOString() : '' });
        const now = Date.now();
        if (activityLogsCache.payload && activityLogsCache.key === cacheKey && now - activityLogsCache.fetchedAt < ACTIVITY_LOGS_CACHE_MS) {
            return res.json(activityLogsCache.payload);
        }
        if (activityLogsCache.promise && activityLogsCache.key === cacheKey) {
            const payload = await activityLogsCache.promise;
            return res.json(payload);
        }

        activityLogsCache.key = cacheKey;
        activityLogsCache.promise = (async () => {
        const logs = await prisma.activity_logs.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take,
            skip
        });
        
        // Convert BigInt id to string for JSON serialization
        const serializedLogs = logs.map(log => ({
            ...log,
            id: log.id.toString()
        }));
        activityLogsCache.fetchedAt = Date.now();
        activityLogsCache.payload = serializedLogs;
        return serializedLogs;
        })().finally(() => { activityLogsCache.promise = null; });

        const payload = await activityLogsCache.promise;
        return res.json(payload);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/activity-logs
// @desc    Create a new activity log
// @access  Admin only; actor identity is derived from the signed session
router.post('/', auditWriteRateLimit, async (req, res) => {
    const action = String(req.body?.action || '').trim().slice(0, 100);
    const target = String(req.body?.target || '').trim().slice(0, 300);
    const details = String(req.body?.details || '').trim().slice(0, 3000);
    if (!action || !target) return res.status(400).json({ message: 'Audit action and target are required.' });

    try {
        const newLog = await prisma.activity_logs.create({
            data: {
                actor_name: req.auth.email,
                role: 'Admin',
                action: action,
                target: target,
                details: details
            }
        });
        activityLogsCache = { key: '', fetchedAt: 0, payload: null, promise: null };

        // Convert BigInt id to string for JSON serialization
        res.json({
            ...newLog,
            id: newLog.id.toString()
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

