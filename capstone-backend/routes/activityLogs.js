const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

router.use(requireRole(['admin']));

let activityLogsCache = { key: '', fetchedAt: 0, payload: null, promise: null };
const ACTIVITY_LOGS_CACHE_MS = 5 * 1000;

// @route   GET api/activity-logs
// @desc    Get all activity logs sorted by newest
// @access  Public (should be protected in prod)
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
// @access  Public
router.post('/', async (req, res) => {
    const { actorName, role, action, target, details } = req.body;

    try {
        const newLog = await prisma.activity_logs.create({
            data: {
                actor_name: actorName,
                role: role,
                action: action,
                target: target,
                details: details
            }
        });

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

