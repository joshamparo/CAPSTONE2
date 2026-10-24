const INACTIVE_ACCOUNT_STATUSES = new Set(['inactive', 'disabled', 'suspended']);

async function getIntakeDoctorIds(db, specialization) {
  const doctors = await db.doctors.findMany({
    where: { specialization: { equals: String(specialization || '').trim(), mode: 'insensitive' }, is_active: true },
    select: { id: true }
  });
  if (!doctors.length) return [];
  const accounts = await db.accounts.findMany({
    where: {
      roles: { equals: 'doctor_secretary', mode: 'insensitive' },
      linked_doctor_id: { in: doctors.map((doctor) => doctor.id) }
    },
    select: { linked_doctor_id: true, status: true }
  });
  const usable = new Set(
    accounts
      .filter((account) => !INACTIVE_ACCOUNT_STATUSES.has(String(account.status || '').trim().toLowerCase()))
      .map((account) => String(account.linked_doctor_id || '').trim())
      .filter(Boolean)
  );
  return doctors.map((doctor) => String(doctor.id)).filter((id) => usable.has(id));
}

async function hasIntakeSecretary(db, specialization) {
  return (await getIntakeDoctorIds(db, specialization)).length > 0;
}

module.exports = { getIntakeDoctorIds, hasIntakeSecretary };
