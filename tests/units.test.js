const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLimiter } = require('../src/rateLimit');
const { dayKey, brewForDay, roastCount } = require('../src/brew');
const { Store } = require('../src/store');
const { makeClock } = require('./helpers');

test('limiter allows up to max then blocks until the window ends', () => {
  const clock = makeClock();
  const limiter = createLimiter({ windowMs: 1000, max: 2, now: clock.now });
  assert.equal(limiter.hit('a').allowed, true);
  assert.equal(limiter.hit('a').allowed, true);
  const blocked = limiter.hit('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 1);
  assert.equal(limiter.hit('b').allowed, true);
  clock.advance(1000);
  assert.equal(limiter.hit('a').allowed, true);
});

test('day key follows the configured time zone', () => {
  const late = new Date('2026-11-22T22:30:00Z');
  assert.equal(dayKey(late, 'Africa/Cairo'), '2026-11-23');
  assert.equal(dayKey(late, 'UTC'), '2026-11-22');
});

test('brew rotates through all roasts and repeats weekly', () => {
  const seen = new Set();
  for (let day = 1; day <= roastCount; day += 1) {
    seen.add(brewForDay(`2026-11-${String(day).padStart(2, '0')}`).name);
  }
  assert.equal(seen.size, roastCount);
  assert.deepEqual(brewForDay('2026-11-01'), brewForDay('2026-11-08'));
  assert.notDeepEqual(brewForDay('2026-11-01'), brewForDay('2026-11-02'));
});

test('store keeps orders after a restart and writes the file atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
  const file = path.join(dir, 'nested', 'orders.json');
  const first = new Store({ file });
  const order = first.add({
    day: '2026-11-22',
    name: 'علي',
    phone: '01012345678',
    quantity: 2,
    note: '',
    idempotencyKey: 'abcdefgh12345678',
  });
  assert.equal(order.number, 1);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  const second = new Store({ file });
  assert.equal(second.findByCode(order.code).quantity, 2);
  assert.equal(second.reservedCups('2026-11-22'), 2);
});

test('store reports a clear error for a damaged data file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
  const file = path.join(dir, 'orders.json');
  fs.writeFileSync(file, '{not json');
  assert.throws(() => new Store({ file }), /Cannot read/);
});

test('store rolls back the order when saving fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'file');
  const store = new Store({ file: path.join(blocker, 'orders.json') });
  assert.throws(() =>
    store.add({
      day: '2026-11-22',
      name: 'علي',
      phone: '01012345678',
      quantity: 1,
      note: '',
      idempotencyKey: 'abcdefgh12345678',
    })
  );
  assert.equal(store.orders.length, 0);
});

test('limiter reset forgets a client', () => {
  const clock = makeClock();
  const limiter = createLimiter({ windowMs: 1000, max: 1, now: clock.now });
  limiter.hit('a');
  assert.equal(limiter.hit('a').allowed, false);
  limiter.reset('a');
  assert.equal(limiter.hit('a').allowed, true);
});

test('store refuses a data file with the wrong shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's12-shape-'));
  try {
    for (const content of ['null', '[null]', '{"orders":[null]}', '{"orders":5}']) {
      const file = path.join(dir, 'orders.json');
      fs.writeFileSync(file, content);
      assert.throws(() => new Store({ file }), /Cannot read/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
