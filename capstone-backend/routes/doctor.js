const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const requireRole = require('../middleware/requireRole');
const { sendError } = require('../utils/httpErrors');
const requireNurseDepartment = require('../middleware/requireNurseDepartment');

const NURSE_DOCTOR_SPECIALTY_ALIASES = {
  ER: ['ER', 'Emergency Medicine'],
  OPD: ['OPD', 'Outpatient', 'Medicine'],
  PEDIA: ['PEDIA', 'Pediatrics'],
  MEDICINE: ['Medicine', 'Internal Medicine'],
  LABORATORY: ['Laboratory', 'Pathology'],
  PATHOLOGY: ['Pathology', 'Laboratory'],
  ECG: ['ECG', 'Cardiology'],
  RADIOLOGY: ['Radiology'],
  'PHYSICAL THERAPY': ['Physical Therapy', 'Rehabilitation Medicine'],
  'DENTAL CLINIC': ['Dental Clinic', 'Dental Medicine'],
  'SURGERY (MINOR)': ['Surgery', 'Minor Surgery'],
  ANESTHESIA: ['Anesthesia', 'Anesthesiology'],
  'OTOLARYNGOLOGY (ENT)': ['Otolaryngology', 'ENT'],
  ORTHOPEDICS: ['Orthopedics'],
  'VIDEO CONSULTATION': ['Video Consultation']
};

router.get('/linked-nurse-doctors', requireRole(['nurse']), requireNurseDepartment, async (req, res) => {
  try {
    const department = String(req.nurseDepartment || '').trim().toUpperCase();
    const aliases = NURSE_DOCTOR_SPECIALTY_ALIASES[department] || [department];
    const matches = aliases.flatMap((value) => [
      { specialization: { equals: value, mode: 'insensitive' } },
      { department: { equals: value, mode: 'insensitive' } }
    ]);
    const doctors = await prisma.doctors.findMany({
      where: { is_active: true, OR: matches },
      select: { id: true, first_name: true, middle_name: true, last_name: true, specialization: true, department: true },
      orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }]
    });
    res.json(doctors.map((doctor) => ({
      id: doctor.id,
      name: `${doctor.first_name || ''} ${doctor.middle_name || ''} ${doctor.last_name || ''}`.replace(/\s+/g, ' ').trim(),
      specialization: doctor.specialization || doctor.department || department
    })));
  } catch (error) {
    res.status(500).json({ message: 'Unable to load doctors linked to this nurse specialization.' });
  }
});

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
      profilePicture,
      currentPassword,
      requiresPasswordAuth,
      middleName,
      middle_name,
      department,
      phone
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

    // --- VALIDATION: strict fields & format checks ---
    const cleanStr = (s, len) => {
      const v = String(s == null ? '' : s).trim();
      return len ? v.slice(0, len) : v;
    };
    const errors = [];
    const fNameClean = cleanStr(firstName || first_name || doctor.first_name);
    const lNameClean = cleanStr(lastName || last_name || doctor.last_name);
    const mNameClean = cleanStr(middleName || middle_name || doctor.middle_name || '');
    const deptClean = cleanStr(department || specialization || doctor.department || doctor.specialization || '');
    const phoneRaw = cleanStr(contactNumber || phone || doctor.phone || '');
    const emailClean = cleanStr(email || doctor.email || '', 254);

    if (fNameClean.length < 2) errors.push("First Name must be at least 2 characters.");
    if (!/^[A-Za-zÑñ][A-Za-zÑñ' .\-]*$/.test(fNameClean)) errors.push("First Name contains invalid characters.");
    if (lNameClean.length < 2) errors.push("Last Name must be at least 2 characters.");
    if (!/^[A-Za-zÑñ][A-Za-zÑñ' .\-]*$/.test(lNameClean)) errors.push("Last Name contains invalid characters.");
    if (mNameClean && !/^[A-Za-zÑñ][A-Za-zÑñ' .\-]*$/.test(mNameClean)) errors.push("Middle Name contains invalid characters.");
    if (!emailClean) errors.push("Email is required.");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailClean)) errors.push("Invalid email address format.");
    if (phoneRaw && !/^(\+?63\s?|0)9\d{9}$/.test(String(phoneRaw).replace(/[\s\-()]/g, ''))) {
      errors.push("Invalid PH phone number. Use format: 09XX XXX XXXX or +63 9XX XXX XXXX.");
    }
    if (deptClean && deptClean.replace(/\s+/g, '').length < 2) errors.push("Department / Specialization is too short.");

    const hasPasswordUpdate = Boolean(String(newPassword || '').trim());
    const needsCurrentPassword = Boolean(hasPasswordUpdate || requiresPasswordAuth || currentPassword);
    const providedCurrentPassword = typeof currentPassword === 'string' ? currentPassword : '';

    // Strict: ALWAYS require current password for any profile save (security)
    if (needsCurrentPassword || Object.keys(req.body || {}).some(k => !['id'].includes(k))) {
      if (!providedCurrentPassword) {
        errors.push("Current password is required to save profile changes.");
      } else if (doctor.password) {
        const bcrypt = require('bcryptjs');
        let isMatch = false;
        try {
          if (/^\$2[aby]\$/.test(String(doctor.password || ''))) {
            isMatch = await bcrypt.compare(providedCurrentPassword, String(doctor.password));
          } else {
            isMatch = String(providedCurrentPassword) === String(doctor.password);
            if (isMatch) {
              try {
                const salt = await bcrypt.genSalt(10);
                await prisma.doctors.update({ where: { id: id }, data: { password: await bcrypt.hash(String(doctor.password), salt) } });
              } catch (_rehash) { /* ignore */ }
            }
          }
        } catch (_bcErr) { /* ignore */ }
        if (!isMatch) errors.push("Incorrect current password.");
      }
    }

    if (hasPasswordUpdate) {
      const pw = String(newPassword || '').trim();
      if (pw.length < 11) errors.push("Password must be at least 11 characters.");
      if (!/[^A-Za-z0-9]/.test(pw)) errors.push("Password must contain at least one special character.");
      if (!/[0-9]/.test(pw)) errors.push("Password must contain at least one number.");
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updateData = {
      first_name: fNameClean,
      last_name: lNameClean,
      middle_name: mNameClean || (doctor.middle_name || undefined),
      email: emailClean,
      phone: phoneRaw || doctor.phone,
      avatar_url: profilePicture || doctor.avatar_url,
      department: deptClean || doctor.department || undefined,
      specialization: deptClean || doctor.specialization || 'ER'
    };

    // If password is being updated
    if (hasPasswordUpdate) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(String(newPassword || '').trim(), salt);
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
          details: 'Updated profile information' + (hasPasswordUpdate ? ' and password' : ''),
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
    sendError(res, err, 'Unable to update doctor profile.');
  }
});

module.exports = router;

