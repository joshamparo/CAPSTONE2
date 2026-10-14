const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SESSION_SECRET = 'assistant-route-test-secret';
process.env.ASSISTANT_RATE_LIMIT_MAX = '50';
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

test('signed patient sessions keep patient assistant scope', async () => {
  const token = createSessionToken({ id: 'patient-1', email: 'patient@example.com', role: 'patient', sessionVersion: 0 });
  const response = await ask({
    role: 'admin',
    pathname: '/admin',
    messages: [{ role: 'user', content: 'What can I do here?' }]
  }, { Authorization: `Bearer ${token}` });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.role, 'patient');
  assert.equal(data.pathname, '/patient');
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

test('price matching returns the requested service instead of the first price entry', async () => {
  const cases = [
    ['Magkano ang chest xray?', /Chest X-ray/i, /₱600/],
    ['Magkano bunot ng ngipin?', /Tooth Extraction|Simple Extraction/i, /₱1,500/],
    ['How much is an annual physical?', /Annual Physical/i, /₱2,300/]
  ];

  for (const [question, servicePattern, pricePattern] of cases) {
    const response = await ask({ messages: [{ role: 'user', content: question }] });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.match(data.answer, servicePattern);
    assert.match(data.answer, pricePattern);
    assert.doesNotMatch(data.answer, /\*\*/);
  }
});

test('operational answers do not claim live queue data or guaranteed turnaround', async () => {
  const queueResponse = await ask({ messages: [{ role: 'user', content: 'What is the current queue waiting time?' }] });
  assert.equal(queueResponse.status, 200);
  const queueData = await queueResponse.json();
  assert.match(queueData.answer, /wala pang access|no access|live queue/i);
  assert.doesNotMatch(queueData.answer, /45 min|1\.5 hrs|100%/i);

  const resultResponse = await ask({ messages: [{ role: 'user', content: 'Nasaan result ng lab ko?' }] });
  assert.equal(resultResponse.status, 200);
  const resultData = await resultResponse.json();
  assert.match(resultData.answer, /estimate|confirm|kumpirmahin/i);
  assert.doesNotMatch(resultData.answer, /100%/i);
});
