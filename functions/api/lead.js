import {
  escapeHtml,
  isEmailAddress,
  isEmailDomainUsable,
  isSameOrigin,
  isTelegramUsername,
  json,
  readJson,
  allowRequest,
  hashIp,
  contactMarkup,
  sendTelegram,
  verifyTurnstile,
} from '../_lib/core.js';

const RATE_MAX = 5;
const RATE_WINDOW_SEC = 10 * 60;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Метод не поддерживается' }, 405);
  }
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: 'Запрос с чужого сайта' }, 403);
  }

  const ipKey = await hashIp(request, env);
  if (!(await allowRequest(env, `lead:${ipKey}`, RATE_MAX, RATE_WINDOW_SEC))) {
    return json({ ok: false, error: 'Слишком много заявок. Попробуйте позже.' }, 429);
  }

  const parsed = await readJson(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, 400);

  const data = parsed.data || {};
  const name = String(data.name || '').trim().slice(0, 100);
  const contact = String(data.contact || '').trim().slice(0, 200);
  const service = String(data.service || '').trim().slice(0, 100) || 'не указана';
  const payment = String(data.payment || '').trim().slice(0, 60) || 'не указан';
  const message = String(data.message || '').trim().slice(0, 4000);

  // Ловушка для ботов
  if (String(data.website || '').trim()) {
    return json({ ok: true });
  }

  // Слишком быстрая отправка — почти наверняка скрипт
  const elapsed = Number(data.elapsed) || 0;
  if (elapsed > 0 && elapsed < 1500) {
    return json({ ok: true });
  }

  const turnstileToken = String(data.turnstileToken || '');
  if (turnstileToken) {
    const turnstile = await verifyTurnstile(env, turnstileToken, request.headers.get('CF-Connecting-IP'));
    if (!turnstile.ok) {
      return json({ ok: false, error: turnstile.error }, 403);
    }
  } else if (env.TURNSTILE_SECRET) {
    // Виджет не загрузился или сломался (VPN, блокировщик, старый браузер).
    // Не теряем живого клиента, но разрешаем только одну такую заявку
    // с IP за 10 минут. Токен с ошибкой по-прежнему блокируется выше.
    if (!(await allowRequest(env, `lead-nocap:${ipKey}`, 1, 10 * 60))) {
      return json({ ok: false, error: 'Слишком много попыток. Попробуйте позже' }, 429);
    }
  }

  if (name.length < 2) {
    return json({ ok: false, error: 'Укажите имя' }, 422);
  }

  const contactIsTelegram = isTelegramUsername(contact);
  const contactIsEmail = isEmailAddress(contact);
  if (contact && !contactIsTelegram && !contactIsEmail) {
    return json({ ok: false, error: 'Некорректный email или @никнейм' }, 422);
  }
  if (contactIsEmail && !(await isEmailDomainUsable(contact))) {
    return json({ ok: false, error: 'Домен почты не проверен — проверьте адрес' }, 422);
  }

  const consent = data.consent === true || data.consent === 'true' || data.consent === 'on';
  if (!consent) {
    return json({ ok: false, error: 'Нужно согласие на обработку данных' }, 422);
  }
  if (contact.length < 3) {
    return json({ ok: false, error: 'Укажите контакт' }, 422);
  }
  if (message.length < 10) {
    return json({ ok: false, error: 'Опишите задачу подробнее' }, 422);
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ ok: false, error: 'Отправка временно недоступна' }, 503);
  }

  const client = contactMarkup(contact);
  const text = [
    '🔔 <b>Новая заявка с сайта</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Контакт:</b> ${client.text}`,
    `<b>Услуга:</b> ${escapeHtml(service)}`,
    `<b>Оплата:</b> ${escapeHtml(payment)}`,
    '',
    '<b>Задача:</b>',
    escapeHtml(message),
  ].join('\n');

  try {
    await sendTelegram(env, text, client.button);
    return json({ ok: true });
  } catch (error) {
    console.error('[lead] Telegram:', error.message);
    return json({ ok: false, error: 'Не удалось отправить' }, 502);
  }
}
