/* ============================================================
   Настройки формы
   ------------------------------------------------------------
   Заявка уходит на /api/lead: Cloudflare Function проверяет данные
   и пересылает её в Telegram (см. functions/api/lead.js).
   ============================================================ */
const CONFIG = {
  // Куда отправлять заявку. Обрабатывает functions/api/lead.js.
  endpoint: '/api/lead',

  // Минимальная длина сообщения
  minMessageLength: 10,
};

/* ============================================================
   Мелкие утилиты
   ============================================================ */

// Текущий год в подвале — чтобы не обновлять руками
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ============================================================
   Мобильное меню
   ------------------------------------------------------------
   На узких экранах навигация прячется в выпадающую панель.
   ============================================================ */
(() => {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  const close = () => {
    nav.classList.remove('nav--open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Открыть меню');
    toggle.textContent = '☰';
  };

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('nav--open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    toggle.textContent = open ? '✕' : '☰';
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target) && !toggle.contains(event.target)) close();
  });
})();

// Проверка: похоже ли на email.
// Тестовые/документационные домены запрещены: они примеряются в формах,
// а не реальные почтовые ящики.
const BLOCKED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'];
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24})$/;

function isEmailAddress(value) {
  const match = String(value || '').trim().match(EMAIL_RE);
  if (!match) return false;
  return !BLOCKED_EMAIL_DOMAINS.includes(match[1].toLowerCase());
}

// Проверка: похоже ли на @nickname из Telegram
function isTelegramUsername(value) {
  return /^@[a-zA-Z0-9_]{4,32}$/.test(String(value || '').trim());
}

/* ============================================================
   Валидация и отправка формы
   ============================================================ */
const form = document.getElementById('contact-form');
const statusEl = document.getElementById('form-status');
const consentLabel = document.getElementById('consent-label');

// Капча проходится один раз за визит страницы
let captchaPassed = false;

// Время открытия страницы — по нему сервер отсекает слишком быстрые отправки
const formLoadedAt = Date.now();

// Показывает/убирает ошибку у конкретного поля
function setError(fieldName, message) {
  const input = form.elements[fieldName];
  const errorEl = form.querySelector(`[data-error-for="${fieldName}"]`);
  const wrapper = input.closest('.field');

  if (message) {
    wrapper.classList.add('field--invalid');
    if (errorEl) errorEl.textContent = message;
  } else {
    wrapper.classList.remove('field--invalid');
    if (errorEl) errorEl.textContent = '';
  }
}

// Проверяет все поля. Возвращает true, если форма валидна.
function validate() {
  const name = form.elements.name.value.trim();
  const contact = form.elements.contact.value.trim();
  const service = form.elements.service.value;
  const message = form.elements.message.value.trim();
  const consent = form.elements.consent.checked;

  let ok = true;

  if (name.length < 2) {
    setError('name', 'Напишите, как к вам обращаться');
    ok = false;
  } else {
    setError('name', '');
  }

  const isTgContact = isTelegramUsername(contact);
  const isEmail = isEmailAddress(contact);

  if (!isTgContact && !isEmail) {
    setError('contact', 'Нужен email или @никнейм в Telegram');
    ok = false;
  } else {
    setError('contact', '');
  }

  if (!service) {
    setError('service', 'Выберите услугу — или «Другое / не знаю»');
    ok = false;
  } else {
    setError('service', '');
  }

  if (message.length < CONFIG.minMessageLength) {
    setError('message', `Опишите задачу подробнее (минимум ${CONFIG.minMessageLength} символов)`);
    ok = false;
  } else {
    setError('message', '');
  }

  consentLabel.classList.toggle('consent--invalid', !consent);
  if (!consent) ok = false;

  return ok;
}

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('form__status--error', isError);
}

