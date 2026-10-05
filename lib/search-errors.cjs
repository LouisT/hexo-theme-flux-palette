'use strict';

// Redact known credentials and bound provider error text before logging
function detail(body, secrets = []) {
    let message =
        typeof body?.error === 'string' ? body.error : body?.error?.message || body?.message;
    if (typeof message !== 'string') return '';
    for (const secret of secrets)
        if (typeof secret === 'string' && secret)
            message = message.split(secret).join('[redacted]');
    // Strip control characters and cap sanitized messages before they reach build logs
    return message
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .trim()
        .slice(0, 512);
}

module.exports = { detail };
