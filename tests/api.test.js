const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, orderBody, api, staffCookie, rawRequest } = require('./helpers');

async function withApp(overrides, run) {
  const app = await startApp(overrides);
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

const roomyLimits = {
  order: { windowMs: 600000, max: 1000 },
  lookup: { windowMs: 60000, max: 1000 },
  login: { windowMs: 600000, max: 1000 },
};

test('brew endpoint describes today and the remaining cups', async () => {
  await withApp({}, async (app) => {
    const { status, body } = await api(app, '/api/brew');
    assert.equal(status, 200);
    assert.equal(body.day, '2026-11-22');
    assert.equal(body.remaining, body.totalCups);
    assert.ok(body.name && body.origin && body.roast && body.notes);
  });
});

test('creating an order returns a tracking code and uses up cups', async () => {
  await withApp({}, async (app) => {
    const { status, body } = await api(app, '/api/orders', {
      method: 'POST',
      body: orderBody({ quantity: 2 }),
    });
    assert.equal(status, 201);
    assert.match(body.order.code, /^[A-HJKMNP-Z2-9]{6}$/);
    assert.equal(body.order.status, 'new');
    assert.equal(body.order.number, 1);
    assert.equal(body.replayed, false);
    const brew = await api(app, '/api/brew');
    assert.equal(brew.body.remaining, brew.body.totalCups - 2);
  });
});

test('invalid input is rejected with field messages', async () => {
  await withApp({}, async (app) => {
    const empty = await api(app, '/api/orders', { method: 'POST', body: {} });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'validation');
    assert.deepEqual(Object.keys(empty.body.error.fields).sort(), [
      'idempotencyKey',
      'name',
      'phone',
      'quantity',
    ]);
    const badPhone = await api(app, '/api/orders', {
      method: 'POST',
      body: orderBody({ phone: '12345' }),
    });
    assert.equal(badPhone.status, 400);
    assert.ok(badPhone.body.error.fields.phone);
    assert.equal((await api(app, '/api/brew')).body.remaining, app.config.dailyCups);
  });
});

test('Arabic digit phones are stored in the normal form', async () => {
  await withApp({}, async (app) => {
    const created = await api(app, '/api/orders', {
      method: 'POST',
      body: orderBody({ phone: '٠١٠١٢٣٤٥٦٧٨' }),
    });
    assert.equal(created.status, 201);
    const cookie = await staffCookie(app);
    const list = await api(app, '/api/staff/orders', { cookie });
    assert.equal(list.body.orders[0].phone, '01012345678');
  });
});

test('sending the same request twice creates one order', async () => {
  await withApp({}, async (app) => {
    const body = orderBody({ quantity: 2 });
    const first = await api(app, '/api/orders', { method: 'POST', body });
    const second = await api(app, '/api/orders', { method: 'POST', body });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.order.code, first.body.order.code);
    assert.equal(app.store.orders.length, 1);
    assert.equal((await api(app, '/api/brew')).body.remaining, app.config.dailyCups - 2);
  });
});

test('reusing a key with different data is a conflict', async () => {
  await withApp({}, async (app) => {
    const body = orderBody();
    await api(app, '/api/orders', { method: 'POST', body });
    const changed = await api(app, '/api/orders', {
      method: 'POST',
      body: { ...body, quantity: 3 },
    });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'idempotency_conflict');
    assert.equal(app.store.orders.length, 1);
  });
});

test('one open order per phone, allowed again after pickup', async () => {
  await withApp({}, async (app) => {
    const phone = '01099998888';
    const first = await api(app, '/api/orders', { method: 'POST', body: orderBody({ phone }) });
    const again = await api(app, '/api/orders', { method: 'POST', body: orderBody({ phone }) });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'open_order_exists');
    assert.equal(JSON.stringify(again.body).includes(first.body.order.code), false);
    const cookie = await staffCookie(app);
    for (const status of ['preparing', 'ready']) {
      await api(app, `/api/staff/orders/${first.body.order.code}`, {
        method: 'PATCH',
        body: { status },
        cookie,
      });
    }
    const third = await api(app, '/api/orders', { method: 'POST', body: orderBody({ phone }) });
    assert.equal(third.status, 201);
  });
});

test('orders stop when the daily cups run out', async () => {
  await withApp({ config: { dailyCups: 4, limits: roomyLimits } }, async (app) => {
    const big = await api(app, '/api/orders', { method: 'POST', body: orderBody({ quantity: 3 }) });
    assert.equal(big.status, 201);
    const tooMany = await api(app, '/api/orders', { method: 'POST', body: orderBody({ quantity: 2 }) });
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.body.error.code, 'not_enough_cups');
    assert.equal(tooMany.body.error.remaining, 1);
    const last = await api(app, '/api/orders', { method: 'POST', body: orderBody({ quantity: 1 }) });
    assert.equal(last.status, 201);
    const soldOut = await api(app, '/api/orders', { method: 'POST', body: orderBody() });
    assert.equal(soldOut.status, 409);
    assert.equal(soldOut.body.error.code, 'sold_out');
    assert.equal((await api(app, '/api/brew')).body.remaining, 0);
  });
});

