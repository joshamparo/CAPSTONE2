const crypto = require('crypto');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashResetToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createPasswordResetToken(now = Date.now()) {
    const token = crypto.randomBytes(32).toString('hex');
    return {
        token,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Number(now) + RESET_TOKEN_TTL_MS)
    };
}

function resetTokenIsValid({ providedToken, storedTokenHash, expiresAt, now = Date.now() }) {
    if (!providedToken || !storedTokenHash || !expiresAt) return false;
    const expiry = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiry) || expiry <= Number(now)) return false;

    const providedHash = Buffer.from(hashResetToken(providedToken), 'hex');
    const storedHash = Buffer.from(String(storedTokenHash), 'hex');
    return providedHash.length === storedHash.length && crypto.timingSafeEqual(providedHash, storedHash);
}

module.exports = { RESET_TOKEN_TTL_MS, createPasswordResetToken, hashResetToken, resetTokenIsValid };
