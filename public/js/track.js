(function () {
  const { request, errorMessage, local } = window.Rukn;

  const CODE_STORAGE = 'rukn:last-code';
  const POLL_MS = 10000;
  const STEPS = [
    { status: 'new', title: 'جديد', text: 'استلمنا طلبك وسيبدأ تحضيره قريبًا' },
    { status: 'preparing', title: 'قيد التحضير', text: 'نحضّر قهوتك الآن' },
    { status: 'ready', title: 'جاهز', text: 'قهوتك جاهزة، تفضل بالاستلام من الكاونتر' },
  ];

  const form = document.getElementById('track-form');
  const input = document.getElementById('code');
  const codeError = document.getElementById('code-error');
  const result = document.getElementById('result');
  const summary = document.getElementById('summary');
  const waiting = document.getElementById('waiting');
  const stepsList = document.getElementById('steps');
  const stale = document.getElementById('stale');

  let timer = null;
  let activeCode = null;

  function cups(count) {
    if (count === 1) {
      return 'كوب واحد';
    }
    if (count === 2) {
      return 'كوبان';
    }
    return `${count} أكواب`;
  }

  function ordersBefore(count) {
    if (count === 1) {
      return 'قبلك طلب واحد';
    }
    if (count === 2) {
      return 'قبلك طلبان';
    }
    if (count <= 10) {
      return `قبلك ${count} طلبات`;
    }
    return `قبلك ${count} طلبًا`;
  }

  function showError(message) {
    codeError.textContent = message;
    codeError.hidden = !message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function render(order) {
    summary.textContent = `طلب رقم ${order.number}، ${cups(order.quantity)}`;
    if (order.status === 'new') {
      waiting.textContent = order.waitingBefore > 0 ? ordersBefore(order.waitingBefore) : 'طلبك هو التالي';
    } else if (order.status === 'preparing') {
      waiting.textContent = order.waitingBefore > 0 ? ordersBefore(order.waitingBefore) : '';
    } else {
      waiting.textContent = '';
    }

    const current = STEPS.findIndex((step) => step.status === order.status);
    stepsList.textContent = '';
    STEPS.forEach((step, index) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = step.title;
      const text = document.createElement('span');
      text.textContent = step.text;
      item.append(title, text);
      if (index < current) {
        item.className = 'passed';
      }
      if (index === current) {
        item.setAttribute('aria-current', 'step');
      }
      stepsList.appendChild(item);
    });
    result.hidden = false;
  }

  function stopPolling() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function lookup(code, { quiet = false } = {}) {
    try {
      const response = await request(`/api/orders/${encodeURIComponent(code)}`);
      if (!response.ok) {
        if (!quiet || response.status === 404) {
          result.hidden = true;
          stopPolling();
          showError(errorMessage(response));
        } else {
          stale.hidden = false;
        }
        return;
      }
      showError('');
      stale.hidden = true;
      activeCode = code;
      render(response.body.order);
      local.set(CODE_STORAGE, code);
      if (response.body.order.status === 'ready') {
        stopPolling();
      } else if (timer === null) {
        timer = setInterval(() => {
          if (!document.hidden) {
            lookup(activeCode, { quiet: true });
          }
        }, POLL_MS);
      }
    } catch (error) {
      if (quiet) {
        stale.hidden = false;
      } else {
        showError('تعذر الاتصال بالخادم، تأكد من الإنترنت وحاول مرة أخرى');
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    stopPolling();
    if (!code) {
      showError('اكتب رمز الطلب أولًا');
      input.focus();
      return;
    }
    input.value = code;
    history.replaceState(null, '', `?code=${encodeURIComponent(code)}`);
    lookup(code);
  });

  const fromAddress = new URLSearchParams(window.location.search).get('code');
  const start = (fromAddress || local.get(CODE_STORAGE) || '').trim().toUpperCase();
  if (start) {
    input.value = start;
    lookup(start);
  }
})();
