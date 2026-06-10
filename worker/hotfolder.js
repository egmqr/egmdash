// hotfolder.js
//
// Two responsibilities:
//
// 1. GET /api/hotfolder
//    Returns configs for ProBooth to import. Merges two sources:
//    a) Scheduled events (dashboard_events Firestore, today's date) — existing behaviour
//    b) Push-synced configs in R2 hotfolder/ prefix — new behaviour
//
// 2. POST /api/hotfolder/push   { key, content }
//    Writes a config JSON to hotfolder/{key} in R2.
//    Called by ProBooth and the dashboard after every save.
//    Auth-gated with BOOTH_AUTH_TOKEN.
//
// 3. DELETE /api/hotfolder/ack  { key }
//    Removes a config from hotfolder/ after ProBooth or Edit Setup pulls it.
//    Auth-gated with BOOTH_AUTH_TOKEN.

import { json, firestoreFetch } from './util.js';

export async function handleHotfolder(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ── POST /api/hotfolder/push — write config to hotfolder ─────────────────
  if (path === '/api/hotfolder/push' && request.method === 'POST') {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${env.BOOTH_AUTH_TOKEN}`) return json({ error: 'Unauthorized' }, 401);

    const { key, content } = await request.json();
    if (!key || !content) return json({ error: 'Missing key or content' }, 400);

    // Safety: only allow writes under hotfolder/
    const safeKey = key.startsWith('hotfolder/') ? key : `hotfolder/${key}`;
    await env.PHOTOS.put(safeKey, content, {
      httpMetadata: { contentType: 'application/json' }
    });
    return json({ success: true, key: safeKey });
  }

  // ── DELETE /api/hotfolder/ack — remove config after pull ─────────────────
  if (path === '/api/hotfolder/ack' && request.method === 'DELETE') {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${env.BOOTH_AUTH_TOKEN}`) return json({ error: 'Unauthorized' }, 401);

    const { key } = await request.json();
    if (!key) return json({ error: 'Missing key' }, 400);

    const safeKey = key.startsWith('hotfolder/') ? key : `hotfolder/${key}`;
    await env.PHOTOS.delete(safeKey);
    return json({ success: true });
  }

  // ── GET /api/hotfolder — return configs for ProBooth to import ───────────
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  // Source A: push-synced configs in R2 hotfolder/ prefix
  const pushSynced = await getPushSyncedConfigs(env);

  // Source B: scheduled-events configs (existing behaviour, today only)
  const scheduled = await getScheduledConfigs(env);

  // Merge — push-synced takes priority (identified by R2KeyPrefix match).
  // If a push-synced file has the same R2KeyPrefix as a scheduled file,
  // the push-synced version wins (it has the latest ProBooth settings).
  const prefixSeen = new Set(pushSynced.map(f => extractPrefix(f.content)));
  const filteredScheduled = scheduled.filter(f => !prefixSeen.has(extractPrefix(f.content)));

  return json([...pushSynced, ...filteredScheduled]);
}

// ── Source A: R2 hotfolder/ prefix ────────────────────────────────────────
async function getPushSyncedConfigs(env) {
  const list = await env.PHOTOS.list({ prefix: 'hotfolder/', limit: 200 });
  const files = [];
  for (const obj of list.objects) {
    if (!obj.key.endsWith('.json')) continue;
    try {
      const r2obj = await env.PHOTOS.get(obj.key);
      if (!r2obj) continue;
      files.push({
        name: obj.key.replace('hotfolder/', ''),
        content: await r2obj.text(),
        hotfolderKey: obj.key  // used by ack endpoint
      });
    } catch {}
  }
  return files;
}

// ── Source B: scheduled dashboard events (today only) ─────────────────────
async function getScheduledConfigs(env) {
  const todayStr = formatPHTDate(new Date());
  const todayBaseIds = await getTodayBaseEventIds(env, todayStr);

  const result = [];
  for (const baseId of todayBaseIds) {
    const days = await getEventDays(env, baseId);
    days.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const ta = a.startTime !== '99:99' ? a.startTime : a.callTime;
      const tb = b.startTime !== '99:99' ? b.startTime : b.callTime;
      return ta.localeCompare(tb);
    });

    days.forEach((d, idx) => {
      if (d.date !== todayStr) return;
      const smartBoothId = idx === 0 ? baseId : `${baseId}_D${idx + 1}`;
      result.push(smartBoothId);
    });
  }

  const files = [];
  for (const eventId of result) {
    const eventDoc = await getEventDoc(env, eventId);
    if (!eventDoc) continue;
    const fields = eventDoc.fields || {};
    const communityOnly = fields.communityOnly?.booleanValue === true;
    if (communityOnly) continue;
    const enableCommunity = fields.enableCommunity?.booleanValue === true;
    const parsedBoothCount = parseInt(fields.boothCount?.stringValue || '', 10);
    const physicalBoothCount = Number.isFinite(parsedBoothCount) ? parsedBoothCount : null;

    const list = await env.PHOTOS.list({ prefix: `events/${eventId}/config/` });
    const boothConfigs = list.objects
      .filter(o => /\/Booth\d+\.json$/.test(o.key))
      .sort((a, b) => a.key.localeCompare(b.key));

    const toEmit = physicalBoothCount !== null
      ? boothConfigs.slice(0, Math.max(0, physicalBoothCount))
      : (enableCommunity ? boothConfigs.slice(0, -1) : boothConfigs);

    for (let i = 0; i < toEmit.length; i++) {
      const obj = await env.PHOTOS.get(toEmit[i].key);
      if (!obj) continue;
      files.push({
        name: `${eventId}_Booth${i + 1}.json`,
        content: await obj.text()
      });
    }
  }
  return files;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractPrefix(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed?.Settings?.R2KeyPrefix || '';
  } catch { return ''; }
}

async function getTodayBaseEventIds(env, todayStr) {
  const res = await firestoreFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'dashboard_events' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'eventDate' },
            op: 'EQUAL',
            value: { stringValue: todayStr }
          }
        }
      }
    })
  });
  const docs = await res.json();
  const ids = new Set();
  for (const r of docs) {
    if (r.document?.fields?.eventId) {
      ids.add(r.document.fields.eventId.stringValue.toLowerCase());
    }
  }
  return [...ids];
}

async function getEventDays(env, baseId) {
  const res = await firestoreFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'dashboard_events' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'eventId' },
            op: 'EQUAL',
            value: { stringValue: baseId }
          }
        }
      }
    })
  });
  const docs = await res.json();
  return docs
    .filter(r => r.document?.fields)
    .map(r => ({
      date: r.document.fields.eventDate?.stringValue || '9999-99-99',
      startTime: r.document.fields.startTime?.stringValue || '99:99',
      callTime: r.document.fields.callTime?.stringValue || '99:99'
    }));
}

async function getEventDoc(env, eventId) {
  const res = await firestoreFetch(env, `/events/${eventId}`);
  if (!res.ok) return null;
  return await res.json();
}

function formatPHTDate(d) {
  const phtMs = d.getTime() + (d.getTimezoneOffset() * 60_000) + (8 * 3_600_000);
  const pht = new Date(phtMs);
  const yyyy = pht.getUTCFullYear();
  const mm = String(pht.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(pht.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
