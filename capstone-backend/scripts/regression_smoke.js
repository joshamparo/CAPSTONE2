const http = require('http');

const HOST = process.env.SMOKE_HOST || 'localhost';
const PORT = Number(process.env.SMOKE_PORT || process.env.PORT || 5000);

function requestJson({ method, path, headers = {}, body }) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const h = { ...headers };
  if (payload) {
    h['Content-Type'] = 'application/json';
    h['Content-Length'] = payload.length;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        method,
        path,
        headers: h
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_) {
            json = null;
          }
          resolve({ status: res.statusCode || 0, json, text: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const health = await requestJson({ method: 'GET', path: '/api/health' });
  assert(health.status === 200, `Expected 200 for /api/health, got ${health.status}`);
  assert(health.json && health.json.ok === true, 'Expected /api/health to return {ok:true}');

  const r1 = await requestJson({ method: 'GET', path: '/api/staff' });
  assert(r1.status === 401, `Expected 401 for /api/staff without role, got ${r1.status}`);

  const r2 = await requestJson({ method: 'GET', path: '/api/staff', headers: { 'x-user-role': 'admin' } });
  assert(r2.status === 200, `Expected 200 for /api/staff with admin, got ${r2.status}`);
  assert(Array.isArray(r2.json), 'Expected staff list to be an array');

  const stats1 = await requestJson({ method: 'GET', path: '/api/stats/admin-overview' });
  assert(stats1.status === 401, `Expected 401 for /api/stats/admin-overview without role, got ${stats1.status}`);

  const stats2 = await requestJson({ method: 'GET', path: '/api/stats/admin-overview', headers: { 'x-user-role': 'admin' } });
  assert(stats2.status === 200, `Expected 200 for /api/stats/admin-overview with admin, got ${stats2.status}`);
  assert(stats2.json && typeof stats2.json === 'object', 'Expected admin-overview to return an object');

  const month = new Date().toISOString().slice(0, 7);
  const sym1 = await requestJson({ method: 'GET', path: `/api/stats/symptom-insights?month=${encodeURIComponent(month)}` });
  assert(sym1.status === 401, `Expected 401 for /api/stats/symptom-insights without role, got ${sym1.status}`);

  const sym2 = await requestJson({
    method: 'GET',
    path: `/api/stats/symptom-insights?month=${encodeURIComponent(month)}`,
    headers: { 'x-user-role': 'admin' }
  });
  assert(sym2.status === 200, `Expected 200 for /api/stats/symptom-insights with admin, got ${sym2.status}`);
  assert(sym2.json && typeof sym2.json === 'object', 'Expected symptom-insights to return an object');

  const apt1 = await requestJson({ method: 'GET', path: '/api/appointments?take=1' });
  assert(apt1.status === 401, `Expected 401 for /api/appointments without role, got ${apt1.status}`);

  const apt2 = await requestJson({ method: 'GET', path: '/api/appointments?take=1', headers: { 'x-user-role': 'nurse' } });
  assert(apt2.status === 200, `Expected 200 for /api/appointments with nurse, got ${apt2.status}`);
  assert(Array.isArray(apt2.json), 'Expected appointments to be an array');

  const ward1 = await requestJson({ method: 'GET', path: '/api/wards' });
  assert(ward1.status === 401, `Expected 401 for /api/wards without role, got ${ward1.status}`);

  const ward2 = await requestJson({ method: 'GET', path: '/api/wards', headers: { 'x-user-role': 'nurse' } });
  assert(ward2.status === 200, `Expected 200 for /api/wards with nurse, got ${ward2.status}`);
  assert(Array.isArray(ward2.json), 'Expected wards to be an array');

  const sup1 = await requestJson({ method: 'GET', path: '/api/supplies' });
  assert(sup1.status === 401, `Expected 401 for /api/supplies without role, got ${sup1.status}`);

  const sup2 = await requestJson({ method: 'GET', path: '/api/supplies', headers: { 'x-user-role': 'pharmacist' } });
  assert(sup2.status === 200, `Expected 200 for /api/supplies with pharmacist, got ${sup2.status}`);
  assert(Array.isArray(sup2.json) || (sup2.json && typeof sup2.json === 'object'), 'Expected supplies to return JSON');

  const inv1 = await requestJson({ method: 'GET', path: '/api/inventory' });
  assert(inv1.status === 401, `Expected 401 for /api/inventory without role, got ${inv1.status}`);

  const inv2 = await requestJson({ method: 'GET', path: '/api/inventory', headers: { 'x-user-role': 'pharmacist' } });
  assert(inv2.status === 200, `Expected 200 for /api/inventory with pharmacist, got ${inv2.status}`);
  assert(Array.isArray(inv2.json) || (inv2.json && typeof inv2.json === 'object'), 'Expected inventory to return JSON');

  const maybeApt = Array.isArray(apt2.json) ? apt2.json[0] : null;
  const maybeId = maybeApt && (maybeApt.id || maybeApt._id);
  if (maybeId && /^\d+$/.test(String(maybeId))) {
    const triage = await requestJson({
      method: 'POST',
      path: `/api/appointments/${encodeURIComponent(String(maybeId))}/triage/ai`,
      headers: { 'x-user-role': 'nurse' }
    });
    assert(triage.status !== 401, `Expected triage AI not to be 401 with nurse, got ${triage.status}`);
    assert(
      triage.status === 200 || triage.status === 404,
      `Expected 200 or 404 for triage AI on appointment ${maybeId}, got ${triage.status}`
    );
  }

  const r3 = await requestJson({ method: 'GET', path: '/api/clinical-orders?role=medtech&take=1' });
  assert(r3.status === 401, `Expected 401 for /api/clinical-orders without role, got ${r3.status}`);

  const r4 = await requestJson({
    method: 'GET',
    path: '/api/clinical-orders?role=medtech&take=1',
    headers: { 'x-user-role': 'medtech' }
  });
  assert(r4.status === 200, `Expected 200 for /api/clinical-orders with role, got ${r4.status}`);

  const r5 = await requestJson({
    method: 'GET',
    path: '/api/clinical-schedule?role=medtech&take=1',
    headers: { 'x-user-role': 'medtech' }
  });
  assert(r5.status === 200, `Expected 200 for /api/clinical-schedule with role, got ${r5.status}`);

  const r6 = await requestJson({
    method: 'OPTIONS',
    path: '/api/clinical-orders',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-user-role'
    }
  });
  assert(r6.status !== 401, `Expected OPTIONS preflight not to be 401, got ${r6.status}`);

  process.stdout.write(`regression_smoke: OK (host=${HOST} port=${PORT})\n`);
}

main().catch((err) => {
  process.stderr.write(`regression_smoke: FAIL: ${err.message}\n`);
  process.exit(1);
});

