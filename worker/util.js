// Shared helpers used across all route handlers.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export function cors(res) {
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', '*');
  r.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  r.headers.set('access-control-allow-headers', 'content-type, authorization');
  return r;
}

// Decode the optional data-URI prefix the Apps Script clients send (data:image/png;base64,...)
export function decodeBase64(str) {
  const clean = str.includes(',') ? str.split(',')[1] : str;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Firestore REST auth ─────────────────────────────────────────────────
// Mirrors getFirebaseAuthToken() from Dashboard/Code.js. Tokens cached
// in Worker globalThis between invocations on the same isolate.
let _fbToken = null;
let _fbTokenExp = 0;

export async function getFirebaseToken(env) {
  const now = Date.now();
  if (_fbToken && now < _fbTokenExp) return _fbToken;

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: env.FIREBASE_EMAIL,
        password: env.FIREBASE_PASSWORD,
        returnSecureToken: true
      })
    }
  );

  if (!res.ok) throw new Error('Firebase auth failed: ' + await res.text());
  const body = await res.json();
  _fbToken = body.idToken;
  _fbTokenExp = now + 50 * 60 * 1000; // 50 min — Firebase tokens are valid for 1h
  return _fbToken;
}

export async function firestoreFetch(env, pathOrUrl, init = {}) {
  const token = await getFirebaseToken(env);
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${pathOrUrl}`;
  const headers = { ...(init.headers || {}), authorization: `Bearer ${token}` };
  if (init.body && !headers['content-type']) headers['content-type'] = 'application/json';
  return fetch(url, { ...init, headers });
}

// ── R2 S3-compatible presigning (AWS SigV4) ─────────────────────────────
// Used by /api/sign-upload to give the WPF booth a short-lived PUT URL.
// We don't pull in the AWS SDK — SigV4 is ~80 lines. R2 accepts it as-is.

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a presigned PUT URL for R2.
 * @param {object} env - Worker env with R2 secrets
 * @param {string} key - object key (e.g. "events/egm0228/booth-1/prints/foo.jpg")
 * @param {number} expiresSec - URL lifetime
 * @param {string} [contentType] - if set, the booth must PUT with this content-type
 */
export async function presignR2Put(env, key, expiresSec = 900, contentType) {
  const region = 'auto';
  const service = 's3';
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bucket = env.BUCKET_NAME;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20260503T120000Z
  const dateStamp = amzDate.slice(0, 8);                            // 20260503
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const signedHeaders = 'host';
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaders
  });

  const canonicalQuery = [...params.keys()].sort().map(k => `${k}=${encodeURIComponent(params.get(k))}`).join('&');
  const canonicalRequest = [
    'PUT',
    `/${bucket}/${encodedKey}`,
    canonicalQuery,
    `host:${host}\n`,
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');

  const kDate = await hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));

  return `https://${host}/${bucket}/${encodedKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ── Path safety ─────────────────────────────────────────────────────────
// Prevents callers from escaping their event's prefix via `..`/absolute keys.
export function safePrefix(p) {
  if (!p) return null;
  // Allow letters, digits, dash, underscore, slash, dot. Reject leading slash and `..`.
  if (/^\//.test(p) || /\.\./.test(p) || !/^[A-Za-z0-9._/-]+$/.test(p)) return null;
  return p.replace(/\/+$/, '');
}
