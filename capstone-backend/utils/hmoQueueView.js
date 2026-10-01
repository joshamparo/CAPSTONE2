const badPatientName = /^(?:patient(?: name unavailable| of|$)|invoice-|(?:clinical|lab) order\s*#|walk-in|nurse walk|onsite consultation|online consultation|video consultation)/i;

function cleanPatientName(...candidates) {
  for (const candidate of candidates) {
    const name = String(candidate || '').replace(/\s+/g, ' ').trim();
    if (name && !badPatientName.test(name) && !name.includes('Auto-created from')) return name;
  }
  return 'Patient name unavailable';
}

function hmoStatusApplies(status) {
  return ['approved', 'partially approved', 'paid'].includes(String(status || '').trim().toLowerCase());
}

function buildHmoQueueRows(rows = []) {
  const mapped = (Array.isArray(rows) ? rows : []).map((row) => {
    const total = Math.max(0, Number(row.total_amount || 0));
    const philhealth = Math.min(total, Math.max(0, Number(row.philhealth_deduction || 0)));
    const hmoApproved = Math.max(0, Number(row.loa_approved_amount || 0));
    const hmoCovered = hmoStatusApplies(row.claim_status)
      ? Math.min(Math.max(0, total - philhealth), hmoApproved)
      : 0;
    const patientPays = Math.max(0, total - philhealth - hmoCovered);
    const patientName = cleanPatientName(row.registry_patient_name, row.order_patient_name, row.claim_patient_name);
    const provider = String(row.hmo_provider || row.registry_hmo_provider || '').trim();
    const cardNumber = String(row.hmo_card_number || row.registry_hmo_card_number || '').trim();
    const loaNumber = String(row.hmo_loa_number || '').trim();
    const patientId = String(row.patient_id || '').trim() || null;
    const invoiceId = String(row.invoice_id || '').trim() || null;
    const appointmentId = String(row.appointment_id || '').trim() || null;
    const claim = {
      id: row.id != null ? String(row.id) : null,
      invoice_id: invoiceId,
      appointment_id: appointmentId,
      patient_id: patientId,
      patient_name: patientName,
      provider,
      hmo_provider: provider,
      loa_number: loaNumber,
      hmo_loa_number: loaNumber,
      hmo_card_number: cardNumber,
      philhealth_deduction: philhealth,
      loa_approved_amount: hmoApproved,
      applied_hmo_amount: hmoCovered,
      patient_payable: patientPays,
      patient_reference: String(row.patient_reference || '').trim() || null,
      status: String(row.claim_status || 'Pending').trim() || 'Pending',
      notes: String(row.claim_notes || '').trim(),
      requested_by: row.requested_by || null,
      updated_by: row.updated_by || null,
      created_at: row.claim_created_at || null,
      updated_at: row.claim_updated_at || null,
      company: String(row.company || '').trim(),
      patient_contact: String(row.contact_number || '').trim()
    };
    return {
      id: claim.id,
      invoice_id: invoiceId,
      invoice_status: row.invoice_status || null,
      invoice_created_at: row.invoice_created_at || null,
      patient_name: patientName,
      patient_reference: claim.patient_reference,
      email: row.email || null,
      contact_number: row.contact_number || null,
      company: row.company || null,
      total_amount: total.toFixed(2),
      philhealth_amount: philhealth.toFixed(2),
      hmo_covered_amount: hmoCovered.toFixed(2),
      patient_pays: patientPays.toFixed(2),
      claim_status: claim.status,
      workups_list: String(row.workups_list || row.order_service || '').trim() || null,
      hmo_claim: claim
    };
  });

  const encounters = new Map();
  for (const row of mapped) {
    const claim = row.hmo_claim;
    const timestamp = row.invoice_created_at || claim.created_at || claim.updated_at || null;
    const dateKey = timestamp && !Number.isNaN(new Date(timestamp).getTime())
      ? new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : 'undated';
    const identity = claim.patient_id ? `patient:${claim.patient_id}` : `name:${row.patient_name.toLowerCase()}`;
    const key = claim.appointment_id
      ? `appointment:${claim.appointment_id}`
      : claim.loa_number
        ? `${identity}:loa:${claim.loa_number.toLowerCase()}`
        : `${identity}:date:${dateKey}`;
    const current = encounters.get(key);
    const invoice = row.invoice_id ? {
      invoice_id: row.invoice_id,
      status: row.invoice_status,
      total_amount: row.total_amount,
      workups_list: row.workups_list,
      created_at: row.invoice_created_at || claim.created_at
    } : null;
    if (!current) {
      encounters.set(key, {
        ...row,
        encounter_id: key,
        invoice_count: invoice ? 1 : 0,
        invoice_ids: invoice ? [row.invoice_id] : [],
        invoices: invoice ? [invoice] : []
      });
      continue;
    }
    if (invoice && !current.invoice_ids.includes(row.invoice_id)) {
      current.invoice_ids.push(row.invoice_id);
      current.invoices.push(invoice);
      current.invoice_count += 1;
    }
    for (const field of ['total_amount', 'philhealth_amount', 'hmo_covered_amount', 'patient_pays']) {
      current[field] = (Number(current[field] || 0) + Number(row[field] || 0)).toFixed(2);
    }
    current.workups_list = Array.from(new Set(`${current.workups_list || ''},${row.workups_list || ''}`.split(',').map((x) => x.trim()).filter(Boolean))).join(', ') || null;
  }
  return Array.from(encounters.values());
}

module.exports = { cleanPatientName, buildHmoQueueRows };
