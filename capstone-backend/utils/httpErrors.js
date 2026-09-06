'use strict';

const DEFAULT_MESSAGE = 'The request could not be completed. Please try again.';

function normalizeStatus(error, fallbackStatus = 500) {
  const candidate = Number(error?.statusCode || error?.status);
  if (Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) return candidate;
  return fallbackStatus;
}

function publicErrorMessage(error, fallback = DEFAULT_MESSAGE, status) {
  const resolvedStatus = Number(status || normalizeStatus(error));
  const declaredStatus = Number(error?.statusCode || error?.status);
  const explicitlyPublic = error?.expose === true
    || (Number.isInteger(declaredStatus) && declaredStatus >= 400 && declaredStatus < 500);
  if (resolvedStatus >= 400 && resolvedStatus < 500 && explicitlyPublic) {
    const message = String(error?.message || '').trim();
    if (message) return message.slice(0, 500);
  }
  return fallback;
}

function sendError(res, error, fallback = DEFAULT_MESSAGE, fallbackStatus = 500, extra = {}) {
  const status = normalizeStatus(error, fallbackStatus);
  const message = publicErrorMessage(error, fallback, status);
  return res.status(status).json({ ...extra, message });
}

module.exports = { DEFAULT_MESSAGE, normalizeStatus, publicErrorMessage, sendError };
