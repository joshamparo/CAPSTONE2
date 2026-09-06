'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATION_DIRECTORY = path.join(__dirname, '..', 'prisma');
const MIGRATION_PATTERN = /^manual_migration_[a-z0-9_]+\.sql$/i;
const LOCK_KEY = 2077461107;

function migrationFiles() {
  return fs.readdirSync(MIGRATION_DIRECTORY)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right));
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function isSafeAutomaticMigration(sql) {
  const withoutComments = String(sql || '').replace(/--[^\r\n]*/g, ' ');
  return !/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+[^;]+\s+SET|INSERT\s+INTO)\b/i.test(withoutComments);
}

function databaseUrl() {
  return String(process.env.DIRECT_URL || process.env.DATABASE_URL || '').trim();
}

async function bootstrapSchema({ strict = process.env.SCHEMA_BOOTSTRAP_STRICT === 'true' } = {}) {
  const connectionString = databaseUrl();
  if (!connectionString) {
    console.warn('[Schema bootstrap] Skipped: DATABASE_URL/DIRECT_URL is not configured.');
    return { ok: false, skipped: true, applied: [], reason: 'missing_database_url' };
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
    application_name: 'pascualinga-schema-bootstrap'
  });
  const applied = [];
  const skipped = [];
  const manual = [];

  try {
    await client.connect();
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_bootstrap_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const filename of migrationFiles()) {
      const fullPath = path.join(MIGRATION_DIRECTORY, filename);
      const sql = fs.readFileSync(fullPath, 'utf8').trim();
      if (!sql) continue;
      if (!isSafeAutomaticMigration(sql)) {
        manual.push(filename);
        console.warn(`[Schema bootstrap] Manual review required; not auto-applied: ${filename}`);
        continue;
      }
      const digest = checksum(sql);
      const previous = await client.query(
        'SELECT checksum FROM public.schema_bootstrap_migrations WHERE filename = $1 LIMIT 1',
        [filename]
      );
      if (previous.rows[0]?.checksum === digest) {
        skipped.push(filename);
        continue;
      }

      await client.query(sql);
      await client.query(`
        INSERT INTO public.schema_bootstrap_migrations (filename, checksum, applied_at)
        VALUES ($1, $2, now())
        ON CONFLICT (filename)
        DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = EXCLUDED.applied_at
      `, [filename, digest]);
      applied.push(filename);
    }

    console.log(`[Schema bootstrap] Ready: ${applied.length} applied, ${skipped.length} already current, ${manual.length} manual.`);
    return { ok: true, applied, skipped, manual };
  } catch (error) {
    console.error('[Schema bootstrap] Migration check failed:', String(error?.message || error));
    if (strict) throw error;
    return { ok: false, applied, skipped, manual, reason: 'migration_failed' };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  bootstrapSchema().catch((error) => {
    console.error('[Schema bootstrap] Fatal:', String(error?.message || error));
    process.exitCode = 1;
  });
}

module.exports = { bootstrapSchema, checksum, isSafeAutomaticMigration, migrationFiles };
