import { json } from '../_lib/core.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return json({ ok: false, error: 'Метод не поддерживается' }, 405);
  }

  if (!env.STATS) {
    return json({ ok: true, views: 0, visitors: 0 });
  }

  try {
    const saved = await env.STATS.get('stats', { type: 'json' });
    const seen = (saved && saved.seen) || {};

    return json({
      ok: true,
      views: Number(saved && saved.views) || 0,
      visitors: Number(saved && saved.visitors) || Object.keys(seen).length,
    });
  } catch (error) {
    console.error('[stats] KV:', error.message);
    return json({ ok: true, views: 0, visitors: 0 });
  }
}
