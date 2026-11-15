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
    label: { preset: 'port', lines: NP.labelPresets.port.lines.slice(), scope: 'device',
      physicalOnly: true, upOnly: false, describedOnly: false, skipDisabled: true }
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
        h('button', { class: 'pick', onclick: function () { state.current = d.id; state.sort = null; save(); render(); } },
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
    const tabs = [['overview', 'Overview'], ['ports', 'Ports (' + dev.ports.length + ')'], ['labels', 'Labels']];
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
        h('button', { onclick: function () { window.print(); } }, 'Print')),
      h('h2', { text: 'Loaded input' }),
      h('div', { class: 'chips' }, dev.sources.map(function (s) {
        return h('span', { class: 'chip', text: s.name + ' (' + s.lines + ' lines)' });
      }))));
  }

  function pill(text) {
    if (!text) return '';
    const cls = text === 'up' || text === 'enabled' || text === 'on' || text === 'delivering' ? 'up'
      : text === 'disabled' ? 'off' : /^err|fault|deny|denied/i.test(text) ? 'warn' : 'down';
    return h('span', { class: 'pill ' + cls, text: text });
  }

  function visiblePorts(dev) {
    const q = state.search.trim().toLowerCase();
    let list = dev.ports.filter(function (p) {
      if (state.physOnly && p.kind !== 'physical') return false;
      if (state.hideDown && p.link !== 'up') return false;
      if (!q) return true;
      return NP.columns.some(function (c) { return String(c.get(p)).toLowerCase().includes(q); });
    });
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

  function ports(view, dev) {
    const cols = NP.columns.filter(function (c) { return state.cols.includes(c.id); });
    const list = visiblePorts(dev);
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
    const inView = function (p) { return list.includes(p); };
    const toolbar = h('div', { class: 'toolbar' }, search, check('Physical only', 'physOnly'), check('Link up only', 'hideDown'),
      colPicker, h('span', { class: 'count', text: list.length + ' of ' + dev.ports.length + ' shown' }), h('span', { class: 'spacer' }),
      h('button', { title: 'The rows and columns currently shown', onclick: function () {
        download(fileSafe(dev.hostname) + '-ports.csv', '﻿' + NP.csv(NP.portRows([dev], state.cols, inView)), 'text/csv');
      } }, 'Export CSV'),
      h('button', { title: 'Every column, every port', onclick: function () {
        download(fileSafe(dev.hostname) + '-ports-full.csv', '﻿' + NP.csv(NP.portRows([dev])), 'text/csv');
      } }, 'Export all columns'),
      h('button', { title: 'Tab-separated, pastes straight into a spreadsheet', onclick: function (e) {
        const tsv = NP.portRows([dev], state.cols, inView).map(function (r) {
          return r.map(function (c) { return String(c).replace(/[\t\r\n]+/g, ' '); }).join('\t');
        }).join('\n');
        const btn = e.target;
        navigator.clipboard.writeText(tsv).then(function () { btn.textContent = 'Copied'; },
          function () { btn.textContent = 'Copy failed'; });
      } }, 'Copy'),
      h('button', { onclick: function () { window.print(); } }, 'Print'));

    const thead = h('thead', {}, h('tr', {}, cols.map(function (c) {
      const s = state.sort && state.sort.id === c.id ? (state.sort.dir > 0 ? 'ascending' : 'descending') : null;
      return h('th', { 'aria-sort': s, scope: 'col', onclick: function () {
        if (!state.sort || state.sort.id !== c.id) state.sort = { id: c.id, dir: 1 };
        else if (state.sort.dir === 1) state.sort.dir = -1;
        else state.sort = null;
        render();
      } }, c.label);
    })));
    const tbody = h('tbody', {}, list.map(function (p) {
      return h('tr', {}, cols.map(function (c) {
        const v = c.get(p);
        if (c.id === 'link' || c.id === 'admin' || c.id === 'poeStatus') return h('td', {}, pill(v));
        const cls = c.id === 'description' || c.id === 'notes' || c.id === 'stp' ? 'wrap'
          : c.id === 'name' || c.id === 'short' || c.id === 'ip' || c.id === 'tagged' ? 'mono' : '';
        return h('td', { class: cls, text: v == null ? '' : String(v) });
      }));
    }));
    view.appendChild(h('section', { class: 'card' }, toolbar,
      list.length ? h('div', { class: 'tablewrap' }, h('table', {}, thead, tbody))
        : h('p', { class: 'empty', text: 'No ports match.' })));
  }

  function labels(view, dev) {
    const L = state.label;
    const devs = L.scope === 'all' ? state.devices : [dev];
    const rows = NP.labelRows(devs, L);
    const set = function (fn) { return function (e) { fn(e.target); save(); render(); }; };
    const check = function (label, key) {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: L[key], onchange: set(function (t) { L[key] = t.checked; }) }), label);
    };
    const lineInput = function (i) {
      return h('label', {}, 'Line ' + (i + 1),
        h('input', { type: 'text', value: L.lines[i] || '', 'data-line': i,
          onchange: set(function (t) { L.lines[i] = t.value; L.preset = 'custom'; }) }));
    };
    const form = h('div', { class: 'labelform' },
      h('label', {}, 'Label type',
        h('select', { onchange: set(function (t) {
          L.preset = t.value;
          if (NP.labelPresets[t.value]) L.lines = NP.labelPresets[t.value].lines.slice();
        }) }, Object.keys(NP.labelPresets).map(function (k) {
          return h('option', { value: k, selected: L.preset === k, text: NP.labelPresets[k].label });
        }), h('option', { value: 'custom', selected: L.preset === 'custom', text: 'Custom' }))),
      h('label', {}, 'Devices',
        h('select', { onchange: set(function (t) { L.scope = t.value; }) },
          h('option', { value: 'device', selected: L.scope === 'device', text: 'This device only' }),
          h('option', { value: 'all', selected: L.scope === 'all', text: 'All loaded devices (' + state.devices.length + ')' }))),
      lineInput(0), lineInput(1), lineInput(2));
    const head = rows[0];
    view.appendChild(h('section', { class: 'card' },
      form,
      h('div', { class: 'opts' }, check('Physical ports only', 'physicalOnly'), check('Link up only', 'upOnly'),
        check('Only ports with a description or neighbor', 'describedOnly'), check('Skip disabled ports', 'skipDisabled')),
      h('p', { class: 'tokens' }, 'Fields: ',
        Object.keys(NP.labelTokens).map(function (t) { return [h('code', { text: '{' + t + '}' }), ' ']; }),
        h('br'), h('code', { text: '{neighbor|desc}' }), ' uses the first one that has a value. ',
        h('code', { text: '[VLAN {vlan}]' }), ' is left out when the field inside is empty.'),
      h('div', { class: 'toolbar' },
        h('span', { class: 'count', text: (rows.length - 1) + ' label(s)' }), h('span', { class: 'spacer' }),
        h('button', { class: 'primary', disabled: rows.length < 2, onclick: function () {
          const name = (L.scope === 'all' ? 'all-devices' : fileSafe(dev.hostname)) + '-labels.csv';
          download(name, NP.csv(rows), 'text/csv');
        } }, 'Export label CSV')),
      rows.length > 1
        ? h('div', { class: 'tablewrap' }, h('table', { class: 'labelprev' },
            h('thead', {}, h('tr', {}, head.map(function (c) { return h('th', { class: 'nosort', scope: 'col', text: c }); }))),
            h('tbody', {}, rows.slice(1).map(function (r) {
              return h('tr', {}, r.map(function (c) { return h('td', { text: c }); }));
            }))))
        : h('p', { class: 'empty', text: 'No ports match these options.' }),
      h('p', { class: 'hint', text: 'In P-touch Editor: File > Database > Connect, choose this CSV, tick "Header row contains field names", then drag the Line fields onto the label and print all records.' })));
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
