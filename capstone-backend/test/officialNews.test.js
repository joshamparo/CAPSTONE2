const test = require('node:test');
const assert = require('node:assert/strict');
const { _newsTest } = require('../routes/announcements');

test('official news fallback contains only allowlisted official domains', () => {
  const allowed = new Set(['who.int', 'www.who.int', 'philhealth.gov.ph', 'www.philhealth.gov.ph']);
  const items = _newsTest.fallbackLiveNews();
  assert.equal(items.length, 6);
  for (const item of items) {
    assert.ok(item.title && item.summary);
    assert.ok(allowed.has(new URL(item.url).hostname), item.url);
  }
});

test('news XML decoder removes non-breaking-space entities', () => {
  assert.equal(_newsTest.decodeXmlEntities('Health&nbsp;care &amp; medicine'), 'Health care & medicine');
});

test('news summaries remove encoded markup and stay compact', () => {
  const encoded = '&lt;p&gt;Official health&amp;nbsp;update for Filipino patients.&lt;/p&gt;';
  assert.equal(_newsTest.stripHtml(encoded), 'Official health update for Filipino patients.');
  assert.ok(_newsTest.compactSummary('word '.repeat(200), 80).length <= 81);
});
