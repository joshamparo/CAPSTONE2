const test = require('node:test');
const assert = require('node:assert/strict');
const { uploadProductImage } = require('../utils/productImageStorage');

function fakeClient({ bucketPublic = true } = {}) {
  const calls = [];
  const bucketApi = {
    upload: async (path, buffer, options) => {
      calls.push({ type: 'upload', path, buffer, options });
      return { data: { path }, error: null };
    },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.example/${path}` } })
  };
  return {
    calls,
    storage: {
      getBucket: async () => ({ data: { public: bucketPublic }, error: null }),
      updateBucket: async (bucket, options) => { calls.push({ type: 'updateBucket', bucket, options }); return { error: null }; },
      createBucket: async (bucket, options) => { calls.push({ type: 'createBucket', bucket, options }); return { error: null }; },
      from: () => bucketApi
    }
  };
}

test('product images upload to persistent HTTPS storage', async () => {
  const client = fakeClient();
  const result = await uploadProductImage({
    file: { buffer: Buffer.from('image'), mimetype: 'image/png' },
    folder: 'medicines',
    ownerId: '42',
    env: { SUPABASE_PRODUCT_IMAGES_BUCKET: 'product-images' },
    client
  });
  assert.match(result.url, /^https:\/\/storage\.example\/medicines\/42-/);
  assert.match(result.path, /^medicines\/42-[a-zA-Z0-9-]+\.png$/);
  assert.equal(client.calls.filter((call) => call.type === 'upload').length, 1);
});

test('product image upload rejects unsupported content types', async () => {
  await assert.rejects(
    uploadProductImage({ file: { buffer: Buffer.from('x'), mimetype: 'text/html' }, client: fakeClient() }),
    /JPG, PNG, WebP, or GIF/
  );
});

test('product image bucket is made public for browser display', async () => {
  const client = fakeClient({ bucketPublic: false });
  await uploadProductImage({
    file: { buffer: Buffer.from('image'), mimetype: 'image/webp' },
    folder: 'categories', ownerId: 'category', client, env: {}
  });
  assert.equal(client.calls.some((call) => call.type === 'updateBucket' && call.options.public === true), true);
});
