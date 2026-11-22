const http = require('node:http');
const path = require('node:path');
const { HttpError } = require('./errors');
const { validateOrder } = require('./validate');
const { createLimiter } = require('./rateLimit');
const { createStaffAuth } = require('./auth');
const { createOrderService } = require('./orders');
const { CODE_LENGTH } = require('./store');
const {
  applySecurityHeaders,
  sendJson,
  sendError,
  readJsonBody,
  parseCookies,
  clientIp,
  serveStatic,
} = require('./http');

const SESSION_COOKIE = 'staff_session';
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const CODE_PATTERN = new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`);

function createApp({ store, config, now = () => new Date() }) {
  const service = createOrderService({ store, config, now });
  const auth = createStaffAuth({ pin: config.staffPin, now, sessionMs: config.sessionMs });
  const limiters = {
    order: createLimiter({ ...config.limits.order, now }),
    lookup: createLimiter({ ...config.limits.lookup, now }),
    login: createLimiter({ ...config.limits.login, now }),
  };

  function enforce(limiter, req) {
    const result = limiter.hit(clientIp(req, config.trustProxy));
    if (!result.allowed) {
      throw new HttpError(
        429,
        'rate_limited',
        `محاولات كثيرة خلال وقت قصير، حاول بعد ${Math.ceil(result.retryAfter / 60)} دقيقة`,
        { retryAfter: result.retryAfter }
      );
    }
  }

  function requireStaff(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!auth.isValid(token)) {
      throw new HttpError(401, 'unauthorized', 'سجّل الدخول بالرقم السري أولًا');
    }
    return token;
  }

  function cookieFor(value, maxAgeSeconds) {
    const parts = [
      `${SESSION_COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (config.secureCookies) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  function parseCode(raw) {
    const code = raw.toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new HttpError(404, 'not_found', 'لم نجد طلبًا بهذا الرمز، تأكد من كتابته');
    }
    return code;
  }

  const routes = [
    [
      'GET',
      /^\/api\/brew$/,
      (req, res) => {
        sendJson(res, 200, service.brew());
      },
    ],
    [
      'POST',
      /^\/api\/orders$/,
      async (req, res) => {
        enforce(limiters.order, req);
        const result = validateOrder(await readJsonBody(req), config);
        if (!result.ok) {
          throw new HttpError(400, 'validation', 'راجع البيانات المكتوبة', {
            fields: result.errors,
          });
        }
        const { order, replayed } = service.place(result.value);
        sendJson(res, replayed ? 200 : 201, {
          order: service.customerView(order),
          replayed,
        });
      },
    ],
    [
      'GET',
      /^\/api\/orders\/([A-Za-z0-9]+)$/,
      (req, res, match) => {
        enforce(limiters.lookup, req);
        sendJson(res, 200, { order: service.track(parseCode(match[1])) });
      },
    ],
    [
      'POST',
      /^\/api\/staff\/login$/,
      async (req, res) => {
        enforce(limiters.login, req);
        const body = await readJsonBody(req);
        const token = auth.login(body && body.pin);
        if (!token) {
          throw new HttpError(401, 'bad_pin', 'الرقم غير صحيح');
        }
        limiters.login.reset(clientIp(req, config.trustProxy));
        sendJson(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': cookieFor(token, Math.floor(config.sessionMs / 1000)) }
        );
      },
    ],
    [
      'POST',
      /^\/api\/staff\/logout$/,
      (req, res) => {
        auth.logout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieFor('', 0) });
      },
    ],
    [
      'GET',
      /^\/api\/staff\/orders$/,
      (req, res) => {
        requireStaff(req);
        sendJson(res, 200, { orders: service.listForStaff(), brew: service.brew() });
      },
    ],
    [
      'PATCH',
      /^\/api\/staff\/orders\/([A-Za-z0-9]+)$/,
      async (req, res, match) => {
        requireStaff(req);
        const body = await readJsonBody(req);
        const order = service.advance(parseCode(match[1]), body && body.status);
        sendJson(res, 200, { order });
      },
    ],
  ];

  async function handleApi(req, res, pathname) {
    const allowed = [];
    for (const [method, pattern, handler] of routes) {
      const match = pathname.match(pattern);
      if (!match) {
        continue;
      }
      if (method === req.method || (method === 'GET' && req.method === 'HEAD')) {
        await handler(req, res, match);
        return;
      }
      allowed.push(method);
    }
    if (allowed.length > 0) {
      throw new HttpError(405, 'method_not_allowed', 'الطريقة غير مسموحة', { allow: allowed.join(', ') });
    }
    throw new HttpError(404, 'not_found', 'العنوان غير موجود');
  }

  async function handle(req, res) {
    applySecurityHeaders(res);
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
      } else {
        await serveStatic(PUBLIC_DIR, req, res, pathname);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error);
        return;
      }
      console.error(error);
      sendError(res, new HttpError(500, 'server_error', 'حدث خطأ غير متوقع، حاول مرة أخرى'));
    }
  }

  return http.createServer(handle);
}

module.exports = { createApp };
