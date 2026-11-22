const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function createStaffAuth({ pin, now = () => new Date(), sessionMs }) {
  const sessions = new Map();
  const expectedDigest = digest(pin);

  function purgeExpired() {
    const current = now().getTime();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= current) {
        sessions.delete(token);
      }
    }
  }

  function login(candidate) {
    if (typeof candidate !== 'string' || candidate.length > 64) {
      return null;
    }
    if (!crypto.timingSafeEqual(digest(candidate), expectedDigest)) {
      return null;
    }
    purgeExpired();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now().getTime() + sessionMs);
    return token;
  }

  function isValid(token) {
    if (!token) {
      return false;
    }
    const expiresAt = sessions.get(token);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= now().getTime()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function logout(token) {
    sessions.delete(token);
  }

  return { login, isValid, logout };
}

module.exports = { createStaffAuth };
