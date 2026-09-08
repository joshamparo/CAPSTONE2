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

// Reads never create patients, attach emails, or trust a client-supplied identity.
async function resolveOwnedPatient(prisma, auth, requestedId) {
  if (auth?.role !== 'patient') throw denied(401, 'Patient authentication required.');
  const select = { id: true, email: true, first_name: true, last_name: true };
  if (requestedId) {
    if (!UUID.test(String(requestedId))) throw denied(400, 'Invalid patient ID.');
    const patient = await prisma.patients.findFirst({ where: { id: String(requestedId) }, select });
    if (!ownsPatient(auth, patient)) throw denied(403, 'This patient record is not linked to your account. Please contact the clinic.');
    return patient;
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
  if (!matches.length) throw denied(404, 'No patient record is linked to your account. Please contact the clinic.');
  return matches[0];
}

module.exports = { ownsPatient, resolveOwnedPatient };
