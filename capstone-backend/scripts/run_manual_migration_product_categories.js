const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean)
    .filter((s) => {
      const t = s.trim().toUpperCase();
      return t !== 'BEGIN' && t !== 'COMMIT';
    });
}

async function main() {
  const filePath = path.join(__dirname, '..', 'prisma', 'manual_migration_product_categories.sql');
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = splitSqlStatements(sql);

  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      const firstLine = stmt.split(/\r?\n/)[0] || '';
      process.stdout.write(`OK: ${firstLine.slice(0, 120)}\n`);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.toLowerCase().includes('already exists')) continue;
      throw e;
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    process.stderr.write(`${e && e.message ? e.message : e}\n`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });

