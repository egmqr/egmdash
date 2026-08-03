import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';
import { handleQRRoutes } from '../worker/qr.js';
import { handleSignedUpload } from '../worker/uploads.js';

const boothToken = 'booth-token';

function verifyRequest(key, token = boothToken) {
  return new Request('https://api.example.com/api/verify-upload', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ key })
  });
}

function envWithHead(exists) {
  return {
    BOOTH_AUTH_TOKEN: boothToken,
    PHOTOS: { head: async () => exists ? { key: 'events/e/prints/p.jpg' } : null }
  };
}

function photoRequest(id) {
  return new Request(`https://api.example.com/api/photo?id=${id}&prefix=events/e/prints`);
}

function pagedEnvWithMatchOnSecondPage() {
  let calls = 0;
  return {
    PUBLIC_CDN_BASE: 'https://cdn.example.com',
    PHOTOS: {
      async list({ cursor }) {
        calls++;
        if (!cursor) {
          return {
            objects: Array.from({ length: 200 }, (_, index) => ({
              key: `events/e/prints/p${String(index + 1).padStart(4, '0')}.jpg`,
              uploaded: new Date(index)
            })),
            truncated: true,
            cursor: 'page-2'
          };
        }
        assert.equal(cursor, 'page-2');
        return { objects: [{ key: 'events/e/prints/p0201.jpg', uploaded: new Date(201) }], truncated: false };
      }
    },
    get calls() { return calls; }
  };
}

test('verify upload reports a present event key', async () => {
  const response = await handleSignedUpload(verifyRequest('events/e/prints/p.jpg'), envWithHead(true));

  assert.deepEqual(await response.json(), { exists: true });
});

test('verify upload route reaches signed upload handler', async () => {
  const response = await worker.fetch(verifyRequest('events/e/prints/p.jpg'), envWithHead(true), {});

  assert.deepEqual(await response.json(), { exists: true });
});

test('verify upload rejects non-event key', async () => {
  const response = await handleSignedUpload(verifyRequest('assets/backgrounds/p.jpg'), envWithHead(true));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid key' });
});

test('photo QR finds second-page object', async () => {
  const env = pagedEnvWithMatchOnSecondPage();
  const response = await handleQRRoutes(photoRequest('p0201'), env);

  assert.equal((await response.json()).status, 'success');
  assert.equal(env.calls, 2);
});
