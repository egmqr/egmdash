// Replaces the Drive-touching parts of Dashboard/Code.js (doPost actions).
//
// IN SCOPE for this Worker:
//   generateBoothSetup, updateBoothSetup, getBoothDetails, deleteBoothEvent,
//   getExistingLogos, asset uploads.
//
// STAYS in Apps Script (the user opted to keep these):
//   logPayrollToSheet, submitExpense, sendDailyReminders, backupFirebaseToSheets,
//   sendPush. The Dashboard frontend still calls the existing GAS URL for these.
//
// Note: the booth (WPF) calls /api/dashboard/generate-booth itself when the
// operator creates a standalone event on-site — same endpoint, same payload.

import { json, decodeBase64, firestoreFetch } from './util.js';

export async function handleDashboardRoutes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ── /api/next-event-id — mint next egm##### ID (used by ProBooth) ────
  if (path === '/api/next-event-id') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const authHdr = request.headers.get('authorization') || '';
    if (authHdr !== `Bearer ${env.BOOTH_AUTH_TOKEN}`) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }
    return json(await mintNextEventId(env));
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Auth: same BOOTH_AUTH_TOKEN gates this. Both the Dashboard frontend and
  // the WPF booth send it as `Authorization: Bearer <token>`. Read-only
  // routes (existing-logos, booth-details) are also gated for now — if you
  // want to make them anonymous later, peel them out of this check.
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${env.BOOTH_AUTH_TOKEN}`) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const body = await request.json();

  // ── /api/dashboard/generate-booth ───────────────────────────────────
  // Replaces generateBoothSetup. Builds per-booth config JSONs, generates
  // QR PNGs via QuickChart, writes everything to R2, then upserts to Firestore.
  if (path === '/api/dashboard/generate-booth') {
    return json(await generateBoothSetup(env, body));
  }

  // ── /api/dashboard/update-booth ─────────────────────────────────────
  if (path === '/api/dashboard/update-booth') {
    return json(await updateBoothSetup(env, body));
  }

  if (path === '/api/dashboard/rename-event') {
    return json(await renameEventName(env, body));
  }

  // ── /api/dashboard/booth-details ────────────────────────────────────
  if (path === '/api/dashboard/booth-details') {
    return json(await getBoothDetails(env, body.eventId, { includeTemplates: body.includeTemplates === true }));
  }

  // ── /api/dashboard/delete-booth ─────────────────────────────────────
  if (path === '/api/dashboard/delete-booth') {
    return json(await deleteBoothEvent(env, body.eventId));
  }

  // ── /api/dashboard/existing-logos ───────────────────────────────────
  // Replaces getExistingLogos. Just lists the assets/logos/ prefix in R2.
  if (path === '/api/dashboard/existing-logos') {
    return json(await listExistingLogos(env));
  }

  // ── /api/dashboard/upload-asset ─────────────────────────────────────
  // Generic: PUT a logo/bg/qr-logo into the assets/ prefix.
  // Used by the Dashboard's new asset-upload form (replaces inline base64
  // uploads in generateBoothSetup).
  if (path === '/api/dashboard/upload-asset') {
    return json(await uploadAsset(env, body));
  }

  // ── /api/dashboard/update-pin ───────────────────────────────────────
  // Syncs the ProBooth system PIN to Firestore
  if (path === '/api/dashboard/update-pin') {
    if (!body.pin) return json({ success: false, error: 'No pin provided' }, 400);
    return json(await saveSystemPinToFirestore(env, body.pin));
  }
  // ── /api/dashboard/get-pin ───────────────────────────────────────
  // Reads the ProBooth system PIN from Firestore
  if (path === '/api/dashboard/get-pin') {
    return json(await getSystemPinFromFirestore(env));
  }
  // ── Single File Deletion (For User Stickers) ────────────────────────
  if (path === '/api/dashboard/delete-file') {
    if (!body.key) return json({ success: false, error: 'No key provided' }, 400);
    try {
      await env.PHOTOS.delete(body.key);
      return json({ success: true });
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  return json({ error: 'Not found' }, 404);
}

// ───────────────────────────────────────────────────────────────────────
// Booth generation
// ───────────────────────────────────────────────────────────────────────

const NETLIFY_BASE_URL = 'https://gallery.createdbyegm.com/main.html';
const MASTER_APP_URL = 'https://gallery.createdbyegm.com/';

async function generateDashboardQr(env, qrKey, mainGalleryUrl, logoUrlForQr, cdn) {
  const qcUrl = `https://quickchart.io/qr?size=1000&errorCorrectionLevel=H&text=${encodeURIComponent(mainGalleryUrl)}` +
    (logoUrlForQr ? `&centerImageUrl=${encodeURIComponent(logoUrlForQr + '?v=' + Date.now())}&centerImageSizeRatio=0.22` : '');

  try {
    const qrResp = await fetch(qcUrl);
    if (!qrResp.ok) return '';

    await env.PHOTOS.put(qrKey, await qrResp.arrayBuffer(), {
      httpMetadata: { contentType: 'image/png', cacheControl: 'no-cache' }
    });

    return `${cdn}/${qrKey}?v=${Date.now()}`;
  } catch {
    return '';
  }
}

