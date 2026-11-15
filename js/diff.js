/* Snapshots (a frozen copy of a device's parsed state) and comparing two of them. */
(function (root) {
  'use strict';
  const NP = root.NP;
  NP.MAX_SNAPSHOTS = 10;

  // ---------------------------------------------------------------- snapshots
  NP.snapshot = function (dev, label, at) {
    const data = JSON.parse(JSON.stringify(dev));
    delete data.snapshots;
    delete data.edits;                 // snapshots hold what the device said, not manual edits
    delete data.unparsed;
    delete data.debug;
    dev.snapshots = dev.snapshots || [];
    const snap = { label: label || 'Snapshot ' + (dev.snapshots.length + 1), at: at || new Date().toISOString(), data: data };
    dev.snapshots.push(snap);
    while (dev.snapshots.length > NP.MAX_SNAPSHOTS) dev.snapshots.shift();
    return snap;
  };
  // Empty the parsed data so the next paste is a clean point in time (additive merging
  // would otherwise keep VLANs and settings that have since been removed from the device).
  NP.resetParsed = function (dev) {
    const keep = { id: dev.id, hostname: dev.hostname, vendor: dev.vendor, edits: dev.edits || {}, snapshots: dev.snapshots || [] };
    const fresh = NP.newDevice();
    Object.keys(dev).forEach(function (k) { delete dev[k]; });
    Object.assign(dev, fresh, keep);
    return dev;
  };

  // --------------------------------------------------------------------- diff
  const CONFIG_FIELDS = ['description', 'admin', 'mode', 'untagged', 'tagged', 'voiceVlan', 'lag', 'ip', 'poeAdmin', 'stp', 'notes'];
  const LIVE_FIELDS = ['link', 'speed', 'duplex', 'media', 'poeStatus', 'poeWatts', 'poeClass', 'stpState', 'neighbor', 'neighborPort', 'neighborInfo'];
  const colOf = function (id) { return NP.columns.find(function (c) { return c.id === id; }); };

  function settings(dev) {
    const out = {};
    NP.summary(dev).forEach(function (s) {
      if (s.title === 'Ports') return;                        // counts follow from the port diff
      s.rows.forEach(function (r) { out[s.title + ': ' + r[0]] = String(r[1]); });
    });
    return out;
  }

  // a = older, b = newer (device-shaped objects). opts.live: also compare link state, PoE draw, neighbors.
  NP.diff = function (a, b, opts) {
    opts = opts || {};
    const res = { settings: [], vlansAdded: [], vlansRemoved: [], vlansRenamed: [], portsAdded: [], portsRemoved: [], ports: [], fieldsSkipped: [] };

    const sa = settings(a), sb = settings(b);
    Object.keys(Object.assign({}, sa, sb)).forEach(function (k) {
      if ((sa[k] || '') !== (sb[k] || '')) res.settings.push({ item: k, before: sa[k] || '', after: sb[k] || '' });
    });

    const va = {}, vb = {};
    (a.vlans || []).forEach(function (v) { va[v.id] = v; });
    (b.vlans || []).forEach(function (v) { vb[v.id] = v; });
    (b.vlans || []).forEach(function (v) {
      if (!va[v.id]) res.vlansAdded.push(v);
      else if ((va[v.id].name || '') !== (v.name || '')) res.vlansRenamed.push({ id: v.id, before: va[v.id].name || '', after: v.name || '' });
    });
    (a.vlans || []).forEach(function (v) { if (!vb[v.id]) res.vlansRemoved.push(v); });

    let fields = CONFIG_FIELDS.slice();
    if (opts.live) {
      LIVE_FIELDS.forEach(function (f) {
        // only meaningful when both sides loaded that kind of data at all
        const hasA = (a.ports || []).some(function (p) { return colOf(f).get(p); });
        const hasB = (b.ports || []).some(function (p) { return colOf(f).get(p); });
        if (hasA && hasB) fields.push(f); else if (hasA !== hasB) res.fieldsSkipped.push(colOf(f).label);
      });
    }
    const pa = {}, pb = {};
    (a.ports || []).forEach(function (p) { pa[p.key] = p; });
    (b.ports || []).forEach(function (p) { pb[p.key] = p; });
    (b.ports || []).forEach(function (p) {
      const old = pa[p.key];
      if (!old) { res.portsAdded.push({ key: p.key, short: p.short, description: p.description }); return; }
      const changes = [];
      fields.forEach(function (f) {
        const c = colOf(f), x = String(c.get(old) || ''), y = String(c.get(p) || '');
        if (x !== y) changes.push({ field: f, label: c.label, before: x, after: y });
      });
      if (changes.length) res.ports.push({ key: p.key, short: p.short, name: p.name, changes: changes });
    });
    (a.ports || []).forEach(function (p) { if (!pb[p.key]) res.portsRemoved.push({ key: p.key, short: p.short, description: p.description }); });

    res.total = res.settings.length + res.vlansAdded.length + res.vlansRemoved.length + res.vlansRenamed.length +
      res.portsAdded.length + res.portsRemoved.length + res.ports.reduce(function (n, p) { return n + p.changes.length; }, 0);
    return res;
  };

  NP.diffMarkdown = function (d, title, fromLabel, toLabel) {
    const e = function (v) { return v === '' ? '(none)' : v; };
    const out = ['# ' + title, '', 'From: ' + fromLabel + '  ', 'To: ' + toLabel, ''];
    if (!d.total) { out.push('No differences.'); return out.join('\n') + '\n'; }
    if (d.settings.length) {
      out.push('## Device settings', '', NP.mdTable([['Item', 'Before', 'After']].concat(d.settings.map(function (s) { return [s.item, e(s.before), e(s.after)]; }))));
    }
    if (d.vlansAdded.length || d.vlansRemoved.length || d.vlansRenamed.length) {
      const rows = [['VLAN', 'Change', 'Before', 'After']];
      d.vlansAdded.forEach(function (v) { rows.push([v.id, 'added', '', v.name]); });
      d.vlansRemoved.forEach(function (v) { rows.push([v.id, 'removed', v.name, '']); });
      d.vlansRenamed.forEach(function (v) { rows.push([v.id, 'renamed', v.before, v.after]); });
      out.push('## VLANs', '', NP.mdTable(rows));
    }
    if (d.portsAdded.length || d.portsRemoved.length || d.ports.length) {
      const rows = [['Port', 'What', 'Before', 'After']];
      d.portsAdded.forEach(function (p) { rows.push([p.short, 'port added', '', p.description]); });
      d.portsRemoved.forEach(function (p) { rows.push([p.short, 'port removed', p.description, '']); });
      d.ports.forEach(function (p) { p.changes.forEach(function (c) { rows.push([p.short, c.label, e(c.before), e(c.after)]); }); });
      out.push('## Ports', '', NP.mdTable(rows));
    }
    return out.join('\n');
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
