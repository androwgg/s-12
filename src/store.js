const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STATUSES = ['new', 'preparing', 'ready'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

class Store {
  constructor({ file = null, now = () => new Date() } = {}) {
    this.file = file;
    this.now = now;
    this.orders = [];
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) {
      return;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read ${this.file}: ${error.message}`);
    }
    if (data === null || typeof data !== 'object' || !Array.isArray(data.orders)) {
      throw new Error(`Cannot read ${this.file}: the file does not hold an orders list`);
    }
    this.orders = data.orders;
    if (this.orders.some((order) => order === null || typeof order !== 'object')) {
      throw new Error(`Cannot read ${this.file}: the orders list contains invalid entries`);
    }
  }

  save() {
    if (!this.file) {
      return;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ orders: this.orders }, null, 2));
    fs.renameSync(temporary, this.file);
  }

  freshCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      }
      if (!this.findByCode(code)) {
        return code;
      }
    }
  }

  forDay(day) {
    return this.orders.filter((order) => order.day === day);
  }

  reservedCups(day) {
    return this.forDay(day).reduce((total, order) => total + order.quantity, 0);
  }

  findByCode(code) {
    return this.orders.find((order) => order.code === code) || null;
  }

  findByKey(key) {
    return this.orders.find((order) => order.idempotencyKey === key) || null;
  }

  findOpenByPhone(phone, day) {
    return (
      this.orders.find(
        (order) => order.day === day && order.phone === phone && order.status !== 'ready'
      ) || null
    );
  }

  waitingBefore(order) {
    const position = this.orders.indexOf(order);
    return this.orders
      .slice(0, position)
      .filter((other) => other.day === order.day && other.status !== 'ready').length;
  }

  add(fields) {
    const stamp = this.now().toISOString();
    const order = {
      id: crypto.randomUUID(),
      code: this.freshCode(),
      number: this.forDay(fields.day).length + 1,
      ...fields,
      status: 'new',
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.orders.push(order);
    try {
      this.save();
    } catch (error) {
      this.orders.pop();
      throw error;
    }
    return order;
  }

  setStatus(order, status) {
    const previous = { status: order.status, updatedAt: order.updatedAt };
    order.status = status;
    order.updatedAt = this.now().toISOString();
    try {
      this.save();
    } catch (error) {
      Object.assign(order, previous);
      throw error;
    }
    return order;
  }
}

module.exports = { Store, STATUSES, CODE_LENGTH };
