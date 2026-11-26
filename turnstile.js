/* Cloudflare Turnstile — проверка «я не робот».
   Ключ берётся из <meta name="turnstile-site-key">. Если ключ пуст,
   виджет не загружается и форма работает как раньше.

   Если проверка не загрузилась, зависла или упала (VPN, блокировщик,
   старый браузер), форма не должна превращаться в тупик: показываем
   пояснение и разрешаем отправку. На сервере такая заявка идёт по более
   строгому лимиту — одна с IP за 10 минут. */
(() => {
  const meta = document.querySelector('meta[name="turnstile-site-key"]');
  const siteKey = meta ? meta.content.trim() : '';

  const wrap = document.getElementById('turnstile-wrap');
  const startedAt = Date.now();
  let token = '';
  let widgetId = null;
  let failed = false;
  let skipped = false;
  let fallbackButton = null;

  function widgetLooksBroken() {
    const container = document.getElementById('turnstile');
    if (!container) return true;

    const rect = container.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    // Пока виджет грузится, высота нулевая. Если через несколько секунд
    // он виден, но так и не вырос — проверка не поднялась.
    return visible && Date.now() - startedAt > 5000 && rect.height < 20;
  }

  function ensureFallbackButton() {
    if (!wrap || fallbackButton) return;

    fallbackButton = document.createElement('button');
    fallbackButton.type = 'button';
    fallbackButton.className = 'turnstile-skip';
    fallbackButton.textContent = 'Не проходит проверка? Отправить без неё';
    fallbackButton.hidden = true;
    fallbackButton.addEventListener('click', () => {
      skipped = true;
      token = '';
      showFallback('Проверка пропущена. Заявка всё равно дойдёт.');
      fallbackButton.hidden = true;
    });
    wrap.appendChild(fallbackButton);
  }

  function showFallback(message) {
    failed = true;
    if (!wrap) return;

    wrap.classList.add('turnstile-wrap--failed');

    let note = wrap.querySelector('.turnstile-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'turnstile-note';
      wrap.appendChild(note);
    }
    note.textContent = message || 'Проверка не загрузилась — заявку всё равно можно отправить.';
    note.hidden = false;
  }

  function clearFallback() {
    failed = false;
    if (!wrap) return;
    wrap.classList.remove('turnstile-wrap--failed');
    const note = wrap.querySelector('.turnstile-note');
    if (note) note.hidden = true;
    if (fallbackButton) fallbackButton.hidden = true;
  }

  window.PortfolioTurnstile = {
    required: () => Boolean(siteKey),
    getToken: () => token,
    // Проверка сломалась или пропущена — сервер разрешит отправку
    // с усиленным лимитом.
    unavailable: () => failed || skipped || widgetLooksBroken(),
    reset: () => {
      token = '';
      skipped = false;
      clearFallback();
      if (window.turnstile && widgetId !== null) {
        try {
          window.turnstile.reset(widgetId);
        } catch {
          /* виджет уже удалён — ничего страшного */
        }
      }
    },
  };

  if (!siteKey) return;

  if (wrap) {
    wrap.hidden = false;
    ensureFallbackButton();
  }

  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = () => {
    const container = document.getElementById('turnstile');
    if (!window.turnstile || !container) {
      showFallback('Проверка не загрузилась — заявку можно отправить без неё.');
      if (fallbackButton) fallbackButton.hidden = false;
      return;
    }

    try {
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: 'dark',
        language: 'ru',
        // На телефонах обычный виджет 300 px шире формы — берём компактный.
        size: window.matchMedia('(max-width: 420px)').matches ? 'compact' : 'normal',
        callback: (value) => {
          token = value;
          skipped = false;
          clearFallback();
        },
        'expired-callback': () => {
          token = '';
        },
        'error-callback': (code) => {
          token = '';
          console.error('[turnstile] ошибка проверки:', code);
          showFallback('Проверка не прошла — заявку всё равно можно отправить.');
          if (fallbackButton) fallbackButton.hidden = false;
        },
      });
    } catch (error) {
      console.error('[turnstile] render:', error);
      showFallback('Проверка не загрузилась — заявку можно отправить без неё.');
      if (fallbackButton) fallbackButton.hidden = false;
    }
  };
  script.onerror = () => {
    console.warn('[turnstile] не удалось загрузить проверку');
    showFallback('Проверка не загрузилась — заявку можно отправить без неё.');
    if (fallbackButton) fallbackButton.hidden = false;
  };
  document.head.appendChild(script);

  // Если через 8 секунд виджет так и не появился — показываем запасной
  // вариант. Если виджет рисуется нормально, кнопку не показываем:
  // человек должен поставить галочку, а не обходить проверку.
  setTimeout(() => {
    if (!token && !failed && widgetLooksBroken()) {
      showFallback('Проверка не загрузилась — заявку можно отправить без неё.');
      if (fallbackButton) fallbackButton.hidden = false;
    }
  }, 8000);
})();
