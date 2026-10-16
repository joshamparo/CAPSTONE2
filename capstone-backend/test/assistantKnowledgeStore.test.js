const test = require('node:test');
const assert = require('node:assert/strict');

const { validateKnowledgeEntry } = require('../utils/assistantKnowledgeStore');

test('chatbot knowledge validation normalizes safe admin content', () => {
  const entry = validateKnowledgeEntry({
    key: ' FAQ OPD Requirements ', type: 'FAQ', title: ' OPD requirements ',
    answerEn: 'Bring a valid ID.', answerTl: 'Magdala ng valid ID.',
    keywords: ['OPD', ' requirements ', 'OPD'], audienceRoles: ['PUBLIC', 'patient'], pricePHP: '500'
  });
  assert.equal(entry.key, 'faq_opd_requirements');
  assert.deepEqual(entry.keywords, ['opd', 'requirements']);
  assert.deepEqual(entry.audienceRoles, ['public', 'patient']);
  assert.equal(entry.pricePHP, 500);
});

test('chatbot knowledge validation rejects unsafe, invalid, and unbounded content', () => {
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad', title: 'Bad', answerEn: '<script>alert(1)</script>' }), /unsafe/i);
  assert.throws(() => validateKnowledgeEntry({ type: 'diagnosis', key: 'bad', title: 'Bad', answerEn: 'No' }), /unsupported/i);
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad', title: 'Bad', answerEn: 'No', audienceRoles: ['superadmin'] }), /role/i);
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad', title: 'Bad', answerEn: 'No', pricePHP: -1 }), /price/i);
});
