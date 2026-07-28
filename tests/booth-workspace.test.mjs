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

test('keeps workspace actions together in the header', () => {
  const header = page.match(/<div class="booth-workspace-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  for (const id of ['boothNewWorkspaceBtn', 'boothGenerateBtn', 'boothSaveBtn', 'boothDeleteBtn']) {
    assert.match(header, new RegExp(`id="${id}"`));
    assert.equal((page.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
});

test('keeps existing booth backend actions while pairing setup with live links', () => {
  assert.match(page, /function openBoothWorkspaceEvent\(\)/);
  assert.match(page, /document\.getElementById\('boothViewContainer'\)\.style\.display = 'block';/);
  assert.match(page, /if \(currentBoothMode === 'edit' \|\| currentBoothMode === 'view'\)/);
  assert.match(page, /'\/api\/dashboard\/generate-booth'/);
  assert.match(page, /'\/api\/dashboard\/update-booth'/);
  assert.match(page, /'\/api\/dashboard\/delete-booth'/);
});

test('groups Booth QR into Event, Web Gallery, and Manage zones', () => {
  for (const zone of ['Event', 'Web Gallery', 'Manage']) {
    assert.match(page, new RegExp(`data-dashboard-segment="${zone}"`));
  }
  assert.match(page, /id="boothShowSearchBar" style="cursor: pointer;"/);
  assert.match(page, /id="boothShowTime" style="cursor: pointer;"/);
  assert.match(page, /function clearBoothManageContainer\(\)/);
  assert.match(page, /clearBoothManageContainer\(\);[\s\S]*?setBoothMode\('new'\);/);
});

test('uses Event as a full-width row above Web Gallery and Manage on desktop', () => {
  assert.match(page, /#boothFormFields \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 20px; \}/);
  assert.match(page, /#boothEventSegment \{ grid-column: 1 \/ -1; \}/);
  assert.match(page, /@media \(max-width: 900px\) \{[\s\S]*?#boothFormFields \{ grid-template-columns: 1fr; \}/);
});

test('keeps legacy Pro events on the Manage zone without breaking the grid', () => {
  assert.match(page, /boothFormFields'\)\.style\.display = 'grid';[\s\S]*?boothEventSegment'\)\.style\.display = 'none';[\s\S]*?boothWebGallerySegment'\)\.style\.display = 'none';/);
});
