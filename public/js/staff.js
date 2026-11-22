(function () {
  const { request, errorMessage, timeAgo } = window.Rukn;

  const POLL_MS = 5000;
  const NEXT_STEP = {
    new: { status: 'preparing', label: 'ابدأ التحضير' },
    preparing: { status: 'ready', label: 'تم التجهيز' },
  };
  const COLUMNS = ['new', 'preparing', 'ready'];

  const loginSection = document.getElementById('login-section');
  const boardSection = document.getElementById('board-section');
  const loginForm = document.getElementById('login-form');
  const pinInput = document.getElementById('pin');
  const loginError = document.getElementById('login-error');
  const notice = document.getElementById('notice');
  const brewLine = document.getElementById('brew-line');

  let timer = null;
  let lastSnapshot = '';

  function show(section) {
    loginSection.hidden = section !== 'login';
    boardSection.hidden = section !== 'board';
  }

  function say(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function stopPolling() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startPolling() {
    if (timer === null) {
      timer = setInterval(() => {
        if (!document.hidden) {
          load();
        }
      }, POLL_MS);
    }
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function buildCard(order) {
    const card = node('li', 'card');

    const top = node('div', 'card-top');
    top.append(node('span', 'card-code', order.code), node('span', 'card-meta', `رقم ${order.number}`));
    card.appendChild(top);

    card.appendChild(node('p', 'card-name', order.name));

    const phone = node('a', 'card-meta', order.phone);
    phone.href = `tel:${order.phone}`;
    phone.setAttribute('dir', 'ltr');
    card.appendChild(phone);

    card.appendChild(node('p', 'card-meta', `عدد الأكواب ${order.quantity}، ${timeAgo(order.createdAt)}`));

    if (order.note) {
      card.appendChild(node('p', 'card-note', order.note));
    }

    const next = NEXT_STEP[order.status];
    if (next) {
      const button = node('button', 'primary', next.label);
      button.type = 'button';
      button.setAttribute('aria-label', `${next.label}، طلب ${order.code} باسم ${order.name}`);
      button.addEventListener('click', () => advance(order.code, next.status, button));
      card.appendChild(button);
    }
    return card;
  }

  function render(data) {
    const snapshot = `${Math.floor(Date.now() / 60000)}|${JSON.stringify(data)}`;
    if (snapshot === lastSnapshot) {
      return;
    }
    lastSnapshot = snapshot;
    const { orders, brew } = data;
    brewLine.textContent = `${brew.name}، ${brew.origin}. متبقٍ ${brew.remaining} من ${brew.totalCups} كوبًا`;
    COLUMNS.forEach((status) => {
      const rows = orders.filter((order) => order.status === status);
      rows.sort((a, b) =>
        status === 'ready'
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.createdAt.localeCompare(b.createdAt)
      );
      const list = document.getElementById(`list-${status}`);
      list.textContent = '';
      if (rows.length === 0) {
        const empty = node('li', 'empty', 'لا توجد طلبات هنا');
        list.appendChild(empty);
      }
      rows.forEach((order) => list.appendChild(buildCard(order)));
      document.getElementById(`count-${status}`).textContent = String(rows.length);
    });
  }

  async function load() {
    try {
      const response = await request('/api/staff/orders');
      if (response.status === 401) {
        stopPolling();
        show('login');
        return;
      }
      if (!response.ok) {
        say(errorMessage(response));
        return;
      }
      show('board');
      say('');
      render(response.body);
      startPolling();
    } catch (error) {
      say('تعذر الاتصال بالخادم، نحاول مرة أخرى تلقائيًا');
    }
  }

  async function advance(code, status, button) {
    button.disabled = true;
    say('');
    try {
      const response = await request(`/api/staff/orders/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        body: { status },
      });
      if (response.status === 401) {
        stopPolling();
        show('login');
        return;
      }
      if (!response.ok) {
        say(errorMessage(response));
      }
    } catch (error) {
      say('تعذر الاتصال بالخادم، لم يتغير شيء. حاول مرة أخرى');
    }
    lastSnapshot = '';
    await load();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    pinInput.removeAttribute('aria-invalid');
    try {
      const response = await request('/api/staff/login', {
        method: 'POST',
        body: { pin: pinInput.value },
      });
      if (!response.ok) {
        loginError.textContent = errorMessage(response);
        loginError.hidden = false;
        pinInput.setAttribute('aria-invalid', 'true');
        pinInput.select();
        return;
      }
      pinInput.value = '';
      say('');
      lastSnapshot = '';
      await load();
    } catch (error) {
      loginError.textContent = 'تعذر الاتصال بالخادم، حاول مرة أخرى';
      loginError.hidden = false;
    }
  });

  document.getElementById('logout').addEventListener('click', async () => {
    stopPolling();
    try {
      await request('/api/staff/logout', { method: 'POST', body: {} });
    } catch (error) {
      say('تعذر إنهاء الجلسة، أغلق المتصفح لإنهائها');
      return;
    }
    show('login');
    pinInput.focus();
  });

  load();
})();
