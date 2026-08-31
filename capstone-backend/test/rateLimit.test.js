const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../utils/rateLimit');

test('rate limiter blocks repeated attempts for the same client key', () => {
  const middleware = createRateLimiter({ windowMs: 60000, max: 2, key: (req) => req.body.email });
  const req = { ip: '127.0.0.1', body: { email: 'nurse@example.com' } };
  const response = () => ({
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });
  let passes = 0;
  middleware(req, response(), () => { passes += 1; });
  middleware(req, response(), () => { passes += 1; });
  const blocked = response();
  middleware(req, blocked, () => { passes += 1; });
  assert.equal(passes, 2);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
});