async function generateBoothSetup(env, p) {
  const {
    eventId, folderName, eventName, pageTitle, boothCount,
    logoData, qrLogoData,
    existingLogoId, existingQrLogoId, existingBgId,
    fontColor, bgColor, logoOnMain,
    templates,
    enableCommunity, communityOnly,
    userStickers,
    showSearchBar, showTime, customTerm
  } = p;

  const includeCommunity = enableCommunity === true;
  const isOnlyCommunity = communityOnly === true;
  const actualNumBooths = isOnlyCommunity ? 0 : (parseInt(boothCount, 10) || 0);
  if (actualNumBooths <= 0 && !isOnlyCommunity) {
    return { success: false, error: 'Invalid booth count.' };
  }

  // 1. Persist asset uploads to assets/ prefix.
  //    Background images are uploaded directly to R2 by the frontend via presigned URL,
  //    so the worker just receives bgId (the R2 key stem) — no base64 handling needed.
  //    Logos still come as base64 because they go through the Cropper.js canvas tool.
  const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');
  let bgId = existingBgId || '';
  let logoId = existingLogoId || '';
  let qrLogoId = existingQrLogoId || '';

  if (logoData?.base64) {
    // 1. Generate ONE timestamp to lock the two files together
    const timestamp = Date.now();
    logoId = `logo_${timestamp}`;

    await env.PHOTOS.put(`assets/logos/${logoId}.png`, decodeBase64(logoData.base64), {
      httpMetadata: { contentType: logoData.mimeType || 'image/png' }
    });

    if (qrLogoData?.base64) {
      qrLogoId = `qrlogo_${timestamp}`;
      await env.PHOTOS.put(`assets/qr-logos/${qrLogoId}.png`, decodeBase64(qrLogoData.base64), {
        httpMetadata: { contentType: qrLogoData.mimeType || 'image/jpeg' }
      });
    } else {
      qrLogoId = logoId;
    }
  }

  // 1b. Smartly determine the correct folder based on the ID prefix
  let logoUrlForQr = '';
  if (qrLogoId) {
    logoUrlForQr = qrLogoId.startsWith('qrlogo_')
      ? `${cdn}/assets/qr-logos/${qrLogoId}.png`
      : `${cdn}/assets/logos/${qrLogoId}.png`;
  } else if (logoId) {
    logoUrlForQr = `${cdn}/assets/logos/${logoId}.png`;
  }

  // 2. Compose physical booth configs and write to R2.
  // Virtual Booth gets a gallery link/QR, but no ProBooth config or hotfolder file.
  let cWidth = 1800, cHeight = 1200;
  if (templates?.[0]) {
    cWidth = templates[0].CanvasWidth || 1800;
    cHeight = templates[0].CanvasHeight || 1200;
  }

  const boothPrefixes = [];
  const qrUrls = [];
  const appUrls = [];
  const configKeys = [];

  for (let i = 1; i <= actualNumBooths; i++) {
    const tabParam = i.toString();

    // R2 key prefix that REPLACES `TargetDirectory` from the old config.
    // ProBooth will upload here directly via presigned URLs.
    const prefix = `events/${eventId}/booth-${i}/prints`;
    boothPrefixes.push(prefix);

    const mainGalleryUrl = `${NETLIFY_BASE_URL}?id=${eventId}&tab=${tabParam}`;
    const cloudLink = `https://webqr.createdbyegm.com/gallery?prefix=${encodeURIComponent(prefix)}`;

    // Preserve existing ProBooth-managed settings if this is an update
    const preserved = p._existingBoothSettings?.[i] || {};

    const eventConfig = {
      Settings: {
        EventName: `${eventName}-Booth${i}`,
        CanvasWidth: cWidth,
        CanvasHeight: cHeight,
        PrinterName: preserved.PrinterName ?? null,
        CloudLink: cloudLink,
        MainGalleryLink: mainGalleryUrl,
        R2KeyPrefix: prefix,
        StaticBoothPreviewSeconds: preserved.StaticBoothPreviewSeconds ?? 30,
        TemplatePaths: [],
        IsStaticBoothMode: preserved.IsStaticBoothMode ?? false,
        StaticBoothCountdownSeconds: preserved.StaticBoothCountdownSeconds ?? 10
      },
      Templates: templates || []
    };

    const configKey = `events/${eventId}/config/Booth${i}.json`;
    const configJson = JSON.stringify(eventConfig, null, 2);
    await env.PHOTOS.put(configKey, configJson, {
      httpMetadata: { contentType: 'application/json' }
    });
    configKeys.push(configKey);

    await putHotfolderConfig(env, `${eventId}_Booth${i}.json`, configJson);

    // Generate QR via QuickChart and stash in R2
    // Added '?v=Date.now()' to centerImageUrl to bust Cloudflare's cache if QuickChart hits a 404
    qrUrls.push(await generateDashboardQr(
      env,
      `events/${eventId}/qr/Booth_${i}_QRCode.png`,
      mainGalleryUrl,
      logoUrlForQr,
      cdn
    ));

    appUrls.push(`${MASTER_APP_URL}?prefix=${encodeURIComponent(prefix)}&tab=${tabParam}`);
  }

  if (includeCommunity) {
    const tabParam = (actualNumBooths + 1).toString();
    const prefix = `events/${eventId}/community`;
    const mainGalleryUrl = `${NETLIFY_BASE_URL}?id=${eventId}&tab=${tabParam}&isCommunity=true`;

    boothPrefixes.push(prefix);
    qrUrls.push(await generateDashboardQr(
      env,
      `events/${eventId}/qr/Community_QRCode.png`,
      mainGalleryUrl,
      logoUrlForQr,
      cdn
    ));
    appUrls.push(`${MASTER_APP_URL}?prefix=${encodeURIComponent(prefix)}&tab=${tabParam}&isCommunity=true`);
  }

  // 3. Upsert Firestore record.
  await saveEventToFirestore(env, eventId, {
    folderName, eventName, pageTitle: pageTitle || eventName, boothCount: String(actualNumBooths),
    bgId, logoId, qrLogoId,
    fontColor, bgColor, logoOnMain,
    booths: appUrls.join('|'),
    qrUrls: qrUrls.join('|'),           // replaces qrFileIds
    configKeys: configKeys.join('|'),    // replaces jsonFileIds
    boothPrefixes: boothPrefixes.join('|'),
    enableCommunity: includeCommunity,
    communityOnly: isOnlyCommunity,
    userStickers: userStickers === true,
    showSearchBar: showSearchBar === true,
    showTime: showTime === true,
    customTerm: customTerm || ''
  });

  return { success: true, message: 'Generated successfully!' };
}

