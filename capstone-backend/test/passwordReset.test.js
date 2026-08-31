const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordResetToken, hashResetToken, resetTokenIsValid } = require('../utils/passwordReset');

test('password reset tokens are stored as hashes and accepted before expiry', () => {
    const now = Date.parse('2026-08-31T00:00:00Z');
    const reset = createPasswordResetToken(now);

    assert.notEqual(reset.token, reset.tokenHash);
    assert.equal(reset.tokenHash, hashResetToken(reset.token));
    assert.equal(resetTokenIsValid({
        providedToken: reset.token,
        storedTokenHash: reset.tokenHash,
        expiresAt: reset.expiresAt,
        now: now + 1000
    }), true);
});

test('password reset tokens reject wrong and expired values', () => {
    const now = Date.parse('2026-08-31T00:00:00Z');
    const reset = createPasswordResetToken(now);

    assert.equal(resetTokenIsValid({
        providedToken: 'wrong-token',
        storedTokenHash: reset.tokenHash,
        expiresAt: reset.expiresAt,
        now
    }), false);
    assert.equal(resetTokenIsValid({
        providedToken: reset.token,
        storedTokenHash: reset.tokenHash,
        expiresAt: reset.expiresAt,
        now: reset.expiresAt.getTime()
    }), false);
});