// Основной обработчик отправки
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!validate()) {
    const hasFieldErrors = Boolean(form.querySelector('.field--invalid'));
    const needsConsent = !form.elements.consent.checked;
    showStatus(
      needsConsent && hasFieldErrors
        ? 'Проверьте поля выше и поставьте галочку согласия'
        : needsConsent
          ? 'Поставьте галочку согласия — без неё отправить нельзя'
          : 'Проверьте поля выше',
      true,
    );
    return;
  }

  // Cloudflare Turnstile (если ключ задан на странице).
  // Если проверка сломалась — не блокируем отправку: сервер применит
  // более строгий лимит, а остальные проверки останутся.
  const turnstile = window.PortfolioTurnstile;
  const turnstileFailed = Boolean(turnstile && turnstile.unavailable && turnstile.unavailable());
  if (turnstile && turnstile.required() && !turnstile.getToken() && !turnstileFailed) {
    showStatus('Поставьте галочку «Подтвердите, что вы человек» и отправьте ещё раз', true);
    return;
  }

  // Двухэтапная капча: сетка с фигурами, затем текст
  if (!captchaPassed && window.PortfolioCaptcha) {
    const captchaButton = form.querySelector('button[type="submit"]');
    captchaButton.disabled = true;
    try {
      const passed = await window.PortfolioCaptcha.verify();
      if (!passed) {
        showStatus('Отправка отменена — капча не пройдена', true);
        return;
      }
      captchaPassed = true;
    } finally {
      captchaButton.disabled = false;
    }
  }

  const contactValue = form.elements.contact.value.trim();
  const data = {
    name: form.elements.name.value.trim(),
    contact: contactValue,
    service: form.elements.service.value,
    payment: form.elements.payment.value,
    message: form.elements.message.value.trim(),
    consent: true,
    website: form.elements.website.value, // ловушка: у человека всегда пусто
    elapsed: Date.now() - formLoadedAt,
    sentAt: new Date().toISOString(),
    turnstileToken: turnstile ? turnstile.getToken() : '',
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  showStatus('Отправляем…');

  try {
    const response = await fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      if (response.status === 429) {
        throw new Error('Слишком много заявок за короткое время. Попробуйте через 10 минут.');
      }
      if (response.status === 503) {
        throw new Error('Отправка временно недоступна. Напишите мне в Telegram.');
      }
      throw new Error(result.error || 'Не получилось отправить заявку');
    }

    showStatus('Заявка отправлена! Отвечу в течение суток.');
    form.reset();
    renderPicked(null);
    hideServiceToast(true);
    if (turnstile) turnstile.reset();
  } catch (error) {
    console.error(error);
    showStatus(
      error instanceof Error && error.message
        ? error.message
        : 'Не получилось отправить. Напишите мне в Telegram.',
      true,
    );
  } finally {
    submitBtn.disabled = false;
  }
});

// Убираем ошибку, как только человек начал исправлять поле
['name', 'contact', 'message'].forEach((fieldName) => {
  form.elements[fieldName].addEventListener('input', () => setError(fieldName, ''));
});

form.elements.service.addEventListener('change', () => setError('service', ''));

form.elements.consent.addEventListener('change', () => {
  if (form.elements.consent.checked) consentLabel.classList.remove('consent--invalid');
});

/* ============================================================
   Кнопки «Выбрать» в блоке услуг
   ------------------------------------------------------------
   Подставляют пакет в форму заявки. Со страницы тарифов форма
   не видна, поэтому рядом с кнопкой появляется заметное
   подтверждение со ссылкой на заявку.
   ============================================================ */
const serviceToast = document.createElement('div');
serviceToast.className = 'service-toast';
serviceToast.hidden = true;
serviceToast.setAttribute('role', 'status');
serviceToast.setAttribute('aria-live', 'polite');
serviceToast.innerHTML =
  '<span class="service-toast__text"></span>' +
  '<a class="service-toast__link" href="#contact">К заявке</a>';

const serviceToastText = serviceToast.querySelector('.service-toast__text');
const serviceToastLink = serviceToast.querySelector('.service-toast__link');
let toastHideTimer = 0;

function hideServiceToast(instant) {
  window.clearTimeout(toastHideTimer);
  serviceToast.classList.remove('service-toast--show');

  if (instant) {
    serviceToast.hidden = true;
    return;
  }

  toastHideTimer = window.setTimeout(() => {
    serviceToast.hidden = true;
  }, 240);
}

function showServiceToast(text) {
  serviceToastText.textContent = text;
  serviceToast.hidden = false;
  // Принудительный пересчёт: без него браузер может не запустить анимацию
  void serviceToast.offsetHeight;
  serviceToast.classList.add('service-toast--show');

  // Плашка висит, пока выбран тариф: пропадает только при снятии выбора
  window.clearTimeout(toastHideTimer);
}

