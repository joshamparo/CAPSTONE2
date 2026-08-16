function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function ensureBillingTablesExist(prisma) {
  const reg = await prisma.$queryRaw`
    SELECT to_regclass('public.billing_invoices')::text AS billing_invoices,
           to_regclass('public.billing_invoice_items')::text AS billing_invoice_items,
           to_regclass('public.billing_payments')::text AS billing_payments
  `;
  const info = Array.isArray(reg) ? reg[0] : null;
  if (!(info && info.billing_invoices && info.billing_invoice_items && info.billing_payments)) {
    const err = new Error('Billing tables are not installed. Run manual_migration_billing.sql first.');
    err.statusCode = 500;
    throw err;
  }
}

async function recordLabOrderPayment(prisma, {
  orderId,
  patientId,
  patientName,
  service,
  kind,
  amount,
  method,
  reference,
  receivedBy
}) {
  await ensureBillingTablesExist(prisma);
  const amountMoney = toMoney(amount);
  const marker = `Lab Order #${String(orderId)}`;
  const description = `${String(service || kind || 'Laboratory Service').trim() || 'Laboratory Service'} - Lab Payment`;

  return prisma.$transaction(async (tx) => {
    let invoice = await tx.billing_invoices.findFirst({
      where: { notes: { contains: marker } },
      include: { payments: true }
    }).catch(() => null);

    if (!invoice) {
      invoice = await tx.billing_invoices.create({
        data: {
          patient_id: patientId || null,
          status: 'Paid',
          notes: `${marker} • Auto-created from cashier lab payment`,
          created_by: receivedBy || null,
          total_amount: amountMoney
        },
        include: { payments: true }
      });
      await tx.billing_invoice_items.create({
        data: {
          invoice_id: invoice.id,
          description,
          quantity: 1,
          unit_price: amountMoney,
          line_total: amountMoney
        }
      });
    }

    const existingPayment = await tx.billing_payments.findFirst({
      where: { invoice_id: invoice.id, reference: reference || null }
    }).catch(() => null);

    if (!existingPayment) {
      await tx.billing_payments.create({
        data: {
          invoice_id: invoice.id,
          amount: amountMoney,
          method: method || null,
          reference: reference || null,
          received_by: receivedBy || null
        }
      });
    }

    await tx.billing_invoices.update({
      where: { id: invoice.id },
      data: {
        patient_id: patientId || invoice.patient_id || null,
        status: 'Paid',
        total_amount: amountMoney,
        updated_at: new Date()
      }
    });

    // Attempt to sync HMO data from the latest appointment for this patient
    if (patientId) {
      try {
        const latestAppt = await tx.appointments.findFirst({
          where: { patient_id: patientId },
          orderBy: { created_at: 'desc' },
          select: { id: true, is_hmo: true }
        });
        if (latestAppt && latestAppt.is_hmo) {
          await syncHmoDataFromAppointmentToInvoice(tx, latestAppt.id, invoice.id);
        }
      } catch (syncErr) {
        console.error('[Lab Payment Sync] Failed to sync HMO:', syncErr);
      }
    }

    return invoice.id;
  });
}