async function updateBoothSetup(env, p) {
  // Update is identical to generate EXCEPT we preserve per-booth settings
  // that ProBooth may have changed locally (IsStaticBoothMode, countdowns, etc.)
  // We read the existing config JSON from R2 before overwriting so those fields
  // survive a dashboard Save Changes operation.

  const eventId = p.eventId;
  const isOnlyCommunity = p.communityOnly === true;
  const actualNumBooths = isOnlyCommunity ? 0 : (parseInt(p.boothCount, 10) || 1);

  // Read existing per-booth settings/templates from R2 configs before regenerating.
  // Dashboard Edit Setup can change gallery/web settings, but templates are owned
  // by ProBooth after the event exists.
  const existingSettings = {};
  let preservedTemplates = null;
  for (let i = 1; i <= actualNumBooths; i++) {
    const configKey = `events/${eventId}/config/Booth${i}.json`;
    try {
      const obj = await env.PHOTOS.get(configKey);
      if (obj) {
        const existing = JSON.parse(await obj.text());
        if (i === 1 && Array.isArray(existing?.Templates)) {
          preservedTemplates = existing.Templates;
        }
        if (existing?.Settings) {
          existingSettings[i] = {
            IsStaticBoothMode: existing.Settings.IsStaticBoothMode ?? false,
            StaticBoothPreviewSeconds: existing.Settings.StaticBoothPreviewSeconds ?? 30,
            StaticBoothCountdownSeconds: existing.Settings.StaticBoothCountdownSeconds ?? 10,
            PrinterName: existing.Settings.PrinterName ?? null,
          };
        }
      }
    } catch { /* no existing config — use defaults */ }
  }

  // Patch the payload with preserved settings so generateBoothSetup uses them
  p._existingBoothSettings = existingSettings;
  if (preservedTemplates) p.templates = preservedTemplates;
  return generateBoothSetup(env, p);
}

