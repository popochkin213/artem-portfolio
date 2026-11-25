/**
 * Сервер сайта-визитки.
 *
 * Делает две вещи:
 *   1. Раздаёт статические файлы (index.html, styles.css, script.js).
 *   2. Принимает POST /api/lead и пересылает заявку в Telegram.
 *
 * Запуск:  npm start   (или  node server.js)
 * Зависимостей нет — только встроенные модули Node.js.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');

// --- Настройки из .env ---------------------------------------------------
// process.loadEnvFile появился в Node 20.12+. Если файла нет — просто
// работаем с переменными окружения.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env ещё не создан — это нормально
}

const PORT = Number(process.env.PORT) || 8000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const IS_CONFIGURED = Boolean(BOT_TOKEN && CHAT_ID);

// --- Прокси ---------------------------------------------------------------
// Если Telegram недоступен напрямую (VPN-клиент, корпоративная сеть),
// достаточно указать HTTPS_PROXY в .env. На сервере строка не задана —
// запросы идут напрямую, ничего не ломается.
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (PROXY_URL) {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  console.log(`Прокси: ${PROXY_URL}`);
}

const ROOT = __dirname;

// --- Типы файлов ---------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// --- Проверки контактов ----------------------------------------------------
// Галочка согласия обязательна для любой заявки (152-ФЗ).
// Если в поле «Email или Telegram» вписали @никнейм — ещё нужна
// галочка «подтверждаю, что это мой Telegram».
function isTelegramUsername(value) {
  return /^@[a-zA-Z0-9_]{4,32}$/.test(String(value || '').trim());
}
const RATE_LIMIT = {
  max: Number(process.env.RATE_LIMIT_MAX) || 5,
  windowMs: (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 10) * 60 * 1000,
};
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now - entry.start > RATE_LIMIT.windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT.max;
}

// --- Утилиты -------------------------------------------------------------
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Telegram понимает HTML в сообщениях — экранируем пользовательский текст
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Читает тело запроса с ограничением размера (защита от переполнения)
function readBody(req, limitBytes = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// --- Отправка в Telegram -------------------------------------------------
// Делает контакт клиента кликабельным: @nickname превращается в ссылку
// на чат и в кнопку «Написать в Telegram» — ответить можно одним нажатием.
// mailto-ссылка — в Telegram HTML-разметка её поддерживает: клиент может
// одной кнопкой открыть почту и написать адресату самому.
function contactMarkup(contact) {
  const raw = String(contact).trim();
  const telegram = raw.match(/^@([a-zA-Z0-9_]{4,32})$/);

  if (telegram) {
    const url = `https://t.me/${telegram[1]}`;
    return {
      text: `<a href="${url}">${escapeHtml(raw)}</a>`,
      button: { text: '💬 Написать в Telegram', url },
    };
  }

  const email = raw.match(/^([^\s@]+@[^\s@]+\.[^\s@]{2,})$/);
  if (email) {
    return {
      text: `<a href="mailto:${escapeHtml(raw)}">${escapeHtml(raw)}</a>`,
      button: null,
    };
  }

  return { text: escapeHtml(raw), button: null };
}

// Проверяем, что домен почты на самом деле используется в DNS:
// есть MX-запись (настоящий почтовый сервер) или хотя бы A/AAAA.
async function isEmailDomainUsable(contact) {
  const raw = String(contact).trim();
  const match = raw.match(/^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/);
  if (!match) return true; // не email — ничего проверять не надо

  const domain = match[1].toLowerCase();
  const answers = (fn, arg) =>
    Promise.resolve()
      .then(() => fn(arg))
      .then((records) => records.length > 0)
      .catch(() => false);

  const hasMx = await answers(dns.resolveMx, domain);
  if (hasMx) return true;
  const hasA = await answers(dns.resolve4, domain);
  if (hasA) return true;
  const hasAAAA = await answers(dns.resolve6, domain);
  if (hasAAAA) return true;
  return false;
}

async function sendToTelegram({ name, contact, service, payment, message }) {
  const client = contactMarkup(contact);

  const text = [
    '🔔 <b>Новая заявка с сайта</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Контакт:</b> ${client.text}`,
    `<b>Услуга:</b> ${escapeHtml(service)}`,
    `<b>Оплата:</b> ${escapeHtml(payment)}`,
    '',
    `<b>Задача:</b>`,
    escapeHtml(message),
  ].join('\n');

  const body = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (client.button) {
    body.reply_markup = { inline_keyboard: [[client.button]] };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram ответил ${response.status}`);
  }
}

// Отдельное сообщение владельцу @никнейма: «подтвердите, что это ваш Telegram».
// Telegram сам не подтверждает, что это человек, поэтому каналом становится
// наличие диалога — подтвердить можно, нажав кнопку «Открыть диалог».
// Требуется, чтобы у бота был режим Privacy Mode ВЫКЛЮЧЕН (в @BotFather).
async function sendToTelegramVerify(username) {
  const url = `https://t.me/${username}`;
  const text = [
    `🔐 Заявка с сайта указала контакт <b>@${username}</b>`,
    'Для подтверждения, что это ваш Telegram:',
    '1) нажмите «Открыть диалог с ботом»;',
    '2) убедитесь, что это тот же чат, откуда пришли уведомления.',
  ].join('\n');

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: username,
      text: escapeHtml(text),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '💬 Открыть диалог с ботом', url }]] },
    }),
  });
}

// --- Обработчик заявки ---------------------------------------------------
async function handleLead(req, res) {
  // IP обрабатываем только в памяти: в логи, БД и сообщения Telegram не уходит.
  const ip = req.socket.remoteAddress || 'unknown';

  if (isRateLimited(ip)) {
    return json(res, 429, { ok: false, error: 'Слишком много заявок. Попробуйте позже.' });
  }

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { ok: false, error: 'Некорректный запрос' });
  }

  const name = String(data.name || '').trim().slice(0, 100);
  const contact = String(data.contact || '').trim().slice(0, 200);
  const tgUser = isTelegramUsername(contact) ? contact.slice(1) : '';
  const service = String(data.service || '').trim().slice(0, 100) || 'не указана';
  const payment = String(data.payment || '').trim().slice(0, 60) || 'не указан';
  const message = String(data.message || '').trim().slice(0, 4000);
  const verify = data.verify === true || data.verify === 'true' || data.verify === 'on';

  // Ловушка для ботов: поле скрыто от людей, но автозаполнялки его видят
  if (String(data.website || '').trim()) {
    console.log('[lead] отброшено: заполнено honeypot-поле');
    return json(res, 200, { ok: true }); // отвечаем «успех», чтобы бот не догадался
  }

  // Слишком быстрая отправка — человек физически не успеет за 1.5 секунды
  const elapsed = Number(data.elapsed) || 0;
  if (elapsed > 0 && elapsed < 1500) {
    console.log(`[lead] отброшено: отправлено за ${elapsed} мс`);
    return json(res, 200, { ok: true });
  }

  if (name.length < 2) {
    return json(res, 422, { ok: false, error: 'Укажите имя' });
  }

  // Серверная проверка формата email (клиент уже проверяет)
  const contactIsTelegram = isTelegramUsername(contact);
  const contactIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
  if (contact && !contactIsTelegram && !contactIsEmail) {
    return json(res, 422, { ok: false, error: 'Некорректный email или @никнейм' });
  }
  if (contactIsEmail && !(await isEmailDomainUsable(contact))) {
    return json(res, 422, { ok: false, error: 'Домен почты не проверен — проверьте адрес' });
  }

  if (tgUser && !verify) {
    return json(res, 422, { ok: false, error: 'Подтвердите, что номер в Telegram — ваш' });
  }

  // Без явного согласия данные обрабатывать нельзя (152-ФЗ)
  const consent = data.consent === true || data.consent === 'true' || data.consent === 'on';
  if (!consent) {
    return json(res, 422, { ok: false, error: 'Нужно согласие на обработку данных' });
  }
  if (contact.length < 3) {
    return json(res, 422, { ok: false, error: 'Укажите контакт' });
  }
  if (message.length < 10) {
    return json(res, 422, { ok: false, error: 'Опишите задачу подробнее' });
  }

  if (!IS_CONFIGURED) {
    console.warn('[lead] Telegram не настроен: нет TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');
    return json(res, 503, {
      ok: false,
      error: 'Отправка пока не настроена',
    });
  }

  try {
    await sendToTelegram({ name, contact, service, payment, message });
    if (tgUser) {
      // Добиваем владельца @никнейма — диалог показывает, что это его чат.
      await sendToTelegramVerify(tgUser).catch(() => {});
    }
    console.log(`[lead] отправлено: ${name} / ${contact} / ${service}`);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('[lead] ошибка Telegram:', error.message);
    return json(res, 502, { ok: false, error: 'Не удалось отправить' });
  }
}

// --- Статические файлы ---------------------------------------------------
function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));

  // /cases/coffee/ -> /cases/coffee/index.html
  if (relative.endsWith('/')) relative += 'index.html';

  const filePath = path.join(ROOT, relative);

  // Защита от выхода за пределы папки проекта (../../etc/passwd)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  // Не отдаём служебные файлы
  const base = path.basename(filePath);
  if (base.startsWith('.') || base === 'server.js' || base === 'package.json') {
    res.writeHead(404).end('Not found');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Страница не найдена');
      return;
    }

    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

// --- Сервер --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === '/api/lead' && req.method === 'POST') {
    return handleLead(req, res);
  }

  if (pathname === '/api/health') {
    return json(res, 200, { ok: true, telegramConfigured: IS_CONFIGURED });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { ok: false, error: 'Метод не поддерживается' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Сайт: http://localhost:${PORT}`);
  console.log(
    IS_CONFIGURED
      ? 'Telegram: настроен, заявки будут приходить в чат'
      : 'Telegram: НЕ настроен — заявки не отправляются (см. .env.example)',
  );
});
