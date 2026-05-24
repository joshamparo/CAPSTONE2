const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');

// @route   POST api/admin-log
// @desc    Log admin login attempts
// @access  Public
router.post('/', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ msg: 'Please enter all fields' });
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
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
});

module.exports = router;

