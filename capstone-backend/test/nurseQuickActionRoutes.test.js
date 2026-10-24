'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.join(__dirname, '..', '..', 'frontend', 'src');
const appSource = fs.readFileSync(path.join(frontendRoot, 'App.js'), 'utf8');
const nurseSource = fs.readFileSync(path.join(frontendRoot, 'Nurse', 'NurseDashboard.js'), 'utf8');

test('nurse nested URLs remain inside the protected nurse dashboard', () => {
  assert.match(appSource, /path="\/nurse\/\*"/);
  assert.match(nurseSource, /useLocation/);
  assert.match(nurseSource, /nurseViewFromPath\(location\.pathname\)/);
});

test('nurse quick actions expose the documented URLs', () => {
  assert.match(nurseSource, /'er-intake': '\/nurse\/er-intake'/);
  assert.match(nurseSource, /orders: '\/nurse\/orders-management'/);
  assert.match(nurseSource, /'ward-management': '\/nurse\/wards'/);
  assert.match(nurseSource, /activity: '\/nurse\/activity'/);
  assert.match(nurseSource, /setView\('orders'\)[\s\S]{0,200}Medication Administration/);
  assert.match(nurseSource, /setView\('activity'\)[\s\S]{0,100}View All/);
  assert.match(nurseSource, /Full Bed Map/);
});
