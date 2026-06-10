// Replaces Gallery/Code.js. Same response shape as before so frontend processItem()
// in Gallery/index.html doesn't need to change beyond pointing API_URL here.

import { json, decodeBase64, safePrefix } from './util.js';

// GLOBAL MEMORY CACHE: Prevents R2 billing spikes by sharing the 
// photo list across all guests connected to this Cloudflare node.
const streamCache = new Map();

export async function handleGalleryRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ── GET /api/gallery?prefix=events/egm0228/booth-1/prints/&limit=60 ──
  // Returns array of [key, name, fullUrl, uploadedTime] — 4-element tuple.
  // No preview — full-res URL is used for both grid and viewer.
  if (path === '/api/gallery' && request.method === 'GET') {
    const prefix = safePrefix(url.searchParams.get('prefix'));
    if (!prefix) return json({ status: 'error', message: 'Invalid prefix' }, 400);

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 1000);
    const items = await listAllObjects(env, prefix + '/', limit);
    const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');

    const data = items
      // Skip any subdirectory keys under the prefix (e.g. a leftover preview/ folder).
      .filter(o => {
        const tail = o.key.slice(prefix.length + 1);
        return !tail.includes('/') && /\.(jpe?g|png|webp)$/i.test(o.key);
      })
      .map(o => {
        const filename = o.key.split('/').pop();
        return [
          o.key,                    // id (was: file.id)
          filename,                 // name
          `${cdn}/${o.key}`,        // full-resolution URL (used for grid AND viewer)
          o.uploaded.getTime()      // sort time
        ];
      })
      .sort((a, b) => b[3] - a[3]);

    return json({ status: 'success', data });
  }

  // ── GET /api/template?prefix=events/egm0228/config/ ───────────────────
  if (path === '/api/template' && request.method === 'GET') {
    const prefix = safePrefix(url.searchParams.get('prefix'));
    if (!prefix) return json({ success: false, error: 'Invalid prefix' }, 400);

    let config = await findTemplateConfig(env, prefix);
    if (!config) {
      const parent = prefix.split('/').slice(0, -1).join('/');
      if (parent && parent !== prefix) config = await findTemplateConfig(env, parent);
    }

    if (!config || !Array.isArray(config.Templates) || config.Templates.length === 0) {
      return json({ success: false, error: 'No valid configuration file found.' });
    }
    return json({ success: true, data: config.Templates });
  }
// ── GET /api/stream?prefix=events/egm0228/booth-1/prints/ ─────────────
  // Server-Sent Events (SSE) endpoint for live gallery updates.
  if (path === '/api/stream' && request.method === 'GET') {
    const prefix = safePrefix(url.searchParams.get('prefix'));
    if (!prefix) return json({ status: 'error', message: 'Invalid prefix' }, 400);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Start the background polling loop
    streamLiveUpdates(env, prefix, writer, encoder);

    // Return the readable stream immediately to keep the connection open
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  // ── POST /api/upload-community ────────────────────────────────────────
  // Stores the full-res image directly. No preview is expected or stored.
  if (path === '/api/upload-community' && request.method === 'POST') {
    const body = await request.json();
    const prefix = safePrefix(body.prefix);
    if (!prefix) return json({ success: false, error: 'Invalid prefix' }, 400);

    const filename = sanitizeFilename(body.filename || `Community_${Date.now()}.jpg`);
    const bytes = decodeBase64(body.base64Data);
    const fullKey = `${prefix}/${filename}`;

    await env.PHOTOS.put(fullKey, bytes, {
      httpMetadata: { contentType: body.mimeType || 'image/jpeg' }
    });

    return json({
      success: true,
      url: `${env.PUBLIC_CDN_BASE.replace(/\/$/, '')}/${fullKey}`,
      key: fullKey
    });
  }

  return json({ error: 'Not found' }, 404);
}

async function listAllObjects(env, prefix, limit) {
  const out = [];
  let cursor;
  while (out.length < limit) {
    const page = await env.PHOTOS.list({
      prefix,
      limit: Math.min(1000, limit - out.length),
      cursor
    });
    out.push(...page.objects);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return out;
}

async function findTemplateConfig(env, prefix) {
  const list = await env.PHOTOS.list({ prefix: prefix + '/' });
  for (const obj of list.objects) {
    if (!obj.key.toLowerCase().endsWith('.json')) continue;
    try {
      const body = await env.PHOTOS.get(obj.key);
      if (!body) continue;
      const data = JSON.parse(await body.text());
      if (Array.isArray(data?.Templates) && data.Templates.length > 0) return data;
    } catch {}
  }
  return null;
}

function sanitizeFilename(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}
async function streamLiveUpdates(env, prefix, writer, encoder) {
  let lastKnownKeys = new Set();
  let isFirstRun = true;

  try {
    while (true) {
      const now = Date.now();
      let cache = streamCache.get(prefix);
      let items = [];

      // Only hit R2 if the cache is older than 5 seconds
      if (!cache || now - cache.time > 5000) {
        items = await listAllObjects(env, prefix + '/', 1000); 
        streamCache.set(prefix, { time: now, items });
      } else {
        items = cache.items;
      }

      const files = items.filter(o => !o.key.slice(prefix.length + 1).includes('/') && /\.(jpe?g|png|webp)$/i.test(o.key));
      const currentKeys = new Set(files.map(f => f.key)); // Store current keys for comparison

      if (!isFirstRun) {
        // 1. CHECK FOR ADDITIONS
        for (const file of files) {
          if (!lastKnownKeys.has(file.key)) {
            const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');
            const data = {
              id: file.key,
              name: file.key.split('/').pop(),
              baseUrl: `${cdn}/${file.key}`,
              time: file.uploaded.getTime()
            };
            await writer.write(encoder.encode(`event: new_photo\ndata: ${JSON.stringify(data)}\n\n`));
          }
        }

        // 2. CHECK FOR DELETIONS
        for (const oldKey of lastKnownKeys) {
          if (!currentKeys.has(oldKey)) {
            // Photo was deleted! Tell the frontend to remove it.
            await writer.write(encoder.encode(`event: deleted_photo\ndata: ${JSON.stringify({ id: oldKey })}\n\n`));
          }
        }
      }

      await writer.write(encoder.encode(`: heartbeat\n\n`));

      // Update the known keys to the current state for the next loop
      lastKnownKeys = currentKeys;
      isFirstRun = false;

      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (err) {
    await writer.close().catch(() => {});
  }
}
