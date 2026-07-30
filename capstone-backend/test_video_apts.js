const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const apts = await prisma.appointments.findMany({
    where: { consultation_mode: 'video' },
    select: { id: true, first_name: true, status: true, doctor_id: true, doctor_uuid: true }
  });
  console.log('Video appointments in appointments table:', apts.map(a => ({...a, id: a.id.toString()})));

  const holds = await prisma.video_booking_holds.findMany({
    select: { id: true, doctor_name: true, status: true, appointment_id: true }
  });
  console.log('Holds:', holds.map(h => ({...h, id: h.id.toString(), appointment_id: h.appointment_id?.toString()})));
}
main().catch(console.error).finally(() => prisma.$disconnect());