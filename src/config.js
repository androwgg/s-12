function readPositiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const staffPin = env.STAFF_PIN || (production ? '' : '1234');
  if (!staffPin) {
    throw new Error('STAFF_PIN must be set when NODE_ENV is production');
  }
  if (!/^\d{4,12}$/.test(staffPin)) {
    throw new Error('STAFF_PIN must be 4 to 12 digits');
  }
  return {
    port: readPositiveInt(env, 'PORT', 3000),
    dataFile: env.DATA_FILE || 'data/orders.json',
    staffPin,
    usingDefaultPin: !env.STAFF_PIN,
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    trustProxy: env.TRUST_PROXY === 'true',
    dailyCups: readPositiveInt(env, 'DAILY_CUPS', 30),
    maxPerOrder: 3,
    timezone: env.TIMEZONE || 'Africa/Cairo',
    sessionMs: 8 * 60 * 60 * 1000,
    limits: {
      order: { windowMs: 10 * 60 * 1000, max: 10 },
      lookup: { windowMs: 60 * 1000, max: 120 },
      login: { windowMs: 10 * 60 * 1000, max: 5 },
    },
  };
}

module.exports = { loadConfig };
