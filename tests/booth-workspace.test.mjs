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
  assert.match(page, /\.booth-workspace-actions \.btn \{ display: inline-flex; align-items: center; justify-content: center; flex: 0 0 156px; width: 156px; min-height: 42px; white-space: nowrap; \}/);
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
  const eventSegment = page.slice(page.indexOf('id="boothEventSegment"'), page.indexOf('id="boothWebGallerySegment"'));
  const gallerySegment = page.slice(page.indexOf('id="boothWebGallerySegment"'), page.indexOf('id="boothViewContainer"'));
  assert.doesNotMatch(eventSegment, /Web Gallery Page Title/);
  assert.match(gallerySegment, /Web Gallery Page Title/);
});

test('lets the app shell own redundant tab titles', () => {
  const editQueue = page.slice(page.indexOf('id="editqueue-view"'), page.indexOf('id="payroll-view"'));
  const payroll = page.slice(page.indexOf('id="payroll-view"'), page.indexOf('id="booth-view"'));
  const expenses = page.slice(page.indexOf('id="expenses-view"'), page.indexOf('id="billingsales-view"'));
  const billingSales = page.slice(page.indexOf('id="billingsales-view"'), page.indexOf('id="payments-view"'));
  assert.doesNotMatch(editQueue, /<h4[^>]*>Editing Queue<\/h4>/);
  assert.doesNotMatch(payroll, /<h4[^>]*>[^<]*Payroll Engine<\/h4>/);
  assert.doesNotMatch(expenses, /<h4[^>]*>Log an Expense<\/h4>/);
  assert.doesNotMatch(billingSales, /Billing Sales Reports/);
});

test('uses Event as a full-width row above Web Gallery and Manage on desktop', () => {
  assert.match(page, /#boothFormFields \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 20px; min-width: 0; \}/);
  assert.match(page, /#boothFormFields > \.booth-workspace-segment \{ margin-top: 0; \}/);
  assert.match(page, /#boothEventSegment \{ grid-column: 1 \/ -1; \}/);
  assert.match(page, /@media \(max-width: 900px\) \{[\s\S]*?#boothFormFields \{ grid-template-columns: 1fr; \}/);
});

test('uses two setup columns for new events and hides the workspace by default', () => {
  assert.match(page, /#boothFormFields\.new-workspace #boothEventSegment \{ grid-column: auto; \}/);
  assert.match(page, /function setBoothMode\(mode, activateWorkspace = false\)/);
  assert.match(page, /boothFormFields'\)\.style\.display = activateWorkspace \? 'grid' : 'none';/);
  assert.match(page, /boothGenerateBtn'\)\.style\.display = activateWorkspace \? 'block' : 'none';/);
  assert.match(page, /boothFormFields'\)\.style\.display = mode === 'edit' && hasSelectedEvent \? 'grid' : 'none';/);
});

test('keeps the Booth workspace responsive on mobile', () => {
  assert.match(page, /@media \(max-width: 700px\) \{[\s\S]*?\.booth-workspace-card \{ width: 100%; padding: 12px !important; \}/);
  assert.match(page, /\.booth-workspace-actions \.btn \{ display: inline-flex; align-items: center; justify-content: center; flex: 0 0 156px; width: 156px; min-height: 42px; white-space: nowrap; \}/);
  assert.match(page, /\.booth-workspace-segment \.booth-custom-file-row \{ width: 100%; min-width: 0; \}/);
  assert.match(page, /#boothEventSegment \.row \{ margin-right: 0; margin-left: 0; row-gap: 14px; \}/);
  assert.match(page, /#boothEventSegment \.row > \[class\*="col-"\] \{ width: 100%; max-width: 100%; padding-right: 0; padding-left: 0; \}/);
});

test('hides zero detail rows for JiniCis and TinaLex without changing Total B', () => {
  const billingSales = page.slice(page.indexOf('function computeBillingSales()'));
  assert.match(billingSales, /if \(ji_rest > 0\) \{[\s\S]*?htmlT3 \+=/);
  assert.match(billingSales, /if \(t_rest > 0\) \{[\s\S]*?htmlT4 \+=/);
  assert.match(billingSales, /\$\{htmlT2\}/);
});

test('credits direct custom services to their assigned Billing Sales owners', () => {
  const billingSales = page.slice(page.indexOf('function computeBillingSales()'));
  assert.match(billingSales, /const francis = parseFloat\(amts\['amt_Francis'\]\) \|\| 0;/);
  assert.match(billingSales, /const tina = parseFloat\(amts\['amt_Tina'\]\) \|\| 0;/);
  assert.match(billingSales, /const grace = parseFloat\(amts\['amt_Grace'\]\) \|\| 0;/);
  assert.match(billingSales, /const netVat = sde \+ doc \+ preprod \+ high \+ vstudio \+ transpo \+ restTotal \+ francis \+ tina \+ grace;/);
  assert.match(billingSales, /t3_JiniSum \+= \(ji_rest \+ sdeThird \+ francis\)/);
  assert.match(billingSales, /t4_TinaSum \+= \(t_rest \+ sdeThird \+ tina\)/);
  assert.match(billingSales, /t5_JGSum \+= \(jgSpecificOther \+ sdeThird \+ grace\)/);
});

test('applies payroll source rules for SDE, Grace, and Edgar deductions', () => {
  const payroll = page.slice(page.indexOf('function renderEgmComputation()'), page.indexOf('function initPayrollPerson(name)'));
  assert.match(payroll, /if \(payer === 'SDE'\) \{[\s\S]*?deductions\.Francis \+= split;[\s\S]*?deductions\.Tina \+= split;[\s\S]*?deductions\.Grace \+= split;/);
  assert.match(payroll, /deductions\.Edgar \+= amount \* 0\.40;[\s\S]*?deductions\.Francis \+= amount \* 0\.30;[\s\S]*?deductions\.Tina \+= amount \* 0\.20;[\s\S]*?deductions\.Grace \+= amount \* 0\.10;/);
  assert.match(payroll, /function getDefaultPayrollPayer\(name, event\)[\s\S]*?if \(hasSde && \['Joram', 'Jun', 'Tatalino', 'Roy', 'Smile'\]\.includes\(name\)\) return 'SDE';[\s\S]*?if \(hasGraceService\) return 'Grace';/);
  assert.match(payroll, /let payer = getDefaultPayrollPayer\(c, e\);/);
  assert.match(payroll, /const graceDirect = doc \+ high \+ vstudio \+ \(parseFloat\(amts\['amt_Grace'\]\) \|\| 0\);/);
});

test('keeps legacy Pro events on the Manage zone without breaking the grid', () => {
  assert.match(page, /boothFormFields'\)\.style\.display = 'grid';[\s\S]*?boothEventSegment'\)\.style\.display = 'none';[\s\S]*?boothWebGallerySegment'\)\.style\.display = 'none';/);
});
