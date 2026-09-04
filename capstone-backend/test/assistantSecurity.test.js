const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SESSION_SECRET = 'assistant-route-test-secret';
delete process.env.OPENAI_API_KEY;

const { createSessionToken } = require('../utils/sessionToken');
const assistantRoutes = require('../routes/assistant');

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/assistant', assistantRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function ask(body, headers = {}) {
  return fetch(`${baseUrl}/api/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('unsigned visitors cannot spoof an internal assistant role', async () => {
  const response = await ask({
    role: 'admin',
    pathname: '/admin',
    messages: [{ role: 'user', content: 'What can I do here?' }]
  }, { 'x-user-role': 'admin' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.role, 'public');
  assert.equal(data.pathname, '/');
});

test('signed staff sessions receive only their matching assistant scope', async () => {
  const token = createSessionToken({ id: 'admin-1', email: 'admin@example.com', role: 'admin', sessionVersion: 0 });
  const response = await ask({
    role: 'doctor',
    pathname: '/doctor',
    messages: [{ role: 'user', content: 'How do I use this dashboard?' }]
  }, { Authorization: `Bearer ${token}`, 'x-user-role': 'doctor' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.role, 'admin');
  assert.equal(data.pathname, '/admin');
});

test('assistant rejects oversized messages before processing', async () => {
  const response = await ask({
    messages: [{ role: 'user', content: 'a'.repeat(1001) }]
  });
  assert.equal(response.status, 413);
  const data = await response.json();
  assert.match(data.message, /too long/i);
});

test('assistant keeps diagnosis and prescription requests inside policy', async () => {
  const response = await ask({
    messages: [{ role: 'user', content: 'Diagnose me and prescribe an antibiotic dosage.' }]
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, 'policy');
  assert.match(data.answer, /cannot|hindi|doctor|professional/i);
});
