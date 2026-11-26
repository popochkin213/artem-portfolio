import { json, escapeHtml, readJson, allowRequest } from '../_lib/core.js';

async function send(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return null;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) return null;
  return result.result;
}

/**
 * Webhook для @artem_portfolio_bot: клиент пишет боту, сообщение приходит
 * владельцу в Telegram. Ответить можно по @username или ID из сообщения.
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Метод не поддерживается' }, 405);
  }

  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  const parsed = await readJson(request, 100_000);
  if (parsed.error) return json({ ok: true });

  const update = parsed.data;
  const message = update.message || update.edited_message;
  if (!message || !message.chat) return json({ ok: true });

  const from = message.from || {};
  const ownerId = String(env.TELEGRAM_CHAT_ID || '').trim();
  if (!ownerId) return json({ ok: true });

  // Сообщения самого владельца не пересылаем (иначе получится цикл).
  if (String(from.id) === ownerId || String(message.chat.id) === ownerId) {
    return json({ ok: true });
  }

  const clientChatId = message.chat.id;
  const text = String(message.text || '').trim();

  if (text === '/start') {
    await send(
      env,
      clientChatId,
      'Здравствуйте! Опишите задачу одним сообщением — я получу его и отвечу. Можно сразу прислать ссылку на сайт или пример.',
    ).catch(() => {});
    return json({ ok: true });
  }

  if (!(await allowRequest(env, `tg:${from.id || clientChatId}`, 10, 10 * 60))) {
    await send(env, clientChatId, 'Слишком много сообщений. Попробуйте через 10 минут.').catch(() => {});
    return json({ ok: true });
  }

  let body = text;
  if (!body && message.contact?.phone_number) body = `Телефон: ${message.contact.phone_number}`;
  if (!body && message.location) body = `Геолокация: ${message.location.latitude}, ${message.location.longitude}`;
  if (!body && message.photo) body = '[клиент отправил фото]';
  if (!body && message.document) body = '[клиент отправил файл]';
  if (!body && message.voice) body = '[клиент отправил голосовое]';
  if (!body) body = '[клиент отправил вложение]';

  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Клиент';
  const username = from.username ? `@${from.username}` : '';
  const lines = [
    '💬 <b>Сообщение из Telegram-бота</b>',
    `<b>От:</b> ${escapeHtml(name)}${username ? ` (${escapeHtml(username)})` : ''}`,
    username ? `Ссылка: https://t.me/${encodeURIComponent(from.username)}` : `ID: ${escapeHtml(String(from.id || ''))}`,
    '',
    escapeHtml(body),
  ];

  const sent = await send(env, ownerId, lines.join('\n'));
  if (sent) {
    await send(env, clientChatId, 'Сообщение отправлено. Отвечу в течение суток.').catch(() => {});
  }

  return json({ ok: true });
}