test('a new day resets the cups and the staff list', async () => {
  await withApp({ config: { limits: roomyLimits } }, async (app) => {
    await api(app, '/api/orders', { method: 'POST', body: orderBody({ quantity: 3 }) });
    app.clock.advance(24 * 60 * 60 * 1000);
    const brew = await api(app, '/api/brew');
    assert.equal(brew.body.day, '2026-11-23');
    assert.equal(brew.body.remaining, brew.body.totalCups);
    const cookie = await staffCookie(app);
    const list = await api(app, '/api/staff/orders', { cookie });
    assert.equal(list.body.orders.length, 0);
    const fresh = await api(app, '/api/orders', { method: 'POST', body: orderBody() });
    assert.equal(fresh.body.order.number, 1);
  });
});

test('order requests are rate limited per client', async () => {
  await withApp({}, async (app) => {
    let last;
    for (let i = 0; i < app.config.limits.order.max + 1; i += 1) {
      last = await api(app, '/api/orders', { method: 'POST', body: {} });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'rate_limited');
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    app.clock.advance(app.config.limits.order.windowMs);
    const after = await api(app, '/api/orders', { method: 'POST', body: {} });
    assert.equal(after.status, 400);
  });
});

test('tracking shows status without personal data', async () => {
  await withApp({ config: { limits: roomyLimits } }, async (app) => {
    const first = await api(app, '/api/orders', { method: 'POST', body: orderBody() });
    const second = await api(app, '/api/orders', { method: 'POST', body: orderBody() });
    const tracked = await api(app, `/api/orders/${second.body.order.code.toLowerCase()}`);
    assert.equal(tracked.status, 200);
    assert.equal(tracked.body.order.status, 'new');
    assert.equal(tracked.body.order.waitingBefore, 1);
    const text = JSON.stringify(tracked.body);
    assert.equal(text.includes('منى'), false);
    assert.equal(text.includes('0101234'), false);
    assert.equal((await api(app, `/api/orders/${first.body.order.code}`)).body.order.waitingBefore, 0);
    assert.equal((await api(app, '/api/orders/ZZZZZZ')).status, 404);
    assert.equal((await api(app, '/api/orders/abc')).status, 404);
  });
});