async function renameEventName(env, body) {
  const { eventId, newEventName } = body;
  if (!eventId || !newEventName) {
    return { success: false, error: 'eventId and newEventName required' };
  }

  let physicalBoothCount = null;
  try {
    const existingRes = await firestoreFetch(env, `/events/${eventId}`);
    if (existingRes.ok) {
      const existingDoc = await existingRes.json();
      const fields = existingDoc.fields || {};
      const parsedCount = parseInt(fields.boothCount?.stringValue || '', 10);
      physicalBoothCount = fields.communityOnly?.booleanValue === true
        ? 0
        : (Number.isFinite(parsedCount) ? parsedCount : null);
    }
  } catch { }

  const firestoreRes = await firestoreFetch(
    env,
    `/events/${eventId}?updateMask.fieldPaths=eventName&updateMask.fieldPaths=folderName`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          eventName: { stringValue: newEventName },
          folderName: { stringValue: newEventName }
        }
      })
    }
  );

  if (!firestoreRes.ok) {
    return { success: false, error: 'Firestore rename failed.' };
  }

  const configList = await env.PHOTOS.list({ prefix: `events/${eventId}/config/`, limit: 1000 });
  for (const obj of configList.objects || []) {
    const match = obj.key.match(/Booth(\d+)\.json$/i);
    if (!match) continue;

    const boothNum = match[1];
    if (physicalBoothCount !== null && parseInt(boothNum, 10) > physicalBoothCount) {
      await env.PHOTOS.delete(`hotfolder/${eventId}_Booth${boothNum}.json`);
      continue;
    }

    try {
      const configObj = await env.PHOTOS.get(obj.key);
      if (!configObj) continue;

      const pkg = JSON.parse(await configObj.text());
      if (!pkg.Settings) pkg.Settings = {};

      const oldName = pkg.Settings.EventName || '';
      const oldSuffix = (oldName.match(/-Booth\d+$/i) || [`-Booth${boothNum}`])[0];
      pkg.Settings.EventName = `${newEventName}${oldSuffix}`;

      const configJson = JSON.stringify(pkg, null, 2);
      await env.PHOTOS.put(obj.key, configJson, {
        httpMetadata: { contentType: 'application/json' }
      });
      await putHotfolderConfig(env, `${eventId}_Booth${boothNum}.json`, configJson);
    } catch { }
  }

  return { success: true, message: 'Event renamed.' };
}

async function getBoothDetails(env, eventId, options = {}) {
  const res = await firestoreFetch(env, `/events/${eventId}`);
  if (!res.ok) return { success: false, error: 'Firebase fetch error' };
  const doc = await res.json();
  const f = doc.fields || {};

  // Pull templates back out of the first config JSON
  const configKeysStr = f.configKeys?.stringValue || '';
  const firstConfigKey = configKeysStr.split('|').find(k => k && k.length > 5) || '';
  let templates = [];
  if (options.includeTemplates === true && firstConfigKey) {
    try {
      const obj = await env.PHOTOS.get(firstConfigKey);
      if (obj) {
        const data = JSON.parse(await obj.text());
        if (Array.isArray(data.Templates)) templates = data.Templates;
      }
    } catch { }
  }

  return {
    success: true,
    id: eventId,
    folderName: f.folderName?.stringValue || '',
    eventName: f.eventName?.stringValue || '',
    pageTitle: f.pageTitle?.stringValue || f.eventName?.stringValue || '',
    boothCount: f.boothCount?.stringValue || '',
    bgId: f.bgId?.stringValue || '',
    logoId: f.logoId?.stringValue || '',
    qrLogoId: f.qrLogoId?.stringValue || '',
    fontColor: f.fontColor?.stringValue || '#ffffff',
    bgColor: f.bgColor?.stringValue || '#000000',
    logoOnMain: f.logoOnMain?.booleanValue || false,
    userStickers: f.userStickers?.booleanValue || false,
    showSearchBar: f.showSearchBar?.booleanValue || false,
    showTime: f.showTime?.booleanValue || false,
    customTerm: f.customTerm?.stringValue || '',
    boothsStr: f.booths?.stringValue || '',
    qrUrlsStr: f.qrUrls?.stringValue || '',
    configKeysStr,
    boothPrefixesStr: f.boothPrefixes?.stringValue || '',
    enableCommunity: f.enableCommunity?.booleanValue || false,
    communityOnly: f.communityOnly?.booleanValue || false,
    templatesStr: options.includeTemplates === true ? JSON.stringify(templates) : ''
  };
}

