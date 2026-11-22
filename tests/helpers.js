const http = require('node:http');
const { loadConfig } = require('../src/config');
const { Store } = require('../src/store');
const { createApp } = require('../src/app');

function makeClock(start = '2026-11-22T10:00:00Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms;
    },
  };
}

async function startApp(overrides = {}) {
  const clock = makeClock(overrides.start);
  const config = { ...loadConfig({ STAFF_PIN: '4321' }), ...overrides.config };
  const store = overrides.store || new Store({ now: clock.now });
  const server = createApp({ store, config, now: clock.now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    store,
    clock,
    config,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

let keyCounter = 0;

function orderBody(overrides = {}) {
  keyCounter += 1;
  return {
    name: 'منى أحمد',
    phone: `0101234${String(keyCounter).padStart(4, '0')}`,
    quantity: 1,
    note: '',
    idempotencyKey: `test-key-${String(keyCounter).padStart(10, '0')}`,
    ...overrides,
  };
}

async function api(app, path, { method = 'GET', body, cookie, raw } = {}) {
  const headers = {};
  if (body !== undefined || raw !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  const response = await fetch(`${app.baseUrl}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  return { status: response.status, body: payload, headers: response.headers };
}

async function staffCookie(app) {
  const result = await api(app, '/api/staff/login', { method: 'POST', body: { pin: '4321' } });
  return result.headers.get('set-cookie').split(';')[0];
}

function rawRequest(app, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(app.baseUrl);
    const req = http.request(
      { host: url.hostname, port: url.port, path: requestPath, ...options },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = { startApp, orderBody, api, staffCookie, rawRequest, makeClock };
