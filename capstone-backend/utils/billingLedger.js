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

    return invoice.id;
  });
}

module.exports = {
  ensureBillingTablesExist,
  recordLabOrderPayment,
  recordVideoConsultationPayment,
  toMoney
};
