/**
 * Общие утилиты для Cloudflare Pages Functions.
 * Работает в рантайме Workers: только Web API (fetch, crypto, Request/Response).
 */

export const BLOCKED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'];

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isTelegramUsername(value) {
  return /^@[a-zA-Z0-9_]{4,32}$/.test(String(value || '').trim());
}

// Строгая проверка: только безопасные символы, без кавычек и угловых скобок.
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24})$/;

export function emailDomain(value) {
  const match = String(value || '').trim().match(EMAIL_RE);
  return match ? match[1].toLowerCase() : '';
}

export function isEmailAddress(value) {
  const domain = emailDomain(value);
  return Boolean(domain) && !BLOCKED_EMAIL_DOMAINS.includes(domain);
}

/** Клиентский IP (Cloudflare всегда передаёт CF-Connecting-IP). */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/** Не даём сторонним сайтам отправлять заявки от имени посетителя (CSRF). */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // не браузер — пропускаем, дальше валидация
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Читает JSON с ограничением размера тела. */
export async function readJson(request, limitBytes = 10_000) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limitBytes) return { error: 'Слишком большой запрос' };

  const text = await request.text();
  if (new TextEncoder().encode(text).length > limitBytes) {
    return { error: 'Слишком большой запрос' };
  }

  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { error: 'Некорректный запрос' };
    }
    return { data };
  } catch {
    return { error: 'Некорректный запрос' };
  }
}

/** Короткий необратимый идентификатор IP — IP в хранилище не попадает. */
export async function hashIp(request, env) {
  const ip = clientIp(request);
  const salt = env.RATE_SALT || 'artem-portfolio';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/** Лимит запросов на ключ (KV, best-effort). Без KV лимит не работает. */
export async function allowRequest(env, key, max, windowSec) {
  if (!env.STATS) return true;
  const kvKey = `rl:${key}`;
  try {
    const current = Number((await env.STATS.get(kvKey)) || 0) + 1;
    if (current > max) return false;
    await env.STATS.put(kvKey, String(current), { expirationTtl: windowSec });
    return true;
  } catch (error) {
    // Если KV временно недоступен — не блокируем живых клиентов.
    console.error('[rate-limit] KV:', error.message);
    return true;
  }
}

/**
 * Проверка домена почты через DNS-over-HTTPS (в Workers нет node:dns).
 * MX → A → AAAA, как в локальном server.js.
 */
export async function isEmailDomainUsable(contact) {
  const domain = emailDomain(contact);
  if (!domain) return false;
  if (BLOCKED_EMAIL_DOMAINS.includes(domain)) return false;

  // Возвращает true (запись есть), false (записи нет) или null (сбой сети).
  const lookup = async (type) => {
    const urls = [
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
    ];

    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.Status === 0) {
          return Array.isArray(data.Answer) && data.Answer.length > 0;
        }
      } catch (error) {
        console.error('[dns]', type, error.message);
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  };

  for (const type of ['MX', 'A', 'AAAA']) {
    const result = await lookup(type);
    if (result === true) return true;
  }
  return false;
}

/** Контакт клиента: @ник → t.me-ссылка, email → mailto. */
export function contactMarkup(contact) {
  const raw = String(contact).trim();
  const telegram = raw.match(/^@([a-zA-Z0-9_]{4,32})$/);

  if (telegram) {
    const url = `https://t.me/${telegram[1]}`;
    return {
      text: `<a href="${url}">${escapeHtml(raw)}</a>`,
      button: { text: '💬 Написать в Telegram', url },
    };
  }

  if (isEmailAddress(raw)) {
    return {
      text: `<a href="mailto:${escapeHtml(raw)}">${escapeHtml(raw)}</a>`,
      button: null,
    };
  }

  return { text: escapeHtml(raw), button: null };
}

/** Отправка сообщения в Telegram. */
export async function sendTelegram(env, text, replyMarkup) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram не настроен');

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = { inline_keyboard: [[replyMarkup]] };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram ответил ${response.status}`);
  }
}

/** Cloudflare Turnstile: если секрет не задан — проверка пропускается. */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'Подтвердите, что вы человек' };

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => ({}));
    return data.success ? { ok: true } : { ok: false, error: 'Проверка не пройдена — попробуйте ещё раз' };
  } catch {
    return { ok: false, error: 'Проверка временно недоступна — попробуйте позже' };
  }
}
