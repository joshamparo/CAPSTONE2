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

async function syncHmoDataFromAppointmentToInvoice(tx, appointmentId, invoiceId) {
  if (!appointmentId || !invoiceId) return;
  try {
    const apptRows = await tx.$queryRawUnsafe(`
      SELECT is_hmo, hmo_provider, hmo_loa_number, hmo_card_number, philhealth_number, philhealth_deduction, hmo_notes
      FROM public.appointments
      WHERE id = $1::bigint
    `, appointmentId.toString());
    const appt = Array.isArray(apptRows) && apptRows.length ? apptRows[0] : null;

    if (appt && appt.is_hmo) {
      // Get invoice total to set as default approved amount for consultation fees
      const invRows = await tx.$queryRawUnsafe(`
        SELECT total_amount FROM public.billing_invoices WHERE id = $1::bigint
      `, invoiceId.toString());
      const invTotal = Array.isArray(invRows) && invRows.length ? Number(invRows[0].total_amount || 0) : 0;

      const existing = await tx.$queryRawUnsafe(`
        SELECT id FROM public.billing_hmo_claims WHERE invoice_id = $1::bigint
      `, invoiceId.toString());

      if (Array.isArray(existing) && existing.length > 0) {
        // Update existing claim if it's still pending
        await tx.$executeRawUnsafe(`
          UPDATE public.billing_hmo_claims
          SET hmo_provider = COALESCE(hmo_provider, $1::text),
              hmo_loa_number = COALESCE(hmo_loa_number, $2::text),
              hmo_card_number = COALESCE(hmo_card_number, $3::text),
              philhealth_deduction = CASE WHEN philhealth_deduction = 0 THEN $4::numeric ELSE philhealth_deduction END,
              loa_approved_amount = CASE WHEN loa_approved_amount = 0 THEN $5::numeric ELSE loa_approved_amount END,
              notes = COALESCE(notes, $6::text),
              updated_at = now()
          WHERE invoice_id = $7::bigint AND status = 'Pending'
        `, appt.hmo_provider, appt.hmo_loa_number, appt.hmo_card_number, appt.philhealth_deduction || 0, invTotal, appt.hmo_notes, invoiceId.toString());
      } else {
        // Create new claim from appointment data
        await tx.$executeRawUnsafe(`
          INSERT INTO public.billing_hmo_claims (
            invoice_id, hmo_provider, hmo_loa_number, hmo_card_number, 
            philhealth_deduction, loa_approved_amount, status, notes, created_at, updated_at
          ) VALUES (
            $1::bigint, $2::text, $3::text, $4::text, 
            $5::numeric, $6::numeric, 'Approved', $7::text, now(), now()
          )
        `, invoiceId.toString(), appt.hmo_provider, appt.hmo_loa_number, appt.hmo_card_number, appt.philhealth_deduction || 0, invTotal, appt.hmo_notes);
      }
    }
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
