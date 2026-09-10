async function hasIntakeSecretary(db, specialization) {
  const doctors = await db.doctors.findMany({
    where: { specialization: { equals: String(specialization || '').trim(), mode: 'insensitive' }, is_active: true },
    select: { id: true }
  });
  if (!doctors.length) return false;
  const accounts = await db.accounts.findMany({
    where: {
      roles: { equals: 'doctor_secretary', mode: 'insensitive' },
      linked_doctor_id: { in: doctors.map((doctor) => doctor.id) }
    },
    select: { status: true }
  });
  return accounts.some((account) => !['inactive', 'disabled', 'suspended'].includes(String(account.status || '').trim().toLowerCase()));
}

module.exports = { hasIntakeSecretary };
