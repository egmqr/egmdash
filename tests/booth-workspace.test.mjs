import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('uses one Booth QR workspace instead of visible setup modes', () => {
  assert.match(page, /class="booth-workspace-header"/);
  assert.match(page, /id="boothNewWorkspaceBtn"/);
  assert.match(page, /class="booth-mode-legacy"/);
  assert.match(page, /\.booth-mode-legacy \{ display: none !important; \}/);
  assert.doesNotMatch(page, />\s*New Setup\s*</);
  assert.doesNotMatch(page, />\s*Edit Setup\s*</);
  assert.doesNotMatch(page, />\s*View Event\s*</);
});

test('keeps existing booth backend actions while pairing setup with live links', () => {
  assert.match(page, /function openBoothWorkspaceEvent\(\)/);
  assert.match(page, /document\.getElementById\('boothViewContainer'\)\.style\.display = 'block';/);
  assert.match(page, /if \(currentBoothMode === 'edit' \|\| currentBoothMode === 'view'\)/);
  assert.match(page, /'\/api\/dashboard\/generate-booth'/);
  assert.match(page, /'\/api\/dashboard\/update-booth'/);
  assert.match(page, /'\/api\/dashboard\/delete-booth'/);
});
