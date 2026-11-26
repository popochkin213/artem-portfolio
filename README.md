# Сайт-визитка на Cloudflare Pages

**Живая версия:** https://artem-portfolio-7m4.pages.dev

Тёмный адаптивный лендинг: услуги, цены, кейсы, песочница, форма заявки.
Заявки приходят в Telegram. Статика раздаётся с CDN, форма и счётчик работают
на Cloudflare Pages Functions.

## Локальный запуск

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars   # один раз
npm run preview                          # http://localhost:8788
```

В `.dev.vars` заполните `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`.
`npm run preview` собирает `dist/` и запускает сайт в том же окружении,
что и Cloudflare (функции + локальный KV для счётчика).

Старый локальный сервер тоже остался: `npm start` → http://localhost:8000.
Он нужен только как запасной вариант и не участвует в деплое.

## Деплой на Cloudflare Pages

Первый раз:

```powershell
npx wrangler login
npx wrangler kv namespace create STATS
```

Из ответа скопируйте `id` в `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "STATS"
id = "ВАШ_ID"
```

Секреты (значения вводятся в консоли, в git они не попадают):

```powershell
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name artem-portfolio
npx wrangler pages secret put TELEGRAM_CHAT_ID   --project-name artem-portfolio
npx wrangler pages secret put RATE_SALT          --project-name artem-portfolio
npx wrangler pages secret put TURNSTILE_SECRET   --project-name artem-portfolio
```

Дальше каждый деплой — одна команда:

```powershell
npm run deploy
```

### Вариант через GitHub

В панели Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
Выберите репозиторий и укажите:

| Параметр | Значение |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| `SITE_URL` | `https://artem-portfolio-7m4.pages.dev` (или свой домен) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RATE_SALT`, `TURNSTILE_SECRET` | secrets в настройках проекта |
| KV binding | `STATS` → созданный namespace |

Переменная `SITE_URL` подставляет адрес в канонические ссылки, `og:url`,
`robots.txt` и `sitemap.xml`. Переменная `TURNSTILE_SITE_KEY` подставляет
ключ проверки «я не робот» во все формы.

## Защита

На уровне Cloudflare (бесплатно):

- DDoS-защита и CDN по умолчанию;
- WAF и Bot Fight Mode — включить в панели Cloudflare;
- HTTPS + HSTS;
- Turnstile — проверка формы от ботов (включена, режим managed).
  В форме появляется галочка «Подтвердите, что вы человек» — это защита,
  а не подписка и не рассылка. Если проверка не проходит (VPN, блокировщик,
  автоматизированный браузер), под виджетом есть кнопка «Отправить без неё»:
  сервер разрешает одну такую заявку с IP за 10 минут;
- Cloudflare Access — если нужно закрыть сайт паролем.

На уровне сайта:

- строгая CSP без `unsafe-inline` для скриптов (хеши считаются при сборке);
- `X-Frame-Options`, `Permissions-Policy`, `Referrer-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`;
- заявки принимаются только с этого же сайта (проверка `Origin`);
- лимит 5 заявок с IP за 10 минут, пинги счётчика — до 120 за 10 минут;
- тело запроса ≤ 10 КБ;
- honeypot-поле и проверка минимального времени заполнения;
- email проверяется по формату и DNS домена (MX → A → AAAA),
  `example.com/.org/.net` блокируются;
- HTML экранируется перед отправкой в Telegram;
- IP не хранится: для лимитов используется необратимый хеш с солью;
- токен бота есть только в секретах Cloudflare, в браузер он не попадает;
- служебные файлы (`server.js`, `.env`, `.git`, `wrangler.toml`) не попадают
  в `dist/` — сборка копирует только публичные файлы.

## Структура

```
.
├─ index.html              главная
├─ styles.css              оформление (цвета — в :root)
├─ script.js               форма, меню, cookies, счётчик
├─ faq.html                вопросы и ответы
├─ sandbox.html            песочница: цена и превью кейса
├─ privacy.html            политика конфиденциальности
├─ terms.html              пользовательское соглашение
├─ 404.html                страница «не найдено»
├─ turnstile.js            Cloudflare Turnstile для форм
├─ cases/                  три демо-кейса
├─ functions/
│  ├─ _lib/core.js         общие проверки, Telegram, Turnstile
│  └─ api/
│     ├─ lead.js           POST /api/lead — заявка в Telegram
│     ├─ ping.js           POST /api/ping — счётчик посетителей
│     ├─ stats.js          GET  /api/stats — статистика
│     └─ health.js         GET  /api/health — проверка настроек
├─ scripts/build.js        сборка dist/ + CSP + _headers
├─ wrangler.toml           конфиг Cloudflare Pages
├─ server.js               старый локальный сервер (запасной)
└─ render.yaml             старый конфиг Render (можно удалить)
```

## Счётчик посетителей

- `POST /api/ping` вызывается из браузера: создаёт `visitorId` в localStorage,
  увеличивает просмотры и сообщает в Telegram о новом посетителе.
- `GET /api/stats` — `{ views, visitors }`.
- Значения хранятся в Cloudflare KV (`STATS`), поэтому переживают деплой.
- Без KV счётчик работает в памяти изолята и сбрасывается — сайт при этом
  не ломается.

## Свой домен

1. Купите домен (например, `.ru` или `.com`) — это единственная платная часть.
2. В Cloudflare: **Workers & Pages → artem-portfolio → Custom domains**.
3. Добавьте домен и следуйте подсказкам DNS.
4. Поставьте `SITE_URL=https://ваш-домен` в настройках сборки.
5. Пересоберите и задеплойте.

## Что менять

| Что | Где |
|---|---|
| Имя, заголовок, описание | `index.html`, блок `.hero` |
| Цвета и шрифт | `styles.css`, блок `:root` |
| Навыки | `index.html`, блок `.skills` |
| Проекты | `index.html`, блок `.cards` |
| Услуги и цены | `index.html`, секция `#services` |
| Способы оплаты | `index.html`, радиокнопки `name="payment"` |
| Тексты секций | `index.html`, секции `#about`, `#projects` |

Цены: Лендинг 15 000 ₽, Сайт-визитка 30 000 ₽, Магазин 60 000 ₽,
доработка 3 000 ₽.

## Юридические страницы

`privacy.html` и `terms.html` — шаблоны, а не юридическая консультация.
Перед серьёзными заказами покажите их юристу. Замените оператора, если
оформите самозанятость или ИП.

## Git

```powershell
git status
git add .
git commit -m "..."
git push
```
