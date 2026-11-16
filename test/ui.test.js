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
      for (const name of ['Overview', 'Ports', 'Labels', 'Checks', 'Normalize', 'Compare', 'Not parsed']) {
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
    const lbx = await save(page, () => page.click('button:has-text("P-touch template")'));
    assert.equal(lbx.name, 'cable-wrap-2line.lbx');
    assert.match(lbx.text, /^PK[\s\S]*label\.xml/);
    await page.selectOption('.toolbar select[aria-label="P-touch template"]', 'flag2');
    const zipped = await save(page, () => page.click('button:has-text("Zipped (.zip")'));
    assert.equal(zipped.name, 'fiber-flag-2line.zip');
    assert.match(zipped.text, /^PK[\s\S]*fiber-flag-2line\.lbx/);
    // field buttons write into the line last clicked, at the cursor, keeping text typed but not yet saved
    const line2 = page.locator('input[data-line="1"]');
    await line2.fill('Port');
    assert.equal(await page.textContent('.tokens .which'), 'Line 2');
    await page.click('.tokens button.token:has-text("{num}")');
    assert.equal(await line2.inputValue(), 'Port {num}');
    await line2.fill('');
    await page.click('.tokens button.token:has-text("[n{vlan}] [t{tagged}]")');
    assert.equal(await page.locator('input[data-line="1"]').inputValue(), '[n{vlan}] [t{tagged}]');
    await page.selectOption('.labelform select >> nth=0', 'vlans');
    assert.equal(await page.locator('input[data-line="1"]').inputValue(), '[n{vlan}] [t{tagged}]');
    assert.match(await page.textContent('#view'), /n3005/);
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

  await t.test('labels: print only odd setups, custom conditions, changes since a snapshot', async (t) => {
    const { page, errors } = await open(t);
    await page.selectOption('#selSample', 'ios');
    await page.click('#btnParse');
    await tab(page, 'Labels');
    const count = async () => (await page.textContent('.toolbar .count')).match(/^(\d+) label/)[1];
    await page.locator('.opts label', { hasText: 'Skip disabled ports' }).locator('input').uncheck();
    const all = +(await count());
    await page.selectOption('select[aria-label="Print only"]', 'odd');
    assert.match(await page.textContent('.only .hint'), /Most ports are access, VLAN 10/);
    assert.equal(await count(), '4');
    await page.selectOption('select[aria-label="Print only"]', '');
    await page.click('button:has-text("+ Add condition")');
    await page.selectOption('select[aria-label="Condition 1 column"]', 'tagged');
    await page.selectOption('select[aria-label="Condition 1 test"]', 'has');
    await page.fill('input[aria-label="Condition 1 value"]', '30');
    await page.press('input[aria-label="Condition 1 value"]', 'Tab');
    assert.equal(await count(), '3');
    await page.click('button[aria-label="Remove condition 1"]');
    assert.equal(+(await count()), all);
    await page.selectOption('select[aria-label="Print only"]', 'snap:');
    assert.match(await page.textContent('.only .hint'), /no snapshot/);
    assert.equal(await count(), '0');
    assert.deepEqual(errors, []);
  });

  await t.test('labels: find and replace in the label text', async (t) => {
    const { page, errors } = await open(t);
    await page.selectOption('#selSample', 'nxos');
    await page.click('#btnParse');
    await tab(page, 'Labels');
    const first = () => page.locator('.labelprev tbody tr').first().locator('td').first().textContent();
    assert.equal(await first(), 'Eth1/1');
    await page.click('button:has-text("+ Add replacement")');
    await page.fill('input[aria-label="Replacement 1 find"]', 'Eth');
    await page.press('input[aria-label="Replacement 1 find"]', 'Tab');
    assert.equal(await first(), '1/1');
    await page.fill('input[aria-label="Replacement 1 find"]', '/(/');
    await page.press('input[aria-label="Replacement 1 find"]', 'Tab');
    assert.match(await page.textContent('.only .warnhint'), /Not a valid regular expression/);
    assert.equal(await first(), 'Eth1/1');
    await page.click('button[aria-label="Remove replacement 1"]');
    assert.equal(await page.locator('input[aria-label="Replacement 1 find"]').count(), 0);
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

  await t.test('device search: a FortiGate with 60 managed switches', async (t) => {
    const { page, errors } = await open(t);
    await page.selectOption('#selSample', 'ios'); await page.click('#btnParse');
    assert.equal(await page.locator('#devFind').isHidden(), true);              // no search box for a short list
    const sw = Array.from({ length: 60 }, (x, i) => '    edit "IDF' + (i + 1) + '-SW"\n        set sn "S124FPTF' + String(1000 + i) + '"\n        set description "Floor ' + (i % 6) +
      '"\n        config ports\n            edit "port1"\n                set vlan "staff"\n            next\n        end\n    next').join('\n');
    await paste(page, 'BIG-FW # show\nconfig system interface\n    edit "staff"\n        set vlanid 10\n        set interface "fortilink"\n    next\nend\n' +
      'config switch-controller managed-switch\n' + sw + '\nend\n');
    await page.selectOption('#selBrand', 'Fortinet'); await page.selectOption('#selVendor', 'fortilink');
    await page.click('#btnParse');
    const picks = page.locator('.devices li .pick');
    assert.equal(await picks.count(), 62);
    assert.equal(await page.locator('#devFind').isVisible(), true);
    assert.equal(await page.textContent('#devCount'), '62 devices');
    await page.fill('#devSearch', 'idf4');
    assert.deepEqual(await picks.locator('b').allTextContents(), ['IDF4-SW', ...Array.from({ length: 10 }, (x, i) => 'IDF4' + i + '-SW')]);
    assert.match(await page.textContent('#devCount'), /^11 of 62 devices/);
    await page.fill('#devSearch', 'floor 3 1039');                             // description and serial, every word must match
    assert.deepEqual(await picks.locator('b').allTextContents(), ['IDF40-SW']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'devSearch');   // typing keeps the focus
    await page.press('#devSearch', 'Enter');
    assert.equal(await page.textContent('.devhead h1'), 'IDF40-SW');
    assert.equal(await page.inputValue('#devSearch'), 'floor 3 1039');
    await page.fill('#devSearch', 'nothing-like-this');
    assert.equal(await page.textContent('.devices li.empty'), 'No device matches.');
    await page.fill('#devSearch', '');
    assert.equal(await picks.count(), 62);
    // the selected device is scrolled into sight inside the list, and the list itself is what scrolls
    const box = await page.evaluate(() => { const ul = document.getElementById('deviceList'), li = ul.querySelector('li.sel').getBoundingClientRect(), r = ul.getBoundingClientRect();
      return { scrolls: ul.scrollHeight > ul.clientHeight, inside: li.top >= r.top && li.bottom <= r.bottom }; });
    assert.deepEqual(box, { scrolls: true, inside: true });
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

  await t.test('normalize: flags odd spellings and VLANs, and the correction reaches the labels', async (t) => {
    const { page, errors } = await open(t);
    const intf = (n, desc, allowed) => 'interface GigabitEthernet1/0/' + n + '\n description ' + desc +
      '\n switchport mode trunk\n switchport trunk native vlan 10\n switchport trunk allowed vlan ' + allowed + '\n!\n';
    await paste(page, 'hostname SW-NORM\n!\n' + intf(1, 'AP-Lobby', '20,30,40') + intf(2, 'AP-Hall', '20,30,40') + intf(3, 'AP-Roof', '20,30,40') +
      intf(4, 'Access Point Kitchen', '20,30') + 'end\n');
    await page.click('#btnParse');
    await page.click('.tabs button:has-text("Normalize (2)")');
    assert.match(await page.textContent('#view .finding h3'), /AP \(4 ports\)/);
    assert.match(await page.locator('.normtable').nth(0).textContent(), /Gi1\/0\/4Access Point KitchenAP Kitchen/);
    assert.match(await page.locator('.normtable').nth(1).textContent(), /missing tagged 40/);
    await page.click('button:has-text("Rename all 1")');
    assert.match(await page.textContent('#msg'), /Changed the description of 1 port/);
    await page.click('button:has-text("Set all 1 to match")');
    assert.match(await page.textContent('#view .count'), /Nothing to normalize/);
    await tab(page, 'Labels');
    await page.fill('input[data-line="1"]', '{desc} [t{tagged}]');
    await page.locator('input[data-line="1"]').blur();
    assert.match(await page.locator('.labelprev tbody tr').nth(3).textContent(), /AP Kitchen t20,30,40/);
    await tab(page, 'Ports');
    assert.match(await page.textContent('.toolbar .count'), /2 edited/);
    assert.deepEqual(errors, []);
  });

  await t.test('phone width: no sideways scrolling', async (t) => {
    const { page, errors } = await open(t, { viewport: { width: 390, height: 800 } });
    await page.selectOption('#selSample', 'ios');
    await page.click('#btnParse');
    for (const name of ['Overview', 'Ports', 'Labels', 'Checks', 'Normalize', 'Compare', 'Not parsed']) {
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
