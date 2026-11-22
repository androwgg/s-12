(function () {
  const { request, errorMessage, session, local } = window.Rukn;

  const KEY_STORAGE = 'rukn:order-key';
  const CODE_STORAGE = 'rukn:last-code';

  const form = document.getElementById('order-form');
  const submit = document.getElementById('submit');
  const formError = document.getElementById('form-error');
  const orderSection = document.getElementById('order-section');
  const closedSection = document.getElementById('closed-section');
  const doneSection = document.getElementById('done');
  const fields = ['name', 'phone', 'quantity', 'note'];

  let memoryKey = null;

  function makeKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function currentKey() {
    if (memoryKey === null) {
      memoryKey = session.get(KEY_STORAGE) || makeKey();
      session.set(KEY_STORAGE, memoryKey);
    }
    return memoryKey;
  }

  function resetKey() {
    memoryKey = null;
    session.remove(KEY_STORAGE);
  }

  function setFieldError(name, message) {
    const input = document.getElementById(name);
    const holder = document.getElementById(`${name}-error`);
    holder.textContent = message || '';
    holder.hidden = !message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function clearErrors() {
    fields.forEach((name) => setFieldError(name, ''));
    formError.hidden = true;
    formError.textContent = '';
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function renderBrew(brew) {
    document.getElementById('brew-title').textContent = `${brew.name}، ${brew.origin}`;
    document.getElementById('brew-notes').textContent = `نكهات اليوم: ${brew.notes}`;
    document.getElementById('brew-roast').textContent = brew.roast;
    document.getElementById('brew-origin').textContent = brew.origin;
    const stockText = document.getElementById('stock-text');
    const meter = document.getElementById('stock-meter');
    const percent = Math.round((brew.remaining / brew.totalCups) * 100);
    stockText.textContent =
      brew.remaining > 0
        ? `متبقٍ ${brew.remaining} من ${brew.totalCups} كوبًا`
        : 'انتهت كمية اليوم';
    meter.setAttribute('aria-valuenow', String(brew.remaining));
    meter.setAttribute('aria-valuemax', String(brew.totalCups));
    meter.firstElementChild.style.setProperty('--fill', String(percent));

    const quantity = document.getElementById('quantity');
    const limit = Math.min(brew.maxPerOrder, brew.remaining);
    quantity.textContent = '';
    for (let count = 1; count <= limit; count += 1) {
      const option = document.createElement('option');
      option.value = String(count);
      option.textContent = String(count);
      quantity.appendChild(option);
    }
    const soldOut = brew.remaining <= 0;
    orderSection.hidden = soldOut || !doneSection.hidden;
    closedSection.hidden = !soldOut;
  }

  async function loadBrew() {
    try {
      const result = await request('/api/brew');
      if (result.ok) {
        renderBrew(result.body);
      } else {
        showFormError(errorMessage(result));
      }
    } catch (error) {
      showFormError('تعذر الاتصال بالخادم، تأكد من الإنترنت ثم أعد تحميل الصفحة');
    }
  }

  function showDone(order) {
    document.getElementById('done-code').textContent = order.code;
    document.getElementById('done-number').textContent =
      `رقم طلبك اليوم ${order.number}، وعدد الأكواب ${order.quantity}.`;
    document.getElementById('done-track').href = `/track?code=${encodeURIComponent(order.code)}`;
    local.set(CODE_STORAGE, order.code);
    orderSection.hidden = true;
    doneSection.hidden = false;
    doneSection.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    submit.disabled = true;
    submit.textContent = 'جارٍ إرسال الطلب';
    try {
      const payload = {
        name: form.elements.name.value,
        phone: form.elements.phone.value,
        quantity: Number(form.elements.quantity.value),
        note: form.elements.note.value,
        idempotencyKey: currentKey(),
      };
      const result = await request('/api/orders', { method: 'POST', body: payload });
      if (result.ok) {
        resetKey();
        showDone(result.body.order);
        return;
      }
      const error = result.body && result.body.error;
      if (error && error.fields) {
        Object.entries(error.fields).forEach(([name, message]) => {
          if (fields.includes(name)) {
            setFieldError(name, message);
          } else {
            showFormError(message);
          }
        });
        const first = fields.find((name) => error.fields[name]);
        if (first) {
          document.getElementById(first).focus();
        }
      } else {
        showFormError(errorMessage(result));
        if (error && ['sold_out', 'not_enough_cups', 'idempotency_conflict'].includes(error.code)) {
          resetKey();
          loadBrew();
        }
      }
    } catch (networkError) {
      showFormError('تعذر الاتصال بالخادم. أعد المحاولة، ولن يتكرر طلبك إذا وصل من قبل');
    } finally {
      submit.disabled = false;
      submit.textContent = 'احجز كوبي';
    }
  });

  loadBrew();
})();
