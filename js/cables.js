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
  // the management address the neighbor advertised (CDP/LLDP detail), kept in neighborInfo with the platform
  NP.neighborIp = function (p) {
    const m = String((p && p.neighborInfo) || '').match(/(?:^|[\s,])(\d{1,3}(?:\.\d{1,3}){3})(?=$|[\s,])/);
    return m ? m[1] : '';
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
          a: { host: A.hostname, dev: A.id, port: p.short, key: p.key, desc: p.description, ip: '' },
          b: { host: p.neighbor, dev: '', port: p.neighborPort, key: '', desc: '', info: p.neighborInfo || '', ip: NP.neighborIp(p) },
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
            if (NP.hostKey(q.neighbor) === NP.hostKey(A.hostname)) link.a.ip = NP.neighborIp(q);
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
    return [['ID', 'Device A', 'IP A', 'Port A', 'Description A', 'Device B', 'IP B', 'Port B', 'Description B', 'Speed', 'Status', 'Note']]
      .concat(cables.map(function (c) {
        return [c.id, c.a.host, c.a.ip, c.a.port, c.a.desc, c.b.host, c.b.ip, c.b.port, c.b.desc, c.speed, c.status, c.note];
      }));
  };

  NP.cableTokens = {
    id: function (c) { return c.id; },
    a: function (c) { return c.a.host; }, aip: function (c) { return c.a.ip; }, aport: function (c) { return c.a.port; }, adesc: function (c) { return c.a.desc; },
    b: function (c) { return c.b.host; }, bip: function (c) { return c.b.ip; }, bport: function (c) { return c.b.port; }, bdesc: function (c) { return c.b.desc; },
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
  // The Labels tab's overrides (see NP.labelOverrider), applied to the cable ends on loaded devices:
  // {desc} and {port} on a port change that end's description and port, {neighbor} and {nport} change the far
  // end's device and port (the far end's own overrides win), and "no label" drops the labels that start at that
  // port. Whole-line overrides and fields cable labels do not have are left to the port labels.
  // -> fn(cable) -> {cable (a copy with the overrides in), skip: {a, b}, changed} or null when none apply
  NP.cableOverrider = function (list, devices) {
    const override = NP.labelOverrider(list);
    const devs = {}, ports = {};
    (devices || []).forEach(function (d) { devs[d.id] = d; });
    const portOf = function (end) {
      const d = devs[end.dev];
      if (!d || !end.key) return null;
      if (!ports[d.id]) { ports[d.id] = {}; NP.eports(d).forEach(function (p) { ports[d.id][p.key] = p; }); }
      return ports[d.id][end.key] ? [d, ports[d.id][end.key]] : null;
    };
    const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o.fields, k); };
    return function (c) {
      const pa = portOf(c.a), pb = portOf(c.b);
      const oa = pa && override(pa[0], pa[1]), ob = pb && override(pb[0], pb[1]);
      if (!oa && !ob) return null;
      const a = Object.assign({}, c.a), b = Object.assign({}, c.b);
      // what each end says about the other first, then each end's own fields over it
      [[oa, b], [ob, a]].forEach(function (x) {
        if (!x[0]) return;
        if (has(x[0], 'neighbor')) x[1].host = x[0].fields.neighbor;
        if (has(x[0], 'nport')) x[1].port = x[0].fields.nport;
      });
      [[oa, a], [ob, b]].forEach(function (x) {
        if (!x[0]) return;
        if (has(x[0], 'desc')) x[1].desc = x[0].fields.desc;
        if (has(x[0], 'port')) x[1].port = x[0].fields.port;
      });
      const changed = ['host', 'port', 'desc'].some(function (k) { return a[k] !== c.a[k] || b[k] !== c.b[k]; });
      return { cable: Object.assign({}, c, { a: a, b: b }), skip: { a: !!(oa && oa.skip), b: !!(ob && ob.skip) }, changed: changed };
    };
  };

  // opts: lines:[..], bothEnds (a second label per cable with the ends swapped, so each end reads "here -> there"),
  //       maxLen, loadedOnly, replace ([{find, replace}], see NP.labelReplacer; before the character limit),
  //       overrides + devices (the Labels tab's overrides and the loaded devices, see NP.cableOverrider)
  NP.cableLabelRows = function (cables, opts) {
    const lines = (opts.lines || []).map(function (l, i) { return { tpl: l, name: 'Line' + (i + 1) }; })
      .filter(function (l) { return l.tpl && l.tpl.trim(); });
    const max = +opts.maxLen || 0;
    const edit = NP.labelReplacer(opts.replace);
    const over = NP.cableOverrider(opts.overrides, opts.devices);
    const rows = [lines.map(function (l) { return l.name; })];
    Object.defineProperty(rows, 'overridden', { value: [] });   // per label row: changed by an override
    const add = function (c, changed) {
      const r = lines.map(function (l) { const t = edit(fill(l.tpl, c)); return max > 0 && t.length > max ? t.slice(0, max).trim() : t; });
      if (r.some(Boolean)) { rows.push(r); rows.overridden.push(changed); }
    };
    cables.forEach(function (c) {
      if (opts.loadedOnly && !c.b.dev) return;
      const o = over(c), x = o ? o.cable : c, changed = !!(o && o.changed);
      if (!(o && o.skip.a)) add(x, changed);
      if (opts.bothEnds && !(o && o.skip.b)) add({ id: x.id, a: x.b, b: x.a, speed: x.speed }, changed);
    });
    return rows;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
