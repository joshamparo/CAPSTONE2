const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecoveryTemplateParams } = require('../utils/recoveryEmail');

test('recovery email supplies the complete link and token under template aliases', () => {
    const link = 'https://pascualinga.com/reset-password?email=nurse%40example.com&token=abc123';
    const params = buildRecoveryTemplateParams('nurse@example.com', link);

    for (const key of ['reset_link', 'resetLink', 'recovery_link', 'link']) {
        assert.equal(params[key], link);
    }
    for (const key of ['token', 'reset_token', 'resetToken', 'recovery_token', 'code']) {
        assert.equal(params[key], 'abc123');
    }
});
