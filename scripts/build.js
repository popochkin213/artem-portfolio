/**
 * Сборка статической версии для Cloudflare Pages.
 *
 * Копирует в dist/ только публичные файлы (без .env, README, функций),
 * считает SHA-256 всех inline-скриптов и генерирует dist/_headers
 * с жёсткой Content-Security-Policy без 'unsafe-inline' для скриптов.
 *
 * Запуск: npm run build
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Локальные .env и .dev.vars (в git не попадают) — чтобы SITE_URL и ключ
// Turnstile подхватывались без ручного ввода. На Cloudflare эти переменные
// задаются в настройках проекта и имеют приоритет.
function loadLocalEnv() {
  for (const name of ['.env', '.dev.vars']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const PUBLIC_ITEMS = [
  'index.html',
  'styles.css',
  'script.js',
  'turnstile.js',
  'faq.html',
  'audit.html',
  'sandbox.html',
  'sandbox.js',
  'privacy.html',
  'terms.html',
  '404.html',
  'favicon.svg',
  'og-image.png',
  '5e36dd9c2416e3d4d8abd29978bffeb6.txt',
  'robots.txt',
  'sitemap.xml',
  'cases',
];

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function walk(dir, extension, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extension, out);
    else if (full.endsWith(extension)) out.push(full);
  }
  return out;
}

// 1. Чистая сборка
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const item of PUBLIC_ITEMS) {
  const source = path.join(ROOT, item);
  if (!fs.existsSync(source)) {
    console.warn(`[build] пропущено (нет файла): ${item}`);
    continue;
  }
  copyRecursive(source, path.join(DIST, item));
}

// 2. Приводим текстовые файлы к LF: браузер всё равно нормализует переводы
//    строк, а хеши inline-скриптов для CSP должны совпадать с тем, что видит
//    браузер. С CRLF хеши бы не сошлись.
for (const extension of ['.html', '.css', '.js', '.xml', '.txt']) {
  for (const file of walk(DIST, extension)) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    fs.writeFileSync(file, text, 'utf8');
  }
}

// 3. Адрес сайта и ключ Turnstile можно задать переменными окружения.
//    По умолчанию — бесплатный поддомен pages.dev.
const SITE_URL = (process.env.SITE_URL || 'https://artem-portfolio-7m4.pages.dev').replace(/\/+$/, '');
const TURNSTILE_SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const CF_BEACON_TOKEN = (process.env.CF_BEACON_TOKEN || '').trim();
const GOOGLE_SITE_VERIFICATION = (process.env.GOOGLE_SITE_VERIFICATION || '').trim();
const YANDEX_VERIFICATION = (process.env.YANDEX_VERIFICATION || '').trim();
const today = new Date().toISOString().slice(0, 10);

if (!/^https:\/\/[a-z0-9.-]+$/i.test(SITE_URL)) {
  throw new Error(`[build] некорректный SITE_URL: ${SITE_URL}`);
}
for (const [name, value] of [
  ['TURNSTILE_SITE_KEY', TURNSTILE_SITE_KEY],
  ['CF_BEACON_TOKEN', CF_BEACON_TOKEN],
  ['GOOGLE_SITE_VERIFICATION', GOOGLE_SITE_VERIFICATION],
  ['YANDEX_VERIFICATION', YANDEX_VERIFICATION],
]) {
  if (value && !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`[build] некорректный ${name}`);
  }
}

const textFiles = [
  ...walk(DIST, '.html'),
  path.join(DIST, 'sitemap.xml'),
  path.join(DIST, 'robots.txt'),
];

for (const file of textFiles) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.split('https://artem-portfolio-7m4.pages.dev').join(SITE_URL);

  if (TURNSTILE_SITE_KEY) {
    text = text.split('<meta name="turnstile-site-key" content="">')
      .join(`<meta name="turnstile-site-key" content="${TURNSTILE_SITE_KEY}">`);
  }

  if (file.endsWith('sitemap.xml')) {
    text = text.replace(/<lastmod>[^<]+<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
  }

  // Подтверждение владения сайтом для поисковиков (если заданы токены).
  if (path.relative(DIST, file) === 'index.html') {
    let verification = '';
    if (GOOGLE_SITE_VERIFICATION) {
      verification += `\n  <meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}">`;
    }
    if (YANDEX_VERIFICATION) {
      verification += `\n  <meta name="yandex-verification" content="${YANDEX_VERIFICATION}">`;
    }
    if (verification) text = text.replace('</head>', `${verification}\n</head>`);
  }

  // Cloudflare Web Analytics: только если задан токен сайта.
  if (CF_BEACON_TOKEN && text.includes('</body>')) {
    const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${CF_BEACON_TOKEN}"}'></script>`;
    text = text.replace('</body>', `  ${beacon}\n</body>`);
  }

  fs.writeFileSync(file, text, 'utf8');
}

// 4. Версии CSS/JS в ссылках. После правки файла меняется хеш, поэтому
//    браузер не возьмёт старую версию из 10-минутного кеша.
const htmlFiles = walk(DIST, '.html');
const assetVersions = new Map();

for (const asset of ['styles.css', 'script.js', 'sandbox.js', 'turnstile.js']) {
  const file = path.join(DIST, asset);
  if (!fs.existsSync(file)) continue;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  assetVersions.set(asset, hash);
}

for (const file of htmlFiles) {
  let html = fs.readFileSync(file, 'utf8');
  for (const [asset, version] of assetVersions) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`((?:href|src)=["'][^"']*/?)${escaped}(?:\\?[^"']*)?(["'])`, 'g');
    html = html.replace(pattern, `$1${asset}?v=${version}$2`);
  }
  fs.writeFileSync(file, html, 'utf8');
}

