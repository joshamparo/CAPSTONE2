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

test('assistant accepts only a bounded safe current module label', async () => {
  const response = await ask({ currentModule: '<script>Patient Queue</script>'.repeat(20), messages: [{ role: 'user', content: 'How do I use this page?' }] });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(String(data.currentModule || '').length <= 80);
  assert.doesNotMatch(String(data.currentModule || ''), /[<>]/);
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

test('assistant handles basic casual conversation naturally in English and Tagalog', async () => {
  const cases = [
    ['How are you?', /doing well|ready to help/i],
    ['Kumusta ka?', /mabuti|handa akong tumulong/i],
    ['hii', /hello|how can i help/i],
    ['helloooo po', /hello|paano kita matutulungan/i],
    ['heyyy there', /hello|how can i help/i],
    ['kumustaaa ka po', /mabuti|handa akong tumulong/i],
    ['thanksss', /welcome/i],
    ['Who are you?', /Pascualinga Assistant/i],
    ['Thanks a lot!', /welcome/i],
    ['Paalam', /paalam|nandito lang/i]
  ];

  for (const [question, answerPattern] of cases) {
    const response = await ask({ messages: [{ role: 'user', content: question }] });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.source, 'knowledge');
    assert.match(data.answer, answerPattern);
  }
});

test('every authenticated chatbot role answers casual and basic workflow questions', async () => {
  const roles = [
    'admin', 'doctor', 'nurse', 'pharmacist', 'cashier', 'doctor_secretary',
    'medtech', 'radiographer', 'ecg_operator', 'physical_therapist', 'staff', 'patient'
  ];

  for (const role of roles) {
    const token = createSessionToken({ id: `${role}-1`, email: `${role}@example.com`, role, sessionVersion: 0 });
    const casualResponse = await ask(
      { pathname: `/${role.replaceAll('_', '-')}`, messages: [{ role: 'user', content: 'How are you?' }] },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(casualResponse.status, 200);
    const casualData = await casualResponse.json();
    assert.equal(casualData.role, role);
    assert.match(casualData.answer, /doing well|ready to help/i);

    const basicResponse = await ask(
      { pathname: `/${role.replaceAll('_', '-')}`, messages: [{ role: 'user', content: 'What can this system do?' }] },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(basicResponse.status, 200);
    const basicData = await basicResponse.json();
    assert.equal(basicData.role, role);
    assert.ok(basicData.answer.length > 30);
  }
});

test('assistant resolves safe multi-turn follow-up questions from prior context', async () => {
  const cases = [
    {
      messages: [
        { role: 'user', content: 'Magkano ang CBC?' },
        { role: 'assistant', content: 'The CBC reference price is ₱380.' },
        { role: 'user', content: 'How about chest xray?' }
      ],
      answer: /Chest X-ray/i,
      detail: /₱600/
    },
    {
      messages: [
        { role: 'user', content: 'Magkano ang chest xray?' },
        { role: 'assistant', content: 'The reference price is ₱600.' },
        { role: 'user', content: 'Saan ako pupunta?' }
      ],
      answer: /Radiology|Imaging/i,
      detail: /reception|0915 312 7144/i
    },
    {
      messages: [
        { role: 'user', content: 'Paano magpa-appointment?' },
        { role: 'assistant', content: 'Call the hospital to confirm availability.' },
        { role: 'user', content: 'Ano ang kailangan kong dalhin?' }
      ],
      answer: /valid ID/i,
      detail: /PhilHealth|HMO/i
    },
    {
      messages: [
        { role: 'user', content: 'Nasaan ang lab result ko?' },
        { role: 'assistant', content: 'Check the portal or releasing area.' },
        { role: 'user', content: 'Paano ko kunin?' }
      ],
      answer: /Patient Portal|releasing area/i,
      detail: /valid ID|resibo/i
    }
  ];

  for (const item of cases) {
    const response = await ask({ messages: item.messages });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.source, 'knowledge');
    assert.match(data.answer, item.answer);
    assert.match(data.answer, item.detail);
  }
});