async function recordVideoConsultationPayment(prisma, {
  appointmentId,
  patientId,
  patientName,
  doctorName,
  serviceType,
  amount,
  paymentReference,
  receivedBy
}) {
  await ensureBillingTablesExist(prisma);
  const amountMoney = toMoney(amount);
  const serviceLabel = String(serviceType || 'Video Consultation').trim() || 'Video Consultation';
  const description = `Video Consultation - ${serviceLabel}`;

  return prisma.$transaction(async (tx) => {
    let invoice = await tx.billing_invoices.findFirst({
      where: { appointment_id: appointmentId },
      include: { payments: true }
    }).catch(() => null);

    if (!invoice) {
      invoice = await tx.billing_invoices.create({
        data: {
          patient_id: patientId || null,
          appointment_id: appointmentId,
          status: 'Paid',
          notes: `Auto-created from paid video consultation${doctorName ? ` • ${doctorName}` : ''}`,
          created_by: receivedBy || null,
          total_amount: amountMoney
        },
        include: { payments: true }
      });
      await tx.billing_invoice_items.create({
        data: {
          invoice_id: invoice.id,
          description,
          quantity: 1,
          unit_price: amountMoney,
          line_total: amountMoney
        }
      });
    }

    const existingPayment = await tx.billing_payments.findFirst({
      where: { invoice_id: invoice.id, reference: paymentReference || null }
    }).catch(() => null);

    if (!existingPayment) {
      await tx.billing_payments.create({
        data: {
          invoice_id: invoice.id,
          amount: amountMoney,
          method: 'PayMongo',
          reference: paymentReference || null,
          received_by: receivedBy || 'paymongo-webhook'
        }
      });
    }

    await tx.billing_invoices.update({
      where: { id: invoice.id },
      data: {
        patient_id: patientId || invoice.patient_id || null,
        appointment_id: appointmentId,
        status: 'Paid',
        total_amount: amountMoney,
        updated_at: new Date()
      }
    });

    if (appointmentId) {
      await syncHmoDataFromAppointmentToInvoice(tx, appointmentId, invoice.id);
    }

    return invoice.id;
  });
}

