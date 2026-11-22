const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOrder, normalizePhone } = require('../src/validate');

const limits = { maxPerOrder: 3 };
const validInput = {
  name: 'سارة علي',
  phone: '01012345678',
  quantity: 2,
  note: 'بدون سكر',
  idempotencyKey: 'abcdefgh12345678',
};

test('accepts a complete valid order', () => {
  const result = validateOrder(validInput, limits);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.value.quantity, 2);
});

test('rejects non-object bodies with every field error', () => {
  for (const body of [null, 'text', 42, [], undefined]) {
    const result = validateOrder(body, limits);
    assert.equal(result.ok, false);
    assert.ok(result.errors.name && result.errors.phone && result.errors.quantity);
    assert.ok(result.errors.idempotencyKey);
  }
});

test('normalizes Egyptian phone formats', () => {
  assert.equal(normalizePhone('0101 234 5678'), '01012345678');
  assert.equal(normalizePhone('+201012345678'), '01012345678');
  assert.equal(normalizePhone('00201012345678'), '01012345678');
  assert.equal(normalizePhone('201012345678'), '01012345678');
  assert.equal(normalizePhone('٠١٠١٢٣٤٥٦٧٨'), '01012345678');
  assert.equal(normalizePhone('۰۱۰۱۲۳۴۵۶۷۸'), '01012345678');
});

test('rejects phone numbers that are not Egyptian mobiles', () => {
  for (const phone of ['', '0101234567', '01312345678', '0212345678', 'abc', '010123456789']) {
    const result = validateOrder({ ...validInput, phone }, limits);
    assert.ok(result.errors.phone, `expected error for ${phone}`);
  }
  assert.ok(validateOrder({ ...validInput, phone: 1012345678 }, limits).errors.phone);
});

test('validates the name', () => {
  for (const name of ['', 'ا', 'x'.repeat(41), '123', '<b>x</b>', 12, null]) {
    assert.ok(validateOrder({ ...validInput, name }, limits).errors.name, String(name));
  }
  assert.equal(validateOrder({ ...validInput, name: "  Amr   O'Neil " }, limits).value.name, "Amr O'Neil");
});

test('validates the quantity', () => {
  for (const quantity of [0, 4, -1, 1.5, '', 'x', null, undefined, '100']) {
    assert.ok(validateOrder({ ...validInput, quantity }, limits).errors.quantity, String(quantity));
  }
  assert.equal(validateOrder({ ...validInput, quantity: '3' }, limits).value.quantity, 3);
});

test('validates and cleans the note', () => {
  assert.ok(validateOrder({ ...validInput, note: 'x'.repeat(101) }, limits).errors.note);
  assert.ok(validateOrder({ ...validInput, note: 5 }, limits).errors.note);
  assert.equal(validateOrder({ ...validInput, note: undefined }, limits).value.note, '');
  assert.equal(validateOrder({ ...validInput, note: 'a\u0000b\nc' }, limits).value.note, 'a b c');
});

test('validates the idempotency key', () => {
  for (const idempotencyKey of ['short', 'has space in it 123', 'x'.repeat(65), 5, null]) {
    assert.ok(
      validateOrder({ ...validInput, idempotencyKey }, limits).errors.idempotencyKey,
      String(idempotencyKey)
    );
  }
});
