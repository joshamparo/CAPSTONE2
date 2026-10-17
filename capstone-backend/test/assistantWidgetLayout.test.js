'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'AssistantWidget.css'),
  'utf8'
);

test('dashboard assistant uses a readable desktop panel anchored away from side navigation', () => {
  assert.match(css, /\.assistant-widget-root\.assistant-widget-page-dashboard\s*\{[^}]*left:\s*auto;[^}]*right:\s*24px;/s);
  assert.match(css, /\.assistant-widget-root\.assistant-widget-page-dashboard \.assistant-widget-panel\s*\{[^}]*width:\s*min\(430px,[^}]*height:\s*min\(760px,/s);
  assert.doesNotMatch(css, /assistant-widget-page-dashboard \.assistant-widget-panel\s*\{[^}]*width:\s*min\(320px,/s);
});

test('mobile assistant overrides dashboard positioning and keeps safe edge spacing', () => {
  const mobileStart = css.indexOf('@media (max-width: 768px)');
  assert.ok(mobileStart >= 0);
  const mobileCss = css.slice(mobileStart);
  assert.match(mobileCss, /\.assistant-widget-root\.assistant-widget-page-dashboard\s*\{[^}]*right:\s*max\(12px,[^}]*left:\s*max\(12px,/s);
  assert.match(mobileCss, /\.assistant-widget-root\.assistant-widget-page-dashboard\.assistant-widget-is-open/);
  assert.match(mobileCss, /\.assistant-widget-panel,[\s\S]*\.assistant-widget-root\.assistant-widget-page-dashboard \.assistant-widget-panel\s*\{[^}]*width:\s*100%;/s);
});
