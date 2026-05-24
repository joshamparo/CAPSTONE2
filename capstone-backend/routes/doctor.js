const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');

router.get('/specializations', requireRole(['admin', 'nurse', 'doctor', 'doctor_secretary', 'cashier', 'staff', 'patient']), async (_req, res) => {
  try {
    const rows = await prisma.doctors.findMany({
      select: { specialization: true },
      where: { specialization: { not: null } }
    });
    const set = new Set();
    (rows || []).forEach((r) => {
      const s = String(r?.specialization || '').trim();
      if (s) set.add(s);
    });
    const list = Array.from(set.values()).sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


// Profile Update Route
router.post('/profile/update', requireRole(['doctor']), async (req, res) => {
  try {
    const { 
      id, 
      first_name, 
      last_name, 
      firstName, 
      lastName, 
      newPassword, 
      specialization,
      email,
      contactNumber,
      profilePicture 
    } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Find the doctor
    const doctor = await prisma.doctors.findUnique({
      where: { id: id }
    });

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    const updateData = {
      first_name: firstName || first_name || doctor.first_name,
      last_name: lastName || last_name || doctor.last_name,
      email: email || doctor.email,
      phone: contactNumber || doctor.phone,
      avatar_url: profilePicture || doctor.avatar_url,
      // Specialization is read-only for doctor but we can still set it to 'ER' as per requirement if it's missing
      specialization: specialization || doctor.specialization || 'ER'
    };

    // If password is being updated
    if (newPassword && newPassword.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(newPassword, salt);
    }

    // Update in database
    const updatedDoctor = await prisma.doctors.update({
      where: { id: id },
      data: updateData
    });

    // Log the activity
    try {
      await prisma.activity_logs.create({
        data: {
          actor_name: `${updatedDoctor.first_name} ${updatedDoctor.last_name}`,
          role: 'Doctor',
          action: 'Profile Update',
          details: 'Updated profile information' + (newPassword ? ' and password' : ''),
          target: 'Profile',
        }
      });
    } catch (logErr) {
      console.error("Profile update logging failed:", logErr);
    }

    // Return success
    const { password: _, ...userData } = updatedDoctor;
    res.json({ message: 'Profile updated successfully', user: userData });

  } catch (err) {
    console.error('Error updating doctor profile:', err);
    res.status(500).json({ message: 'Server error while updating profile' });
  }
});

module.exports = router;

