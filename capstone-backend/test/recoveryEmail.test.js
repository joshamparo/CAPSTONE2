const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecoveryTemplateParams } = require('../utils/recoveryEmail');
const fs = require('node:fs');
const path = require('node:path');

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

test('password recovery resend has server cooldown and anti-enumeration responses', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'staff.js'), 'utf8');
    assert.match(source, /recoveryCooldownLimit\s*=\s*createRateLimiter\(\{\s*windowMs:\s*60\s*\*\s*1000,\s*max:\s*1/i);
    assert.match(source, /request-password-reset', recoveryCooldownLimit, recoveryRateLimit/i);
    assert.match(source, /If the account is eligible, a password reset email will arrive shortly/i);
    assert.doesNotMatch(source, /Recovery email could not be delivered\. Please try again later\./i);
});
