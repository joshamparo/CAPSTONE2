const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../utils/migrateLabStorage');
const { PRIVATE_BUCKET } = require('../utils/labStorage');
const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_LAB_RESULTS_BUCKET: 'lab-results' };
const key = 'lab-results/patient/report.pdf';
const source = Buffer.from('%PDF-1.4\nsource content');
function fixture({ corrupt = false } = {}) {
  let destination;
  let removed = false;
  const statements = [];
  const db = { query: async (sql) => { statements.push(sql); return { rows: sql.startsWith('SELECT') ? [{ name: key }] : [] }; } };
  const sb = { storage: {
    getBucket: async () => ({ data: { public: false } }),
    from: bucket => ({
      upload: async (_key, buffer) => { destination = corrupt ? Buffer.from('%PDF-1.4\nwrong bytes') : buffer; return {}; },
      createSignedUrl: async () => ({ data: { signedUrl: `${env.SUPABASE_URL}/${bucket}` } }),
      remove: async () => { assert.ok(destination); removed = true; return {}; }
    })
  } };
  return { db, sb, statements, wasRemoved: () => removed, download: async (url) => new Response(url.endsWith(PRIVATE_BUCKET) ? destination : source) };
}
test('migration dry run reports candidates without changing policy or storage', async () => {
  const f = fixture();
  const result = await migrate({ ...f, env });
  assert.equal(result.candidates, 1);
  assert.equal(f.statements.length, 1);
  assert.equal(f.wasRemoved(), false);
});
test('migration verifies private bytes before removing the legacy public source', async () => {
  const f = fixture(); const original = global.fetch; global.fetch = f.download;
  try {
    const result = await migrate({ ...f, env, apply: true });
    assert.equal(result.removed, 1);
    assert.equal(f.wasRemoved(), true);
    assert.ok(f.statements.some(sql => sql.includes('AS RESTRICTIVE FOR ALL TO public')));
  } finally { global.fetch = original; }
});
test('a mismatching private copy never causes removal of the original file', async () => {
  const f = fixture({ corrupt: true }); const original = global.fetch; global.fetch = f.download;
  try {
    await assert.rejects(migrate({ ...f, env, apply: true }), /verification failed/);
    assert.equal(f.wasRemoved(), false);
  } finally { global.fetch = original; }
});
