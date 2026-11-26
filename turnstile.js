/* Cloudflare Turnstile — невидимая проверка «я не робот».
   Ключ берётся из <meta name="turnstile-site-key">. Если ключ пуст,
   виджет не загружается и форма работает как раньше. */
(() => {
  const meta = document.querySelector('meta[name="turnstile-site-key"]');
  const siteKey = meta ? meta.content.trim() : '';

  let token = '';
  let widgetId = null;

  window.PortfolioTurnstile = {
    required: () => Boolean(siteKey),
    getToken: () => token,
    reset: () => {
      token = '';
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

  const wrap = document.getElementById('turnstile-wrap');
  if (wrap) wrap.hidden = false;

  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.onload = () => {
    const container = document.getElementById('turnstile');
    if (!window.turnstile || !container) return;

    widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      theme: 'dark',
      language: 'ru',
      // На телефонах обычный виджет 300 px шире формы — берём компактный.
      size: window.matchMedia('(max-width: 420px)').matches ? 'compact' : 'normal',
      callback: (value) => {
        token = value;
      },
      'expired-callback': () => {
        token = '';
      },
      'error-callback': () => {
        token = '';
      },
    });
  };
  script.onerror = () => {
    console.warn('[turnstile] не удалось загрузить проверку');
  };
  document.head.appendChild(script);
})();
