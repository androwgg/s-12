const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const PHONE_PATTERN = /^01[0125]\d{8}$/;
const NOTE_LIMIT = 100;

function toLatinDigits(text) {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function cleanText(value) {
  if (typeof value !== 'string') {
    return null;
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(raw) {
  let digits = toLatinDigits(raw).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+20')) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('0020')) {
    digits = `0${digits.slice(4)}`;
  } else if (/^20\d{10}$/.test(digits)) {
    digits = `0${digits.slice(2)}`;
  }
  return digits;
}

function parseQuantity(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && /^\d{1,2}$/.test(value.trim())) {
    return Number(value.trim());
  }
  return NaN;
}

function validateOrder(body, { maxPerOrder }) {
  const input = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = {};

  const name = cleanText(input.name);
  if (name === null || name.length < 2 || name.length > 40 || !NAME_PATTERN.test(name)) {
    errors.name = 'اكتب اسمك بحروف فقط، من حرفين إلى 40 حرفًا';
  }

  const phone = typeof input.phone === 'string' ? normalizePhone(input.phone) : '';
  if (!PHONE_PATTERN.test(phone)) {
    errors.phone = 'اكتب رقم موبايل مصريًا صحيحًا مثل 01012345678';
  }

  const quantity = parseQuantity(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxPerOrder) {
    errors.quantity = `اختر عددًا من 1 إلى ${maxPerOrder}`;
  }

  let note = '';
  if (input.note !== undefined && input.note !== null) {
    const cleaned = cleanText(input.note);
    if (cleaned === null || cleaned.length > NOTE_LIMIT) {
      errors.note = `الملاحظة يجب ألا تزيد على ${NOTE_LIMIT} حرف`;
    } else {
      note = cleaned;
    }
  }

  const idempotencyKey = input.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !KEY_PATTERN.test(idempotencyKey)) {
    errors.idempotencyKey = 'تعذر التحقق من الطلب، أعد تحميل الصفحة وحاول مرة أخرى';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { name, phone, quantity, note, idempotencyKey },
  };
}

module.exports = { validateOrder, normalizePhone };