async function deleteBoothEvent(env, eventId) {
  // Delete every R2 object under events/{eventId}/
  let cursor;
  do {
    const page = await env.PHOTOS.list({ prefix: `events/${eventId}/`, cursor });
    if (page.objects.length) {
      await env.PHOTOS.delete(page.objects.map(o => o.key));
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);

  await deleteHotfolderConfigsForEvent(env, eventId);

  // Delete Firestore doc
  const res = await firestoreFetch(env, `/events/${eventId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    return { success: false, error: 'Firestore delete failed.' };
  }
  return { success: true, message: 'Booth resources deleted.' };
}

async function putHotfolderConfig(env, fileName, configJson) {
  await env.PHOTOS.put(`hotfolder/${fileName}`, configJson, {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function deleteHotfolderConfigsForEvent(env, eventId) {
  const keysToDelete = [];
  let cursor;
  do {
    const page = await env.PHOTOS.list({ prefix: 'hotfolder/', cursor, limit: 200 });
    for (const obj of page.objects) {
      if (!obj.key.endsWith('.json')) continue;
      if (obj.key.startsWith(`hotfolder/${eventId}_`)) {
        keysToDelete.push(obj.key);
        continue;
      }

      try {
        const r2obj = await env.PHOTOS.get(obj.key);
        if (!r2obj) continue;
        const parsed = JSON.parse(await r2obj.text());
        const prefix = parsed?.Settings?.R2KeyPrefix || '';
        if (prefix.startsWith(`events/${eventId}/`)) keysToDelete.push(obj.key);
      } catch { }
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);

  if (keysToDelete.length) await env.PHOTOS.delete(keysToDelete);
}

async function listExistingLogos(env) {
  const list = await env.PHOTOS.list({ prefix: 'assets/logos/', limit: 1000 });
  const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');
  const logos = list.objects
    .filter(o => {
      const name = o.key.split('/').pop();
      return name && name.trim() !== '' && !name.startsWith('.');
    })
    .map(o => {
      const id = o.key.replace('assets/logos/', '').replace(/\.[^.]+$/, '');
      const qrId = id.startsWith('logo_') ? id.replace(/^logo_/, 'qrlogo_') : id;
      return {
        id,
        qrId,
        key: o.key,
        qrKey: `assets/qr-logos/${qrId}.png`,
        name: o.key.split('/').pop(),
        url: `${cdn}/${o.key}?w=150`
      };
    });
  return { success: true, logos };
}

async function uploadAsset(env, body) {
  const kind = body.kind; // 'logo' | 'background' | 'qr-logo'
  const map = {
    'logo': 'assets/logos',
    'background': 'assets/backgrounds',
    'qr-logo': 'assets/qr-logos'
  };
  const prefix = map[kind];
  if (!prefix) return { success: false, error: 'Invalid kind' };

  const id = `${kind}_${Date.now()}`;
  const ext = (body.filename || '').match(/\.[a-z0-9]+$/i)?.[0] || '.png';
  const key = `${prefix}/${id}${ext}`;
  await env.PHOTOS.put(key, decodeBase64(body.base64Data), {
    httpMetadata: { contentType: body.mimeType || 'image/png' }
  });

  const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');
  return { success: true, id, key, url: `${cdn}/${key}` };
}

// ── Mint next egm##### event ID ─────────────────────────────────────────
// Queries the Firestore events collection for the highest egm##### ID,
// increments it, and returns the next one. Shared counter between Dashboard
// and ProBooth so IDs never collide.
async function mintNextEventId(env) {
  try {
    const projectId = env.FIREBASE_PROJECT_ID;
    const token = await getFirestoreToken(env);
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
    const counterDocPath = `${baseUrl}/documents/counters/eventIdCounter`;

    // Step 1: Atomically increment the counter using Firestore's commit + transform
    const commitUrl = `${baseUrl}/documents:commit`;
    const commitRes = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        writes: [{
          transform: {
            document: `projects/${projectId}/databases/(default)/documents/counters/eventIdCounter`,
            fieldTransforms: [{
              fieldPath: 'currentId',
              increment: { integerValue: '1' }
            }]
          }
        }]
      })
    });

    if (!commitRes.ok) {
      const errText = await commitRes.text();
      throw new Error(`Firestore commit failed: ${commitRes.status} — ${errText}`);
    }

    // Step 2: Read back the updated counter value
    const getRes = await fetch(counterDocPath, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!getRes.ok) throw new Error(`Counter read failed: ${getRes.status}`);
    const doc = await getRes.json();
    const currentId = parseInt(doc.fields?.currentId?.integerValue || '1', 10);

    const eventId = 'egm' + String(currentId).padStart(4, '0');
    return { success: true, eventId };

  } catch (err) {
    console.error('mintNextEventId error:', err);
    // Fallback — random 5-digit egm ID (low collision risk for offline use)
    const fallback = 'egm' + Math.floor(10000 + Math.random() * 90000);
    return { success: true, eventId: fallback, fallback: true };
  }
}

// Helper: get Firebase auth token (reused from firestoreFetch in util.js)
async function getFirestoreToken(env) {
  const { firestoreFetch } = await import('./util.js');
  // firestoreFetch handles auth internally; we just need the token
  // Use a lightweight ping to get the token via the existing auth flow
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: env.FIREBASE_EMAIL,
        password: env.FIREBASE_PASSWORD,
        returnSecureToken: true
      })
    }
  );
  if (!res.ok) throw new Error('Firebase auth failed');
  const data = await res.json();
  return data.idToken;
}

async function saveEventToFirestore(env, eventId, data) {
  const url = `/events/${eventId}`;
  const payload = {
    fields: {
      folderName: { stringValue: data.folderName || '' },
      eventName: { stringValue: data.eventName || '' },
      pageTitle: { stringValue: data.pageTitle || data.eventName || '' },
      boothCount: { stringValue: data.boothCount || '1' },
      bgId: { stringValue: data.bgId || '' },
      logoId: { stringValue: data.logoId || '' },
      qrLogoId: { stringValue: data.qrLogoId || '' },
      fontColor: { stringValue: data.fontColor || '' },
      bgColor: { stringValue: data.bgColor || '' },
      booths: { stringValue: data.booths || '' },
      qrUrls: { stringValue: data.qrUrls || '' },
      configKeys: { stringValue: data.configKeys || '' },
      boothPrefixes: { stringValue: data.boothPrefixes || '' },
      logoOnMain: { booleanValue: data.logoOnMain === true },
      enableCommunity: { booleanValue: data.enableCommunity === true },
      communityOnly: { booleanValue: data.communityOnly === true },
      userStickers: { booleanValue: data.userStickers === true },
      showSearchBar: { booleanValue: data.showSearchBar === true },
      showTime: { booleanValue: data.showTime === true },
      customTerm: { stringValue: data.customTerm || '' },
      timestamp: { timestampValue: new Date().toISOString() }
    }
  };

  // Create a comma-separated list of all the keys in the fields object
  const updateMaskPaths = Object.keys(payload.fields).map(key => `updateMask.fieldPaths=${key}`).join('&');

  await firestoreFetch(env, `${url}?${updateMaskPaths}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}
async function saveSystemPinToFirestore(env, pin) {
  const url = `/booth_settings/system`;
  const payload = {
    fields: {
      pin: { stringValue: pin },
      timestamp: { timestampValue: new Date().toISOString() }
    }
  };

  // Removing the updateMask forces Firestore to create the document if it doesn't exist
  const res = await firestoreFetch(env, url, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text(); // Grab the real error from Google
    return { success: false, error: `Firestore Error ${res.status}: ${errText}` };
  }
  return { success: true, message: 'System pin updated' };
}
async function getSystemPinFromFirestore(env) {
  const url = `/booth_settings/system`;

  const res = await firestoreFetch(env, url);

  if (!res.ok) {
    // If the document doesn't exist yet (404), return the default 1234 pin
    if (res.status === 404) {
      return { success: true, pin: '1234' };
    }
    const errText = await res.text();
    return { success: false, error: `Firestore Error ${res.status}: ${errText}` };
  }

  const doc = await res.json();
  const pin = doc.fields?.pin?.stringValue || '1234';

  return { success: true, pin: pin };
}
