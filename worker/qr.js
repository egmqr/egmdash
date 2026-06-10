// Replaces QR/Code.js. Uses KV for session/photo counters per prefix.

import { json, safePrefix } from './util.js';

export async function handleQRRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const prefix = safePrefix(url.searchParams.get('prefix'));
  if (!prefix) return json({ status: 'error', message: 'Missing or invalid prefix' }, 400);

  // ── GET /api/photo?id=p0001&prefix=...  (replaces api=photo) ──────────
  if (path === '/api/photo' && request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return json({ status: 'error', message: 'Missing id' }, 400);

    const photo = await findPhotoByTagOrName(env, prefix, id);
    if (!photo) {
      // If ID not found by name match, try returning the Nth photo by counter position
      // This handles cases where ProBooth used a local fallback ID
      const numMatch = id.match(/[ps](\d+)/i);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        const all = await listAll(env, prefix + '/');
        const sorted = all
          .filter(o => !o.key.slice(prefix.length + 1).includes('/'))
          .sort((a, b) => a.uploaded - b.uploaded);
        if (sorted.length >= n && n > 0) {
          return json({ status: 'success', data: [photoUrls(env, prefix, sorted[n - 1].key)] });
        }
      }
      return json({ status: 'error', message: 'Photo not found yet — try again in a moment.' });
    }
    return json({ status: 'success', data: [photoUrls(env, prefix, photo.key)] });
  }

  // ── DELETE /api/photo?key=...  (ProBooth photo delete → R2) ─────────────
  // Auth-gated. `key` is the full R2 object key (e.g. events/egm0001/booth-1/prints/file.jpg)
  if (path === '/api/photo' && request.method === 'DELETE') {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${env.BOOTH_AUTH_TOKEN}`) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }
    const key = url.searchParams.get('key');
    if (!key) return json({ success: false, error: 'Missing key' }, 400);
    // Safety check: key must start with events/ to prevent accidental asset deletion
    if (!key.startsWith('events/')) {
      return json({ success: false, error: 'Invalid key — must be under events/' }, 400);
    }
    await env.PHOTOS.delete(key);
    return json({ success: true, deleted: key });
  }

  // ── GET /api/session-gallery?session=s0001&prefix=...  (replaces api=gallery) ──
  if (path === '/api/session-gallery' && request.method === 'GET') {
    const session = url.searchParams.get('session');
    if (!session) return json({ status: 'error', message: 'Missing session' }, 400);

    const list = await listAll(env, prefix + '/');
    const re = new RegExp(`-${escapeRegex(session)}(?:\\.[A-Za-z0-9]+)?$`);
    const photos = list
      // No preview/ subdirectory exists, but filter defensively anyway
      .filter(o => {
        const tail = o.key.slice(prefix.length + 1);
        return !tail.includes('/') && re.test(tail);
      })
      .sort((a, b) => b.uploaded - a.uploaded)
      .map(o => {
        const u = photoUrls(env, prefix, o.key);
        const d = new Date(o.uploaded);
        u.displayTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return u;
      });

    if (photos.length === 0) {
      return json({ status: 'error', message: 'No photos in this session yet — refresh in a moment.' });
    }
    return json({ status: 'success', data: photos });
  }

  // ── POST /api/toggle-session?prefix=... { isStarting: bool } ──────────
  if (path === '/api/toggle-session' && request.method === 'POST') {
    const body = await request.json();
    if (body.isStarting) {
      const sessionStr = await nextId(env, 's', prefix);
      await env.SESSIONS.put(`active:${prefix}`, sessionStr);
      return json({ sessionNum: sessionStr });
    } else {
      const current = await env.SESSIONS.get(`active:${prefix}`);
      await env.SESSIONS.delete(`active:${prefix}`);
      return json({ sessionNum: current });
    }
  }

  // ── GET /api/next-photo-id?prefix=...  (replaces api=getPhotoId) ──────
  if (path === '/api/next-photo-id' && request.method === 'GET') {
    const photoId = await nextId(env, 'p', prefix);
    return json({ photoId });
  }

  return json({ error: 'Not found' }, 404);
}

async function nextId(env, kind, prefix) {
  const key = `counter:${kind}:${prefix}`;
  const cur = parseInt((await env.SESSIONS.get(key)) || '0', 10);
  const next = cur + 1;
  await env.SESSIONS.put(key, String(next));
  return kind + String(next).padStart(4, '0');
}

async function findPhotoByTagOrName(env, prefix, id) {
  const list = await listAll(env, prefix + '/', 200);
  const hit = list.find(o => {
    const tail = o.key.slice(prefix.length + 1);
    if (tail.includes('/')) return false;
    return tail.includes(id);
  });
  return hit ? { key: hit.key } : null;
}

async function listAll(env, prefix, limit = 1000) {
  const out = [];
  let cursor;
  while (out.length < limit) {
    const page = await env.PHOTOS.list({ prefix, limit: Math.min(1000, limit - out.length), cursor });
    out.push(...page.objects);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return out;
}

function photoUrls(env, prefix, key) {
  const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');
  // No preview — full-res URL used everywhere (grid, lightbox, download).
  return {
    baseUrl: `${cdn}/${key}`,       // full-resolution
    previewUrl: `${cdn}/${key}`,    // same as baseUrl — no separate preview
    downloadUrl: `${cdn}/${key}`
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
