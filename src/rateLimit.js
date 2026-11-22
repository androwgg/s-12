function createLimiter({ windowMs, max, now = () => new Date() }) {
  const windows = new Map();

  function prune(current) {
    for (const [key, entry] of windows) {
      if (current - entry.start >= windowMs) {
        windows.delete(key);
      }
    }
  }

  function hit(key) {
    const current = now().getTime();
    if (windows.size > 2000) {
      prune(current);
    }
    let entry = windows.get(key);
    if (!entry || current - entry.start >= windowMs) {
      entry = { start: current, count: 0 };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - current) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true, retryAfter: 0 };
  }

  function reset(key) {
    windows.delete(key);
  }

  return { hit, reset };
}

module.exports = { createLimiter };
