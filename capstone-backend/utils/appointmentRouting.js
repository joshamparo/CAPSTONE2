function newAppointmentRouting(mode, requestedDoctorUuid) {
  const normalizedMode = String(mode || '').trim().toLowerCase() === 'video' ? 'video' : 'onsite';
  if (normalizedMode === 'onsite') {
    return { doctorUuid: null, assignmentStatus: 'PENDING_ASSIGNMENT', assignedAt: null };
  }
  return {
    doctorUuid: requestedDoctorUuid || null,
    assignmentStatus: requestedDoctorUuid ? 'ASSIGNED' : 'PENDING_ASSIGNMENT',
    assignedAt: requestedDoctorUuid ? new Date() : null
  };
}

function canAssignOnsiteAppointment(role) {
  return ['doctor_secretary', 'admin'].includes(String(role || '').trim().toLowerCase());
}

function doctorAppointmentScope(doctorId) {
  return {
    AND: [
      { doctor_uuid: String(doctorId || '') },
      {
        OR: [
          { consultation_mode: 'video' },
          { consultation_mode: 'onsite', assignment_status: 'ASSIGNED' }
        ]
      }
    ]
  };
}

function doctorDepartmentAppointmentScope(doctorIds) {
  const ids = Array.from(new Set((Array.isArray(doctorIds) ? doctorIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)));
  return {
    AND: [
      { doctor_uuid: { in: ids } },
      {
        OR: [
          { consultation_mode: 'video' },
          { consultation_mode: 'onsite', assignment_status: 'ASSIGNED' }
        ]
      }
    ]
  };
}

module.exports = { newAppointmentRouting, canAssignOnsiteAppointment, doctorAppointmentScope, doctorDepartmentAppointmentScope };
