const crypto = require('crypto');
const prisma = require('../utils/prisma');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function requestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(body || {}))).digest('hex');
}

function actorKey(req) {
  const role = String(req.auth?.role || '').trim().toLowerCase();
  const identity = String(req.auth?.email || req.auth?.id || '').trim().toLowerCase();
  return `${role}:${identity}`;
}

async function readRequest(operation, actor, key) {
  const rows = await prisma.$queryRaw`
    SELECT request_hash AS "requestHash", state, response_status AS "responseStatus",
           response_body AS "responseBody", expires_at AS "expiresAt"
    FROM public.idempotency_requests
    WHERE operation = ${operation} AND actor_key = ${actor} AND idempotency_key = ${key}
    LIMIT 1
  `;
  return Array.isArray(rows) ? rows[0] : null;
}

function requireIdempotency(operation, { waitMs = 5000 } = {}) {
  return async (req, res, next) => {
    const key = String(req.headers['x-idempotency-key'] || '').trim();
    // Backward compatibility for older deployed frontends. Updated clients send
    // a key; keeping this optional avoids interrupting emergency intake during a
    // rolling frontend/backend deployment.
    if (!key) return next();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
      return res.status(400).json({ message: 'Invalid idempotency key.' });
    }

    const actor = actorKey(req);
    if (!req.auth?.role || actor.endsWith(':')) return res.status(401).json({ message: 'Authentication required.' });
    const hash = requestHash(req.body);

    try {
      // Expired rows are safe to remove before claiming a new request key.
      await prisma.$executeRaw`
        DELETE FROM public.idempotency_requests
        WHERE operation = ${operation} AND actor_key = ${actor}
          AND idempotency_key = ${key} AND expires_at <= now()
      `;
      const inserted = await prisma.$queryRaw`
        INSERT INTO public.idempotency_requests
          (operation, actor_key, idempotency_key, request_hash)
        VALUES (${operation}, ${actor}, ${key}, ${hash})
        ON CONFLICT (operation, actor_key, idempotency_key) DO NOTHING
        RETURNING idempotency_key
      `;

      if (!Array.isArray(inserted) || inserted.length === 0) {
        const deadline = Date.now() + waitMs;
        let existing = await readRequest(operation, actor, key);
        if (existing && existing.requestHash !== hash) {
          return res.status(409).json({ message: 'This submission key was already used with different data.' });
        }
        while (existing?.state === 'processing' && Date.now() < deadline) {
          await sleep(200);
          existing = await readRequest(operation, actor, key);
        }
        if (existing?.state === 'completed') {
          res.set('x-idempotency-replayed', 'true');
          return res.status(Number(existing.responseStatus || 200)).json(existing.responseBody);
        }
        res.set('retry-after', '1');
        return res.status(409).json({ message: 'This submission is still processing. Please retry shortly.' });
      }

      const originalJson = res.json.bind(res);
      let finalized = false;
      res.json = (body) => {
        if (finalized) return originalJson(body);
        finalized = true;
        const status = Number(res.statusCode || 200);
        const complete = status >= 200 && status < 300;
        const persist = complete
          ? prisma.$executeRaw`
              UPDATE public.idempotency_requests
              SET state = 'completed', response_status = ${status}, response_body = ${JSON.stringify(body ?? null)}::jsonb,
                  completed_at = now(), expires_at = now() + interval '24 hours'
              WHERE operation = ${operation} AND actor_key = ${actor} AND idempotency_key = ${key}
            `
          : prisma.$executeRaw`
              DELETE FROM public.idempotency_requests
              WHERE operation = ${operation} AND actor_key = ${actor} AND idempotency_key = ${key}
            `;
        Promise.resolve(persist)
          .catch((error) => console.error('[idempotency] Unable to finalize request:', error?.message || error))
          .finally(() => originalJson(body));
        return res;
      };
      next();
    } catch (error) {
      console.error('[idempotency] Guard unavailable:', error?.message || error);
      return res.status(503).json({ message: 'Submission protection is temporarily unavailable. Please retry.' });
    }
  };
}

module.exports = requireIdempotency;
module.exports.__test = { actorKey, requestHash, stableValue };
