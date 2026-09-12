const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { parseReference, readMedicalFile, createMedicalFileUrl, writeMedicalFile, MAX_BYTES, ensurePrivateBucket, PRIVATE_BUCKET } = require('../utils/labStorage');
const env = { SUPABASE_URL: 'https://project.supabase.co' };
const pdf = Buffer.from('%PDF-1.4\nmedical fixture');
test('legacy medical URLs resolve to storage without fetching their supplied host', () => {
  assert.deepEqual(parseReference('https://old.example/uploads/lab-results/file.pdf', env), { kind: 'local', key: 'file.pdf' });
  assert.deepEqual(parseReference('https://project.supabase.co/storage/v1/object/public/lab-results/lab-results/p1/file.pdf', env), { kind: 'storage', bucket: 'lab-results', key: 'lab-results/p1/file.pdf' });
});
test('external, private-address, traversal, and nonmedical storage references are rejected', () => {
  for (const url of ['http://169.254.169.254/latest/meta-data', 'https://evil.example/a.pdf', 'lab-local:../secret', 'lab-local:%2e%2e%2fsecret', 'lab-storage:lab-results/p/../secret', 'https://project.supabase.co/storage/v1/object/public/avatars/lab-results/a.pdf']) {
    assert.throws(() => parseReference(url, env));
  }
});
test('private local files are read with content validation and a size bound', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-storage-'));
  try {
    await fs.writeFile(path.join(directory, 'fixture.pdf'), pdf);
    const file = await readMedicalFile('lab-local:fixture.pdf', null, { localRoot: directory });
    assert.deepEqual(file.buffer, pdf);
    assert.equal(file.mimeType, 'application/pdf');
    await fs.writeFile(path.join(directory, 'fake.pdf'), '<html>not a PDF</html>');
    await assert.rejects(readMedicalFile('lab-local:fake.pdf', null, { localRoot: directory }));
    const handle = await fs.open(path.join(directory, 'large.pdf'), 'w');
    await handle.truncate(MAX_BYTES + 1); await handle.close();
    await assert.rejects(readMedicalFile('lab-local:large.pdf', null, { localRoot: directory }), /size limit/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('lab-storage-'));
    await fs.rm(directory, { recursive: true });
  }
});
const storage = { storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: env.SUPABASE_URL + '/storage/v1/object/sign/private-lab-results/lab-results/p/file.pdf?token=short' } }) }) } };
test('patient clients receive a short-lived private storage URL they can open', async () => {
  const url = await createMedicalFileUrl('lab-storage:lab-results/p/file.pdf', storage, 300, { env });
  assert.equal(url, env.SUPABASE_URL + '/storage/v1/object/sign/private-lab-results/lab-results/p/file.pdf?token=short');
});
test('storage downloads prohibit redirects and retain timeouts through body consumption', async () => {
  const file = await readMedicalFile('lab-storage:lab-results/p/file.pdf', storage, { env, fetch: async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, false);
    return new Response(pdf);
  } });
  assert.deepEqual(file.buffer, pdf);
});
test('streamed medical downloads stop when their byte limit is exceeded', async () => {
  await assert.rejects(readMedicalFile('lab-storage:lab-results/p/file.pdf', storage, { env, fetch: async () => ({ ok: true, headers: new Headers(), body: (async function* () { yield Buffer.alloc(MAX_BYTES); yield Buffer.alloc(1); })() }) }), /size limit/);
});
test('uploads fail closed when the dedicated medical bucket is public', async () => {
  await assert.rejects(ensurePrivateBucket({ storage: { getBucket: async () => ({ data: { public: true } }) } }), /must be private/);
});
test('a new upload stays private and can be read back for viewing and verification', async () => {
  const patient = '11111111-1111-4111-8111-111111111111';
  let uploaded;
  const sb = { storage: {
    getBucket: async () => ({ data: { public: false } }),
    from: bucket => {
      assert.equal(bucket, PRIVATE_BUCKET);
      return {
        upload: async (key, buffer, options) => {
          assert.ok(key.startsWith(`lab-results/${patient}/`));
          assert.equal(options.upsert, false);
          assert.equal(options.contentType, 'application/pdf');
          uploaded = buffer;
          return {};
        },
        createSignedUrl: async () => ({ data: { signedUrl: env.SUPABASE_URL + '/private-download' } })
      };
    }
  } };
  const reference = await writeMedicalFile(sb, patient, 'report.pdf', pdf);
  assert.ok(reference.url.startsWith('lab-storage:'));
  assert.equal(reference.url.includes('http'), false);
  const file = await readMedicalFile(reference.url, sb, { env, fetch: async () => new Response(uploaded) });
  assert.deepEqual(file.buffer, pdf);
});
