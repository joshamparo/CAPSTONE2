const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SESSION_SECRET = 'doctor-chat-route-test-secret';

const { createSessionToken } = require('../utils/sessionToken');
const doctorChatRoutes = require('../routes/doctorChat');

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/doctor-chat', doctorChatRoutes);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('doctor chat rejects unauthenticated requests', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/doctor-chat/health`);
    assert.equal(response.status, 401);
  });
});

test('doctor chat rejects a signed patient session even with spoofed doctor headers', async () => {
  const token = createSessionToken({ id: 'patient-1', email: 'patient@example.com', role: 'patient' });
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/doctor-chat/health`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-user-role': 'doctor',
        'x-user-email': 'doctor@example.com'
      }
    });
    assert.equal(response.status, 403);
  });
});

test('doctor chat accepts a signed doctor session', async () => {
  const token = createSessionToken({ id: 'doctor-1', email: 'doctor@example.com', role: 'doctor' });
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/doctor-chat/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  });
});
