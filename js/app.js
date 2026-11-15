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
    editing: false, only: null,          // only: {title, keys} = Ports tab limited to the ports of one check
    exp: { fmt: 'csv', cols: 'shown', rows: 'shown', devs: 'device' },
    label: { preset: 'port', per: 'port', lines: NP.labelPresets.port.lines.slice(), scope: 'device',
      physicalOnly: true, upOnly: false, describedOnly: false, skipDisabled: true,
      match: '', maxLen: 0, refCols: false, dedupe: false, delim: ',' }
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

  // ------------------------------------------------------------- persistence
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        devices: state.devices, current: state.current, cols: state.cols, label: state.label }));
    } catch (e) { /* private window or quota: carry on without persistence */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!d) return;
      state.devices = NP.restore({ format: 'confighelper-backup', devices: d.devices || [] });
      state.current = d.current;
      if (Array.isArray(d.cols) && d.cols.length) state.cols = d.cols;
      if (d.label) Object.assign(state.label, d.label);
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

  // ------------------------------------------------------------------ ingest
  function ingest(text, name) {
    const r = NP.ingest(text, {
      vendor: $('selVendor').value, target: $('selTarget').value,
      devices: state.devices, current: cur(), name: name });
    if (r.isNew) state.devices.push(r.dev);
    (r.extra || []).forEach(function (x) { if (x.isNew) state.devices.push(x.dev); });
    state.current = r.dev.id;
    return r;
  }
  function parseText(text, name) {
    if (!text.trim()) { msg('Paste something first.', 'err'); return; }
    try {
      const r = ingest(text, name);
      msg((r.isNew ? 'Added ' : 'Merged into ') + (r.dev.hostname || 'unnamed device') + ' as ' +
        NP.vendors[r.vendor].label + ': ' + r.dev.ports.length + ' ports.' +
        (r.extra && r.extra.length ? ' Also ' + r.extra.length + ' FortiLink-managed switch(es): ' +
          r.extra.map(function (x) { return x.dev.hostname; }).join(', ') + '.' : ''), 'ok');
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
    let vendor = $('selVendor').value;
    const dev = cur();
    const fromDevice = vendor === 'auto' && dev && $('selTarget').value !== 'new';
    if (fromDevice) vendor = dev.vendor;
    const c = NP.commands[vendor];
    if (!c) {
      $('cmdSummary').textContent = 'Commands to run';
      box.appendChild(h('p', { text: 'Choose a platform above to see which commands to run on the device.' }));
      return;
    }
    $('cmdSummary').textContent = 'Commands to run on ' + NP.vendors[vendor].label;
    if (fromDevice) box.appendChild(h('p', { text: 'Based on the selected device, ' + (dev.hostname || 'unnamed') + '.' }));
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
  }

  // ---------------------------------------------------------------- sidebar
  function renderDevices() {
    const ul = $('deviceList');
    ul.replaceChildren();
    if (!state.devices.length) { ul.appendChild(h('li', { class: 'empty', text: 'No devices yet.' })); return; }
    state.devices.forEach(function (d) {
      ul.appendChild(h('li', { class: d.id === state.current ? 'sel' : '' },
        h('button', { class: 'pick', onclick: function () { state.current = d.id; state.sort = null; state.only = null; save(); render(); } },
          h('b', { text: d.hostname || '(unnamed)' }),
          h('span', { text: NP.vendorLabel(d) + ' · ' + d.ports.length + ' ports' })),
        h('button', { class: 'link', title: 'Remove this device', 'aria-label': 'Remove ' + (d.hostname || 'device'),
          onclick: function () {
            if (!confirm('Remove ' + (d.hostname || 'this device') + '?')) return;
            state.devices = state.devices.filter(function (x) { return x !== d; });
            if (state.current === d.id) state.current = state.devices.length ? state.devices[0].id : null;
            save(); render();
          } }, '✕')));
    });
  }

  // ------------------------------------------------------------------- views
  function render() {
    renderDevices();
    renderCommands();
    const view = $('view');
    view.replaceChildren();
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
      ['unparsed', 'Not parsed (' + (dev.unparsed || []).length + ')']];
    view.appendChild(h('section', { class: 'card' },
      h('div', { class: 'devhead' },
        h('h1', { text: dev.hostname || '(unnamed device)' }),
        h('span', { class: 'sub', text: [NP.vendorLabel(dev), dev.model, dev.version].filter(Boolean).join(' · ') }),
        h('button', { onclick: function () {
          const n = prompt('Device name', dev.hostname);
          if (n !== null) { dev.hostname = n.trim(); save(); render(); }
        } }, 'Rename')),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { role: 'tab', 'aria-selected': String(state.tab === t[0]),
          onclick: function () { state.tab = t[0]; render(); } }, t[1]);
      }))));
    if (state.tab === 'overview') overview(view, dev);
    else if (state.tab === 'labels') labels(view, dev);
    else if (state.tab === 'unparsed') unparsed(view, dev);
    else if (state.tab === 'checks') checks(view, dev);
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

  function unparsed(view, dev) {
    const groups = NP.unparsedGroups(dev);
    if (!groups.length) {
      view.appendChild(h('section', { class: 'card' },
        h('p', { class: 'empty', text: 'Everything in the input for this device was either used or is on the list of lines that never matter (certificates, banners, console settings and the like).' })));
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
    return function (p) {
      if (only && !only.includes(p.key)) return false;
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
      title: 'Change descriptions, neighbors and notes, or leave ports out of exports and labels',
      onclick: function () { state.editing = !state.editing; render(); } }, state.editing ? 'Done editing' : 'Edit');
    const resetBtn = state.editing && ec.total ? h('button', { class: 'danger', onclick: function () {
      if (!confirm('Discard ' + ec.total + ' manual change(s) on ' + (dev.hostname || 'this device') + ' and go back to the parsed values?')) return;
      dev.edits = {}; save(); render();
    } }, 'Reset edits (' + ec.total + ')') : null;
    const toolbar = h('div', { class: 'toolbar' }, search, check('Physical only', 'physOnly'), check('Link up only', 'hideDown'),
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
            return h('td', { class: 'editcell' + (was !== undefined ? ' edited' : '') },
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

  function labels(view, dev) {
    const L = state.label;
    const perDevice = L.per === 'device';
    const devs = L.scope === 'all' ? state.devices : [dev];
    const rows = NP.labelRows(devs, L);
    const set = function (fn) { return function (e) { fn(e.target); save(); render(); }; };
    const check = function (label, key, disabled) {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: L[key], disabled: disabled, onchange: set(function (t) { L[key] = t.checked; }) }), label);
    };
    const lineInput = function (i) {
      return h('label', {}, 'Line ' + (i + 1) + (i ? ' (optional)' : ''),
        h('input', { type: 'text', value: L.lines[i] || '',
          onchange: set(function (t) { L.lines[i] = t.value; L.preset = 'custom'; }) }));
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
      lineInput(0), lineInput(1), lineInput(2),
      h('label', {}, 'Only ports matching (comma = or)',
        h('input', { type: 'text', value: L.match, placeholder: 'e.g. AP, 1/0/1, trunk', disabled: perDevice,
          onchange: set(function (t) { L.match = t.value; }) })),
      h('label', {}, 'Max characters per line (0 = no limit)',
        h('input', { type: 'text', inputmode: 'numeric', value: String(L.maxLen || 0),
          onchange: set(function (t) { L.maxLen = Math.max(0, parseInt(t.value, 10) || 0); }) })),
      h('label', {}, 'File format',
        sel(L.delim, [[',', 'CSV, comma'], [';', 'CSV, semicolon'], ['\t', 'Tab-separated .txt']], function (v) { L.delim = v; save(); render(); })));
    const head = rows[0];
    const lineCount = (L.lines || []).filter(function (l) { return l && l.trim(); }).length;
    view.appendChild(h('section', { class: 'card' },
      form,
      h('div', { class: 'opts' },
        check('Physical ports only', 'physicalOnly', perDevice), check('Link up only', 'upOnly', perDevice),
        check('Only ports with a description or neighbor', 'describedOnly', perDevice), check('Skip disabled ports', 'skipDisabled', perDevice),
        check('Remove duplicate labels', 'dedupe'), check('Add reference columns (device, port, description, VLAN)', 'refCols')),
      h('p', { class: 'tokens' }, 'Fields: ',
        Object.keys(NP.labelTokens).map(function (t) { return [h('code', { text: '{' + t + '}' }), ' ']; }),
        h('br'), h('code', { text: '{neighbor|desc}' }), ' uses the first one that has a value. ',
        h('code', { text: '[VLAN {vlan}]' }), ' is left out when the field inside is empty.'),
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: (rows.length - 1) + ' label(s), ' + head.length + ' column(s) in the file' }), h('span', { class: 'spacer' }),
        h('button', { disabled: rows.length < 2, onclick: function (e) {
          copyText(NP.csv(rows, '\t'), e.target, 'Copy');
        } }, 'Copy'),
        h('button', { class: 'primary', disabled: rows.length < 2, onclick: function () {
          const name = (L.scope === 'all' ? 'all-devices' : fileSafe(dev.hostname)) + '-labels.' + (L.delim === '\t' ? 'txt' : 'csv');
          download(name, NP.csv(rows, L.delim), L.delim === '\t' ? 'text/plain' : 'text/csv');
        } }, 'Export label file')),
      rows.length > 1
        ? h('div', { class: 'tablewrap' }, h('table', { class: 'labelprev' },
            h('thead', {}, h('tr', {}, head.map(function (c) { return h('th', { class: 'nosort', scope: 'col', text: c }); }))),
            h('tbody', {}, rows.slice(1).map(function (r) {
              return h('tr', {}, r.map(function (c, i) { return h('td', { class: i < lineCount ? 'line' : '', text: c }); }));
            }))))
        : h('p', { class: 'empty', text: 'No ports match these options.' }),
      h('p', { class: 'hint', text: 'In P-touch Editor: File > Database > Connect, choose this file, tick "Header row contains field names", then drag the Line fields onto the label and print all records.' })));
  }

  // -------------------------------------------------------------------- wire
  function init() {
    NP.vendorOrder.forEach(function (id) {
      $('selVendor').appendChild(h('option', { value: id, text: NP.vendors[id].label }));
    });
    Object.keys(NP.samples).forEach(function (id) {
      $('selSample').appendChild(h('option', { value: id, text: NP.samples[id].label }));
    });
    $('selVendor').addEventListener('change', function (e) {
      $('cmdBox').open = e.target.value !== 'auto';
      renderCommands();
    });
    $('selTarget').addEventListener('change', renderCommands);
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
      if (!state.devices.length || !confirm('Remove all ' + state.devices.length + ' device(s) from this browser?')) return;
      state.devices = []; state.current = null; save(); render();
    });
    load();
    if (!cur() && state.devices.length) state.current = state.devices[0].id;
    render();
  }
  init();
})();