// 5. Проверки перед публикацией: никаких inline-обработчиков и javascript:
//    (они несовместимы с жёсткой CSP и обычно означают XSS-риск).
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const relative = path.relative(DIST, file);

  if (/\son[a-z]+\s*=\s*["']/i.test(html)) {
    throw new Error(`[build] inline-обработчик события в ${relative}`);
  }
  if (/javascript\s*:/i.test(html)) {
    throw new Error(`[build] ссылка javascript: в ${relative}`);
  }
}

// 6. Хеши inline-скриптов для CSP
const scriptHashes = new Set();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const pattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    if (!match[1].trim()) continue;
    const hash = crypto.createHash('sha256').update(match[1], 'utf8').digest('base64');
    scriptHashes.add(`'sha256-${hash}'`);
  }
}

const scriptSources = ["'self'", 'https://challenges.cloudflare.com', ...scriptHashes];
const connectSources = ["'self'", 'https://challenges.cloudflare.com'];
if (CF_BEACON_TOKEN) {
  scriptSources.push('https://static.cloudflareinsights.com');
  connectSources.push('https://cloudflareinsights.com');
}

const csp = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  `script-src ${scriptSources.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${connectSources.join(' ')}`,
  "frame-src 'self' https://challenges.cloudflare.com",
  "manifest-src 'self'",
  "media-src 'self'",
  "worker-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

// 7. Заголовки безопасности
const htmlRoutes = [
  '/',
  '/index.html',
  '/faq',
  '/faq.html',
  '/sandbox',
  '/sandbox.html',
  '/audit',
  '/audit.html',
  '/privacy',
  '/privacy.html',
  '/terms',
  '/terms.html',
  '/404.html',
  '/cases/coffee/',
  '/cases/calculator/',
  '/cases/dashboard/',
];
const htmlCacheRules = htmlRoutes
  .map((route) => `${route}\n  Cache-Control: no-cache`)
  .join('\n\n');

const headers = `# Сгенерировано scripts/build.js — не редактировать вручную

# Статика: короткий кеш, чтобы правки появлялись быстро
/styles.css
  Cache-Control: public, max-age=600

/script.js
  Cache-Control: public, max-age=600

/sandbox.js
  Cache-Control: public, max-age=600

/turnstile.js
  Cache-Control: public, max-age=600

/favicon.svg
  Cache-Control: public, max-age=86400

/og-image.png
  Cache-Control: public, max-age=86400

/robots.txt
  Cache-Control: public, max-age=600

/sitemap.xml
  Cache-Control: public, max-age=600

# HTML: браузер всегда проверяет свежесть
${htmlCacheRules}

# Жёсткая CSP и запрет встраивания
/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  X-XSS-Protection: 0
  X-Permitted-Cross-Domain-Policies: none
  X-DNS-Prefetch-Control: off
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
`;

fs.writeFileSync(path.join(DIST, '_headers'), headers, 'utf8');

// 8. Функции вызываются только для /api/* — статика идёт мимо них
fs.writeFileSync(
  path.join(DIST, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2),
  'utf8',
);

// 9. Браузеры по привычке просят /favicon.ico — отправляем на SVG.
fs.writeFileSync(path.join(DIST, '_redirects'), '/favicon.ico /favicon.svg 302\n', 'utf8');

console.log(`[build] dist готов: ${walk(DIST, '.html').length} HTML, CSP-хешей: ${scriptHashes.size}`);
