/* Cable list across all loaded devices, built from CDP/LLDP neighbor data.
 * A link seen from both ends is listed once. */
(function (root) {
  'use strict';
  const NP = root.NP;

  // "CORE-01.corp.example.com" / "LAB-AP01 (Office)" -> "core-01" / "lab-ap01"
  NP.hostKey = function (name) {
    let s = String(name || '').trim().toLowerCase().replace(/\s*\(.*\)$/, '');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) s = s.split('.')[0];
    return s;
  };
  function findFar(dev, text) {
    if (!text) return null;
    let p = NP.findPort(dev, text);
    if (!p) {                                   // e.g. a description "10GigabitEthernet1/3/4" for port 1/3/4
      const m = String(text).match(/(\d+(?:\/\d+)+)$/);
      if (m) p = NP.findPort(dev, m[1]);
    }
    return p || null;
  }

  NP.cables = function (devices) {
    const byHost = {};
    devices.forEach(function (d) { if (d.hostname) byHost[NP.hostKey(d.hostname)] = d; });
    const ports = {};                           // device id -> effective ports (manual edits applied, excluded dropped)
    devices.forEach(function (d) { ports[d.id] = NP.eports(d); });
    const eport = function (d, p) { return p && ports[d.id].find(function (x) { return x.key === p.key; }); };
    const seen = {};
    const out = [];

    devices.forEach(function (A) {
      ports[A.id].forEach(function (p) {
        if (!p.neighbor || p.kind === 'lag') return;
        const B = byHost[NP.hostKey(p.neighbor)];
        const link = {
          a: { host: A.hostname, dev: A.id, port: p.short, key: p.key, desc: p.description },
          b: { host: p.neighbor, dev: '', port: p.neighborPort, key: '', desc: '', info: p.neighborInfo || '' },
          speed: p.speed || '', status: 'far end not loaded', note: ''
        };
        if (B && B !== A) {
          link.b.host = B.hostname; link.b.dev = B.id;
          const q = eport(B, findFar(B, p.neighborPort));
          if (q) {
            const pair = [A.id + '|' + p.key, B.id + '|' + q.key].sort().join(' <> ');
            if (seen[pair]) return;             // already listed from the other end
            link.b.port = q.short; link.b.key = q.key; link.b.desc = q.description;
            link.speed = link.speed || q.speed || '';
            if (!q.neighbor) { link.status = 'one end only'; link.note = B.hostname + ' has no neighbor data for ' + q.short; }
            else {
              const back = NP.hostKey(q.neighbor) === NP.hostKey(A.hostname) ? eport(A, findFar(A, q.neighborPort)) : null;
              if (back && back.key === p.key) link.status = 'both ends';
              else { link.status = 'mismatch'; link.note = B.hostname + ' ' + q.short + ' reports ' + q.neighbor + ' ' + q.neighborPort; }
            }
            if (link.status !== 'mismatch') seen[pair] = true;
          } else {
            link.status = 'one end only';
            link.note = 'port "' + p.neighborPort + '" not found on ' + B.hostname;
          }
        }
        out.push(link);
      });
    });
    out.forEach(function (l, i) { l.id = 'C' + String(i + 1).padStart(3, '0'); });
    return out;
  };

  NP.cableRows = function (cables) {
    return [['ID', 'Device A', 'Port A', 'Description A', 'Device B', 'Port B', 'Description B', 'Speed', 'Status', 'Note']]
      .concat(cables.map(function (c) {
        return [c.id, c.a.host, c.a.port, c.a.desc, c.b.host, c.b.port, c.b.desc, c.speed, c.status, c.note];
      }));
  };

  NP.cableTokens = {
    id: function (c) { return c.id; },
    a: function (c) { return c.a.host; }, aport: function (c) { return c.a.port; }, adesc: function (c) { return c.a.desc; },
    b: function (c) { return c.b.host; }, bport: function (c) { return c.b.port; }, bdesc: function (c) { return c.b.desc; },
    speed: function (c) { return c.speed; }
  };
  function fill(tpl, c) {
    const one = function (s) {
      let empty = false;
      const t = s.replace(/\{([^}]+)\}/g, function (all, names) {
        let v = '';
        names.split('|').some(function (n) { const f = NP.cableTokens[n.trim().toLowerCase()]; v = f ? String(f(c) || '') : ''; return v; });
        if (!v) empty = true;
        return v;
      });
      return { text: t, empty: empty };
    };
    const opt = String(tpl || '').replace(/\[([^\]]*)\]/g, function (all, inner) { const r = one(inner); return r.empty ? '' : r.text; });
    return one(opt).text.replace(/\s+/g, ' ').trim();
  }
  // opts: lines:[..], bothEnds (a second label per cable with the ends swapped, so each end reads "here -> there"),
  //       maxLen, loadedOnly, replace ([{find, replace}], see NP.labelReplacer; before the character limit)
  NP.cableLabelRows = function (cables, opts) {
    const lines = (opts.lines || []).map(function (l, i) { return { tpl: l, name: 'Line' + (i + 1) }; })
      .filter(function (l) { return l.tpl && l.tpl.trim(); });
    const max = +opts.maxLen || 0;
    const edit = NP.labelReplacer(opts.replace);
    const rows = [lines.map(function (l) { return l.name; })];
    const add = function (c) {
      const r = lines.map(function (l) { const t = edit(fill(l.tpl, c)); return max > 0 && t.length > max ? t.slice(0, max).trim() : t; });
      if (r.some(Boolean)) rows.push(r);
    };
    cables.forEach(function (c) {
      if (opts.loadedOnly && !c.b.dev) return;
      add(c);
      if (opts.bothEnds) add({ id: c.id, a: c.b, b: c.a, speed: c.speed });
    });
    return rows;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