async function syncHmoDataFromAppointmentToInvoice(tx, appointmentId, invoiceId, opts = {}) {
  const patientIdRaw = opts.patientId || null;
  const patientNameRaw = opts.patientName || null;
  const hmoProvOverride = opts.hmoProvider || null;
  const hmoLoaOverride = opts.hmoLoaNumber || null;
  const hmoCardOverride = opts.hmoCardNumber || null;
  const philhealthOverride = Number.isFinite(Number(opts.philhealthDeduction)) ? Number(opts.philhealthDeduction) : null;
  const loaOverride = Number.isFinite(Number(opts.loaApprovedAmount)) ? Number(opts.loaApprovedAmount) : null;
  const requester = opts.requester || null;
  const fallbackPatientLookup = async () => {
    if (!patientIdRaw) return null;
    const p = await tx.$queryRawUnsafe(`
      SELECT is_hmo, hmo_provider, hmo_card_number, philhealth_amount
      FROM public.patients WHERE id = $1::uuid
    `, String(patientIdRaw)).catch(() => []);
    return Array.isArray(p) && p.length ? p[0] : null;
  };

  try {
    const invRows = invoiceId
      ? await tx.$queryRawUnsafe(`SELECT total_amount, patient_id FROM public.billing_invoices WHERE id = $1::bigint`, invoiceId.toString()).catch(() => [])
      : [];
    const invTotal = Array.isArray(invRows) && invRows.length ? Number(invRows[0].total_amount || 0) : 0;
    const invPatientId = Array.isArray(invRows) && invRows.length ? invRows[0].patient_id : null;

    let hmoProvider = hmoProvOverride;
    let hmoLoaNumber = hmoLoaOverride;
    let hmoCardNumber = hmoCardOverride;
    let philhealthDeduction = philhealthOverride;
    let loaApproved = loaOverride;
    let notes = opts.notes || null;
    let patientFinalId = invPatientId || patientIdRaw || null;
    let patientFinalName = patientNameRaw || null;
    let anyHmoActive = Boolean(hmoProvider) || Boolean(hmoCardNumber) || (philhealthOverride && philhealthOverride > 0) || (loaOverride && loaOverride > 0);

    if (appointmentId) {
      const apptRows = await tx.$queryRawUnsafe(`
        SELECT is_hmo, hmo_provider, hmo_loa_number, hmo_card_number, philhealth_number, philhealth_deduction, hmo_notes, patient_id
        FROM public.appointments
        WHERE id = $1::bigint
      `, appointmentId.toString()).catch(() => []);
      const appt = Array.isArray(apptRows) && apptRows.length ? apptRows[0] : null;
      if (appt && (appt.is_hmo || anyHmoActive)) {
        anyHmoActive = anyHmoActive || Boolean(appt.is_hmo);
        hmoProvider = hmoProvider || appt.hmo_provider;
        hmoLoaNumber = hmoLoaNumber || appt.hmo_loa_number;
        hmoCardNumber = hmoCardNumber || appt.hmo_card_number;
        if (!(philhealthDeduction != null)) philhealthDeduction = Number(appt.philhealth_deduction || 0);
        if (!(loaApproved != null)) loaApproved = invTotal > 0 ? invTotal : null;
        notes = notes || appt.hmo_notes;
        if (!patientFinalId && appt.patient_id) patientFinalId = appt.patient_id;
      }
    } else if (!anyHmoActive) {
      const pRow = await fallbackPatientLookup();
      if (pRow && pRow.is_hmo) {
        anyHmoActive = true;
        hmoProvider = hmoProvider || pRow.hmo_provider;
        hmoCardNumber = hmoCardNumber || pRow.hmo_card_number;
        if (!(philhealthDeduction != null)) philhealthDeduction = Number(pRow.philhealth_amount || 0);
      }
    }

    if (!anyHmoActive || !invoiceId) return;

    const existing = await tx.$queryRawUnsafe(`
      SELECT id, status FROM public.billing_hmo_claims WHERE invoice_id = $1::bigint
    `, invoiceId.toString()).catch(() => []);

    const finalPh = Math.max(0, Number(philhealthDeduction || 0));
    const finalLoa = Math.max(0, Number(loaApproved != null ? loaApproved : invTotal));

    if (Array.isArray(existing) && existing.length > 0) {
      const firstRow = existing[0];
      const firstStatus = String(firstRow.status || '').toLowerCase();
      const shouldReSync =
        firstStatus === 'pending' ||
        firstStatus === 'awaiting loa' ||
        firstStatus === 'paid' ||
        firstStatus === 'ready' ||
        firstStatus === 'for payment' ||
        firstStatus === 'billed' ||
        firstStatus === 'completed' ||
        firstStatus === '';
      if (shouldReSync) {
        await tx.$executeRawUnsafe(`
          UPDATE public.billing_hmo_claims
          SET hmo_provider = COALESCE($1::text, hmo_provider),
              hmo_loa_number = COALESCE($2::text, hmo_loa_number),
              hmo_card_number = COALESCE($3::text, hmo_card_number),
              philhealth_deduction = CASE WHEN philhealth_deduction <= 0 THEN $4::numeric ELSE philhealth_deduction END,
              loa_approved_amount = CASE WHEN loa_approved_amount <= 0 THEN $5::numeric ELSE loa_approved_amount END,
              status = CASE WHEN status = 'Rejected' THEN status ELSE 'Approved' END,
              notes = COALESCE($6::text, notes),
              patient_id = COALESCE($7::uuid, patient_id),
              patient_name = COALESCE($8::text, patient_name),
              requested_by = COALESCE($9::text, requested_by),
              updated_at = now()
          WHERE invoice_id = $10::bigint
        `, hmoProvider || null, hmoLoaNumber || null, hmoCardNumber || null, finalPh, finalLoa, notes || null, patientFinalId || null, patientFinalName || null, requester || null, invoiceId.toString()).catch(() => null);
      }
      return;
    }

    await tx.$executeRawUnsafe(`
      INSERT INTO public.billing_hmo_claims (
        invoice_id, appointment_id, patient_id, patient_name, hmo_provider, hmo_loa_number, hmo_card_number,
        philhealth_deduction, loa_approved_amount, status, notes, requested_by, created_at, updated_at
      ) VALUES (
        $1::bigint, $2::bigint, $3::uuid, $4::text, $5::text, $6::text, $7::text,
        $8::numeric, $9::numeric, 'Approved', $10::text, $11::text, now(), now()
      )
    `,
      invoiceId.toString(),
      appointmentId ? appointmentId.toString() : null,
      patientFinalId || null,
      patientFinalName || null,
      hmoProvider || null,
      hmoLoaNumber || null,
      hmoCardNumber || null,
      finalPh,
      finalLoa,
      notes || null,
      requester || null
    ).catch((e) => console.warn('[syncHmo] per-lab claim insert warn:', e?.message));
  } catch (err) {
    console.error('[Billing Sync] Failed to sync HMO data:', err);
  }
}

module.exports = {
  ensureBillingTablesExist,
  recordLabOrderPayment,
  recordVideoConsultationPayment,
  syncHmoDataFromAppointmentToInvoice,
  toMoney
};
