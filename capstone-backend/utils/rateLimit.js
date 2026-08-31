function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, key = () => '' } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const rawKey = String(key(req) || '').trim().toLowerCase();
    const clientKey = `${String(req.ip || req.socket?.remoteAddress || 'unknown')}:${rawKey}`;
    const current = buckets.get(clientKey);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    buckets.set(clientKey, bucket);
    if (buckets.size > 5000) {
      for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
    }
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Too many attempts. Please wait before trying again.' });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
