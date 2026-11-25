/* ============================================================
   Настройки формы
   ------------------------------------------------------------
   Сейчас форма работает в демо-режиме: проверяет поля и показывает
   «отправлено», но никуда не уходит.
   На 3-й день мы подключим отправку заявок в Telegram — инструкция
   в README.md, раздел «Как получать заявки в Telegram».
   ============================================================ */
const CONFIG = {
  // Куда отправлять заявку. Обрабатывает server.js и пересылает в Telegram.
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

// Проверка: похоже ли на email.
// Тестовые/документационные домены запрещены: они примеряются в формах,
// а не реальные почтовые ящики.
const BLOCKED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'];

function isEmailAddress(value) {
  const m = String(value || '').trim().match(/^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/);
  if (!m) return false;
  const domain = m[1].toLowerCase();
  return !BLOCKED_EMAIL_DOMAINS.includes(domain);
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

  if (isTgContact) {
    // Реальность @никнейма проверяет сервер (DNS)
  } else if (isEmail) {
    // email введён корректно, формат удовлетворительный
  } else {
    setError('contact', 'Нужен email или @никнейм в Telegram');
    ok = false;
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
    showStatus(
      form.elements.consent.checked
        ? 'Проверьте поля выше'
        : 'Поставьте галочку согласия — без неё отправить нельзя',
      true,
    );
    return;
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
      throw new Error(result.error || 'Сервер ответил ошибкой');
    }

    showStatus('Заявка отправлена! Отвечу в течение суток.');
    form.reset();
  } catch (error) {
    console.error(error);
    showStatus(
      error.message === 'Домен почты не проверен — проверьте адрес'
        ? error.message
        : error.message === 'Отправка пока не подключена'
          ? 'Форма ещё не подключена к Telegram.'
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
   Подставляют пакет в форму заявки, не листая страницу вниз.
   ============================================================ */
document.querySelectorAll('[data-service]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.service;
    const select = form.elements.service;

    // Если такого варианта нет — ставим «Другое»
    const hasOption = [...select.options].some((option) => option.value === value);
    select.value = hasOption ? value : 'Другое / не знаю';

    setError('service', '');

    setTimeout(() => {
      // Не листаем вниз — фокус виден без скролла, пользователь остаётся наверху
      form.elements.name.focus({ preventScroll: true });
      showStatus(`Выбрано: ${select.value}`);
    }, 450);
  });
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
