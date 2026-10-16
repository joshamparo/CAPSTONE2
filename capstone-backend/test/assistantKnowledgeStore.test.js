const test = require('node:test');
const assert = require('node:assert/strict');

const { validateKnowledgeEntry, validateFeedback, rankKnowledgeEntries } = require('../utils/assistantKnowledgeStore');

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
  assert.equal(entry.status, 'draft');
});

test('chatbot knowledge requires explicit publishing and rejects unsafe claims', () => {
  const published = validateKnowledgeEntry({ type: 'workflow', key: 'queue_help', title: 'Queue help', answerEn: 'Open the Queue module and select the assigned patient.', status: 'active', module: 'Patient Queue', audienceRoles: ['doctor'] });
  assert.equal(published.active, true);
  assert.equal(published.module, 'Patient Queue');
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad_claim', title: 'Bad', answerEn: 'This service is definitely available.' }), /guaranteed claims/i);
});

test('knowledge ranking respects publication, role, and active module', () => {
  const base = { active: true, status: 'active', audienceRoles: ['doctor'], effectiveFrom: null, expiresAt: null, keywords: ['how do i use this page'] };
  const ranked = rankKnowledgeEntries([
    { ...base, key: 'billing', title: 'Billing workflow', module: 'Billing' },
    { ...base, key: 'queue', title: 'Queue workflow', module: 'Patient Queue' },
    { ...base, key: 'draft', title: 'Draft workflow', module: 'Patient Queue', status: 'draft' }
  ], { role: 'doctor', text: 'How do I use this page?', currentModule: 'Patient Queue' });
  assert.equal(ranked[0].entry.key, 'queue');
  assert.equal(ranked.some((item) => item.entry.key === 'draft'), false);
});

test('assistant feedback stores only bounded metadata', () => {
  const item = validateFeedback({ requestId: '123e4567-e89b-12d3-a456-426614174000', rating: 'not_helpful', reason: 'did_not_answer', knowledgeKey: 'faq_contact', currentModule: 'Contact' });
  assert.equal(item.rating, 'not_helpful');
  assert.equal(item.module, 'Contact');
  assert.throws(() => validateFeedback({ requestId: 'bad', rating: 'helpful' }), /request ID/i);
});

test('chatbot knowledge validation rejects unsafe, invalid, and unbounded content', () => {
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad', title: 'Bad', answerEn: '<script>alert(1)</script>' }), /unsafe/i);
  assert.throws(() => validateKnowledgeEntry({ type: 'diagnosis', key: 'bad', title: 'Bad', answerEn: 'No' }), /unsupported/i);
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad', title: 'Bad', answerEn: 'No', audienceRoles: ['superadmin'] }), /role/i);
  assert.throws(() => validateKnowledgeEntry({ type: 'faq', key: 'bad', title: 'Bad', answerEn: 'No', pricePHP: -1 }), /price/i);
});
