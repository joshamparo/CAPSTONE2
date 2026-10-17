'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'AssistantWidget.css'),
  'utf8'
);

test('dashboard assistant keeps its launcher inside staff side navigation', () => {
  assert.match(css, /\.assistant-widget-root\.assistant-widget-page-sidebar\s*\{[^}]*left:\s*12px;[^}]*right:\s*auto;/s);
  assert.match(css, /\.assistant-widget-root\.assistant-widget-page-sidebar\.assistant-widget-is-open\s*\{[^}]*left:\s*260px;/s);
  assert.match(css, /\.assistant-widget-root\.assistant-widget-page-dashboard \.assistant-widget-panel\s*\{[^}]*width:\s*min\(430px,[^}]*height:\s*min\(760px,/s);
  assert.doesNotMatch(css, /assistant-widget-page-dashboard \.assistant-widget-panel\s*\{[^}]*width:\s*min\(320px,/s);
});

test('collapsed staff sidebars hide the assistant instead of clipping its launcher', () => {
  assert.match(css, /body:has\(\.sidebar\.collapsed,[^}]*\.assistant-widget-root\.assistant-widget-page-sidebar\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /assistant-widget-page-sidebar:not\(\.assistant-widget-is-open\) \.assistant-widget-trigger\s*\{[^}]*width:\s*52px;/s);
});

test('mobile assistant overrides dashboard positioning and keeps safe edge spacing', () => {
  const mobileStart = css.indexOf('@media (max-width: 768px)');
  assert.ok(mobileStart >= 0);
  const mobileCss = css.slice(mobileStart);
  assert.match(mobileCss, /\.assistant-widget-root\.assistant-widget-page-dashboard\s*\{[^}]*right:\s*max\(12px,[^}]*left:\s*max\(12px,/s);
  assert.match(mobileCss, /\.assistant-widget-root\.assistant-widget-page-dashboard\.assistant-widget-is-open/);
  assert.match(mobileCss, /\.assistant-widget-panel,[\s\S]*\.assistant-widget-root\.assistant-widget-page-dashboard \.assistant-widget-panel\s*\{[^}]*width:\s*100%;/s);
});