test('staff routes need a login', async () => {
  await withApp({}, async (app) => {
    assert.equal((await api(app, '/api/staff/orders')).status, 401);
    assert.equal(
      (await api(app, '/api/staff/orders/ABCDEF', { method: 'PATCH', body: { status: 'preparing' } }))
        .status,
      401
    );
    const wrong = await api(app, '/api/staff/login', { method: 'POST', body: { pin: '0000' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);
    const forged = await api(app, '/api/staff/orders', { cookie: 'staff_session=abc' });
    assert.equal(forged.status, 401);
  });
});

test('staff can move an order forward one step at a time', async () => {
  await withApp({}, async (app) => {
    const created = await api(app, '/api/orders', { method: 'POST', body: orderBody() });
    const code = created.body.order.code;
    const cookie = await staffCookie(app);
    const patch = (status) =>
      api(app, `/api/staff/orders/${code}`, { method: 'PATCH', body: { status }, cookie });

    const skip = await patch('ready');
    assert.equal(skip.status, 409);
    assert.equal(skip.body.error.code, 'invalid_transition');
    assert.equal((await patch('preparing')).body.order.status, 'preparing');
    assert.equal((await api(app, `/api/orders/${code}`)).body.order.status, 'preparing');
    assert.equal((await patch('new')).status, 409);
    assert.equal((await patch('ready')).body.order.status, 'ready');
    assert.equal((await patch('ready')).status, 409);
    assert.equal((await patch('delivered')).status, 400);
    const missing = await api(app, '/api/staff/orders/ABCDEF', {
      method: 'PATCH',
      body: { status: 'preparing' },
      cookie,
    });
    assert.equal(missing.status, 404);
  });
});

test('staff list carries contact details and the brew state', async () => {
  await withApp({}, async (app) => {
    await api(app, '/api/orders', { method: 'POST', body: orderBody({ note: 'حليب جوز الهند' }) });
    const cookie = await staffCookie(app);
    const list = await api(app, '/api/staff/orders', { cookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.orders[0].note, 'حليب جوز الهند');
    assert.ok(list.body.orders[0].phone.startsWith('0101234'));
    assert.equal(list.body.brew.remaining, list.body.brew.totalCups - 1);
  });
});

test('logout ends the session', async () => {
  await withApp({}, async (app) => {
    const cookie = await staffCookie(app);
    assert.equal((await api(app, '/api/staff/orders', { cookie })).status, 200);
    await api(app, '/api/staff/logout', { method: 'POST', body: {}, cookie });
    assert.equal((await api(app, '/api/staff/orders', { cookie })).status, 401);
  });
});

test('sessions expire after the configured time', async () => {
  await withApp({}, async (app) => {
    const cookie = await staffCookie(app);
    app.clock.advance(app.config.sessionMs + 1000);
    assert.equal((await api(app, '/api/staff/orders', { cookie })).status, 401);
  });
});

test('login attempts are rate limited', async () => {
  await withApp({}, async (app) => {
    let last;
    for (let i = 0; i < app.config.limits.login.max + 1; i += 1) {
      last = await api(app, '/api/staff/login', { method: 'POST', body: { pin: '0000' } });
    }
    assert.equal(last.status, 429);
    const correct = await api(app, '/api/staff/login', { method: 'POST', body: { pin: '4321' } });
    assert.equal(correct.status, 429);
  });
});

test('bad bodies get clear errors', async () => {
  await withApp({}, async (app) => {
    const broken = await api(app, '/api/orders', { method: 'POST', raw: '{oops' });
    assert.equal(broken.status, 400);
    assert.equal(broken.body.error.code, 'bad_json');
    const wrongType = await fetch(`${app.baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(wrongType.status, 415);
    const huge = await api(app, '/api/orders', {
      method: 'POST',
      raw: JSON.stringify({ note: 'x'.repeat(10000) }),
    });
    assert.equal(huge.status, 413);
    const nullBody = await api(app, '/api/orders', { method: 'POST', raw: 'null' });
    assert.equal(nullBody.status, 400);
    const login = await api(app, '/api/staff/login', { method: 'POST', raw: 'null' });
    assert.equal(login.status, 401);
  });
});

test('unknown paths and wrong methods', async () => {
  await withApp({}, async (app) => {
    assert.equal((await api(app, '/api/nothing')).status, 404);
    assert.equal((await api(app, '/api/orders', { method: 'DELETE' })).status, 405);
    assert.equal((await api(app, '/api/brew', { method: 'POST', body: {} })).status, 405);
  });
});

test('pages are served and files outside public are not', async () => {
  await withApp({}, async (app) => {
    for (const page of ['/', '/track', '/staff']) {
      const response = await fetch(`${app.baseUrl}${page}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html lang="ar" dir="rtl">/);
    }
    assert.equal((await fetch(`${app.baseUrl}/css/style.css`)).status, 200);
    for (const bad of ['/..%2fpackage.json', '/%2e%2e/package.json', '/..%2f..%2fetc%2fpasswd', '/%E0%A4%A']) {
      const result = await rawRequest(app, bad);
      assert.ok([400, 404].includes(result.status), `${bad} gave ${result.status}`);
      assert.equal(result.text.includes('"name"'), false);
    }
    assert.equal((await fetch(`${app.baseUrl}/server.js`)).status, 404);
    const response = await fetch(`${app.baseUrl}/`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

test('405 answers carry an Allow header and HEAD works on GET routes', async () => {
  await withApp({}, async (app) => {
    const wrong = await api(app, '/api/orders', { method: 'DELETE' });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'POST');
    assert.equal(wrong.body.error.allow, undefined);
    const head = await fetch(`${app.baseUrl}/api/brew`, { method: 'HEAD' });
    assert.equal(head.status, 200);
  });
});

test('a successful login clears the failed attempts of that client', async () => {
  await withApp({}, async (app) => {
    for (let i = 0; i < app.config.limits.login.max - 1; i += 1) {
      await api(app, '/api/staff/login', { method: 'POST', body: { pin: '0000' } });
    }
    assert.equal((await api(app, '/api/staff/login', { method: 'POST', body: { pin: '4321' } })).status, 200);
    for (let i = 0; i < app.config.limits.login.max - 1; i += 1) {
      const wrong = await api(app, '/api/staff/login', { method: 'POST', body: { pin: '0000' } });
      assert.equal(wrong.status, 401);
    }
  });
});

test('parallel identical requests create one order', async () => {
  await withApp({ config: { limits: roomyLimits } }, async (app) => {
    const body = orderBody();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => api(app, '/api/orders', { method: 'POST', body }))
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 200).length, 3);
    assert.equal(app.store.orders.length, 1);
  });
});

test('direction override characters are removed from the note', async () => {
  await withApp({ config: { limits: roomyLimits } }, async (app) => {
    const result = await api(app, '/api/orders', {
      method: 'POST',
      body: orderBody({ note: 'a‮b​c' }),
    });
    assert.equal(result.status, 201);
    assert.equal(app.store.orders[0].note, 'abc');
  });
});
