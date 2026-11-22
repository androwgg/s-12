(function () {
  async function request(path, options = {}) {
    const { method = 'GET', body } = options;
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    return { ok: response.ok, status: response.status, body: payload };
  }

  function errorMessage(result) {
    if (result.body && result.body.error && result.body.error.message) {
      return result.body.error.message;
    }
    return 'حدث خطأ غير متوقع، حاول مرة أخرى';
  }

  function timeAgo(isoText) {
    const minutes = Math.floor((Date.now() - new Date(isoText).getTime()) / 60000);
    if (minutes < 1) {
      return 'الآن';
    }
    if (minutes < 60) {
      return `منذ ${minutes} دقيقة`;
    }
    return `منذ ${Math.floor(minutes / 60)} ساعة`;
  }

  function keep(name) {
    function area() {
      try {
        return window[name];
      } catch (error) {
        return null;
      }
    }

    return {
      get(key) {
        try {
          return area().getItem(key);
        } catch (error) {
          return null;
        }
      },
      set(key, value) {
        try {
          area().setItem(key, value);
        } catch (error) {
          return;
        }
      },
      remove(key) {
        try {
          area().removeItem(key);
        } catch (error) {
          return;
        }
      },
    };
  }

  window.Rukn = {
    request,
    errorMessage,
    timeAgo,
    session: keep('sessionStorage'),
    local: keep('localStorage'),
  };
})();
