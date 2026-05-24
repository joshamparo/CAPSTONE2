const express = require('express');
const requireRole = require('../middleware/requireRole');
const { getSystemSettings, saveSystemSettings } = require('../utils/systemSettingsStore');

const router = express.Router();

router.get('/', requireRole(['admin']), async (_req, res) => {
  try {
    const settings = await getSystemSettings({ force: true });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load system settings.' });
  }
});

router.put('/', requireRole(['admin']), async (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = await saveSystemSettings(incoming);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to save system settings.' });
  }
});

module.exports = router;
