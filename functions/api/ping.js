import { json, readJson, isSameOrigin, hashIp, allowRequest, sendTelegram } from '../_lib/core.js';

/**
 * Счётчик посетителей. Значения лежат в KV (binding STATS).
 * Без KV (локальная разработка) работает в памяти изолята.
 */
const memory = { views: 0, visitors: 0, seen: new Map() };

const MAX_SEEN = 2000;
const SEEN_TTL_MS = 90 * 24 * 3600 * 1000;

async function readState(env) {
  if (!env.STATS) {
    return { views: memory.views, visitors: memory.visitors, seen: memory.seen, inMemory: true };
  }

  try {
    const saved = await env.STATS.get('stats', { type: 'json' });
    const seen = new Map();
    for (const [id, at] of Object.entries((saved && saved.seen) || {})) {
      if (typeof id === 'string' && Number.isFinite(at)) seen.set(id, at);
    }
    return {
      views: Number(saved && saved.views) || 0,
      visitors: Number(saved && saved.visitors) || 0,
      seen,
      inMemory: false,
    };
  } catch (error) {
    console.error('[ping] KV read:', error.message);
    return { views: memory.views, visitors: memory.visitors, seen: memory.seen, inMemory: true };
  }
}

async function saveState(env, state) {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [id, at] of state.seen) {
    if (at < cutoff) state.seen.delete(id);
  }
  // Ограничиваем размер: храним только MAX_SEEN последних посетителей
  if (state.seen.size > MAX_SEEN) {
    const recent = [...state.seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN);
    state.seen = new Map(recent);
  }

  if (state.inMemory) {
    memory.views = state.views;
    memory.visitors = state.visitors;
    memory.seen = state.seen;
    return;
  }

  try {
    await env.STATS.put(
      'stats',
      JSON.stringify({
        views: state.views,
        visitors: state.visitors,
        seen: Object.fromEntries(state.seen),
      }),
    );
  } catch (error) {
    // Не роняем счётчик из-за временной ошибки KV.
    console.error('[ping] KV write:', error.message);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Метод не поддерживается' }, 405);
  }
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: 'Запрос с чужого сайта' }, 403);
  }

  const parsed = await readJson(request, 2_000);
  const data = parsed.data || {};
  const visitorId = String(data.visitorId || '').slice(0, 80);
  const state = await readState(env);

  state.views += 1;

  if (visitorId && !state.seen.has(visitorId)) {
    // Защита от накрутки: не больше 10 новых «посетителей» с IP в час
    const ipKey = await hashIp(request, env);
    if (await allowRequest(env, `nv:${ipKey}`, 10, 3600)) {
      state.seen.set(visitorId, Date.now());
      state.visitors += 1;

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        const text = [
          '📈 Новый посетитель сайта',
          `Всего посетителей: ${state.visitors}`,
          `Просмотров: ${state.views}`,
        ].join('\n');
        const notify = sendTelegram(env, text).catch(() => {});
        if (typeof context.waitUntil === 'function') context.waitUntil(notify);
        else await notify;
      }
    }
  }

  await saveState(env, state);
  return json({ ok: true, views: state.views, visitors: state.visitors });
}