serviceToastLink.addEventListener('click', () => hideServiceToast());
document.body.append(serviceToast);

/* Выбранный пакет: галочка держится, пока выбор не снимут
   или не выберут другой пакет. */
const serviceButtons = [...document.querySelectorAll('[data-service]')];
const serviceSelect = form.elements.service;
const serviceField = serviceSelect.closest('.field');
let pickedService = null;

function renderPicked(value) {
  pickedService = value;

  serviceButtons.forEach((btn) => {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    const active = value !== null && btn.dataset.service === value;
    btn.textContent = active ? '✓ Выбрано' : btn.dataset.label;
    btn.classList.toggle('is-picked', active);
    btn.title = active ? 'Нажмите, чтобы снять выбор' : '';
  });
}

function clearPicked() {
  pickedService = null;
  serviceSelect.value = '';
  renderPicked(null);
  showStatus('');
  hideServiceToast(true);
  if (serviceField) serviceField.classList.remove('field--picked');
}

serviceButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.service;

    // Повторное нажатие на выбранный пакет снимает выбор
    if (pickedService === value) {
      clearPicked();
      return;
    }

    // Если такого варианта нет — ставим «Другое»
    const hasOption = [...serviceSelect.options].some((option) => option.value === value);
    serviceSelect.value = hasOption ? value : 'Другое / не знаю';

    setError('service', '');
    showStatus(`Выбрано: ${serviceSelect.value}`);
    renderPicked(value);
    showServiceToast(serviceSelect.value);

    // Подсвечиваем поле в форме — при переходе «К заявке» видно, куда смотреть
    if (serviceField) {
      serviceField.classList.add('field--picked');
      window.setTimeout(() => serviceField.classList.remove('field--picked'), 2600);
    }
  });
});

// Выбор вручную в форме: галочка переезжает на подходящий пакет или снимается
serviceSelect.addEventListener('change', () => {
  const value = serviceSelect.value;

  if (!value) {
    clearPicked();
    return;
  }

  const match = serviceButtons.find((btn) => btn.dataset.service === value);
  renderPicked(match ? value : null);
  if (!match) hideServiceToast(true);
});

/* ============================================================
   Плавное появление секций при прокрутке
   ============================================================ */
const revealTargets = document.querySelectorAll('.section, .card, .skill');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealTargets.forEach((el) => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}

/* ============================================================
   Уведомление о cookies
   ------------------------------------------------------------
   Показываем один раз. Выбор хранится в localStorage браузера,
   на сервер ничего не отправляется.
   ============================================================ */
const cookieBar = document.getElementById('cookie');
const cookieOk = document.getElementById('cookie-ok');
const COOKIE_KEY = 'cookie-notice-accepted';

try {
  if (cookieBar && !localStorage.getItem(COOKIE_KEY)) {
    cookieBar.hidden = false;
  }

  cookieOk?.addEventListener('click', () => {
    localStorage.setItem(COOKIE_KEY, '1');
    cookieBar.hidden = true;
  });
} catch {
  // Приватный режим браузера может запрещать localStorage — тогда
  // просто не показываем уведомление, сайт работает как обычно.
  if (cookieBar) cookieBar.hidden = true;
}

/* ============================================================
   Статистика посетителей (счётчик + Telegram-уведомление)
   ------------------------------------------------------------
   На каждый визит в localStorage сохраняем visitorId и пингуем
   POST /api/ping. Первый визит нового человека отправляет
   уведомление в Telegram. Ответ пинга сразу содержит счётчики —
   отдельный запрос за статистикой не нужен.
   ============================================================ */
(() => {
  const statsEl = document.getElementById('footer-stats');

  let visitorId = '';
  try {
    visitorId = localStorage.getItem('visitorId') || '';
    if (!visitorId) {
      visitorId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      localStorage.setItem('visitorId', visitorId);
    }
  } catch {
    // Приватный режим браузера может запрещать localStorage —
    // пингуем без идентификатора, счётчик просмотров всё равно работает.
    visitorId = '';
  }

  fetch('/api/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId }),
  })
    .then((r) => r.json().catch(() => ({})))
    .then((d) => {
      const visitors = Number(d && d.visitors) || 0;
      if (statsEl && visitors > 0) statsEl.textContent = `Посетителей: ${visitors}`;
    })
    .catch(() => {});
})();
