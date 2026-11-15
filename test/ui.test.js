// Browser tests against the bundled app (dist/confighelper.html). Run with: npm run test:ui
// Needs Playwright; skipped when it is not installed so that plain "npm test" has no dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; } catch (e) { /* not installed */ }
const APP = 'file://' + path.join(__dirname, '..', 'dist', 'confighelper.html');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');

async function open(t, opts) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1500, height: 900 }, acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'] }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(APP);
  return { page, errors };
}
const paste = (page, text) => page.evaluate(t => { document.getElementById('txtInput').value = t; }, text);
const save = async (page, click) => {
  const [d] = await Promise.all([page.waitForEvent('download'), click()]);
  const p = await d.path();
  return { name: d.suggestedFilename(), text: fs.readFileSync(p, 'utf8') };
};
const tab = (page, name) => page.click('.tabs button:has-text("' + name + '")');

test('ui', { skip: chromium ? false : 'Playwright is not installed' }, async (t) => {
  await t.test('every sample loads and every tab renders without errors', async (t) => {
    const { page, errors } = await open(t);
    const ids = await page.locator('#selSample option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
    assert.ok(ids.length >= 10);
    for (const id of ids) {
      await page.selectOption('#selSample', id);
      await page.click('#btnParse');
      assert.match(await page.textContent('#msg'), /^(Added|Merged into) /, id);
      for (const name of ['Overview', 'Ports', 'Labels', 'Checks', 'Compare', 'Not parsed']) {
        await tab(page, name);
        assert.ok(await page.locator('#view section').count() >= 2, id + ' / ' + name);
        assert.equal(await page.locator('#view .pagedesc').count(), 1, id + ' / ' + name + ' description');
        assert.equal(await page.locator('#view details.pagehelp').count(), 1, id + ' / ' + name + ' help');
      }
    }
    await page.click('#btnCables');
    assert.match(await page.textContent('.devhead h1'), /Cable list/);
    assert.equal(await page.locator('#view details.pagehelp[data-help=cables]').count(), 1);
    assert.deepEqual(errors, []);
  });

  await t.test('commands appear only for a platform chosen by hand', async (t) => {
    const { page, errors } = await open(t);
    const shown = () => page.locator('#cmdList button:has-text("Copy all")').count();
    await page.selectOption('#selSample', 'fortigate');
    await page.click('#btnParse');                                          // a device is loaded and selected: still nothing to copy
    assert.equal(await shown(), 0);
    assert.equal(await page.textContent('#cmdSummary'), 'Commands to run');
    await page.selectOption('#selBrand', 'Fortinet');                       // three platforms: none is picked for you
    assert.equal(await page.inputValue('#selVendor'), 'auto');
    assert.match(await page.locator('#selVendor option').first().textContent(), /Choose a platform/);
    assert.equal(await shown(), 0);
    await page.selectOption('#selVendor', 'fortilink');
    assert.equal(await shown(), 1);
    assert.match(await page.textContent('#cmdSummary'), /FortiLink/);
    await page.selectOption('#selBrand', 'Dell');                           // changing brand clears the choice again
    assert.equal(await shown(), 0);
    await page.selectOption('#selBrand', 'Juniper');                        // one platform: the brand is the choice
    assert.equal(await page.inputValue('#selVendor'), 'junos');
    assert.equal(await shown(), 1);
    await page.selectOption('#selBrand', 'Cisco');                          // brand chosen, platform not: pastes are still auto-detected
    await page.selectOption('#selSample', 'ios');
    await page.click('#btnParse');
    assert.match(await page.textContent('#msg'), /^Added .* as Cisco IOS/);
    assert.deepEqual(errors, []);
  });

  await t.test('real 3850 session: table, filter, sort, export, labels', async (t) => {
    const { page, errors } = await open(t);
    await paste(page, FIXTURE);
    await page.click('#btnParse');
    assert.match(await page.textContent('#msg'), /Added SW-PATCH-01 as Cisco IOS \/ IOS-XE: 65 ports/);
    assert.equal(await page.locator('.devhead .pill').count(), 0);                     // verified platform: no "experimental" badge
    assert.equal(await page.locator('tbody tr').count(), 65);
    await page.fill('.toolbar input[type=search]', 'err-disabled');
    assert.match(await page.textContent('.toolbar .count'), /^1 of 65 shown/);
    await page.fill('.toolbar input[type=search]', '');
    await page.check('text=Link up only');
    assert.equal(await page.locator('tbody tr').count(), 6);
    await page.click('details.exp summary');
    const csv = await save(page, () => page.click('details.exp button:has-text("Download")'));
    assert.equal(csv.name, 'SW-PATCH-01-ports.csv');
    assert.equal(csv.text.trim().split('\r\n').length, 7);
    assert.match(csv.text, /GigabitEthernet1\/0\/7,TechArea-Test-Rack,enabled,up,1G,access,3005/);
    await tab(page, 'Labels');
    const lab = await save(page, () => page.click('button:has-text("Export label file")'));
    assert.match(lab.text, /^Line1,Line2\r\nGi1\/0\/1,Lab-Data\r\n/);
    await tab(page, 'Checks');
    assert.match(await page.textContent('#view'), /err-disabled/);
    await page.locator('.finding', { hasText: 'err-disabled' }).locator('button').click();
    assert.match(await page.textContent('.toolbar .count'), /^1 of 65 shown/);
    assert.deepEqual(errors, []);
  });

  await t.test('edits, snapshot compare and reload persistence', async (t) => {
    const { page, errors } = await open(t);
    await page.selectOption('#selSample', 'ios');
    await page.click('#btnParse');
    await page.click('button:has-text("Edit")');
    const first = page.locator('tbody tr').nth(1).locator('input[type=text]').first();
    await first.fill('Edited by test');
    await first.press('Tab');
    await page.locator('tbody tr').nth(2).locator('input[type=checkbox]').uncheck();
    await page.click('button:has-text("Done editing")');
    assert.match(await page.textContent('.toolbar .count'), /8 of 9 shown, 1 edited, 1 excluded/);
    const sample = await page.evaluate(() => window.NP.samples.ios.text);
    await page.selectOption('#selTarget', 'snapshot');
    await paste(page, sample.replace(' description AP-Lobby\n', ' description AP-Lobby-2\n'));
    await page.click('#btnParse');
    assert.match(await page.textContent('#view'), /1 difference\(s\)/);
    assert.match(await page.textContent('.difftable'), /AP-Lobby-2/);
    await page.reload();
    await tab(page, 'Ports');
    assert.match(await page.textContent('.toolbar .count'), /1 edited, 1 excluded/);
    assert.match(await page.textContent('.tabs'), /Compare \(1\)/);
    assert.deepEqual(errors, []);
  });

  await t.test('sanitize and problem report', async (t) => {
    const { page, errors } = await open(t);
    await page.click('#sanBox summary');
    await paste(page, FIXTURE);
    const rep = await save(page, () => page.click('#btnReport'));
    assert.equal(rep.name, 'confighelper-report.txt');
    assert.match(rep.text, /Sanitized text parses the same as the original: yes/);
    assert.ok(!rep.text.includes('SW-PATCH-01'));
    await page.click('#btnSanitize');
    assert.match(await page.textContent('#sanMsg'), /still parses to the same 65 ports and 27 VLANs/);
    assert.ok(!(await page.inputValue('#txtInput')).includes('SW-PATCH-01'));
    assert.deepEqual(errors, []);
  });

  await t.test('the page cannot contact any server', async (t) => {
    const { page } = await open(t);
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval|https?:/.test(csp), 'no escape hatches in the policy');
    const tries = await page.evaluate(async () => {
      const out = {};
      try { await fetch('https://example.com/x'); out.fetch = 'allowed'; } catch (e) { out.fetch = 'blocked'; }
      out.xhr = await new Promise(r => { const x = new XMLHttpRequest(); x.onload = () => r('allowed'); x.onerror = () => r('blocked');
        try { x.open('GET', 'https://example.com/x'); x.send(); } catch (e) { r('blocked'); } });
      out.img = await new Promise(r => { const i = new Image(); i.onload = () => r('allowed'); i.onerror = () => r('blocked'); i.src = 'https://example.com/x.png'; });
      out.script = await new Promise(r => { const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.head.appendChild(s); r(window.__injected ? 'allowed' : 'blocked'); });
      return out;
    });
    assert.deepEqual(tries, { fetch: 'blocked', xhr: 'blocked', img: 'blocked', script: 'blocked' });
  });

  await t.test('eight-member stack: unit selector and a responsive table', async (t) => {
    const { page, errors } = await open(t);
    await paste(page, require('./stack.js')(8));
    await page.click('#btnParse');
    assert.match(await page.textContent('#msg'), /416 ports/);
    assert.equal(await page.locator('tbody tr').count(), 416);
    await page.selectOption('.toolbar select[aria-label="Stack unit"]', '5');
    assert.match(await page.textContent('.toolbar .count'), /^52 of 416 shown/);       // 48 access ports + 4 empty uplink slots
    await tab(page, 'Labels');
    assert.match(await page.textContent('.toolbar .count'), /^48 label/);      // the unit choice carries over
    await tab(page, 'Overview');
    assert.match(await page.textContent('#view'), /Stack units \/ slots \(8\)/);
    await tab(page, 'Ports');
    await page.selectOption('.toolbar select[aria-label="Stack unit"]', '');
    // typing in the filter re-draws the table: it has to stay quick with every port showing
    const ms = await page.evaluate(async () => {
      const box = document.querySelector('.toolbar input[type=search]');
      const t0 = performance.now();
      for (const ch of 'desk 1') { box.value += ch; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(requestAnimationFrame); }
      return (performance.now() - t0) / 6;
    });
    console.log('      average redraw per keystroke with 416 ports: ' + ms.toFixed(0) + ' ms');
    assert.ok(ms < 250, 'redraw took ' + ms.toFixed(0) + ' ms');
    assert.deepEqual(errors, []);
  });

  await t.test('remove and clear all can be undone; backup reminder', async (t) => {
    const { page, errors } = await open(t);
    for (const id of ['ios', 'junos']) { await page.selectOption('#selSample', id); await page.click('#btnParse'); }
    assert.match(await page.textContent('#bkHint'), /Only saved in this browser so far/);
    await save(page, () => page.click('#btnBackup'));
    assert.match(await page.textContent('#bkHint'), /^Backed up /);
    await page.click('.devices li:first-child button.link');
    assert.equal(await page.locator('.devices li .pick').count(), 1);
    assert.match(await page.textContent('#undoBar'), /Removed SW-ACCESS-01/);
    assert.match(await page.textContent('#bkHint'), /Changed since the backup/);
    await page.click('#undoBar button');
    assert.equal(await page.locator('.devices li .pick').count(), 2);
    assert.match(await page.textContent('#bkHint'), /^Backed up /);
    await page.click('#btnClear');
    assert.equal(await page.locator('.devices li .pick').count(), 0);
    await page.click('#undoBar button');
    assert.equal(await page.locator('.devices li .pick').count(), 2);
    assert.equal(await page.locator('#undoBar').isHidden(), true);
    assert.deepEqual(errors, []);
  });

  await t.test('phone width: no sideways scrolling', async (t) => {
    const { page, errors } = await open(t, { viewport: { width: 390, height: 800 } });
    await page.selectOption('#selSample', 'ios');
    await page.click('#btnParse');
    for (const name of ['Overview', 'Ports', 'Labels', 'Checks', 'Compare', 'Not parsed']) {
      await tab(page, name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, name);
    }
    assert.deepEqual(errors, []);
  });

  await t.test('page help: closed by default, remembers being opened, experimental parsers say so in words', async (t) => {
    const { page, errors } = await open(t);
    assert.equal(await page.locator('#inputHelp details.pagehelp').count(), 1);
    assert.equal(await page.locator('#inputHelp details.pagehelp').evaluate(d => d.open), false);
    await paste(page, FIXTURE);
    await page.click('#btnParse');
    const help = page.locator('#view details.pagehelp');
    assert.equal(await help.getAttribute('data-help'), 'ports');
    assert.equal(await help.evaluate(d => d.open), false);
    assert.equal(await page.locator('#view .warnhint').count(), 0);                   // verified platform
    await help.locator('summary').click();
    assert.match(await help.textContent(), /Use it for.*Limits/s);
    assert.equal(await help.locator('input, button, select, textarea').count(), 0);  // reading matter only
    await tab(page, 'Labels');
    assert.equal(await page.locator('#view details.pagehelp').evaluate(d => d.open), false);
    await page.reload();
    await tab(page, 'Ports');
    assert.equal(await page.locator('#view details.pagehelp').evaluate(d => d.open), true);
    const exp = await page.locator('#selSample option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
    await page.selectOption('#selSample', exp.find(v => v !== 'ios') || exp[0]);
    await page.click('#btnParse');
    if (await page.locator('.devhead .pill.warn').count()) assert.match(await page.textContent('#view .warnhint'), /Experimental parser/);
    assert.deepEqual(errors, []);
  });
});
