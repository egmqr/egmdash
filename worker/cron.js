// Replaces the daily Apps Script trigger that ran processDailyBoothJsons.
//
// In the new architecture there's nothing to physically copy — /api/hotfolder
// computes the active set live. So this cron only handles things that need
// proactive scheduling: cleanup of stale KV counters from finished events,
// and (optional) the FCM daily reminder push.
//
// Wire up in wrangler.toml:
//   [triggers]
//   crons = ["0 17 * * *"]   # 17:00 UTC = 01:00 GMT+8 (Manila)

import { firestoreFetch, json } from './util.js';

export async function runDailyTasks(env) {
  const out = { cleanedCounters: 0, errors: [] };

  try {
    // Find finished events: any eventId whose latest day < today
    const todayStr = formatPHTDate(new Date());
    const allEvents = await firestoreAllEvents(env);

    const baseIdToMaxDate = new Map();
    for (const ev of allEvents) {
      const id = ev.eventId.toLowerCase();
      const date = ev.eventDate || '0000-00-00';
      const cur = baseIdToMaxDate.get(id);
      if (!cur || date > cur) baseIdToMaxDate.set(id, date);
    }

    for (const [baseId, lastDate] of baseIdToMaxDate) {
      if (lastDate < todayStr) {
        // Sweep KV counters for this event's prefixes
        const list = await env.SESSIONS.list({ prefix: `counter:p:events/${baseId}/` });
        for (const k of list.keys) {
          await env.SESSIONS.delete(k.name);
          out.cleanedCounters++;
        }
        const sessList = await env.SESSIONS.list({ prefix: `counter:s:events/${baseId}/` });
        for (const k of sessList.keys) {
          await env.SESSIONS.delete(k.name);
          out.cleanedCounters++;
        }
      }
    }
  } catch (e) {
    out.errors.push(e.message);
  }

  return json(out);
}

async function firestoreAllEvents(env) {
  // Page through dashboard_events collection
  const out = [];
  let pageToken;
  do {
    const url = `/dashboard_events?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await firestoreFetch(env, url);
    if (!res.ok) break;
    const data = await res.json();
    for (const d of (data.documents || [])) {
      const f = d.fields || {};
      out.push({
        eventId: f.eventId?.stringValue || '',
        eventDate: f.eventDate?.stringValue || ''
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

function formatPHTDate(d) {
  const phtMs = d.getTime() + (d.getTimezoneOffset() * 60_000) + (8 * 3_600_000);
  const pht = new Date(phtMs);
  return `${pht.getUTCFullYear()}-${String(pht.getUTCMonth() + 1).padStart(2, '0')}-${String(pht.getUTCDate()).padStart(2, '0')}`;
}
