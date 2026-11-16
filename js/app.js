/* ConfigHelper UI. All rendering goes through h() / textContent: pasted configs are untrusted text. */
(function () {
  'use strict';
  const NP = window.NP;
  const $ = function (id) { return document.getElementById(id); };
  const STORE = 'confighelper.v1';

  const state = {
    devices: [], current: null, tab: 'ports',
    cols: NP.columns.filter(function (c) { return c.on; }).map(function (c) { return c.id; }),
    search: '', physOnly: false, hideDown: false, sort: null,
    view: 'device',                      // 'device' or 'cables' (the cross-device cable list)
    cab: { q: '', loadedOnly: false, fmt: 'csv', lines: ['{a} {aport}', '{b} {bport}', ''], bothEnds: true, maxLen: 0 },
    unit: '',                            // stack member shown on the Ports and Labels tabs ('' = all)
    devFilter: '',                       // text typed in the device search box (not saved)
    undo: null,                          // {text, devices, current}: the last removal, until something else changes
    sig: '', backupSig: '', lastBackup: '',
    editing: false, only: null,          // only: {title, keys} = Ports tab limited to the ports of one check
    exp: { fmt: 'csv', cols: 'shown', rows: 'shown', devs: 'device' },
    norm: { scope: 'device', pick: {} },  // Normalize tab: this device or all, and what each group is normalized to (not saved)
    label: { preset: 'port', per: 'port', lines: NP.labelPresets.port.lines.slice(), scope: 'device',
      physicalOnly: true, upOnly: false, describedOnly: false, skipDisabled: true,
      match: '', maxLen: 0, refCols: false, dedupe: false, delim: ',', only: '', snap: '', rules: [], replace: [], overrides: [] }
  };

  function h(tag, attrs) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'value' || k === 'selected' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    const add = function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    };
    for (let i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }

  // --------------------------------------------------------------- page help
  // Which "How this page works" panels were left open, by view id. Kept apart from STORE so a full
  // device store cannot lose it, and storage may be unavailable (private window): the panel still works.
  const HELP_STORE = 'confighelper.help';
  function helpOpen(id, set) {
    try {
      const o = JSON.parse(localStorage.getItem(HELP_STORE) || '{}') || {};
      if (set === undefined) return o[id] === true;
      if (set) o[id] = true; else delete o[id];
      localStorage.setItem(HELP_STORE, JSON.stringify(o));
    } catch (e) { /* starts closed next time */ }
    return !!set;
  }
  // The collapsed panel for one view, built from NP.help (js/help.js). Reading matter only: no controls in here.
  function helpPanel(id) {
    const e = NP.help[id];
    const body = h('div', { class: 'pagehelp-body' });
    NP.helpLabels.forEach(function (label) {
      (e.sections[label] || []).forEach(function (para, i) {
        body.appendChild(h('p', {}, i === 0 ? [h('b', { text: label }), ' '] : null, NP.helpInline(para).map(function (r) {
          if (r.kind === 'code') return h('code', { text: r.text });
          if (r.kind === 'link') return h('a', { href: r.href, target: '_blank', rel: 'noopener', text: r.text });
          return r.text;
        })));
      });
    });
    const d = h('details', { class: 'pagehelp', 'data-help': id }, h('summary', { text: NP.helpSummary }), body);
    d.open = helpOpen(id);
    d.addEventListener('toggle', function () { helpOpen(id, d.open); });
    return d;
  }
  // What goes under a view's heading: its one-line description, then its help panel.
  function pageHead(id) {
    return [h('p', { class: 'pagedesc', text: NP.help[id].desc }), helpPanel(id)];
  }

  // ------------------------------------------------------------- persistence
  function save() {
    try {
      state.saveFailed = false;
      const devJson = JSON.stringify(state.devices);
      let hsh = 2166136261;                              // FNV-1a: a cheap fingerprint to tell "changed since the last backup"
      for (let i = 0; i < devJson.length; i++) { hsh ^= devJson.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
      state.sig = devJson.length + ':' + (hsh >>> 0);
      localStorage.setItem(STORE, '{"devices":' + devJson + ',' + JSON.stringify({ current: state.current, cols: state.cols, label: state.label,
        backupSig: state.backupSig, lastBackup: state.lastBackup }).slice(1));
    } catch (e) {
      // private window or quota (snapshots are the usual cause): keep working, but say so
      if (!state.saveFailed && state.devices.length) msg('Could not save to browser storage (it may be full). Use Export backup to keep your work, and delete old snapshots.', 'err');
      state.saveFailed = true;
    }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!d) return;
      state.devices = NP.restore({ format: 'confighelper-backup', devices: d.devices || [] });
      state.current = d.current;
      if (Array.isArray(d.cols) && d.cols.length) state.cols = d.cols;
      if (d.label) Object.assign(state.label, d.label);
      state.backupSig = d.backupSig || ''; state.lastBackup = d.lastBackup || '';
    } catch (e) { /* ignore corrupt storage */ }
  }
  const cur = function () {
    return state.devices.find(function (d) { return d.id === state.current; }) || null;
  };

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  const fileSafe = function (s) { return String(s || 'device').replace(/[^\w.\-]+/g, '_'); };

  function msg(text, kind) {
    const el = $('msg');
    el.textContent = text; el.className = 'msg ' + (kind || '');
  }

  // The Platform list holds platform ids (see NP.platforms); parsers are keyed by parser id.
  function pickedParser() { return NP.platformParser($('selVendor').value); }

  // ------------------------------------------------------------------ ingest
  // A paste may hold sessions from several devices: each is taken on its own.
  function ingest(text, name) {
    const parts = $('selTarget').value === 'auto' || $('selTarget').value === 'new' ? NP.splitDevices(text) : [text];
    if (parts.length === 1) return ingestOne(text, name);
    const done = [], errs = [];
    parts.forEach(function (t, i) { try { done.push(ingestOne(t, name, (i + 1) + ' of ' + parts.length)); } catch (e) { errs.push(e.message); } });
    if (!done.length) throw new Error(errs[0]);
    const last = done[done.length - 1];
    last.others = done.slice(0, -1);
    return last;
  }
  function ingestOne(text, name, part) {
    let target = $('selTarget').value;
    if (target === 'snapshot') {
      const dev = cur();
      if (!dev) throw new Error('Select a device first, then paste its newer output as a new snapshot.');
      const vendor = pickedParser() === 'auto' ? (NP.detect(text) || dev.vendor) : pickedParser();
      NP.ingest(text, { vendor: vendor, devices: [], target: 'new' });      // throws if the paste is unusable: nothing is touched
      NP.snapshot(dev, 'Before ' + new Date().toLocaleString());
      NP.resetParsed(dev);
      target = 'current';
      $('selTarget').value = 'auto';                                         // further pastes (status, PoE ...) merge into the new state
      state.tab = 'compare';
    }
    const r = NP.ingest(text, {
      vendor: pickedParser(), target: target,
      devices: state.devices, current: cur(), name: name, part: part });
    state.undo = null;
    if (r.isNew) state.devices.push(r.dev);
    (r.extra || []).forEach(function (x) { if (x.isNew) state.devices.push(x.dev); });
    state.current = r.dev.id;
    state.view = 'device';
    return r;
  }
  function parseText(text, name) {
    if (!text.trim()) { msg('Paste something first.', 'err'); return; }
    try {
      const r = ingest(text, name);
      const said = function (x) {
        return (x.isNew ? 'Added ' : 'Merged into ') + (x.dev.hostname || 'unnamed device') + ' as ' +
          NP.vendors[x.vendor].label + ': ' + x.dev.ports.length + ' ports.';
      };
      msg((r.others || []).map(function (x) { return said(x) + ' '; }).join('') + said(r) +
        (r.extra && r.extra.length ? ' Also ' + r.extra.length + ' FortiLink-managed switch(es): ' +
          r.extra.slice(0, 6).map(function (x) { return x.dev.hostname; }).join(', ') +
          (r.extra.length > 6 ? ' and ' + (r.extra.length - 6) + ' more (use the search box under Devices)' : '') + '.' : '') +
        (r.cleaned && r.cleaned.length ? ' Cleaned up first: ' + r.cleaned.join('; ') + '.' : ''), 'ok');
      $('txtInput').value = '';
    } catch (e) { msg(e.message, 'err'); }
    save(); render();
  }
  function readFiles(files) {
    const list = Array.from(files);
    let done = 0, ok = 0;
    const errs = [];
    if (!list.length) return;
    list.forEach(function (f) {
      const fr = new FileReader();
      fr.onload = function () {
        try { ingest(String(fr.result), f.name); ok++; } catch (e) { errs.push(f.name + ': ' + e.message); }
        if (++done === list.length) {
          msg(ok + ' of ' + list.length + ' file(s) parsed.' + (errs.length ? ' ' + errs.join(' ') : ''), errs.length ? 'err' : 'ok');
          save(); render();
        }
      };
      fr.readAsText(f);
    });
  }

  // ---------------------------------------------------- command suggestions
  function renderCommands() {
    const box = $('cmdList');
    box.replaceChildren();
    // Commands are shown only for a platform chosen by hand, never guessed: a list for the wrong
    // platform is too easy to copy without noticing.
    const vendor = $('selVendor').value;
    const c = NP.commands[vendor];
    if (!c) {
      $('cmdSummary').textContent = 'Commands to run';
      box.appendChild(h('p', { text: $('selBrand').value === 'auto' ? 'Choose a brand and platform above to see which commands to run on the device.'
        : 'Choose a platform above to see which commands to run on the device.' }));
      return;
    }
    $('cmdSummary').textContent = 'Commands to run: ' + NP.platformLabel(vendor);
    box.appendChild(h('ol', {},
      c.pager ? h('li', {}, h('code', { text: c.pager }), h('span', { text: 'turns off paging so output is not cut at --More--' })) : null,
      c.cmds.map(function (x) { return h('li', {}, h('code', { text: x.cmd }), h('span', { text: x.gives })); })));
    box.appendChild(h('button', { onclick: function (e) {
      const btn = e.target;
      navigator.clipboard.writeText(NP.commandScript(vendor)).then(function () { btn.textContent = 'Copied'; },
        function () { btn.textContent = 'Copy failed'; });
      setTimeout(function () { btn.textContent = 'Copy all'; }, 1500);
    } }, 'Copy all'));
    box.appendChild(h('p', { text: 'Paste the block into the device session, then paste the whole session output below.' }));
    if (c.note) box.appendChild(h('p', { text: c.note }));
  }

  // ---------------------------------------------------------------- sidebar
  function renderDevices() {
    const ul = $('deviceList');
    ul.replaceChildren();
    const ub = $('undoBar');
    ub.hidden = !state.undo;
    ub.replaceChildren();
    if (state.undo) {
      ub.append(state.undo.text + ' ', h('button', { onclick: function () {
        state.devices = state.undo.devices; state.current = state.undo.current; state.undo = null; save(); render();
      } }, 'Undo'));
    }
    const bk = $('bkHint');
    bk.hidden = !state.devices.length;
    bk.replaceChildren();
    if (state.devices.length) {
      const exportLink = h('button', { onclick: function () { $('btnBackup').click(); } }, 'Export backup');
      if (state.sig && state.sig === state.backupSig) bk.append('Backed up ' + new Date(state.lastBackup).toLocaleString() + '.');
      else bk.append((state.lastBackup ? 'Changed since the backup of ' + new Date(state.lastBackup).toLocaleString() + '. ' : 'Only saved in this browser so far. '), exportLink);
    }
    // a FortiGate with its switches can add dozens of devices at once: from a handful up, offer a search box
    const find = $('devFind');
    find.hidden = state.devices.length < 8 && !state.devFilter;
    if (find.hidden) state.devFilter = '';
    if ($('devSearch').value !== state.devFilter) $('devSearch').value = state.devFilter;
    renderDeviceList();
  }
  // every word typed must be found somewhere in the device's name, platform, model, serial, addresses or description
  function deviceMatches(d, words) {
    if (!words.length) return true;
    const hay = [d.hostname, NP.vendorLabel(d), d.model, d.serial, d.version, d.mgmtIp, d.snmp && d.snmp.location,
      d.other && d.other.Description, d.other && d.other['Managed by']].filter(Boolean).join('\n').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function shownDevices() {
    const words = state.devFilter.toLowerCase().split(/\s+/).filter(Boolean);
    return state.devices.filter(function (d) { return deviceMatches(d, words); });
  }
  function pickDevice(d) { state.current = d.id; state.view = 'device'; state.sort = null; state.only = null; state.unit = ''; save(); render(); }
  // only the list: typing in the search box must not rebuild the page (and take the focus with it)
  function renderDeviceList() {
    const ul = $('deviceList');
    ul.replaceChildren();
    if (!state.devices.length) { ul.appendChild(h('li', { class: 'empty', text: 'No devices yet.' })); return; }
    const shown = shownDevices();
    $('devCount').textContent = state.devFilter ? shown.length + ' of ' + state.devices.length + ' devices' + (shown.length ? ' · Enter opens the first' : '')
      : state.devices.length + ' devices';
    if (!shown.length) ul.appendChild(h('li', { class: 'empty', text: 'No device matches.' }));
    shown.forEach(function (d) {
      ul.appendChild(h('li', { class: d.id === state.current && state.view !== 'cables' ? 'sel' : '' },
        h('button', { class: 'pick', title: [d.model, d.serial, d.mgmtIp, d.other && d.other.Description].filter(Boolean).join(' · '),
          onclick: function () { pickDevice(d); } },
          h('b', { text: d.hostname || '(unnamed)' }),
          h('span', { text: [NP.vendorLabel(d), d.ports.length + ' ports', d.other && d.other.Description].filter(Boolean).join(' · ') })),
        h('button', { class: 'link', title: 'Remove this device', 'aria-label': 'Remove ' + (d.hostname || 'device'),
          onclick: function () {
            state.undo = { text: 'Removed ' + (d.hostname || 'a device') + '.', devices: state.devices.slice(), current: state.current };
            state.devices = state.devices.filter(function (x) { return x !== d; });
            if (state.current === d.id) state.current = state.devices.length ? state.devices[0].id : null;
            save(); render();
          } }, '✕')));
    });
    // keep the selected device in sight in a long list (inside the list only: the page itself must not jump)
    const sel = ul.querySelector('li.sel');
    if (sel && ul.scrollHeight > ul.clientHeight) {
      if (sel.offsetTop < ul.scrollTop || sel.offsetTop + sel.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = Math.max(0, sel.offsetTop - ul.clientHeight / 3);
    }
  }

  // ------------------------------------------------------------------- views
  function render() {
    renderDevices();
    renderCommands();
    const view = $('view');
    view.replaceChildren();
    const cb = $('btnCables');
    cb.hidden = !state.devices.length;
    cb.textContent = 'Cable list (' + (state.devices.length ? NP.cables(state.devices).length : 0) + ')';
    cb.className = 'cablebtn' + (state.view === 'cables' ? ' sel' : '');
    if (state.view === 'cables' && state.devices.length) { cablesView(view); return; }
    const dev = cur();
    if (!dev) {
      view.appendChild(h('section', { class: 'card welcome' },
        h('h1', { text: 'Turn device output into a port sheet' }),
        h('p', { text: 'Paste a running config, show-command output, or a whole terminal session on the left.' }),
        h('ol', {},
          h('li', { text: 'Config gives VLANs, descriptions, spanning tree, DNS, NTP and the rest.' }),
          h('li', { text: 'Add interface status, PoE and neighbor output for the same device to fill in link state, power draw and what is plugged in.' }),
          h('li', { text: 'Export the table as CSV, or build label rows for P-touch Editor on the Labels tab.' })),
        h('p', { class: 'hint', text: 'Not sure what it looks like? Pick one of the samples under the Parse button.' })));
      return;
    }
    const tabs = [['overview', 'Overview'], ['ports', 'Ports (' + dev.ports.length + ')'], ['labels', 'Labels'],
      ['checks', 'Checks (' + NP.checks(dev).length + ')'],
      ['normalize', 'Normalize (' + NP.normalizeCount(NP.normalize([dev], state.norm.pick)) + ')'],
      ['compare', 'Compare (' + (dev.snapshots || []).length + ')'],
      ['unparsed', 'Not parsed (' + (dev.unparsed || []).length + ')']];
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'devhead' },
        h('h1', { text: dev.hostname || '(unnamed device)' }),
        h('span', { class: 'sub', text: [NP.vendorLabel(dev), dev.model, dev.version].filter(Boolean).join(' · ') }),
        NP.verified[dev.vendor] ? null : h('span', { class: 'pill warn',
          title: 'This parser was written from documentation and made-up samples and has not been checked against real hardware yet. Check the tables against the device, and look at the Not parsed tab.',
          text: 'experimental parser' }),
        h('button', { onclick: function () {
          const n = prompt('Device name', dev.hostname);
          if (n !== null) { dev.hostname = n.trim(); save(); render(); }
        } }, 'Rename')),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { role: 'tab', 'aria-selected': String(state.tab === t[0]),
          onclick: function () { state.tab = t[0]; render(); } }, t[1]);
      })),
      // said in words as well as by the pill: a tooltip does not show on touch screens or for keyboard users
      NP.verified[dev.vendor] ? null : h('p', { class: 'hint warnhint',
        text: 'Experimental parser: written from documentation and made-up samples, not yet checked against real hardware. Check the tables against the device, and look at the Not parsed tab.' }),
      pageHead(NP.help[state.tab] ? state.tab : 'ports')));
    if (state.tab === 'overview') overview(view, dev);
    else if (state.tab === 'labels') labels(view, dev);
    else if (state.tab === 'unparsed') unparsed(view, dev);
    else if (state.tab === 'checks') checks(view, dev);
    else if (state.tab === 'normalize') normalize(view, dev);
    else if (state.tab === 'compare') compare(view, dev);
    else ports(view, dev);
  }

  function overview(view, dev) {
    const grid = h('div', { class: 'grid' });
    NP.summary(dev).forEach(function (s) {
      grid.appendChild(h('section', { class: 'card' }, h('h2', { text: s.title }),
        h('dl', { class: 'kv' }, s.rows.map(function (r) {
          return [h('dt', { text: r[0] }), h('dd', { text: String(r[1]) })];
        }))));
    });
    view.appendChild(grid);
    const us = NP.units(dev);
    if (us.length) {
      view.appendChild(h('section', { class: 'card' }, h('h2', { text: 'Stack units / slots (' + us.length + ')' }),
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Unit', 'Ports', 'Up', 'Down', 'Disabled', 'Not present', 'PoE W', ''].map(function (t) { return h('th', { class: 'nosort', scope: 'col', text: t }); }))),
          h('tbody', {}, us.map(function (u) {
            return h('tr', {}, h('td', { class: 'mono', text: u.unit }), h('td', { text: u.ports }), h('td', { text: u.up }), h('td', { text: u.down }),
              h('td', { text: u.disabled }), h('td', { text: u.absent || '' }), h('td', { text: u.poeWatts || '' }),
              h('td', {}, h('button', { class: 'link', onclick: function () { state.unit = u.unit; state.tab = 'ports'; render(); } }, 'Show ports')));
          }))))));
    }
    if (dev.vlans.length) {
      view.appendChild(h('section', { class: 'card' }, h('h2', { text: 'VLANs' }),
        h('div', { class: 'chips' }, dev.vlans.map(function (v) {
          return h('span', { class: 'chip' }, h('b', { text: v.id }), v.name ? ' ' + v.name : '');
        }))));
    }
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('button', { onclick: function () {
          download(fileSafe(dev.hostname) + '-summary.csv', '﻿' + NP.csv(NP.summaryRows(dev)), 'text/csv');
        } }, 'Export summary CSV'),
        h('button', { title: 'Overview, VLANs and the port table as one Markdown document', onclick: function () {
          download(fileSafe(dev.hostname) + '-report.md', NP.deviceReport(dev, state.cols), 'text/markdown');
        } }, 'Export device report'),
        h('button', { onclick: function () { window.print(); } }, 'Print')),
      h('h2', { text: 'Loaded input' }),
      h('div', { class: 'chips' }, dev.sources.map(function (s) {
        return h('span', { class: 'chip', text: s.name + ' (' + s.lines + ' lines)' });
      }))));
  }

  function checks(view, dev) {
    const found = NP.checks(dev);
    const warn = found.filter(function (f) { return f.severity === 'warn'; }).length;
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: found.length
          ? warn + ' to fix, ' + (found.length - warn) + ' to review. These are prompts to look, worked out from what was loaded; the tool cannot know what is intentional.'
          : 'Nothing flagged in what was loaded for this device.' }),
        h('span', { class: 'spacer' }),
        found.length ? h('button', { onclick: function (e) { copyText(NP.checksText(dev), e.target, 'Copy findings'); } }, 'Copy findings') : null)));
    found.forEach(function (f) {
      const shown = f.ports.slice(0, 16).map(function (p) { return p.short; }).join(', ') + (f.ports.length > 16 ? ', +' + (f.ports.length - 16) + ' more' : '');
      view.appendChild(h('section', { class: 'card finding' },
        h('div', { class: 'findhead' },
          h('span', { class: 'pill ' + (f.severity === 'warn' ? 'off' : 'warn'), text: f.severity === 'warn' ? 'Fix' : 'Review' }),
          h('h3', { text: f.title })),
        h('p', { text: f.detail }),
        f.ports.length ? h('p', { class: 'findports' }, h('span', { class: 'mono', text: shown }), ' ',
          h('button', { onclick: function () {
            state.only = { title: f.title, keys: f.ports.map(function (p) { return p.key; }) };
            state.tab = 'ports'; state.search = ''; state.physOnly = false; state.hideDown = false; render();
          } }, 'Show these ' + f.ports.length + ' in Ports')) : null));
    });
  }

  // Ports of the same kind that are not written or set up alike, with the correction on offer.
  function normalize(view, dev) {
    const N = state.norm;
    const many = N.scope === 'all' && state.devices.length > 1;
    const devs = many ? state.devices : [dev];
    const groups = NP.normalize(devs, N.pick);
    const total = NP.normalizeCount(groups);
    const apply = function (kind, rows, what) {
      const n = NP.normalizeApply(kind, rows);
      save(); render();
      msg('Changed the ' + what + ' of ' + n + ' port(s) in the table, exports and labels. Edit on the Ports tab shows and undoes it.', 'ok');
    };
    const choose = function (g, field, value, options, aria) {
      return sel(value, options, function (v) { (N.pick[g.id] = N.pick[g.id] || {})[field] = v; render(); }, aria);
    };
    const table = function (heads, rows, cells) {
      return h('div', { class: 'tablewrap' }, h('table', { class: 'normtable' },
        h('thead', {}, h('tr', {}, (many ? ['Device'] : []).concat(heads, ['']).map(function (t) { return h('th', { class: 'nosort', scope: 'col', text: t }); }))),
        h('tbody', {}, rows.map(function (r) {
          return h('tr', {}, many ? h('td', { text: r.dev.hostname || '(unnamed)' }) : null, h('td', { class: 'mono', text: r.short }), cells(r));
        }))));
    };
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: total
          ? total + ' port(s) differ from the others of their kind, in ' + groups.length + ' group(s).'
          : 'Nothing to normalize: ports with the same kind of description are written and set up alike.' }),
        h('span', { class: 'spacer' }),
        state.devices.length > 1 ? sel(N.scope, [['device', 'This device only'], ['all', 'All loaded devices (' + state.devices.length + ')']],
          function (v) { N.scope = v; render(); }, 'Devices to compare') : null,
        total ? h('button', { onclick: function (e) { copyText(NP.normalizeText(devs, N.pick), e.target, 'Copy list'); } }, 'Copy list') : null),
      h('p', { class: 'hint', text: 'Applying a correction changes this table, its exports and the labels only. Nothing is written to the switch: a port with different VLANs still has to be fixed there, or its label will not match what it carries.' })));
    groups.forEach(function (g) {
      const S = g.spelling, V = g.vlans;
      view.appendChild(h('section', { class: 'card finding' },
        h('div', { class: 'findhead' }, h('h3', { text: g.label + ' (' + g.count + ' ports)' })),
        S ? [
          h('div', { class: 'normhead' },
            h('span', { text: 'Written ' + S.variants.length + ' ways. Use' }),
            choose(g, 'spelling', S.target, S.variants.map(function (v) { return [v.text, v.text + ' (' + v.count + ')']; }), 'Spelling to use for ' + g.label),
            h('button', { class: 'primary', onclick: function () { apply('spelling', S.rows, 'description'); } }, 'Rename all ' + S.rows.length)),
          table(['Port', 'Description', 'Becomes'], S.rows, function (r) {
            return [h('td', { class: 'wrap', text: r.from }), h('td', { class: 'wrap', text: r.to }),
              h('td', {}, h('button', { 'aria-label': 'Rename ' + r.short, onclick: function () { apply('spelling', [r], 'description'); } }, 'Rename'))];
          })] : null,
        V ? [
          h('div', { class: 'normhead' },
            h('span', { text: V.profiles[0].count + ' of ' + V.of + ' have the same VLANs. Compare with' }),
            choose(g, 'profile', V.target, V.profiles.map(function (p) { return [p.sig, p.label + ' (' + p.count + ')']; }), 'VLAN setup to compare ' + g.label + ' with'),
            h('button', { onclick: function () { apply('vlans', V.rows, 'VLANs'); } }, 'Set all ' + V.rows.length + ' to match')),
          table(['Port', 'VLANs now', 'Difference'], V.rows, function (r) {
            return [h('td', { class: 'mono', text: r.from }), h('td', { class: 'wrap', text: r.diff }),
              h('td', {}, h('button', { 'aria-label': 'Set ' + r.short + ' to match', onclick: function () { apply('vlans', [r], 'VLANs'); } }, 'Set to match'))];
          })] : null));
    });
  }

  function cablesView(view) {
    const K = state.cab;
    const all = NP.cables(state.devices);
    const q = K.q.trim().toLowerCase();
    const list = all.filter(function (c) {
      if (K.loadedOnly && !c.b.dev) return false;
      return !q || [c.id, c.a.host, c.a.port, c.a.desc, c.b.host, c.b.port, c.b.desc, c.status].join(' ').toLowerCase().includes(q);
    });
    const count = function (s) { return all.filter(function (c) { return c.status === s; }).length; };
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'devhead' }, h('h1', { text: 'Cable list' }),
        h('span', { class: 'sub', text: all.length + ' link(s) across ' + state.devices.length + ' loaded device(s): ' + count('both ends') + ' seen from both ends, ' +
          count('one end only') + ' from one end, ' + count('far end not loaded') + ' to devices not loaded' + (count('mismatch') ? ', ' + count('mismatch') + ' mismatched' : '') })),
      pageHead('cables'),
      h('p', { class: 'hint', text: 'A link reported by both switches is listed once. ' +
        'Links only appear where neighbor output was loaded; ports you excluded and neighbors you edited on the Ports tab are respected. IDs are assigned in list order and change when devices are added.' })));
    if (!all.length) {
      view.appendChild(h('section', { class: 'card' }, h('p', { class: 'empty', text: 'No neighbor data is loaded yet. Paste CDP or LLDP neighbor output for your devices (the "Commands to run" list includes it).' })));
      return;
    }
    const search = h('input', { type: 'search', placeholder: 'Filter cables…', value: K.q, 'aria-label': 'Filter cables',
      oninput: function (e) {
        K.q = e.target.value; render();
        const el = document.querySelector('.toolbar input[type=search]');
        el.focus(); el.setSelectionRange(el.value.length, el.value.length);
      } });
    const rows = function () { return NP.cableRows(list); };
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'toolbar' }, search,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: K.loadedOnly, onchange: function (e) { K.loadedOnly = e.target.checked; render(); } }), 'Only links between loaded devices'),
        h('span', { class: 'count', text: list.length + ' of ' + all.length + ' shown' }), h('span', { class: 'spacer' }),
        sel(K.fmt, Object.keys(NP.formats).map(function (k) { return [k, NP.formats[k].label]; }), function (v) { K.fmt = v; render(); }, 'Export format'),
        h('button', { class: 'primary', onclick: function () {
          const f = NP.formats[K.fmt];
          download('cable-list.' + f.ext, NP.formatRows(rows(), K.fmt), f.mime);
        } }, 'Download'),
        h('button', { onclick: function (e) { copyText(NP.formatRows(rows(), K.fmt).replace(/^\ufeff/, ''), e.target, 'Copy'); } }, 'Copy'),
        h('button', { onclick: function () { window.print(); } }, 'Print')),
      list.length ? h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['ID', 'Device A', 'Port A', 'Description A', 'Device B', 'Port B', 'Description B', 'Speed', 'Status'].map(function (t) {
          return h('th', { class: 'nosort', scope: 'col', text: t }); }))),
        h('tbody', {}, list.map(function (c) {
          const cls = c.status === 'both ends' ? 'up' : c.status === 'mismatch' ? 'off' : c.status === 'one end only' ? 'warn' : 'down';
          return h('tr', {}, h('td', { class: 'mono', text: c.id }), h('td', { text: c.a.host }), h('td', { class: 'mono', text: c.a.port }), h('td', { class: 'wrap', text: c.a.desc }),
            h('td', { text: c.b.host }), h('td', { class: 'mono', text: c.b.port }), h('td', { class: 'wrap', text: c.b.desc }), h('td', { text: c.speed }),
            h('td', { title: c.note || null }, h('span', { class: 'pill ' + cls, text: c.status }), c.note ? h('div', { class: 'hint', text: c.note }) : null));
        })))) : h('p', { class: 'empty', text: 'No cables match.' })));

    if (!Array.isArray(state.label.overrides)) state.label.overrides = [];
    const lab = NP.cableLabelRows(list, Object.assign({}, K, { replace: state.label.replace, overrides: state.label.overrides, devices: state.devices }));
    const nOver = state.label.overrides.filter(function (o) { return o && o.field && String(o.ports || '').trim(); }).length;
    const line = function (i) {
      return h('label', {}, 'Line ' + (i + 1) + (i ? ' (optional)' : ''),
        h('input', { type: 'text', value: K.lines[i] || '', onchange: function (e) { K.lines[i] = e.target.value; render(); } }));
    };
    view.appendChild(h('section', { class: 'card' },
      h('h2', { text: 'Cable labels' }),
      h('div', { class: 'labelform' }, line(0), line(1), line(2),
        h('label', {}, 'Max characters per line (0 = no limit)',
          h('input', { type: 'text', inputmode: 'numeric', value: String(K.maxLen || 0), onchange: function (e) { K.maxLen = Math.max(0, parseInt(e.target.value, 10) || 0); render(); } }))),
      h('div', { class: 'opts' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: K.bothEnds, onchange: function (e) { K.bothEnds = e.target.checked; render(); } }),
          'Two labels per cable, one for each end (the second swaps A and B, so each reads "this end, then far end")')),
      replaceEditor(''),
      h('p', { class: 'tokens' }, 'Fields: ', Object.keys(NP.cableTokens).map(function (t) { return [h('code', { text: '{' + t + '}' }), ' ']; }),
        ' The labels follow the filter above.'),
      h('p', { class: 'hint' }, nOver
        ? nOver + ' override(s) from the Labels tab apply here: {desc} and {port} change that end, {neighbor} and {nport} the far end, and "No label" leaves out the labels that start at those ports. Whole-line and VLAN overrides only affect port labels. Changed labels are marked. '
        : 'Overrides set on the Labels tab ({desc}, {port}, {neighbor}, {nport}, No label) apply here too. ',
        h('button', { type: 'button', class: 'link', onclick: function () { state.view = 'device'; state.tab = 'labels'; render(); } }, 'Edit overrides')),
      h('div', { class: 'toolbar' }, h('span', { class: 'count', text: (lab.length - 1) + ' label(s)' }), h('span', { class: 'spacer' }),
        h('button', { disabled: lab.length < 2, onclick: function (e) { copyText(NP.csv(lab, '\t'), e.target, 'Copy'); } }, 'Copy'),
        h('button', { class: 'primary', disabled: lab.length < 2, onclick: function () { download('cable-labels.csv', NP.csv(lab), 'text/csv'); } }, 'Export label file')),
      lab.length > 1 ? h('div', { class: 'tablewrap' }, h('table', { class: 'labelprev' },
        h('thead', {}, h('tr', {}, lab[0].map(function (c) { return h('th', { class: 'nosort', scope: 'col', text: c }); }))),
        h('tbody', {}, lab.slice(1).map(function (r, i) {
          return h('tr', { class: lab.overridden[i] ? 'overridden' : null, title: lab.overridden[i] ? 'Changed by an override' : null },
            r.map(function (c) { return h('td', { class: 'line', text: c }); }));
        })))) : null));
  }

  function compare(view, dev) {
    const snaps = dev.snapshots || [];
    const C = state.cmp = state.cmp || { from: 0, to: 'current', live: false };
    const fmtAt = function (s) { const d = new Date(s.at); return isNaN(d) ? '' : d.toLocaleString(); };
    const saveBtn = h('button', { title: 'Keep a frozen copy of what is loaded for this device right now', onclick: function () {
      const label = prompt('Name for this snapshot', 'Snapshot ' + new Date().toLocaleString());
      if (label === null) return;
      NP.snapshot(dev, label.trim() || undefined);
      save(); render();
    } }, 'Save snapshot of current state');

    view.appendChild(h('section', { class: 'card' },
      h('h2', { text: 'Snapshots' }),
      snaps.length
        ? h('div', { class: 'tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Name', 'Saved', 'Ports', 'VLANs', ''].map(function (t) { return h('th', { class: 'nosort', scope: 'col', text: t }); }))),
            h('tbody', {}, snaps.map(function (s, i) {
              return h('tr', {}, h('td', { class: 'wrap', text: s.label }), h('td', { text: fmtAt(s) }),
                h('td', { text: (s.data.ports || []).length }), h('td', { text: (s.data.vlans || []).length }),
                h('td', {},
                  h('button', { class: 'link', title: 'Rename', onclick: function () {
                    const n = prompt('Snapshot name', s.label);
                    if (n !== null && n.trim()) { s.label = n.trim(); save(); render(); }
                  } }, 'Rename'), ' ',
                  h('button', { class: 'link', title: 'Delete this snapshot', onclick: function () {
                    if (!confirm('Delete snapshot "' + s.label + '"?')) return;
                    snaps.splice(i, 1); C.from = 0; C.to = 'current'; save(); render();
                  } }, 'Delete')));
            }))))
        : h('p', { class: 'empty', text: 'No snapshots yet for this device.' }),
      h('div', { class: 'btnrow' }, saveBtn),
      h('p', { class: 'hint', text: 'To compare with a later state of the device: choose "Selected device, as a new snapshot" under Add to, then paste the newer output. ' +
        'What is loaded now is saved as a snapshot and the device starts fresh from the new paste, so removed VLANs and settings show up as removed. ' +
        'Up to ' + NP.MAX_SNAPSHOTS + ' snapshots are kept per device; they are included in backups.' })));
    if (!snaps.length) return;

    if (C.from >= snaps.length) C.from = 0;
    if (C.to !== 'current' && +C.to >= snaps.length) C.to = 'current';
    const opt = function (withCurrent) {
      return (withCurrent ? [['current', 'Current state']] : []).concat(snaps.map(function (s, i) { return [String(i), s.label]; }));
    };
    const from = snaps[+C.from], to = C.to === 'current' ? null : snaps[+C.to];
    const a = from.data, b = to ? to.data : dev;
    const fromLabel = from.label, toLabel = to ? to.label : 'Current state';
    const d = NP.diff(a, b, { live: C.live });
    const e = function (v) { return v === '' ? h('span', { class: 'none', text: '(none)' }) : v; };
    const setC = function (k) { return function (v) { C[k] = v; render(); }; };

    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'labelform' },
        h('label', {}, 'From (older)', sel(String(C.from), opt(false), setC('from'))),
        h('label', {}, 'To (newer)', sel(String(C.to), opt(true), setC('to')))),
      h('div', { class: 'opts' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: C.live, onchange: function (ev) { C.live = ev.target.checked; render(); } }),
          'Also compare live state (link, speed, PoE draw, neighbors)')),
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: d.total ? d.total + ' difference(s): ' + d.settings.length + ' device settings, ' +
          (d.vlansAdded.length + d.vlansRemoved.length + d.vlansRenamed.length) + ' VLANs, ' +
          (d.ports.length + d.portsAdded.length + d.portsRemoved.length) + ' ports' : 'No differences between these two.' }),
        h('span', { class: 'spacer' }),
        h('button', { onclick: function (ev) { copyText(NP.diffMarkdown(d, (dev.hostname || 'Device') + ' changes', fromLabel, toLabel), ev.target, 'Copy'); } }, 'Copy'),
        h('button', { onclick: function () {
          download(fileSafe(dev.hostname) + '-changes.md', NP.diffMarkdown(d, (dev.hostname || 'Device') + ' changes', fromLabel, toLabel), 'text/markdown');
        } }, 'Export changes')),
      d.fieldsSkipped.length ? h('p', { class: 'hint', text: 'Not compared, because only one side has that data loaded: ' + d.fieldsSkipped.join(', ') + '.' }) : null));

    const table = function (title, head, rows) {
      if (!rows.length) return;
      view.appendChild(h('section', { class: 'card' }, h('h2', { text: title + ' (' + rows.length + ')' }),
        h('div', { class: 'tablewrap' }, h('table', { class: 'difftable' },
          h('thead', {}, h('tr', {}, head.map(function (t) { return h('th', { class: 'nosort', scope: 'col', text: t }); }))),
          h('tbody', {}, rows.map(function (r) { return h('tr', {}, r.map(function (c, i) {
            return h('td', { class: i === r.length - 2 ? 'wrap before' : i === r.length - 1 ? 'wrap after' : 'mono' }, c);
          })); }))))));
    };
    table('Device settings', ['Item', 'Before', 'After'], d.settings.map(function (s) { return [s.item, e(s.before), e(s.after)]; }));
    table('VLANs', ['VLAN', 'Change', 'Before', 'After'],
      d.vlansAdded.map(function (v) { return [String(v.id), 'added', e(''), e(v.name || '')]; })
        .concat(d.vlansRemoved.map(function (v) { return [String(v.id), 'removed', e(v.name || ''), e('')]; }))
        .concat(d.vlansRenamed.map(function (v) { return [String(v.id), 'renamed', e(v.before), e(v.after)]; })));
    const prow = [];
    d.portsAdded.forEach(function (p) { prow.push([p.short, 'port added', e(''), e(p.description)]); });
    d.portsRemoved.forEach(function (p) { prow.push([p.short, 'port removed', e(p.description), e('')]); });
    d.ports.forEach(function (p) { p.changes.forEach(function (c) { prow.push([p.short, c.label, e(c.before), e(c.after)]); }); });
    table('Ports', ['Port', 'What', 'Before', 'After'], prow);
  }

  // The last paste for this device: what went in, what was worked out, what came out.
  function parseDebug(view, dev) {
    const text = NP.debugText(dev);
    if (!text) return;
    view.appendChild(h('section', { class: 'card' },
      h('details', { class: 'debug' },
        h('summary', { text: 'Parse debug (last paste)' }),
        h('p', { class: 'hint', text: 'How the last paste for this device was handled: its sections, how the platform was picked, timings, and how much of the port table it filled. It holds counts, the commands you ran and pattern names, never config values. Paste it into a bug report.' }),
        h('div', { class: 'btnrow' },
          h('button', { onclick: function (e) { copyText(text, e.target, 'Copy debug'); } }, 'Copy debug')),
        h('pre', { class: 'debugtext', text: text }))));
  }

  function unparsed(view, dev) {
    const groups = NP.unparsedGroups(dev);
    if (!groups.length) {
      view.appendChild(h('section', { class: 'card' },
        h('p', { class: 'empty', text: 'Everything in the input for this device was either used or is on the list of lines that never matter (certificates, banners, console settings and the like).' })));
      parseDebug(view, dev);
      return;
    }
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: 'Input the parser saw but did not use. Most of it is harmless; anything about a port, VLAN or service that matters to you is a gap worth reporting. Passwords and keys are replaced with ***.' }),
        h('span', { class: 'spacer' }),
        h('button', { onclick: function (e) { copyText(NP.unparsedText(dev), e.target, 'Copy list'); } }, 'Copy list'),
        h('button', { title: 'Forget this list; it is rebuilt from whatever you paste next', onclick: function () { dev.unparsed = []; save(); render(); } }, 'Clear'))));
    groups.forEach(function (g) {
      view.appendChild(h('section', { class: 'card' },
        h('h2', { text: g.title + ' (' + g.items.length + ')' }),
        h('p', { class: 'hint', text: g.hint }),
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { class: 'nosort', scope: 'col', text: g.ctx === 'command' ? 'Command' : 'Line' }),
            h('th', { class: 'nosort', scope: 'col', text: 'Times seen' }), h('th', { class: 'nosort', scope: 'col', text: g.ctx === 'command' ? 'Output lines' : 'Lines inside' }))),
          h('tbody', {}, g.items.map(function (e) {
            return h('tr', {}, h('td', { class: 'mono wrap', text: e.text }), h('td', { text: e.count }), h('td', { text: e.inner || '' }));
          }))))));
    });
    parseDebug(view, dev);
  }

  function pill(text) {
    if (!text) return '';
    const cls = text === 'up' || text === 'enabled' || text === 'on' || text === 'delivering' ? 'up'
      : text === 'disabled' ? 'off' : /^err|fault|deny|denied/i.test(text) ? 'warn' : 'down';
    return h('span', { class: 'pill ' + cls, text: text });
  }

  function portPredicate() {
    const q = state.search.trim().toLowerCase();
    const only = state.only ? state.only.keys : null;
    const unit = state.unit;
    return function (p) {
      if (only && !only.includes(p.key)) return false;
      if (unit && NP.portUnit(p) !== unit) return false;
      if (state.physOnly && p.kind !== 'physical') return false;
      if (state.hideDown && p.link !== 'up') return false;
      if (!q) return true;
      return NP.columns.some(function (c) { return String(c.get(p)).toLowerCase().includes(q); });
    };
  }
  function visiblePorts(dev) {
    let list = NP.eports(dev, state.editing).filter(portPredicate());
    if (state.sort) {
      const col = NP.columns.find(function (c) { return c.id === state.sort.id; });
      if (col) {
        list = list.slice().sort(function (a, b) {
          const x = String(col.get(a)).toLowerCase(), y = String(col.get(b)).toLowerCase();
          if (!x || !y) return x ? -1 : y ? 1 : 0;          // blanks always last
          return NP.naturalCompare(x, y) * state.sort.dir;
        });
      }
    }
    return list;
  }
  function copyText(text, btn, label) {
    navigator.clipboard.writeText(text).then(function () { btn.textContent = 'Copied'; },
      function () { btn.textContent = 'Copy failed'; });
    setTimeout(function () { btn.textContent = label; }, 1500);
  }
  function sel(value, options, onchange, aria) {
    return h('select', { 'aria-label': aria, onchange: function (e) { onchange(e.target.value); } }, options.map(function (o) {
      return h('option', { value: o[0], selected: String(value) === String(o[0]), text: o[1] });
    }));
  }

  // rows for the port export, honouring the Export menu choices
  function exportRows(dev, list) {
    const E = state.exp;
    const cols = NP.columns.filter(function (c) { return E.cols === 'all' || state.cols.includes(c.id); });
    const devs = E.devs === 'all' ? state.devices : [dev];
    const pred = portPredicate();
    const rows = [['Device'].concat(cols.map(function (c) { return c.label; }))];
    devs.forEach(function (d) {
      const all = NP.eports(d);                     // manual edits applied, excluded ports left out
      const ports = E.rows === 'all' ? all : d === dev ? list.filter(function (p) { return !p.excluded; }) : all.filter(pred);
      ports.forEach(function (p) { rows.push([d.hostname].concat(cols.map(function (c) { return c.get(p); }))); });
    });
    return rows;
  }

  function ports(view, dev) {
    const cols = NP.columns.filter(function (c) { return state.cols.includes(c.id); });
    const list = visiblePorts(dev);
    const E = state.exp;
    const check = function (label, key) {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: state[key], onchange: function (e) { state[key] = e.target.checked; render(); } }), label);
    };
    const search = h('input', { type: 'search', placeholder: 'Filter ports…', value: state.search, 'aria-label': 'Filter ports',
      oninput: function (e) {
        state.search = e.target.value; render();
        const el = document.querySelector('.toolbar input[type=search]');
        el.focus(); el.setSelectionRange(el.value.length, el.value.length);
      } });
    const colPicker = h('details', { class: 'cols' }, h('summary', { text: 'Columns' }),
      h('div', { class: 'pop' }, NP.columns.map(function (c) {
        return h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: state.cols.includes(c.id), onchange: function (e) {
            state.cols = NP.columns.map(function (x) { return x.id; }).filter(function (id) {
              return id === c.id ? e.target.checked : state.cols.includes(id);
            });
            save(); render();
            document.querySelector('details.cols').open = true;
          } }), c.label);
      })));
    const setExp = function (k) { return function (v) { E[k] = v; save(); render(); document.querySelector('details.exp').open = true; }; };
    const expMenu = h('details', { class: 'cols exp' }, h('summary', { class: 'primary', text: 'Export…' }),
      h('div', { class: 'pop right' },
        h('label', {}, 'Format', sel(E.fmt, Object.keys(NP.formats).map(function (k) { return [k, NP.formats[k].label]; }), setExp('fmt'))),
        h('label', {}, 'Columns', sel(E.cols, [['shown', 'Columns shown (' + cols.length + ')'], ['all', 'All columns (' + NP.columns.length + ')']], setExp('cols'))),
        h('label', {}, 'Rows', sel(E.rows, [['shown', 'Rows shown (filters applied)'], ['all', 'All ports']], setExp('rows'))),
        h('label', {}, 'Devices', sel(E.devs, [['device', 'This device'], ['all', 'All loaded devices (' + state.devices.length + ')']], setExp('devs'))),
        h('div', { class: 'btnrow' },
          h('button', { class: 'primary', onclick: function () {
            const f = NP.formats[E.fmt];
            download((E.devs === 'all' ? 'all-devices' : fileSafe(dev.hostname)) + '-ports.' + f.ext, NP.formatRows(exportRows(dev, list), E.fmt), f.mime);
          } }, 'Download'),
          h('button', { title: 'Copy in the chosen format', onclick: function (e) {
            copyText(NP.formatRows(exportRows(dev, list), E.fmt).replace(/^﻿/, ''), e.target, 'Copy');
          } }, 'Copy'))));
    const ec = NP.editCount(dev);
    const editBtn = h('button', { class: state.editing ? 'primary' : '', 'aria-pressed': String(state.editing),
      title: 'Change descriptions, VLANs, neighbors and notes, or leave ports out of exports and labels',
      onclick: function () { state.editing = !state.editing; render(); } }, state.editing ? 'Done editing' : 'Edit');
    const resetBtn = state.editing && ec.total ? h('button', { class: 'danger', onclick: function () {
      if (!confirm('Discard ' + ec.total + ' manual change(s) on ' + (dev.hostname || 'this device') + ' and go back to the parsed values?')) return;
      dev.edits = {}; save(); render();
    } }, 'Reset edits (' + ec.total + ')') : null;
    const units = NP.units(dev);
    if (state.unit && !units.some(function (u) { return u.unit === state.unit; })) state.unit = '';
    const unitSel = units.length ? sel(state.unit, [['', 'All units (' + units.length + ')']].concat(units.map(function (u) {
      return [u.unit, 'Unit ' + u.unit + ' (' + u.ports + ' ports)']; })), function (v) { state.unit = v; render(); }, 'Stack unit') : null;
    const toolbar = h('div', { class: 'toolbar' }, search, unitSel, check('Physical only', 'physOnly'), check('Link up only', 'hideDown'),
      colPicker, h('span', { class: 'count', text: list.length + ' of ' + dev.ports.length + ' shown' +
        (ec.fields ? ', ' + ec.fields + ' edited' : '') + (ec.excluded ? ', ' + ec.excluded + ' excluded' : '') }), h('span', { class: 'spacer' }),
      editBtn, resetBtn, expMenu, h('button', { onclick: function () { window.print(); } }, 'Print'));
    const onlyBar = state.only ? h('p', { class: 'onlybar' }, 'Showing the ' + state.only.keys.length + ' port(s) from the check: ',
      h('b', { text: state.only.title }), ' ',
      h('button', { onclick: function () { state.only = null; render(); } }, 'Show all ports')) : null;
    const editHint = state.editing ? h('p', { class: 'hint edithint', text: 'Type in the outlined cells (' +
      NP.columns.filter(function (c) { return NP.editable.includes(c.id); }).map(function (c) { return c.label; }).join(', ') +
      ') and untick a port to leave it out of exports and labels. Changes are kept when you paste newer output for this device; the parsed value is shown when you hover an edited cell.' }) : null;

    const thead = h('thead', {}, h('tr', {}, state.editing ? h('th', { class: 'nosort', scope: 'col', text: 'Include' }) : null, cols.map(function (c) {
      const s = state.sort && state.sort.id === c.id ? (state.sort.dir > 0 ? 'ascending' : 'descending') : null;
      return h('th', { 'aria-sort': s, scope: 'col', onclick: function () {
        if (!state.sort || state.sort.id !== c.id) state.sort = { id: c.id, dir: 1 };
        else if (state.sort.dir === 1) state.sort.dir = -1;
        else state.sort = null;
        render();
      } }, c.label);
    })));
    const tbody = h('tbody', {}, list.map(function (p) {
      const edited = p.edited || {};
      return h('tr', { class: p.excluded ? 'excluded' : '' }, state.editing ? h('td', {},
        h('input', { type: 'checkbox', checked: !p.excluded, 'aria-label': 'Include ' + p.short + ' in exports',
          onchange: function (e) { NP.setEdit(dev, p.key, 'excluded', !e.target.checked); save(); render(); } })) : null,
      cols.map(function (c) {
        const v = c.get(p);
        const was = edited[c.id];
        if (NP.editable.includes(c.id)) {
          const title = was !== undefined ? 'Parsed value: ' + (was || '(empty)') : null;
          if (state.editing) {
            return h('td', { class: 'editcell' + (was !== undefined ? ' edited' : '') + (c.id === 'mode' || c.id === 'untagged' ? ' narrow' : '') },
              h('input', { type: 'text', value: v || '', title: title, 'aria-label': c.label + ' for ' + p.short,
                onchange: function (e) { NP.setEdit(dev, p.key, c.id, e.target.value); save(); render(); } }));
          }
          if (was !== undefined) return h('td', { class: 'wrap edited', title: title, text: v == null ? '' : String(v) });
        }
        if (c.id === 'link' || c.id === 'admin' || c.id === 'poeStatus') return h('td', {}, pill(v));
        const cls = c.id === 'description' || c.id === 'notes' || c.id === 'stp' ? 'wrap'
          : c.id === 'name' || c.id === 'short' || c.id === 'ip' || c.id === 'tagged' ? 'mono' : '';
        return h('td', { class: cls, text: v == null ? '' : String(v) });
      }));
    }));
    view.appendChild(h('section', { class: 'card' }, toolbar, onlyBar, editHint,
      list.length ? h('div', { class: 'tablewrap' }, h('table', {}, thead, tbody))
        : h('p', { class: 'empty', text: 'No ports match.' })));
  }

  // Find and replace on the finished label text, e.g. drop "Eth" from Eth1/1/1. One list, kept with the
  // label settings, used by both the Labels tab and the cable labels.
  function replaceEditor(extra) {
    const L = state.label;
    if (!Array.isArray(L.replace)) L.replace = [];
    const bad = NP.labelReplacer(L.replace).errors;
    // Order matters (each works on the text the one above left), so rows can be dragged by their handle,
    // or moved with the arrow keys while the handle has focus.
    const move = function (from, to) {
      if (to < 0 || to >= L.replace.length || to === from) return;
      L.replace.splice(to, 0, L.replace.splice(from, 1)[0]);
      save(); render();
      const again = document.querySelector('button[aria-label="Move replacement ' + (to + 1) + '"]');
      if (again) again.focus();
    };
    const replaceRow = function (r, i) {
      const upd = function (k) { return function (e) { r[k] = e.target.value; save(); render(); }; };
      const row = h('div', { class: 'rule' + (r.off ? ' off' : ''), 'data-i': i,
        ondragstart: function (e) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); },
        ondragend: function () { row.draggable = false; row.classList.remove('dragging'); },
        ondragover: function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('dropto'); },
        ondragleave: function () { row.classList.remove('dropto'); },
        ondrop: function (e) {
          e.preventDefault();
          const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(from)) move(from, i);
        } },
        h('button', { type: 'button', class: 'grip', text: '⠿', title: 'Drag to reorder (or focus and press the up and down arrows)',
          'aria-label': 'Move replacement ' + (i + 1),
          onmousedown: function () { row.draggable = true; }, onmouseup: function () { row.draggable = false; },
          onkeydown: function (e) {
            if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
          } }),
        h('input', { type: 'checkbox', checked: !r.off, title: 'Use this replacement', 'aria-label': 'Use replacement ' + (i + 1),
          onchange: function (e) { if (e.target.checked) delete r.off; else r.off = true; save(); render(); } }),
        h('input', { type: 'text', value: r.find || '', placeholder: 'Find, e.g. Eth', 'aria-label': 'Replacement ' + (i + 1) + ' find',
          class: bad.includes(r.find) ? 'bad' : null, onchange: upd('find') }),
        h('span', { text: '→' }),
        h('input', { type: 'text', value: r.replace || '', placeholder: '(nothing)', 'aria-label': 'Replacement ' + (i + 1) + ' replace with',
          onchange: upd('replace') }),
        h('button', { type: 'button', class: 'link', 'aria-label': 'Remove replacement ' + (i + 1),
          onclick: function () { L.replace.splice(i, 1); save(); render(); } }, 'Remove'));
      return row;
    };
    return h('div', { class: 'only' },
      h('p', { class: 'hint', text: 'Replace text in every label line, in order: plain text in any case (Eth → nothing turns Eth1/1/1 into 1/1/1), or /pattern/ for a regular expression with $1 for its groups. Untick one to switch it off without losing it; drag ⠿ to change the order. Port labels and cable labels share this list. ' + (extra || '') }),
      h('div', { class: 'rules' },
        L.replace.map(replaceRow),
        bad.length ? h('p', { class: 'hint warnhint', text: 'Not a valid regular expression, so skipped: ' + bad.join(', ') }) : null,
        h('button', { type: 'button', onclick: function () { L.replace.push({ find: '', replace: '' }); save(); render(); } }, '+ Add replacement')));
  }

  // Overrides: change what the labels of a range of ports say (Line 2 = "Spare" on Gi1/0/40-48, no label for
  // Gi1/0/1-4 ...) without editing the ports. Kept with the label settings.
  let labelPick = { sel: {}, last: -1, field: 'desc', value: '' };   // rows ticked in the label preview
  const pickKey = function (dev, p) { return (dev.hostname || '') + '\u0001' + p.key; };
  function overrideEditor(devs) {
    const L = state.label;
    const hosts = state.devices.map(function (d) { return d.hostname; }).filter(Boolean)
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    const ovRow = function (o, i) {
      const upd = function (k) { return function (v) { o[k] = v; save(); render(); }; };
      const n = String(o.ports || '').trim() ? devs.reduce(function (sum, d) {
        if (o.host && o.host.toLowerCase() !== String(d.hostname || '').toLowerCase()) return sum;
        return sum + NP.eports(d).filter(NP.portSpec(o.ports)).length;
      }, 0) : 0;
      return h('div', { class: 'rule' },
        hosts.length > 1 || o.host ? sel(o.host || '', [['', 'Any device']].concat(hosts.map(function (x) { return [x, x]; })),
          upd('host'), 'Override ' + (i + 1) + ' device') : null,
        h('input', { type: 'text', value: o.ports || '', placeholder: 'Ports, e.g. Gi1/0/1-24, 48', 'aria-label': 'Override ' + (i + 1) + ' ports',
          onchange: function (e) { upd('ports')(e.target.value); } }),
        sel(o.field, NP.labelOverrideFields, upd('field'), 'Override ' + (i + 1) + ' field'),
        o.field !== 'skip' ? h('span', { text: '=' }) : null,
        o.field !== 'skip' ? h('input', { type: 'text', value: o.value || '', placeholder: '(empty)', 'aria-label': 'Override ' + (i + 1) + ' value',
          onchange: function (e) { upd('value')(e.target.value); } }) : null,
        h('span', { class: 'count', text: n + ' port' + (n === 1 ? '' : 's') }),
        h('button', { type: 'button', class: 'link', 'aria-label': 'Remove override ' + (i + 1),
          onclick: function () { L.overrides.splice(i, 1); save(); render(); } }, 'Remove'));
    };
    return h('div', { class: 'only' },
      h('p', { class: 'hint', text: 'Overrides change what the labels say for some ports, without editing the ports: set a field such as {desc} (the lines then use it in its place), a whole line, or leave the ports out. Ports: Gi1/0/1-24, 1/0/1-24, 1-24 (port numbers), or * for all; a value can use fields too, e.g. {desc} (spare). Later overrides win. Tick rows in the preview below (shift-click for a range) to add one quickly.' }),
      h('div', { class: 'rules' },
        L.overrides.map(ovRow),
        h('button', { type: 'button', onclick: function () {
          L.overrides.push({ host: '', ports: '', field: 'desc', value: '' }); save(); render();
        } }, '+ Add override')));
  }

  const VLANISH = { untagged: true, tagged: true, voiceVlan: true };
  let labelCaret = { line: 0, pos: null };   // the label line the field buttons write into
  // "N selected: set [field] to [value]" under the label preview; adds one override per device.
  function pickBar(rows) {
    const shown = {};
    rows.ports.forEach(function (x) { shown[pickKey(x[0], x[1])] = true; });
    Object.keys(labelPick.sel).forEach(function (k) { if (!shown[k]) delete labelPick.sel[k]; });   // keep only rows still listed
    const picked = Object.keys(labelPick.sel).map(function (k) { return labelPick.sel[k]; });
    if (!picked.length) return h('p', { class: 'hint', text: 'Tick labels below (shift-click for a range) to change what they say in one go.' });
    const apply = function () {
      const byDev = [];
      picked.forEach(function (x) {
        let g = byDev.find(function (b) { return b.dev === x[0]; });
        if (!g) byDev.push(g = { dev: x[0], ports: [] });
        g.ports.push(x[1]);
      });
      byDev.forEach(function (g) {
        state.label.overrides.push({ host: g.dev.hostname || '', ports: NP.portSpecText(g.ports), field: labelPick.field,
          value: labelPick.field === 'skip' ? '' : labelPick.value });
      });
      labelPick.sel = {}; labelPick.last = -1;
      save(); render();
      msg('Added ' + byDev.length + ' override(s) for ' + picked.length + ' port(s). They are listed under Overrides, where you can change or remove them.', 'ok');
    };
    return h('div', { class: 'toolbar pickbar' },
      h('span', { class: 'count', text: picked.length + ' selected: set' }),
      sel(labelPick.field, NP.labelOverrideFields, function (v) { labelPick.field = v; render(); }, 'Field to set on the selected labels'),
      labelPick.field === 'skip' ? null : h('span', { text: 'to' }),
      labelPick.field === 'skip' ? null : h('input', { type: 'text', value: labelPick.value, placeholder: '(empty)', 'aria-label': 'Value for the selected labels',
        oninput: function (e) { labelPick.value = e.target.value; },
        onkeydown: function (e) { if (e.key === 'Enter') { labelPick.value = e.target.value; apply(); } } }),
      h('button', { class: 'primary', onclick: apply }, 'Apply to ' + picked.length),
      h('button', { class: 'link', onclick: function () { labelPick.sel = {}; labelPick.last = -1; render(); } }, 'Clear selection'));
  }
  function labels(view, dev) {
    const L = state.label;
    const tplKey = NP.labelTemplates[L.tpl] ? L.tpl : Object.keys(NP.labelTemplates)[0], tpl = NP.labelTemplates[tplKey];
    const perDevice = L.per === 'device';
    const devs = L.scope === 'all' ? state.devices : [dev];
    const lunits = L.scope === 'all' ? [] : NP.units(dev);
    if (state.unit && !lunits.some(function (u) { return u.unit === state.unit; })) state.unit = '';
    const rows = NP.labelRows(devs, Object.assign({}, L, { unit: L.scope === 'all' ? '' : state.unit, snap: L.scope === 'all' ? '' : L.snap }));
    const set = function (fn) { return function (e) { fn(e.target); save(); render(); }; };
    const check = function (label, key, disabled) {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: L[key], disabled: disabled, onchange: set(function (t) { L[key] = t.checked; }) }), label);
    };
    const remember = function (i) {
      return function (e) {
        labelCaret = { line: i, pos: e.target.selectionStart };
        view.querySelectorAll('input[data-line]').forEach(function (el) { el.classList.toggle('target', el === e.target); });
        const which = view.querySelector('.tokens .which');
        if (which) which.textContent = 'Line ' + (i + 1);
      };
    };
    const lineInput = function (i) {
      return h('label', {}, 'Line ' + (i + 1) + (i ? ' (optional)' : ''),
        h('input', { type: 'text', value: L.lines[i] || '', 'data-line': i, class: labelCaret.line === i ? 'target' : null,
          onfocus: remember(i), onkeyup: remember(i), onclick: remember(i), onselect: remember(i),
          onchange: set(function (t) { L.lines[i] = t.value; L.preset = 'custom'; }) }));
    };
    // Field buttons put their text into the line last clicked, at the cursor. mousedown is cancelled so the
    // line keeps focus (and its typed, not yet saved text) while the button is clicked.
    const insertField = function (text) {
      const i = labelCaret.line;
      const input = view.querySelector('input[data-line="' + i + '"]');
      const cur = input ? input.value : (L.lines[i] || '');
      let pos = input && document.activeElement === input ? input.selectionStart : labelCaret.pos;
      if (pos == null || pos > cur.length) pos = cur.length;
      const before = cur.slice(0, pos), after = cur.slice(pos);
      const pad = before && !/\s$/.test(before) ? ' ' : '';
      L.lines[i] = before + pad + text + after;
      if (input) input.value = L.lines[i];   // removing the focused line on re-render fires its change event
      L.preset = 'custom';
      labelCaret = { line: i, pos: (before + pad + text).length };
      save(); render();
      const again = document.querySelector('input[data-line="' + i + '"]');
      if (again) { again.focus(); again.setSelectionRange(labelCaret.pos, labelCaret.pos); }
    };
    const fieldButton = function (text, help) {
      return h('button', { type: 'button', class: 'token', title: help, text: text,
        onmousedown: function (e) { e.preventDefault(); }, onclick: function () { insertField(text); } });
    };
    const form = h('div', { class: 'labelform' },
      h('label', {}, 'Label type',
        h('select', { onchange: set(function (t) {
          L.preset = t.value;
          const pr = NP.labelPresets[t.value];
          if (pr) { L.lines = pr.lines.slice(); L.per = pr.per; }
        }) }, Object.keys(NP.labelPresets).map(function (k) {
          return h('option', { value: k, selected: L.preset === k, text: NP.labelPresets[k].label });
        }), h('option', { value: 'custom', selected: L.preset === 'custom', text: 'Custom' }))),
      h('label', {}, 'Devices',
        h('select', { onchange: set(function (t) { L.scope = t.value; }) },
          h('option', { value: 'device', selected: L.scope === 'device', text: 'This device only' }),
          h('option', { value: 'all', selected: L.scope === 'all', text: 'All loaded devices (' + state.devices.length + ')' }))),
      lunits.length ? h('label', {}, 'Stack unit', sel(state.unit, [['', 'All units (' + lunits.length + ')']].concat(lunits.map(function (u) {
        return [u.unit, 'Unit ' + u.unit + ' (' + u.ports + ' ports)']; })), function (v) { state.unit = v; render(); })) : null,
      lineInput(0), lineInput(1), lineInput(2),
      h('label', {}, 'Only ports matching (comma = or)',
        h('input', { type: 'text', value: L.match, placeholder: 'e.g. AP, 1/0/1, trunk', disabled: perDevice,
          onchange: set(function (t) { L.match = t.value; }) })),
      h('label', {}, 'Max characters per line (0 = no limit)',
        h('input', { type: 'text', inputmode: 'numeric', value: String(L.maxLen || 0),
          onchange: set(function (t) { L.maxLen = Math.max(0, parseInt(t.value, 10) || 0); }) })),
      h('label', {}, 'File format',
        sel(L.delim, [[',', 'CSV, comma'], [';', 'CSV, semicolon'], ['\t', 'Tab-separated .txt']], function (v) { L.delim = v; save(); render(); })));
    // "Print only": narrow the labels to the ports that stand out, and/or to custom conditions on any column.
    if (!Array.isArray(L.rules)) L.rules = [];
    const snaps = L.scope === 'all' ? [] : dev.snapshots || [];
    const onlyOpts = [['', 'Every port that matches the options'], ['odd', 'Ports set up differently from most (mode / VLANs)'],
      ['edited', 'Ports I edited (Edit or Normalize)']].concat(L.scope === 'all'
      ? [['snap:', 'Labels changed since each device\'s latest snapshot']]
      : snaps.length ? snaps.map(function (sn, i) { return ['snap:' + i, 'Labels changed since snapshot "' + sn.label + '"']; }).reverse()
        : [['snap:', 'Labels changed since a snapshot (none saved yet)']]);
    const onlyVal = L.only !== 'snap' ? L.only || ''
      : 'snap:' + (L.scope === 'all' || !snaps.length ? '' : L.snap === '' || L.snap == null || !snaps[+L.snap] ? snaps.length - 1 : L.snap);
    let onlyNote = '';
    if (!perDevice && L.only === 'odd') {
      const base = NP.labelFilter(Object.assign({}, L, { unit: L.scope === 'all' ? '' : state.unit }));
      onlyNote = devs.map(function (d) {
        const u = NP.labelUsual(NP.eports(d).filter(base));
        return u ? (devs.length > 1 ? (d.hostname || 'device') + ': ' : '') + 'Most ports are ' + u.text + ' (' + u.count + ' of ' + u.of +
          (u.tied ? ', tied with ' + u.tied + ' other setup(s), so this one was picked by name' : '') + ')' : '';
      }).filter(Boolean).join('; ') + '. Labels are made for the others.';
    } else if (!perDevice && L.only === 'snap') {
      const none = devs.filter(function (d) { return !(d.snapshots || []).length; }).length;
      if (none) onlyNote = (devs.length > 1 ? none + ' device(s) have' : 'This device has') + ' no snapshot, so give no labels. Save one on the Compare tab.';
      else onlyNote = 'Only ports whose label text differs from the snapshot, or that are new since, get a label.';
    }
    const fieldOpts = NP.columns.map(function (c) { return [c.id, c.label]; });
    const ruleRow = function (r, i) {
      const upd = function (k) { return function (v) { r[k] = v; save(); render(); }; };
      const needsValue = r.op !== 'empty' && r.op !== 'set';
      return h('div', { class: 'rule' },
        sel(r.field, fieldOpts, upd('field'), 'Condition ' + (i + 1) + ' column'),
        sel(r.op, NP.labelRuleOps, upd('op'), 'Condition ' + (i + 1) + ' test'),
        needsValue ? h('input', { type: 'text', value: r.value || '', 'aria-label': 'Condition ' + (i + 1) + ' value',
          placeholder: VLANISH[r.field] ? 'e.g. 30 or 10,20-25' : 'text (comma = any of)',
          onchange: function (e) { r.value = e.target.value; save(); render(); } }) : null,
        h('button', { type: 'button', class: 'link', 'aria-label': 'Remove condition ' + (i + 1),
          onclick: function () { L.rules.splice(i, 1); save(); render(); } }, 'Remove'));
    };
    const onlyBox = h('div', { class: 'only' },
      h('label', {}, 'Print only',
        sel(onlyVal, onlyOpts, function (v) {
          if (v.slice(0, 5) === 'snap:') { L.only = 'snap'; L.snap = v.slice(5); } else { L.only = v; L.snap = ''; }
          save(); render();
        }, 'Print only')),
      onlyNote ? h('p', { class: 'hint', text: onlyNote }) : null,
      h('div', { class: 'rules' },
        L.rules.length ? h('p', { class: 'hint', text: 'And only ports where all of these are true:' }) : null,
        L.rules.map(ruleRow),
        h('button', { type: 'button', disabled: perDevice, onclick: function () {
          L.rules.push({ field: 'untagged', op: 'not', value: '' }); save(); render();
        } }, '+ Add condition')));
    const replaceBox = replaceEditor('The {portid} field also gives the port without its type.');
    if (!Array.isArray(L.overrides)) L.overrides = [];
    const overrideBox = perDevice ? null : overrideEditor(devs);
    const head = rows[0];
    const lineCount = (L.lines || []).filter(function (l) { return l && l.trim(); }).length;
    view.appendChild(h('section', { class: 'card' },
      form,
      h('div', { class: 'opts' },
        check('Physical ports only', 'physicalOnly', perDevice), check('Link up only', 'upOnly', perDevice),
        check('Only ports with a description or neighbor', 'describedOnly', perDevice), check('Skip disabled ports', 'skipDisabled', perDevice),
        check('Remove duplicate labels', 'dedupe'), check('Add reference columns (device, port, description, VLAN)', 'refCols')),
      perDevice ? null : onlyBox,
      replaceBox,
      overrideBox,
      h('div', { class: 'tokens' },
        h('p', {}, 'Click a field to add it to ', h('b', { class: 'which', text: 'Line ' + (labelCaret.line + 1) }),
          ' at the cursor (click in a line first to choose it). Hover a field for what it holds.'),
        h('div', { class: 'tokenrow' }, h('span', { class: 'tokenhead', text: 'Port' }),
          Object.keys(NP.labelTokens).filter(function (t) { return !NP.labelDeviceTokens[t]; })
            .map(function (t) { return fieldButton('{' + t + '}', NP.labelTokenHelp[t]); })),
        h('div', { class: 'tokenrow' }, h('span', { class: 'tokenhead', text: 'Device' }),
          Object.keys(NP.labelDeviceTokens).map(function (t) { return fieldButton('{' + t + '}', NP.labelTokenHelp[t]); })),
        h('div', { class: 'tokenrow' }, h('span', { class: 'tokenhead', text: 'Combos' }),
          NP.labelSnippets.map(function (sn) { return fieldButton(sn.text, sn.help); })),
        h('p', {}, h('code', { text: '{a|b}' }), ' uses the first field that has a value. ',
          h('code', { text: '[text {a}]' }), ' is left out when the field inside is empty.')),
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: (rows.length - 1) + ' label(s), ' + head.length + ' column(s) in the file' }), h('span', { class: 'spacer' }),
        h('button', { disabled: rows.length < 2, onclick: function (e) {
          copyText(NP.csv(rows, '\t'), e.target, 'Copy');
        } }, 'Copy'),
        sel(tplKey, Object.keys(NP.labelTemplates).map(function (k) { return [k, NP.labelTemplates[k].label]; }),
          function (v) { L.tpl = v; save(); render(); }, 'P-touch template'),
        h('button', { title: 'A ready-made P-touch Editor layout: ' + tpl.label, onclick: function () {
          download(tpl.file, NP.b64Bytes(tpl.b64), 'application/octet-stream');
        } }, 'P-touch template (.lbx)'),
        h('button', { title: 'The same template inside a .zip, which is how Brother\'s phone app (Pro Label Tool) imports P-touch Editor layouts', onclick: function () {
          download(tpl.file.replace(/\.lbx$/, '.zip'), NP.zipStore(tpl.file, NP.b64Bytes(tpl.b64)), 'application/zip');
        } }, 'Zipped (.zip, phone app)'),
        h('button', { class: 'primary', disabled: rows.length < 2, onclick: function () {
          const name = (L.scope === 'all' ? 'all-devices' : fileSafe(dev.hostname)) + '-labels.' + (L.delim === '\t' ? 'txt' : 'csv');
          download(name, NP.csv(rows, L.delim), L.delim === '\t' ? 'text/plain' : 'text/csv');
        } }, 'Export label file')),
      perDevice || rows.length < 2 ? null : pickBar(rows),
      rows.length > 1
        ? h('div', { class: 'tablewrap' }, h('table', { class: 'labelprev' },
            h('thead', {}, h('tr', {}, perDevice ? null : h('th', { class: 'nosort pick', scope: 'col' },
              h('input', { type: 'checkbox', 'aria-label': 'Select all labels', checked: rows.ports.every(function (x) { return labelPick.sel[pickKey(x[0], x[1])]; }),
                onchange: function (e) {
                  rows.ports.forEach(function (x) { if (e.target.checked) labelPick.sel[pickKey(x[0], x[1])] = x; else delete labelPick.sel[pickKey(x[0], x[1])]; });
                  labelPick.last = -1; render();
                } })),
              head.map(function (c) { return h('th', { class: 'nosort', scope: 'col', text: c }); }))),
            h('tbody', {}, rows.slice(1).map(function (r, ri) {
              const x = rows.ports[ri], k = pickKey(x[0], x[1]);
              return h('tr', { class: [x[2] ? 'overridden' : '', labelPick.sel[k] ? 'picked' : ''].join(' ').trim() || null,
                title: x[2] ? 'Changed by an override' : null },
                perDevice ? null : h('td', { class: 'pick' }, h('input', { type: 'checkbox', checked: !!labelPick.sel[k],
                  'aria-label': 'Select label for ' + x[1].short, onclick: function (e) {
                    const on = e.target.checked;
                    const from = e.shiftKey && labelPick.last >= 0 ? Math.min(labelPick.last, ri) : ri;
                    const to = e.shiftKey && labelPick.last >= 0 ? Math.max(labelPick.last, ri) : ri;
                    for (let j = from; j <= to; j++) {
                      const y = rows.ports[j];
                      if (on) labelPick.sel[pickKey(y[0], y[1])] = y; else delete labelPick.sel[pickKey(y[0], y[1])];
                    }
                    labelPick.last = ri; render();
                  } })),
                r.map(function (c, i) { return h('td', { class: i < lineCount ? 'line' : '', text: c }); }));
            }))))
        : h('p', { class: 'empty', text: 'No ports match these options.' }),
      h('p', { class: 'hint', text: 'In P-touch Editor: File > Database > Connect, choose this file, tick "Header row contains field names", then drag the Line fields onto the label and print all records. Or start from a P-touch template (pick one next to Export; each uses Line1 and Line2): open it, connect this file the same way and link its Line1 and Line2 text to the matching fields. Brother\'s phone app (Pro Label Tool) takes the zipped template instead.' })));
  }

  // -------------------------------------------------------------------- wire
  function init() {
    $('inputHelp').replaceChildren(helpPanel('input'));
    NP.brands().forEach(function (b) { $('selBrand').appendChild(h('option', { value: b, text: b })); });
    $('selBrand').addEventListener('change', function (e) {
      const sel = $('selVendor'), brand = e.target.value;
      sel.replaceChildren();
      const list = NP.platforms.filter(function (p) { return p.brand === brand; });
      // more than one platform: nothing is chosen until the user chooses (pasted output is still auto-detected)
      if (brand === 'auto') sel.appendChild(h('option', { value: 'auto', text: 'Auto-detect' }));
      else if (list.length > 1) sel.appendChild(h('option', { value: 'auto', text: 'Choose a platform…' }));
      list.forEach(function (p) {
        sel.appendChild(h('option', { value: p.id, text: p.name + (NP.verified[p.parser || p.id] ? '' : ' (experimental)') }));
      });
      sel.disabled = sel.options.length < 2;
      $('lblVendor').hidden = brand === 'auto';
      sel.dispatchEvent(new Event('change'));
    });
    Object.keys(NP.samples).forEach(function (id) {
      $('selSample').appendChild(h('option', { value: id, text: NP.samples[id].label }));
    });
    $('selVendor').addEventListener('change', function (e) {
      $('cmdBox').open = e.target.value !== 'auto';
      renderCommands();
    });
    $('selTarget').addEventListener('change', renderCommands);
    $('btnSanitize').addEventListener('click', function () {
      const el = $('sanMsg'), ta = $('txtInput');
      if (!ta.value.trim()) { el.textContent = 'Paste the output into the box above first.'; el.className = 'msg err'; return; }
      const r = NP.sanitize(ta.value, { vendor: pickedParser(), names: $('sanNames').checked, descriptions: $('sanDesc').checked,
        vlanNames: $('sanVlan').checked, addresses: $('sanAddr').checked });
      ta.value = r.text;
      const c = r.counts;
      const parts = [[c.secrets, 'secret(s) removed'], [c.names, 'name(s)'], [c.descriptions, 'description(s)'], [c.vlanNames, 'VLAN name(s)'],
        [c.ips, 'IP network(s)'], [c.macs, 'MAC(s)'], [c.serials, 'serial(s)']].filter(function (p) { return p[0]; })
        .map(function (p) { return p[0] + ' ' + p[1]; });
      let text = 'Done: ' + (parts.join(', ') || 'nothing needed replacing') + '. ';
      let cls = 'msg ok';
      if (!r.checked) { text += 'The platform was not recognised, so only secrets and addresses were handled; names and descriptions are untouched. Pick the platform and try again. '; cls = 'msg err'; }
      else if (r.same) text += 'Checked: it still parses to the same ' + r.ports + ' ports and ' + r.vlans + ' VLANs. ';
      else { text += 'Warning: the sanitized text parses differently from the original, so it may not reproduce your problem. '; cls = 'msg err'; }
      if (r.leftovers.length) { text += 'Still present somewhere in the text: ' + r.leftovers.join(', ') + '. '; cls = 'msg err'; }
      text += 'Read it through before sharing: free text the parser does not understand (ACL and policy names, comments) is not replaced.';
      el.textContent = text; el.className = cls;
      $('btnSanCopy').hidden = false; $('btnSanSave').hidden = false;
    });
    $('btnSanCopy').addEventListener('click', function (e) { copyText($('txtInput').value, e.target, 'Copy'); });
    $('btnSanSave').addEventListener('click', function () { download('sanitized-output.txt', $('txtInput').value, 'text/plain'); });
    $('ver').textContent = 'v' + NP.version + ' · ' + NP.build;
    let lastReport = '';
    $('btnReport').addEventListener('click', function () {
      const el = $('repMsg'), ta = $('txtInput');
      if (!ta.value.trim()) { el.textContent = 'Paste the original device output into the box above first.'; el.className = 'msg err'; return; }
      const r = NP.problemReport(ta.value, { vendor: pickedParser(), names: $('sanNames').checked, descriptions: $('sanDesc').checked,
        vlanNames: $('sanVlan').checked, addresses: $('sanAddr').checked, note: $('repNote').value, agent: navigator.userAgent });
      lastReport = r.text;
      download('confighelper-report.txt', r.text, 'text/plain');
      let text = 'Report downloaded (confighelper-report.txt). ';
      let cls = 'msg ok';
      if (!r.vendor) { text += 'The platform was not recognised, so names and descriptions were NOT replaced: choose the platform and build it again. '; cls = 'msg err'; }
      else if (!r.same) text += 'Note: the sanitized text parses differently from the original; say so when you send it. ';
      if (r.leftovers.length) { text += 'Still present in the text: ' + r.leftovers.join(', ') + '. '; cls = 'msg err'; }
      text += 'Read it through before sending. The box above still holds your original text.';
      el.textContent = text; el.className = cls;
      $('btnRepCopy').hidden = false;
    });
    $('btnRepCopy').addEventListener('click', function (e) { copyText(lastReport, e.target, 'Copy report'); });
    $('btnCables').addEventListener('click', function () { state.view = 'cables'; render(); });
    $('devSearch').addEventListener('input', function (e) { state.devFilter = e.target.value; renderDeviceList(); });
    $('devSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const first = shownDevices()[0];
        if (first) { pickDevice(first); $('devSearch').focus(); }
      } else if (e.key === 'ArrowDown') {
        const b = document.querySelector('#deviceList .pick');
        if (b) { b.focus(); e.preventDefault(); }
      }
    });
    $('btnParse').addEventListener('click', function () { parseText($('txtInput').value, 'pasted text'); });
    $('btnFiles').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) { readFiles(e.target.files); e.target.value = ''; });
    $('selSample').addEventListener('change', function (e) {
      if (!e.target.value) return;
      $('txtInput').value = NP.samples[e.target.value].text;
      e.target.value = '';
      msg('Sample loaded. Press Parse.', '');
    });
    const ta = $('txtInput');
    ta.addEventListener('dragover', function (e) { e.preventDefault(); ta.classList.add('drag'); });
    ta.addEventListener('dragleave', function () { ta.classList.remove('drag'); });
    ta.addEventListener('drop', function (e) {
      ta.classList.remove('drag');
      if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); readFiles(e.dataTransfer.files); }
    });
    $('btnBackup').addEventListener('click', function () {
      if (!state.devices.length) { msg('Nothing to back up yet.', 'err'); return; }
      download('confighelper-backup-' + new Date().toISOString().slice(0, 10) + '.json', NP.backup(state.devices), 'application/json');
      save();                                             // refresh the fingerprint, then record it as backed up
      state.backupSig = state.sig; state.lastBackup = new Date().toISOString();
      save(); render();
    });
    $('btnImport').addEventListener('click', function () { $('fileBackup').click(); });
    $('fileBackup').addEventListener('change', function (e) {
      const f = e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        try {
          const devs = NP.restore(String(fr.result));
          devs.forEach(function (d) {
            const i = state.devices.findIndex(function (x) { return x.id === d.id; });
            if (i >= 0) state.devices[i] = d; else state.devices.push(d);
          });
          if (devs.length) state.current = devs[0].id;
          msg('Imported ' + devs.length + ' device(s).', 'ok');
        } catch (err) { msg(err.message, 'err'); }
        save(); render();
      };
      fr.readAsText(f);
      e.target.value = '';
    });
    $('btnClear').addEventListener('click', function () {
      if (!state.devices.length) return;
      state.undo = { text: 'Removed all ' + state.devices.length + ' device(s).', devices: state.devices.slice(), current: state.current };
      state.devices = []; state.current = null; save(); render();
    });
    load();
    if (!cur() && state.devices.length) state.current = state.devices[0].id;
    render();
  }
  init();
})();
