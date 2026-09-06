const express = require('express');
const requireRole = require('../middleware/requireRole');
const prisma = require('../utils/prisma');
const { getSystemSettings, saveSystemSettings } = require('../utils/systemSettingsStore');
const { createRateLimiter } = require('../utils/rateLimit');
const { sendError } = require('../utils/httpErrors');

const router = express.Router();
const settingsWriteRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  key: (req) => req.auth?.email || 'admin'
});

// Public, no auth — globally exposes safe signals only (maintenance mode)
router.get('/public', async (_req, res) => {
  try {
    const settings = await getSystemSettings({ force: false });
    const safe = {
      maintenanceMode: Boolean(settings?.maintenanceMode),
      updatedAt: settings?.updatedAt || null,
      publicVersion: 1
    };
    res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.json(safe);
  } catch (err) {
    sendError(res, err, 'Failed to load public system status.', 500, { maintenanceMode: false });
  }
});

router.get('/', requireRole(['admin']), async (_req, res) => {
  try {
    const settings = await getSystemSettings({ force: true });
    res.json(settings);
  } catch (err) {
    sendError(res, err, 'Failed to load system settings.');
  }
});

router.put('/', requireRole(['admin']), settingsWriteRateLimit, async (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = await saveSystemSettings(incoming);
    await prisma.activity_logs.create({
      data: {
        actor_name: req.auth.email,
        role: 'Admin',
        action: 'Update System Settings',
        target: Object.keys(incoming).sort().join(', '),
        details: `Updated approved settings keys: ${Object.keys(incoming).sort().join(', ')}`.slice(0, 1000)
      }
    }).catch(() => {});
    res.json(settings);
  } catch (err) {
    sendError(res, err, 'Failed to save system settings.');
  }
});

module.exports = router;
