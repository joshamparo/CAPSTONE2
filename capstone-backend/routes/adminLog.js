const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

const LOGIN_AUDIT_ROLES = [
    'admin', 'staff', 'cashier', 'doctor_secretary', 'doctor', 'nurse',
    'pharmacist', 'medtech', 'radiographer', 'ecg_operator', 'physical_therapist'
];

// @route   POST api/admin-log
// @desc    Record a successful staff login for the authenticated account
// @access  Authenticated staff roles
router.post('/', requireRole(LOGIN_AUDIT_ROLES), async (req, res) => {
    const email = String(req.auth?.email || '').trim().toLowerCase();

    if (!email) {
        return res.status(401).json({ message: 'Authenticated email is required.' });
    }

    try {
        const savedLog = await prisma.admin_logs.create({
            data: {
                email
            }
        });
        
        // Convert BigInt to string before sending JSON
        const responseLog = {
            ...savedLog,
            id: savedLog.id ? savedLog.id.toString() : undefined
        };
        
        res.json(responseLog);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Unable to record the login audit.' });
    }
});

module.exports = router;

