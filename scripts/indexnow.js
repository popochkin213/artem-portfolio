/**
 * IndexNow: сообщает Яндексу, Bing и другим поисковикам об обновлении страниц.
 * Запускается после деплоя. Если сервис недоступен — деплой не ломается.
 */
const fs = require('node:fs');
const path = require('node:path');

const SITE_URL = (process.env.SITE_URL || 'https://artem-portfolio-7m4.pages.dev').replace(/\/+$/, '');
const KEY = process.env.INDEXNOW_KEY || '5e36dd9c2416e3d4d8abd29978bffeb6';

const sitemap = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

if (urls.length === 0) {
  console.log('IndexNow: в sitemap нет URL');
  process.exit(0);
}

(async () => {
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE_URL).host,
        key: KEY,
        keyLocation: `${SITE_URL}/${KEY}.txt`,
        urlList: urls,
      }),
    });

    console.log(`IndexNow: HTTP ${response.status}, отправлено URL: ${urls.length}`);
    if (!response.ok) {
      console.log('IndexNow: поисковик ответил ошибкой, попробуем при следующем деплое');
    }
  } catch (error) {
    console.log(`IndexNow: сеть недоступна (${error.message}), пропускаем`);
  }
})();
