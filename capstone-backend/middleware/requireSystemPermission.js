const { getSystemSettings, hasSystemPermission } = require('../utils/systemSettingsStore');

const ROLE_LABELS = Object.freeze({
  admin: 'Admin',
  doctor: 'Doctor',
  nurse: 'Nurse',
  staff: 'Staff'
});

function requireSystemPermission(permission) {
  return async (req, res, next) => {
    const roleKey = String(req.auth?.role || '').trim().toLowerCase();
    const roleName = ROLE_LABELS[roleKey];

    // Specialized roles keep their purpose-built access rules. The configurable
    // matrix currently covers only the four roles displayed in Admin Settings.
    if (!roleName) return next();

    try {
      const settings = await getSystemSettings({ force: false });
      if (hasSystemPermission(settings, roleKey, permission)) return next();
      return res.status(403).json({
        message: `Your ${roleName} role does not have the ${permission.replace(/_/g, ' ')} permission.`
      });
    } catch (error) {
      console.error('[System permission] Policy lookup failed:', error?.message || error);
      return res.status(503).json({ message: 'Unable to verify system permissions right now.' });
    }
  };
}

module.exports = requireSystemPermission;
