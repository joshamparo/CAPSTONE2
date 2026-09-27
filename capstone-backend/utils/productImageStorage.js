const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BUCKET = 'product-images';
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif']
]);

let cachedClient = null;
let cachedConfig = '';
let readyBucketsByClient = new WeakMap();

function getStorageClient(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  const config = `${url}|${key}`;
  if (!cachedClient || cachedConfig !== config) {
    cachedClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    cachedConfig = config;
    readyBucketsByClient = new WeakMap();
  }
  return cachedClient;
}

async function ensurePublicBucket(client, bucket) {
  let readyBuckets = readyBucketsByClient.get(client);
  if (!readyBuckets) {
    readyBuckets = new Set();
    readyBucketsByClient.set(client, readyBuckets);
  }
  if (readyBuckets.has(bucket)) return;
  const info = await client.storage.getBucket(bucket);
  if (info?.error) {
    const created = await client.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: Array.from(MIME_EXTENSIONS.keys())
    });
    if (created?.error) throw created.error;
  } else if (info?.data && info.data.public !== true) {
    const updated = await client.storage.updateBucket(bucket, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: Array.from(MIME_EXTENSIONS.keys())
    });
    if (updated?.error) throw updated.error;
  }
  readyBuckets.add(bucket);
}

function safeSegment(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

async function uploadProductImage({ file, folder, ownerId, env = process.env, client = null }) {
  if (!file?.buffer) throw Object.assign(new Error('No image was uploaded.'), { statusCode: 400 });
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = MIME_EXTENSIONS.get(mime);
  if (!ext) throw Object.assign(new Error('Image must be a JPG, PNG, WebP, or GIF.'), { statusCode: 400 });

  const storageClient = client || getStorageClient(env);
  if (!storageClient) throw Object.assign(new Error('Product image storage is not configured.'), { statusCode: 503 });

  const bucket = String(env.SUPABASE_PRODUCT_IMAGES_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  await ensurePublicBucket(storageClient, bucket);
  const objectPath = `${safeSegment(folder, 'products')}/${safeSegment(ownerId, 'item')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const uploaded = await storageClient.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: false
  });
  if (uploaded?.error) throw uploaded.error;

  const publicUrl = storageClient.storage.from(bucket).getPublicUrl(objectPath)?.data?.publicUrl;
  if (!publicUrl || !String(publicUrl).startsWith('https://')) {
    throw new Error('Unable to generate a secure product image URL.');
  }
  return { url: String(publicUrl), bucket, path: objectPath };
}

module.exports = { uploadProductImage, _productImageStorageTest: { ensurePublicBucket, safeSegment, MIME_EXTENSIONS } };
