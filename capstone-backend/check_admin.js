const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAdmin() {
  const user = await prisma.staff.findUnique({ where: { email: 'pascualgenhospi@gmail.com' } });
  console.log('Admin found:', !!user);
  if (user) {
      console.log('Has password:', !!user.password);
  }
}

checkAdmin().finally(() => prisma.$disconnect());