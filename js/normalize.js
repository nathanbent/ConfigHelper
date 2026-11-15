/* Normalizer: ports that look like the same kind of thing (20 "AP" ports) but are not written or set up
 * the same way. Two kinds of finding per group:
 *   spelling  the same word written differently ("AP", "ap", "Access Point")
 *   vlans     a few ports whose mode / native / tagged VLANs differ from what most of the group has
 * Corrections are manual edits (NP.setEdit), so they change the table, exports and labels only, never the
 * parsed data. Like the checks these are prompts to review: the tool cannot know which port is the odd one out
 * on purpose. */
(function (root) {
  'use strict';
  const NP = root.NP;

  // Words that mean the same device. Longer names first; a name's words may be joined, spaced, or split by - or _.
  NP.roleAliases = [
    { id: 'ap', label: 'AP', names: ['wireless access point', 'wireless ap', 'wi-fi ap', 'wifi ap', 'access point', 'wap', 'ap'] },
    { id: 'printer', label: 'Printer', names: ['printer', 'prn'] },
    { id: 'camera', label: 'Camera', names: ['ip camera', 'camera', 'cctv', 'cam'] },
    { id: 'phone', label: 'Phone', names: ['voip phone', 'ip phone', 'telephone', 'phone'] },
    { id: 'uplink', label: 'Uplink', names: ['up-link', 'uplink'] },
    { id: 'switch', label: 'Switch', names: ['switch', 'sw'] },
    { id: 'server', label: 'Server', names: ['server', 'srv'] },
    { id: 'pc', label: 'PC', names: ['workstation', 'desktop', 'pc'] }
  ];
  const ALIAS_RE = [];
  NP.roleAliases.forEach(function (a) {
    a.names.forEach(function (n) {
      ALIAS_RE.push({ alias: a, re: new RegExp('(?:^|[^A-Za-z])(' + n.split(/[\s-]+/).join('[\\s_-]*') + ')(?![A-Za-z])', 'i') });
    });
  });

  // What kind of thing a description names: {id, label, text (as written), start, end}, or null.
  // A known alias anywhere in the text wins (the earliest, then the longest); otherwise the first word.
  NP.portRole = function (desc) {
    desc = String(desc || '');
    let best = null;
    ALIAS_RE.forEach(function (x) {
      const m = x.re.exec(desc);
      if (!m) return;
      const start = m.index + m[0].length - m[1].length;
      if (!best || start < best.start || (start === best.start && m[1].length > best.text.length)) {
        best = { id: x.alias.id, label: x.alias.label, text: m[1], start: start, end: start + m[1].length };
      }
    });
    if (best) return best;
    const w = /[A-Za-z]{2,}/.exec(desc);
    return w ? { id: 'w:' + w[0].toLowerCase(), label: '', text: w[0], start: w.index, end: w.index + w[0].length } : null;
  };

  const profileLabel = function (mode, untagged, tagged) {
    const out = [];
    if (mode) out.push(mode);
    if (untagged) out.push((mode === 'access' ? 'VLAN ' : 'native ') + untagged);
    if (tagged) out.push('tagged ' + tagged);
    return out.join(', ') || '(no VLANs)';
  };
  // how a port differs from the profile it is measured against, in words
  const profileDiff = function (p, t) {
    const out = [];
    if (p.mode !== t.mode) out.push((p.mode || 'no mode') + ', not ' + (t.mode || 'no mode'));
    if (p.untagged !== t.untagged) out.push((p.untagged ? 'native ' + p.untagged : 'no native VLAN') + ', not ' + (t.untagged || 'none'));
    if (p.tagged !== t.tagged) {
      const lists = /^[\d,\-]+$/.test(p.tagged) && /^[\d,\-]+$/.test(t.tagged);
      if (lists) {
        const a = NP.parseVlanList(p.tagged), b = NP.parseVlanList(t.tagged);
        const missing = b.filter(function (v) { return !a.includes(v); }), extra = a.filter(function (v) { return !b.includes(v); });
        if (missing.length) out.push('missing tagged ' + NP.compressVlans(missing));
        if (extra.length) out.push('extra tagged ' + NP.compressVlans(extra));
      } else out.push((p.tagged ? 'tagged ' + p.tagged : 'no tagged VLANs') + ', not ' + (t.tagged || 'none'));
    }
    return out.join('; ');
  };
  const byCount = function (a, b) { return b.count - a.count || NP.naturalCompare(a.text || a.sig, b.text || b.sig); };

  NP.normalizeMinVlanGroup = 3;      // fewer ports than this is not enough to call anything "the usual setup"
  NP.normalizeMajority = 0.6;        // the usual setup must be on at least this share of the group

  // devices -> groups with something to normalize. pick[groupId] = {spelling, profile} overrides what to normalize to.
  NP.normalize = function (devices, pick) {
    pick = pick || {};
    const groups = {};
    devices.forEach(function (dev) {
      NP.eports(dev).forEach(function (p) {
        if (p.kind !== 'physical' && p.kind !== 'lag') return;
        const r = NP.portRole(p.description);
        if (!r) return;
        const g = groups[r.id] = groups[r.id] || { id: r.id, label: r.label, members: [] };
        g.members.push({ dev: dev, p: p, role: r });
      });
    });
    const out = [];
    Object.keys(groups).forEach(function (id) {
      const g = groups[id], chosen = pick[id] || {};
      const res = { id: id, label: g.label, count: g.members.length, spelling: null, vlans: null };

      // ---- spelling
      const texts = {};
      g.members.forEach(function (m) { texts[m.role.text] = (texts[m.role.text] || 0) + 1; });
      const variants = Object.keys(texts).map(function (t) { return { text: t, count: texts[t] }; }).sort(byCount);
      const target = texts[chosen.spelling] ? chosen.spelling : variants[0].text;
      if (!res.label) res.label = target;
      if (variants.length > 1) {
        res.spelling = { variants: variants, target: target, rows: g.members.filter(function (m) { return m.role.text !== target; }).map(function (m) {
          const d = m.p.description;
          return { dev: m.dev, key: m.p.key, short: m.p.short, from: d, to: d.slice(0, m.role.start) + target + d.slice(m.role.end) };
        }) };
      }

      // ---- VLAN setup (LAG members carry no VLANs of their own; ports with no VLAN data say nothing)
      const cand = g.members.filter(function (m) { return m.p.kind === 'physical' && !m.p.lag && (m.p.mode || m.p.untagged || m.p.tagged); });
      const sigs = {};
      cand.forEach(function (m) {
        m.sig = [m.p.mode, m.p.untagged, m.p.tagged].join('|');
        (sigs[m.sig] = sigs[m.sig] || { sig: m.sig, count: 0, mode: m.p.mode, untagged: m.p.untagged, tagged: m.p.tagged,
          label: profileLabel(m.p.mode, m.p.untagged, m.p.tagged) }).count++;
      });
      const profiles = Object.keys(sigs).map(function (s) { return sigs[s]; }).sort(byCount);
      if (cand.length >= NP.normalizeMinVlanGroup && profiles.length > 1 && profiles[0].count / cand.length >= NP.normalizeMajority) {
        const t = sigs[chosen.profile] || profiles[0];
        res.vlans = { profiles: profiles, target: t.sig, targetLabel: t.label, of: cand.length, rows: cand.filter(function (m) { return m.sig !== t.sig; }).map(function (m) {
          return { dev: m.dev, key: m.p.key, short: m.p.short, from: sigs[m.sig].label, diff: profileDiff(m.p, t),
            to: { mode: t.mode, untagged: t.untagged, tagged: t.tagged } };
        }) };
      }
      if (res.spelling || res.vlans) out.push(res);
    });
    const rows = function (g) { return (g.spelling ? g.spelling.rows.length : 0) + (g.vlans ? g.vlans.rows.length : 0); };
    return out.sort(function (a, b) { return rows(b) - rows(a) || NP.naturalCompare(a.label, b.label); });
  };

  NP.normalizeCount = function (groups) {
    return groups.reduce(function (n, g) { return n + (g.spelling ? g.spelling.rows.length : 0) + (g.vlans ? g.vlans.rows.length : 0); }, 0);
  };

  // Apply rows from one finding as manual edits. kind: 'spelling' or 'vlans'. Returns how many ports changed.
  NP.normalizeApply = function (kind, rows) {
    rows.forEach(function (r) {
      if (kind === 'spelling') NP.setEdit(r.dev, r.key, 'description', r.to);
      else ['mode', 'untagged', 'tagged'].forEach(function (f) { NP.setEdit(r.dev, r.key, f, r.to[f]); });
    });
    return rows.length;
  };

  NP.normalizeText = function (devices, pick) {
    const many = devices.length > 1;
    const out = ['ConfigHelper normalizer: ' + devices.map(function (d) { return d.hostname || 'device'; }).join(', ')];
    const groups = NP.normalize(devices, pick);
    if (!groups.length) out.push('', 'Nothing to normalize.');
    const where = function (r) { return (many ? (r.dev.hostname || 'device') + ' ' : '') + r.short; };
    groups.forEach(function (g) {
      out.push('', g.label + ' (' + g.count + ' ports)');
      if (g.spelling) {
        out.push('  Written ' + g.spelling.variants.length + ' ways: ' + g.spelling.variants.map(function (v) { return '"' + v.text + '" x' + v.count; }).join(', '));
        g.spelling.rows.forEach(function (r) { out.push('    ' + where(r) + ': "' + r.from + '" -> "' + r.to + '"'); });
      }
      if (g.vlans) {
        out.push('  VLANs differ from: ' + g.vlans.targetLabel);
        g.vlans.rows.forEach(function (r) { out.push('    ' + where(r) + ': ' + r.from + ' (' + r.diff + ')'); });
      }
    });
    return out.join('\n') + '\n';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
