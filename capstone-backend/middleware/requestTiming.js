function normalizeThreshold(value, fallback = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(100, Math.min(60000, Math.round(parsed)));
}

function createRequestTiming({ logger = console, thresholdMs = 1000, logAll = false, now = () => process.hrtime.bigint() } = {}) {
  const threshold = normalizeThreshold(thresholdMs);
  return (req, res, next) => {
    const startedAt = now();
    res.once('finish', () => {
      const elapsedMs = Number(now() - startedAt) / 1e6;
      if (!logAll && elapsedMs < threshold) return;
      const path = String(req.path || req.route?.path || '/').split('?')[0].slice(0, 180);
      const size = Number(res.getHeader?.('Content-Length')) || null;
      logger.info('[API timing]', {
        method: String(req.method || 'GET').toUpperCase(),
        path,
        status: Number(res.statusCode || 0),
        durationMs: Math.round(elapsedMs),
        responseBytes: size
      });
    });
    next();
  };
}

module.exports = { createRequestTiming, normalizeThreshold };
