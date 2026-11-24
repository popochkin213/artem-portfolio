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

// Проверка: похоже ли на email или на @nickname из Telegram
function isValidContact(value) {
  const v = value.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const isTelegram = /^@[a-zA-Z0-9_]{4,32}$/.test(v);
  return isEmail || isTelegram;
}

/* ============================================================
   Валидация и отправка формы
   ============================================================ */
const form = document.getElementById('contact-form');
const statusEl = document.getElementById('form-status');

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
  const message = form.elements.message.value.trim();

  let ok = true;

  if (name.length < 2) {
    setError('name', 'Напишите, как к вам обращаться');
    ok = false;
  } else {
    setError('name', '');
  }

  if (!isValidContact(contact)) {
    setError('contact', 'Нужен email или @никнейм в Telegram');
    ok = false;
  } else {
    setError('contact', '');
  }

  if (message.length < CONFIG.minMessageLength) {
    setError('message', `Опишите задачу подробнее (минимум ${CONFIG.minMessageLength} символов)`);
    ok = false;
  } else {
    setError('message', '');
  }

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
    showStatus('Проверьте поля выше', true);
    return;
  }

  const data = {
    name: form.elements.name.value.trim(),
    contact: form.elements.contact.value.trim(),
    message: form.elements.message.value.trim(),
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
      error.message === 'Отправка пока не настроена'
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
