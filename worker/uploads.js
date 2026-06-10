// /api/sign-upload — issues short-lived presigned PUT URLs to the WPF booth so
// JPGs go straight from the camera-attached PC to R2 with zero hops through us.
// The booth shares a single auth token (rotated occasionally); R2 credentials never
// leave the Worker.

import { json, presignR2Put, safePrefix } from './util.js';

export async function handleSignedUpload(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${env.BOOTH_AUTH_TOKEN}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body = await request.json();
  const prefix = safePrefix(body.prefix);
  if (!prefix) return json({ error: 'Invalid prefix' }, 400);

  // Allow booth photo uploads under events/ AND dashboard bg uploads under assets/backgrounds/
  const allowedPrefixes = ['events/', 'assets/backgrounds'];
  if (!allowedPrefixes.some(p => prefix.startsWith(p))) {
    return json({ error: 'Token may only write under events/ or assets/backgrounds/' }, 403);
  }

  const filename = (body.filename || '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!filename || !/\.(jpe?g|png|webp)$/i.test(filename)) {
    return json({ error: 'Invalid filename' }, 400);
  }

  const key = `${prefix}/${filename}`.replace(/\/+/g, '/');
  const uploadUrl = await presignR2Put(env, key, 900); // 15 min

  const cdn = env.PUBLIC_CDN_BASE.replace(/\/$/, '');
  return json({
    uploadUrl,
    key,
    publicUrl: `${cdn}/${key}`,
    expiresIn: 900
  });
}