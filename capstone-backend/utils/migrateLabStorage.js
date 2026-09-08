require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { PRIVATE_BUCKET, ensurePrivateBucket, readMedicalFile } = require('./labStorage');

const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// Every public source is removed only after a private copy has been downloaded
// and matched byte-for-byte. Existing database URLs stay valid via labStorage.
async function migrate({ db, sb, env, apply = false }) {
  const legacyBucket = env.SUPABASE_LAB_RESULTS_BUCKET || env.SUPABASE_STORAGE_BUCKET || 'lab-results';
  const objects = await db.query('SELECT name FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2 ORDER BY name', [legacyBucket, 'lab-results/%']);
  const result = { apply, candidates: objects.rows.length, copied: 0, removed: 0 };
  if (!apply) return result;
  await ensurePrivateBucket(sb);
  // Restrictive policies are ANDed with existing permissive policies. Browser
  // anon/authenticated roles cannot read or alter medical objects directly.
  // Supabase's service_role retains its BYPASSRLS server-side access.
  const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
  const condition = `bucket_id <> ${quote(PRIVATE_BUCKET)} AND NOT (bucket_id = ${quote(legacyBucket)} AND name LIKE 'lab-results/%')`;
  await db.query('BEGIN');
  try {
    await db.query('DROP POLICY IF EXISTS pascualinga_private_medical_objects ON storage.objects');
    await db.query(`CREATE POLICY pascualinga_private_medical_objects ON storage.objects AS RESTRICTIVE FOR ALL TO public USING (${condition}) WITH CHECK (${condition})`);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  if (legacyBucket === PRIVATE_BUCKET) return result;
  for (const { name } of objects.rows) {
    const legacyUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(legacyBucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;
    // Read the actual source rather than a pre-existing destination copy.
    const sourceClient = { storage: { from: (bucket) => bucket === PRIVATE_BUCKET
      ? { createSignedUrl: async () => ({ error: true }) }
      : sb.storage.from(bucket) } };
    const source = await readMedicalFile(legacyUrl, sourceClient, { env });
    const upload = await sb.storage.from(PRIVATE_BUCKET).upload(name, source.buffer, { contentType: source.mimeType, upsert: false, cacheControl: '0' });
    // A retry may encounter an existing destination. Always compare its bytes.
    const destination = await readMedicalFile(`lab-storage:${name}`, sb, { env });
    if (hash(source.buffer) !== hash(destination.buffer)) throw new Error('Private copy verification failed; the public source was retained.');
    if (!upload.error) result.copied++;
    const removed = await sb.storage.from(legacyBucket).remove([name]);
    if (removed.error) throw new Error('Private copy is verified, but public source removal failed. Retry migration.');
    result.removed++;
  }
  return result;
}

async function main() {
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DATABASE_URL) throw new Error('Storage and database configuration are required.');
  const db = new Client({ connectionString: env.DATABASE_URL });
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await db.connect();
  try { console.log(JSON.stringify(await migrate({ db, sb, env, apply: process.argv.includes('--apply') }))); }
  finally { await db.end(); }
}
if (require.main === module) main().catch(() => { console.error('Medical storage migration failed. Sources are retained unless their private copy was verified. Check configuration and rerun.'); process.exitCode = 1; });
module.exports = { migrate };
