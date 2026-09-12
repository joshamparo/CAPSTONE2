const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = (value) => String(value || '').trim().toLowerCase();

function ownsPatient(auth, patient) {
  if (auth?.role !== 'patient' || !patient) return false;
  return Boolean((auth.id && String(auth.id) === String(patient.id))
    || (email(auth.email) && email(auth.email) === email(patient.email)));
}

function denied(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function resolveAppointmentLinkedPatient(prisma, auth) {
  const authEmail = email(auth?.email);
  if (!authEmail) return null;
  let links = [];
  if (prisma?.$queryRawUnsafe) {
    links = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT patient_id::text AS "patientId"
       FROM public.appointments
       WHERE lower(email) = lower($1)
         AND patient_id IS NOT NULL
       LIMIT 2`,
      authEmail
    );
  } else if (prisma?.appointments?.findMany) {
    links = await prisma.appointments.findMany({
      where: {
        email: { equals: authEmail, mode: 'insensitive' },
        patient_id: { not: null }
      },
      select: { patient_id: true },
      distinct: ['patient_id'],
      take: 2
    });
  } else {
    return null;
  }
  const patientIds = Array.from(new Set((links || []).map((row) => String(row.patientId || row.patient_id || '').trim()).filter(Boolean)));
  if (patientIds.length > 1) throw denied(409, 'Multiple patient records are linked to this account. Please contact the clinic.');
  if (patientIds.length !== 1) return null;
  return prisma.patients.findFirst({
    where: { id: patientIds[0] },
    select: { id: true, email: true, first_name: true, last_name: true }
  });
}

async function resolvePatientAccountProfile(prisma, auth) {
  if (!prisma?.accounts?.findFirst) return null;
  const authId = String(auth?.id || '').trim();
  const authEmail = email(auth?.email);
  const identity = [];
  if (/^\d+$/.test(authId)) identity.push({ id: BigInt(authId) });
  if (authEmail) identity.push({ email: { equals: authEmail, mode: 'insensitive' } });
  if (!identity.length) return null;

  const account = await prisma.accounts.findFirst({
    where: { OR: identity },
    select: { name: true, email: true, birthday: true, roles: true }
  });
  if (!account || String(account.roles || '').trim().toLowerCase() !== 'patient') return null;

  const accountEmail = email(account.email);
  if (accountEmail) {
    const emailMatches = await prisma.patients.findMany({
      where: { email: { equals: accountEmail, mode: 'insensitive' } },
      select: { id: true, email: true, first_name: true, last_name: true },
      take: 2
    });
    if (emailMatches.length > 1) throw denied(409, 'Multiple patient records are linked to this account. Please contact the clinic.');
    if (emailMatches.length === 1) return emailMatches[0];
  }

  const nameParts = String(account.name || '').trim().split(/\s+/).filter(Boolean);
  if (nameParts.length < 2 || !account.birthday) return null;
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];
  const profileMatches = await prisma.patients.findMany({
    where: {
      first_name: { equals: firstName, mode: 'insensitive' },
      last_name: { equals: lastName, mode: 'insensitive' },
      date_of_birth: account.birthday
    },
    select: { id: true, email: true, first_name: true, last_name: true },
    take: 2
  });
  if (profileMatches.length > 1) throw denied(409, 'Multiple patient records match this account. Please contact the clinic.');
  return profileMatches[0] || null;
}

// Reads never create patients, attach emails, or trust a client-supplied identity.
async function resolveOwnedPatient(prisma, auth, requestedId) {
  if (auth?.role !== 'patient') throw denied(401, 'Patient authentication required.');
  const select = { id: true, email: true, first_name: true, last_name: true };
  if (requestedId) {
    const requested = String(requestedId).trim();
    if (UUID.test(requested)) {
      const patient = await prisma.patients.findFirst({ where: { id: requested }, select });
      if (ownsPatient(auth, patient)) return patient;
      const linked = await resolveAppointmentLinkedPatient(prisma, auth)
        || await resolvePatientAccountProfile(prisma, auth);
      if (linked && String(linked.id) === requested) return linked;
      throw denied(403, 'This patient record is not linked to your account. Please contact the clinic.');
    }
    if (requested !== String(auth?.id || '').trim()) throw denied(400, 'Invalid patient ID.');
    const linked = await resolveAppointmentLinkedPatient(prisma, auth)
      || await resolvePatientAccountProfile(prisma, auth);
    if (linked) return linked;
    throw denied(404, 'No patient record is linked to your account. Please contact the clinic.');
  }
  if (UUID.test(String(auth.id || ''))) {
    const patient = await prisma.patients.findFirst({ where: { id: String(auth.id) }, select });
    if (patient) return patient;
  }
  if (!email(auth.email)) throw denied(401, 'Patient authentication required.');
  const matches = await prisma.patients.findMany({
    where: { email: { equals: email(auth.email), mode: 'insensitive' } }, select, take: 2
  });
  if (matches.length > 1) throw denied(409, 'Multiple patient records are linked to this email. Please contact the clinic.');
  if (matches.length === 1) return matches[0];
  const linked = await resolveAppointmentLinkedPatient(prisma, auth)
    || await resolvePatientAccountProfile(prisma, auth);
  if (linked) return linked;
  throw denied(404, 'No patient record is linked to your account. Please contact the clinic.');
}

module.exports = { ownsPatient, resolveOwnedPatient };
