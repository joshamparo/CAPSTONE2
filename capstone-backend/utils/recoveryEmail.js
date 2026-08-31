function buildRecoveryTemplateParams(email, resetLink) {
    const normalizedEmail = String(email || '').trim();
    const fullLink = String(resetLink || '').trim();
    let token = '';
    try {
        token = new URL(fullLink).searchParams.get('token') || '';
    } catch (_) {}

    return {
        to_email: normalizedEmail,
        email: normalizedEmail,
        user_email: normalizedEmail,
        reset_link: fullLink,
        resetLink: fullLink,
        recovery_link: fullLink,
        link: fullLink,
        token,
        reset_token: token,
        resetToken: token,
        recovery_token: token,
        code: token,
        subject: 'Password Recovery - Pascualinga'
    };
}

module.exports = { buildRecoveryTemplateParams };
