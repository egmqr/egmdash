import assert from 'node:assert/strict';
import test from 'node:test';

import { ManagePhotoTaskQueue } from '../public/manage-photo-task-queue.mjs';

test('runs queued tasks in FIFO order', async () => {
  const order = [];
  const queue = new ManagePhotoTaskQueue({ onChange() {} });

  const upload = queue.enqueue({
    label: 'Upload 1 photo',
    total: 1,
    run: async () => { order.push('upload'); }
  });
  const deletion = queue.enqueue({
    label: 'Delete 1 photo',
    total: 1,
    run: async () => { order.push('delete'); }
  });

  await Promise.all([upload, deletion]);

  assert.deepEqual(order, ['upload', 'delete']);
});

test('continues queued work after a failed task', async () => {
  const order = [];
  const queue = new ManagePhotoTaskQueue({ onChange() {} });

  const failedUpload = queue.enqueue({
    label: 'Broken upload',
    total: 1,
    run: async () => { throw new Error('R2 unavailable'); }
  });
  const deletion = queue.enqueue({
    label: 'Delete 1 photo',
    total: 1,
    run: async () => { order.push('delete'); }
  });

  await assert.rejects(failedUpload, /R2 unavailable/);
  await deletion;

  assert.deepEqual(order, ['delete']);
});
