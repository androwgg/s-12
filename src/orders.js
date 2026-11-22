const { HttpError } = require('./errors');
const { dayKey, brewForDay } = require('./brew');
const { STATUSES } = require('./store');

function sameRequest(order, input) {
  return (
    order.name === input.name &&
    order.phone === input.phone &&
    order.quantity === input.quantity &&
    order.note === input.note
  );
}

function createOrderService({ store, config, now }) {
  function today() {
    return dayKey(now(), config.timezone);
  }

  function brew() {
    const day = today();
    const reserved = store.reservedCups(day);
    return {
      day,
      ...brewForDay(day),
      totalCups: config.dailyCups,
      remaining: Math.max(0, config.dailyCups - reserved),
      maxPerOrder: config.maxPerOrder,
    };
  }

  function customerView(order) {
    return {
      code: order.code,
      number: order.number,
      quantity: order.quantity,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      waitingBefore: order.status === 'ready' ? 0 : store.waitingBefore(order),
    };
  }

  function staffView(order) {
    return {
      code: order.code,
      number: order.number,
      name: order.name,
      phone: order.phone,
      quantity: order.quantity,
      note: order.note,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  function place(input) {
    const previous = store.findByKey(input.idempotencyKey);
    if (previous) {
      if (sameRequest(previous, input)) {
        return { order: previous, replayed: true };
      }
      throw new HttpError(
        409,
        'idempotency_conflict',
        'هذا الطلب أُرسل من قبل ببيانات مختلفة، اضغط احجز مرة أخرى لإرسال طلب جديد'
      );
    }

    const day = today();
    if (store.findOpenByPhone(input.phone, day)) {
      throw new HttpError(
        409,
        'open_order_exists',
        'لديك طلب قيد الانتظار بهذا الرقم، تابعه من صفحة التتبع وبعد أن يصبح جاهزًا يمكنك طلب كوب آخر'
      );
    }

    const remaining = config.dailyCups - store.reservedCups(day);
    if (remaining <= 0) {
      throw new HttpError(409, 'sold_out', 'انتهت كمية قهوة اليوم، نراك غدًا بتحميص جديد');
    }
    if (input.quantity > remaining) {
      throw new HttpError(
        409,
        'not_enough_cups',
        `المتبقي من قهوة اليوم ${remaining} فقط، قلّل عدد الأكواب`,
        { remaining }
      );
    }

    const order = store.add({
      day,
      name: input.name,
      phone: input.phone,
      quantity: input.quantity,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    });
    return { order, replayed: false };
  }

  function track(code) {
    const order = store.findByCode(code);
    if (!order) {
      throw new HttpError(404, 'not_found', 'لم نجد طلبًا بهذا الرمز، تأكد من كتابته');
    }
    return customerView(order);
  }

  function listForStaff() {
    return store.forDay(today()).map(staffView);
  }

  function advance(code, status) {
    const order = store.findByCode(code);
    if (!order) {
      throw new HttpError(404, 'not_found', 'الطلب غير موجود');
    }
    if (!STATUSES.includes(status)) {
      throw new HttpError(400, 'bad_status', 'الحالة غير معروفة');
    }
    const next = STATUSES[STATUSES.indexOf(order.status) + 1];
    if (status !== next) {
      throw new HttpError(
        409,
        'invalid_transition',
        'لا يمكن تغيير الحالة بهذا الترتيب، حدّث الشاشة وحاول مرة أخرى'
      );
    }
    return staffView(store.setStatus(order, status));
  }

  return { brew, place, track, listForStaff, advance, customerView };
}

module.exports = { createOrderService };
