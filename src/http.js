const fs = require('node:fs/promises');
const path = require('node:path');
const { HttpError } = require('./errors');

const BODY_LIMIT = 4096;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PAGES = {
  '/': 'index.html',
  '/track': 'track.html',
  '/staff': 'staff.html',
};

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function publicDetails(details = {}) {
  const { allow, ...rest } = details;
  return rest;
}

function sendError(res, error) {
  const headers = {};
  if (error.details && error.details.retryAfter) {
    headers['Retry-After'] = String(error.details.retryAfter);
  }
  if (error.details && error.details.allow) {
    headers.Allow = error.details.allow;
  }
  sendJson(
    res,
    error.status,
    { error: { code: error.code, message: error.message, ...publicDetails(error.details) } },
    headers
  );
}

function readJsonBody(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    return Promise.reject(
      new HttpError(415, 'unsupported_media_type', 'يجب إرسال البيانات بصيغة JSON')
    );
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) {
        return;
      }
      size += chunk.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(new HttpError(413, 'payload_too_large', 'حجم البيانات المرسلة كبير جدًا'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) {
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new HttpError(400, 'bad_json', 'تعذر قراءة البيانات المرسلة'));
      }
    });
    req.on('error', () => {
      if (!failed) {
        failed = true;
        reject(new HttpError(400, 'bad_request', 'انقطع الاتصال أثناء إرسال البيانات'));
      }
    });
  });
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) {
      return forwarded;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

async function serveStatic(rootDir, req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'method_not_allowed', 'الطريقة غير مسموحة', { allow: 'GET, HEAD' });
  }
  let relative = PAGES[pathname];
  if (!relative) {
    try {
      relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch (error) {
      throw new HttpError(400, 'bad_request', 'عنوان غير صالح');
    }
  }
  const target = path.resolve(rootDir, relative);
  const type = CONTENT_TYPES[path.extname(target)];
  if (!type || !target.startsWith(rootDir + path.sep)) {
    throw new HttpError(404, 'not_found', 'الصفحة غير موجودة');
  }
  let content;
  try {
    content = await fs.readFile(target);
  } catch (error) {
    throw new HttpError(404, 'not_found', 'الصفحة غير موجودة');
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

module.exports = {
  applySecurityHeaders,
  sendJson,
  sendError,
  readJsonBody,
  parseCookies,
  clientIp,
  serveStatic,
};
