/* ConfigHelper core: shared data model, helpers, vendor registry.
 * Plain script (no modules) so index.html works straight from file://.
 * In Node, require() the files in order; everything hangs off globalThis.NP. */
(function (root) {
  'use strict';
  const NP = root.NP = root.NP || {};

  // Version shown in the app and in problem reports. build.js replaces the build stamp.
  NP.version = '0.1.0';
  NP.build = 'source';            // becomes the commit id on the deployed site, "local build" in a file you built yourself

  // Platforms whose parser has been checked against output from real hardware, and on what.
  // Everything else was written from documentation and made-up samples: shown as "experimental".
  NP.verified = { ios: 'Catalyst 3850, IOS-XE 16.12', junos: 'EX2300-C, Junos 25.2', icx: 'ICX7150-48P, FastIron 10.0.10; ICX6610, FastIron 08.0.30 (config only)' };

  // ---------------------------------------------------------------- vendors
  NP.vendors = {};
  NP.vendorOrder = [];
  NP.registerVendor = function (id, label, parse) {
    NP.vendors[id] = { id, label, parse };
    NP.vendorOrder.push(id);
  };

  // ---------------------------------------------------------------- helpers
  NP.addUnique = function (arr, v) {
    if (v === undefined || v === null || v === '') return;
    if (!arr.includes(v)) arr.push(v);
  };

  NP.unquote = function (s) {
    s = String(s == null ? '' : s).trim();
    return s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  };

  // "1,3-5 7" -> [1,3,4,5,7]
  NP.parseVlanList = function (s) {
    const out = [];
    String(s).split(/[,\s]+/).forEach(function (part) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (b < a || b > 4095) return;
      for (let i = a; i <= b; i++) out.push(i);
    });
    return out;
  };

  // [1,3,4,5,7] -> "1,3-5,7"
  NP.compressVlans = function (list) {
    const a = Array.from(new Set(list.map(Number))).filter(function (n) { return !isNaN(n); })
      .sort(function (x, y) { return x - y; });
    const out = [];
    for (let i = 0; i < a.length; i++) {
      let j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      out.push(j > i ? a[i] + '-' + a[j] : String(a[i]));
      i = j;
    }
    return out.join(',');
  };

  // Normalise a VLAN list string for display.
  NP.normVlans = function (s) {
    s = String(s == null ? '' : s).trim();
    if (!s || /^none$/i.test(s)) return '';
    if (/^all$/i.test(s)) return 'all';
    const l = NP.parseVlanList(s);
    if (!l.length) return s;
    const c = NP.compressVlans(l);
    return /^1-409[45]$/.test(c) ? 'all' : c;
  };

  NP.maskToLen = function (mask) {
    let n = 0;
    String(mask).split('.').forEach(function (o) {
      let v = +o;
      while (v) { n += v & 1; v >>= 1; }
    });
    return n;
  };
  NP.cidr = function (ip, mask) {
    if (!mask) return ip;
    return ip + '/' + (/^\d+$/.test(mask) ? mask : NP.maskToLen(mask));
  };

  NP.fmtSpeed = function (s) {
    s = String(s == null ? '' : s).trim().replace(/^a-/, '').replace(/\(a\)$/, '');
    if (!s || /^auto$/i.test(s) || s === '--') return '';
    const map = { 10: '10M', 100: '100M', 1000: '1G', 2500: '2.5G', 5000: '5G', 10000: '10G',
      25000: '25G', 40000: '40G', 50000: '50G', 100000: '100G' };
    if (/^\d+$/.test(s)) return map[+s] || s + 'M';
    return s;
  };
  NP.fmtDuplex = function (s) {
    s = String(s == null ? '' : s).trim().replace(/^a-/, '').replace(/\(a\)$/, '');
    if (/^(full|f|fdx)$/i.test(s)) return 'full';
    if (/^(half|h|hdx)$/i.test(s)) return 'half';
    return '';
  };

  // ------------------------------------------------------------ port naming
  // long/short interface prefixes -> one canonical abbreviation, so that
  // "GigabitEthernet1/0/1" (config) and "Gi1/0/1" (show output) merge.
  const PREFIX = {
    fastethernet: 'Fa', fa: 'Fa', fas: 'Fa',
    gigabitethernet: 'Gi', gi: 'Gi', gig: 'Gi', ge: 'Gi',
    twogigabitethernet: 'Tw', tw: 'Tw', two: 'Tw',
    fivegigabitethernet: 'Fi', fi: 'Fi', fiv: 'Fi',
    tengigabitethernet: 'Te', te: 'Te', ten: 'Te', 'ten-gigabitethernet': 'Te', xge: 'Te',
    twentyfivegige: 'Twe', twe: 'Twe', tf: 'Twe', twentyfivegigabitethernet: 'Twe', 'twenty-fivegige': 'Twe', wge: 'Twe',
    fortygigabitethernet: 'Fo', fo: 'Fo', 'for': 'Fo', fortygige: 'Fo', fge: 'Fo',
    hundredgige: 'Hu', hu: 'Hu', hun: 'Hu', hundredgigabitethernet: 'Hu', hge: 'Hu',
    appgigabitethernet: 'Ap', ap: 'Ap',
    ethernet: 'Eth', eth: 'Eth', et: 'Eth',
    'port-channel': 'Po', po: 'Po', portchannel: 'Po',
    'bridge-aggregation': 'BAGG', bagg: 'BAGG',
    vlan: 'Vlan', vl: 'Vlan', 'vlan-interface': 'Vlan',
    loopback: 'Lo', lo: 'Lo', loop: 'Lo',
    management: 'Ma', ma: 'Ma', mgmt: 'mgmt', managementethernet: 'Ma',
    tunnel: 'Tu', tu: 'Tu',
    lag: 'lag', lg: 'lag'
  };
  const KIND_BY_ABBR = { Po: 'lag', BAGG: 'lag', lag: 'lag', Vlan: 'svi', Lo: 'loopback',
    Ma: 'mgmt', mgmt: 'mgmt', Tu: 'tunnel' };

  NP.portId = function (name) {
    name = String(name).trim();
    const m = name.match(/^([A-Za-z][A-Za-z\-]*?)\s*(\d[\d\/.:]*)$/);
    if (m) {
      const abbr = PREFIX[m[1].toLowerCase()];
      if (abbr) {
        return { key: (abbr + m[2]).toLowerCase(), short: abbr + m[2], kind: KIND_BY_ABBR[abbr] || 'physical' };
      }
    }
    let kind = 'physical';
    if (/^(ae|bond|trk|lag|bridge)\d*/i.test(name)) kind = 'lag';
    else if (/^(vlan|irb|vl)[\s.\-]?\d+/i.test(name)) kind = 'svi';
    else if (/^lo(opback)?\d*(\.\d+)?$/i.test(name)) kind = 'loopback';
    else if (/^(mgmt|me\d|fxp|em\d|vme|oobm|management)/i.test(name)) kind = 'mgmt';
    else if (/^(tunnel|gre|ipsec|wg|ssl\.)/i.test(name)) kind = 'tunnel';
    return { key: name.toLowerCase().replace(/\s+/g, ''), short: name, kind: kind };
  };

  // Trailing port number, handy for faceplate labels: Gi1/0/12 -> "12"
  NP.portNum = function (name) {
    const m = String(name).match(/(\d+)(?!.*\d)/);
    return m ? m[1] : '';
  };

  // Stack member / chassis slot a physical port belongs to: Gi2/0/14 -> "2", ge-1/0/3 -> "1",
  // 3/1/24 -> "3", ProCurve "2/24" -> "2" and "B12" -> "B". Single-numbered ports have none.
  NP.portUnit = function (p) {
    if (p.kind !== 'physical') return '';
    const m = String(p.short).match(/(\d+)(?:\/\d+)+(?!.*\d)/);
    if (m) return m[1];
    const l = String(p.short).match(/^([A-Za-z])\d+$/);
    return l ? l[1].toUpperCase() : '';
  };
  // -> [{unit, ports, up, down, disabled, absent, poeWatts}] for devices with more than one unit, else []
  NP.units = function (dev) {
    const by = {};
    dev.ports.forEach(function (p) {
      const u = NP.portUnit(p);
      if (!u) return;
      const x = by[u] = by[u] || { unit: u, ports: 0, up: 0, down: 0, disabled: 0, absent: 0, poeWatts: 0 };
      x.ports++;
      if (p.link === 'not present') x.absent++;
      else if (p.adminUp === false) x.disabled++;
      else if (p.link === 'up') x.up++;
      else if (p.link) x.down++;
      x.poeWatts = Math.round((x.poeWatts + (parseFloat(p.poeWatts) || 0)) * 10) / 10;
    });
    const list = Object.keys(by).sort(NP.naturalCompare).map(function (k) { return by[k]; });
    return list.length > 1 ? list : [];
  };

  // ------------------------------------------------------------- data model
  let seq = 0;
  NP.newDevice = function () {
    return {
      id: 'd' + Date.now().toString(36) + (seq++).toString(36),
      vendor: '', hostname: '', model: '', version: '', serial: '',
      mgmtIp: '', gateway: '', domain: '',
      dns: [], ntp: [], syslog: [],
      snmp: { versions: [], location: '', contact: '' },
      stp: { enabled: '', mode: '', priority: [], notes: [] },
      multicast: { igmpSnooping: '', querier: '', routing: '', notes: [] },
      vlans: [],          // {id, name}
      ports: [],
      other: {},          // free-form "Label" -> "value"
      sources: [],        // what was pasted in, for the record (names only)
      unparsed: [],       // {ctx, text, count, inner}: input the parser did not use
      snapshots: [],      // [{label, at, data}]: frozen earlier states, for the Compare tab
      edits: {}           // port key -> {description, neighbor, ..., excluded}: manual changes, kept apart from parsed data
    };
  };

  NP.newPort = function (name) {
    const id = NP.portId(name);
    return {
      key: id.key, name: name, short: id.short, kind: id.kind,
      description: '', adminUp: null, link: '', speed: '', duplex: '', media: '',
      mode: '', untagged: '', tagged: '', voiceVlan: '', lag: '', ip: '',
      poeAdmin: '', poeStatus: '', poeWatts: '', poeClass: '',
      stp: '', stpState: '', neighbor: '', neighborPort: '', neighborInfo: '', notes: ''
    };
  };

  // get-or-create
  NP.port = function (dev, name) {
    name = String(name).trim();
    const id = NP.portId(name);
    let p = dev.ports.find(function (x) { return x.key === id.key; });
    if (!p) { p = NP.newPort(name); dev.ports.push(p); }
    else if (name.length > p.name.length) p.name = name;   // prefer the long form
    return p;
  };
  NP.findPort = function (dev, name) {
    const key = NP.portId(name).key;
    return dev.ports.find(function (x) { return x.key === key; });
  };

  NP.addVlan = function (dev, id, name) {
    id = +id;
    if (!id) return null;
    let v = dev.vlans.find(function (x) { return x.id === id; });
    if (!v) { v = { id: id, name: '' }; dev.vlans.push(v); }
    if (name) v.name = NP.unquote(name);
    return v;
  };

  NP.addNote = function (p, note) {
    const list = p.notes ? p.notes.split('; ') : [];
    if (!list.includes(note)) list.push(note);
    p.notes = list.join('; ');
  };
  NP.addFlag = function (p, field, flag) {
    const list = p[field] ? p[field].split(', ') : [];
    if (!list.includes(flag)) list.push(flag);
    p[field] = list.join(', ');
  };
  NP.addOther = function (dev, key, val) {
    const cur = dev.other[key] ? dev.other[key].split(', ') : [];
    if (!cur.includes(val)) cur.push(val);
    dev.other[key] = cur.join(', ');
  };

  // ------------------------------------------------------------ manual edits
  // Parsed values are never overwritten: edits live in dev.edits and are laid over the ports
  // whenever they are shown or exported, so re-pasting a config keeps them.
  NP.editable = ['description', 'mode', 'untagged', 'tagged', 'neighbor', 'neighborPort', 'notes'];
  NP.eports = function (dev, withExcluded) {
    const ed = dev.edits || {};
    const out = [];
    dev.ports.forEach(function (p) {
      const e = ed[p.key];
      if (!e) { out.push(p); return; }
      if (e.excluded && !withExcluded) return;
      const q = Object.assign({}, p);
      q.edited = {};                       // field -> the parsed value it replaces
      NP.editable.forEach(function (f) {
        if (e[f] !== undefined && e[f] !== p[f]) { q.edited[f] = p[f]; q[f] = e[f]; }
      });
      q.excluded = !!e.excluded;
      out.push(q);
    });
    return out;
  };
  NP.setEdit = function (dev, key, field, value) {
    const p = dev.ports.find(function (x) { return x.key === key; });
    if (!p) return;
    dev.edits = dev.edits || {};
    const e = dev.edits[key] = dev.edits[key] || {};
    if (field === 'excluded') { if (value) e.excluded = true; else delete e.excluded; }
    else if (NP.editable.includes(field)) {
      value = String(value == null ? '' : value).trim();
      if (value === p[field]) delete e[field]; else e[field] = value;
    }
    if (!Object.keys(e).length) delete dev.edits[key];
  };
  NP.editCount = function (dev) {
    const live = {};
    dev.ports.forEach(function (p) { live[p.key] = p; });
    let n = 0, excluded = 0;
    Object.keys(dev.edits || {}).forEach(function (k) {
      const e = dev.edits[k], p = live[k];
      if (!p) return;
      if (e.excluded) excluded++;
      NP.editable.forEach(function (f) { if (e[f] !== undefined && e[f] !== p[f]) n++; });
    });
    return { fields: n, excluded: excluded, total: n + excluded };
  };

  // ---------------------------------------------------- "not parsed" tracking
  // Parsers call NP.miss() for a line they recognise nothing in. NP.ingest collects these,
  // drops known noise, strips secrets and stores the rest on the device.
  NP._collector = null;
  NP._lastMiss = null;
  NP.miss = function (text, ctx, inner) {
    if (!NP._collector) return null;
    text = String(text).trim();
    const key = ctx + '\u0001' + text;
    const e = NP._collector[key] = NP._collector[key] || { ctx: ctx, text: text, count: 0, inner: 0 };
    e.count++;
    e.inner += inner || 0;
    NP._lastMiss = e;
    return e;
  };
  // an indented line under a block the parser skipped: count it against that block
  NP.missInner = function () { if (NP._collector && NP._lastMiss) NP._lastMiss.inner++; };

  NP.redact = function (t) {
    return String(t)
      .replace(/\b(secret|password|passwd|key|key-string|community|auth|priv|md5|sha\d*|psk|passphrase|pre-shared-key|encrypted-password|cipher|simple|hash)\b(\s+\d)?\s+\S+/gi, '$1 ***')
      .replace(/\$\d\$\S+|\b[0-9A-Fa-f]{16,}\b|[A-Za-z0-9+\/=]{28,}/g, '***');
  };
  // lines nobody needs to hear about
  const NOISE = new RegExp('^(' + [
    '[!#;]', 'end$', 'exit$', 'quit$', 'return$', 'Building configuration', 'Current configuration', 'Running configuration',
    'version ', 'ver ', 'boot[ -]', '(no )?service ', '(no )?platform ', 'license ', 'diagnostic ', 'memory ', 'redundancy',
    'transceiver ', 'control-plane', 'line (con|aux)', 'banner ', 'crypto ', 'call-home', 'class-map ', 'policy-map ',
    'no (login|device-tracking|ip domain[- ]lookup|ip address|aaa new-model|untagged|tagged)', 'enable (secret|password|super-user)',
    'archive', 'alias ', 'hw-module', 'ip forward-protocol', 'ip classless', 'ip subnet-zero', 'login ', 'subscriber ',
    'mls ', 'module \\d', 'stack-port', '[\\w.\\-@]+[#>]$', 'ip http (authentication|client)', 'switch \\d+ provision', 'system mtu'
  ].join('|') + ')', 'i');
  const NOISE_CMD = /^(terminal |term |skip-page|no page|screen-length|set cli |config system console|set output|show int$|exit|end$|enable$)/i;

  // -> {seen, noise, added}: distinct lines missed, how many of those were known noise, how many are new on the list
  NP.storeMisses = function (dev, collector) {
    const n = { seen: 0, noise: 0, added: 0 };
    Object.keys(collector).forEach(function (k) {
      const e = collector[k];
      n.seen++;
      if (e.ctx !== 'command' && e.ctx !== 'block' && NOISE.test(e.text)) { n.noise++; return; }
      const text = NP.redact(e.text);
      const old = dev.unparsed.find(function (x) { return x.ctx === e.ctx && x.text === text; });
      if (old) { old.count = Math.max(old.count, e.count); old.inner = Math.max(old.inner, e.inner); }
      else { dev.unparsed.push({ ctx: e.ctx, text: text, count: e.count, inner: e.inner }); n.added++; }
    });
    return n;
  };
  // What each prompted section gives when parsed on its own: [{cmd, lines, used, ports, vlans} | {cmd, lines, noise}].
  // A section with no command is the text before the first prompt (a bare config, usually).
  function sectionYield(text, vendor) {
    const solo = function (t) {
      const d = NP.newDevice(); d.id = '';
      NP.vendors[vendor].parse(t, d);
      delete d.pendingChildren;
      return d;
    };
    const empty = JSON.stringify(solo(''));
    return NP.sections(text).map(function (s) {
      const lines = s.text.split('\n').filter(function (l) { return l.trim(); }).length;
      if (s.cmd && NOISE_CMD.test(s.cmd)) return { cmd: s.cmd, lines: lines, noise: true };
      const d = solo(s.text);
      return { cmd: s.cmd, lines: lines, used: JSON.stringify(d) !== empty, ports: d.ports.length, vlans: d.vlans.length };
    });
  }
  // Commands whose whole output changed nothing.
  function unusedCommands(sections) {
    const out = {};
    sections.forEach(function (s) {
      if (!s.cmd || s.noise || s.used) return;
      out['command\u0001' + s.cmd] = { ctx: 'command', text: s.cmd, count: 1, inner: s.lines };
    });
    return out;
  }

  // ------------------------------------------------------- input splitting
  // A paste may be a whole terminal session ("sw1#show run ... sw1#show int status ...").
  // Split it at the prompt lines so each command's output is handled on its own.
  const PROMPT = /^\s*((?:[\w.\-:\/()@~]+\s?[#>]|\[[^\]\n]+\]\s?>?|<[\w.\-]+>))\s*((?:(?:show|sho|sh|display|disp|dis|get|diagnose|diag|do|export|print)\b|\/[a-z])[^\n]*)$/i;

  NP.sections = function (text) {
    const out = [];
    let cur = { cmd: '', host: '', lines: [] };
    String(text).split(/\r?\n/).forEach(function (line) {
      // (an XML line such as "<name>shopkeeper</name>" is not a "<SWITCH>" prompt followed by a command)
      const m = /<\/[\w.\-:]+>\s*$/.test(line) ? null : line.match(PROMPT);
      if (m) {
        if (cur.lines.some(function (l) { return l.trim(); })) out.push(cur);
        const host = m[1].replace(/[#>\s]+$/, '').replace(/^[\[<]|[\]>]$/g, '')
          .replace(/^.*@/, '').replace(/\(.*\)$/, '').trim();
        cur = { cmd: m[2].trim(), host: host, lines: [] };
      } else cur.lines.push(line);
    });
    if (cur.lines.some(function (l) { return l.trim(); })) out.push(cur);
    return out.map(function (s) { return { cmd: s.cmd, host: s.host, text: s.lines.join('\n') }; });
  };

  // One paste holding sessions from several devices ("sw1#show run ... fw2 # show ..."): cut it where
  // the prompt's hostname changes, so each device is detected and parsed on its own.
  NP.splitDevices = function (text) {
    const chunks = [];
    let cur = [], host = '';
    String(text).split(/\r?\n/).forEach(function (line) {
      const m = /<\/[\w.\-:]+>\s*$/.test(line) ? null : line.match(PROMPT);
      if (m) {
        const h = m[1].replace(/[#>\s]+$/, '').replace(/^[\[<]|[\]>]$/g, '').replace(/^.*@/, '').replace(/\(.*\)$/, '').trim().toLowerCase();
        if (h && host && h !== host) { chunks.push(cur.join('\n')); cur = []; }
        if (h) host = h;
      }
      cur.push(line);
    });
    chunks.push(cur.join('\n'));
    return chunks.length > 1 ? chunks : [String(text)];
  };

  // Walk fixed-layout "show" tables: find each header line, feed the rows that follow.
  NP.eachTable = function (text, isHeader, onRow) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!isHeader(lines[i])) continue;
      const header = lines[i];
      let rows = 0;
      for (i++; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln.trim()) { if (rows) break; continue; }
        if (/^[\s\-=+|]+$/.test(ln)) continue;
        if (isHeader(ln)) { i--; break; }
        if (onRow(ln, header) === false) break;
        rows++;
      }
    }
  };

  // ---------------------------------------------------------------- finalise
  const KIND_RANK = { physical: 0, lag: 1, svi: 2, loopback: 3, mgmt: 4, tunnel: 5 };
  NP.naturalCompare = function (a, b) {
    const ax = String(a).match(/\d+|\D+/g) || [], bx = String(b).match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
      if (ax[i] === bx[i]) continue;
      const an = /^\d/.test(ax[i]), bn = /^\d/.test(bx[i]);
      if (an && bn) return +ax[i] - +bx[i];
      return ax[i] < bx[i] ? -1 : 1;
    }
    return ax.length - bx.length;
  };
  NP.comparePorts = function (a, b) {
    const r = (KIND_RANK[a.kind] === undefined ? 9 : KIND_RANK[a.kind]) -
              (KIND_RANK[b.kind] === undefined ? 9 : KIND_RANK[b.kind]);
    if (r) return r;
    // order by slot/module first, then interface type, then port number:
    // Gi1/0/1..36, Te1/0/37..48, then the 1/1/x uplink module
    const pa = split(a.key), pb = split(b.key);
    return NP.naturalCompare(pa.parent, pb.parent) || NP.naturalCompare(pa.prefix, pb.prefix) ||
      NP.naturalCompare(a.key, b.key);
  };
  function split(key) {
    const m = key.match(/^(\D*)(.*)$/);
    const i = m[2].lastIndexOf('/');
    return { prefix: m[1], parent: i < 0 ? '' : m[2].slice(0, i) };
  }

  NP.finalize = function (dev) {
    dev.ports.sort(NP.comparePorts);
    dev.vlans.sort(function (a, b) { return a.id - b.id; });
    if (!dev.mgmtIpFixed) {
      // every address the box can be managed on: mgmt port first, then SVIs, then loopbacks
      const up = function (p) { return p.ip && /\d/.test(p.ip) && p.adminUp !== false; };
      let list = [];
      ['mgmt', 'svi', 'loopback'].forEach(function (k) {
        list = list.concat(dev.ports.filter(function (p) { return p.kind === k && up(p); }));
      });
      if (!list.length) list = dev.ports.filter(up).slice(0, 1);
      dev.mgmtIp = list.slice(0, 4).map(function (p) { return p.ip + ' (' + p.short + ')'; }).join(', ') +
        (list.length > 4 ? ', +' + (list.length - 4) + ' more' : '');
    }
    return dev;
  };

  // ------------------------------------------------------------------ ingest
  const now = function () { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); };
  const DEBUG_FIELDS = ['description', 'admin', 'link', 'speed', 'duplex', 'media', 'mode', 'untagged', 'tagged', 'voiceVlan', 'lag',
    'ip', 'poeAdmin', 'poeStatus', 'poeWatts', 'stp', 'stpState', 'neighbor', 'notes'];
  NP.parseInto = function (text, vendor, dev) {
    NP.vendors[vendor].parse(text, dev);
    if (!dev.hostname) {
      const s = NP.sections(text).find(function (x) { return x.host; });
      if (s) dev.hostname = s.host;
    }
    return dev;
  };

  // opts: {vendor:'auto'|id, target:'auto'|'new'|'current', devices:[], current:dev|null, name:''}
  NP.ingest = function (text, opts) {
    opts = opts || {};
    const ms = {}, t0 = now();
    let t = t0;
    const lap = function (k) { const n = now(); ms[k] = Math.round((n - t) * 10) / 10; t = n; };
    const rawChars = String(text).length;
    const cleaned = NP.clean ? NP.clean(text) : { text: text, notes: [] };
    text = cleaned.text;
    lap('clean');
    const devices = opts.devices || [];
    const byHand = !!(opts.vendor && opts.vendor !== 'auto');
    let vendor = byHand ? opts.vendor : NP.detect(text);
    let how = byHand ? 'chosen by hand' : 'auto-detected';
    if (!vendor && opts.current) { vendor = opts.current.vendor; how = 'not detected; taken from the selected device'; }
    lap('detect');
    if (!vendor || !NP.vendors[vendor]) {
      throw new Error('Could not tell which vendor this is. Pick one from the list and try again.');
    }
    const probe = NP.parseInto(text, vendor, NP.newDevice());
    delete probe.pendingChildren;
    lap('probe');
    const found = probe.ports.length || probe.vlans.length || probe.hostname || probe.dns.length ||
      probe.ntp.length || probe.version || probe.model;
    if (!found) {
      throw new Error('Nothing recognisable was found in that input (parsed as ' + NP.vendors[vendor].label + ').');
    }
    let dev = null, why = '';
    const target = opts.target || 'auto';
    if (target === 'current') { dev = opts.current || null; why = dev ? 'the selected device, as asked' : 'no device selected'; }
    else if (target === 'auto') {
      if (probe.hostname) {
        dev = devices.find(function (d) { return d.hostname.toLowerCase() === probe.hostname.toLowerCase(); }) || null;
        why = dev ? 'hostname matches a loaded device' : 'hostname not loaded yet';
      } else { dev = opts.current || null; why = dev ? 'no hostname in the input; the selected device' : 'no hostname in the input and no device selected'; }
    } else why = 'a new device, as asked';
    const isNew = !dev;
    if (isNew) dev = NP.newDevice();
    if (!dev.vendor) dev.vendor = vendor;
    const was = { vlans: dev.vlans.length, ports: {} };
    dev.ports.forEach(function (p) { was.ports[p.key] = JSON.stringify(p); });
    NP._collector = {}; NP._lastMiss = null;
    let misses;
    try { NP.parseInto(text, vendor, dev); } finally { misses = NP._collector; NP._collector = null; }
    lap('parse');
    if (!dev.unparsed) dev.unparsed = [];
    const missed = NP.storeMisses(dev, misses);
    const yields = sectionYield(text, vendor);
    NP.storeMisses(dev, unusedCommands(yields));
    lap('sections');
    // A parser may describe further devices found in the same input (FortiLink-managed
    // switches inside a FortiGate config): [{hostname, vendor, apply(dev)}]
    const kids = dev.pendingChildren || [];
    delete dev.pendingChildren;
    NP.finalize(dev);
    dev.sources.push({ name: opts.name || 'pasted text', vendor: vendor, lines: text.split('\n').length });
    const extra = [];
    kids.forEach(function (k) {
      const same = function (d) { return d !== dev && d.hostname.toLowerCase() === k.hostname.toLowerCase(); };
      let child = devices.find(same);
      const prior = extra.find(function (e) { return same(e.dev); });
      if (!child && prior) child = prior.dev;
      const childNew = !child;
      if (childNew) { child = NP.newDevice(); child.vendor = k.vendor; child.hostname = k.hostname; }
      k.apply(child);
      NP.finalize(child);
      child.sources.push({ name: 'managed-switch config from ' + (dev.hostname || 'FortiGate'), vendor: vendor, lines: 0 });
      if (!prior) extra.push({ dev: child, isNew: childNew });
    });
    lap('finish');
    ms.total = Math.round((now() - t0) * 10) / 10;

    // What went in, what was worked out and what came out, for this paste only (see NP.debugText).
    // Holds counts, commands and pattern names; never config values or file names.
    const added = dev.ports.filter(function (p) { return was.ports[p.key] === undefined; }).length;
    const changed = dev.ports.filter(function (p) { return was.ports[p.key] !== undefined && was.ports[p.key] !== JSON.stringify(p); }).length;
    const kinds = {}, filled = {};
    const phys = dev.ports.filter(function (p) { return p.kind === 'physical'; });
    dev.ports.forEach(function (p) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
    DEBUG_FIELDS.forEach(function (f) {
      filled[f] = phys.filter(function (p) { return f === 'admin' ? p.adminUp !== null && p.adminUp !== undefined : p[f] !== '' && p[f] != null; }).length;
    });
    const have = {
      hostname: dev.hostname, model: dev.model, version: dev.version, serial: dev.serial, mgmtIp: dev.mgmtIp, gateway: dev.gateway,
      domain: dev.domain, dns: dev.dns.length, ntp: dev.ntp.length, syslog: dev.syslog.length, snmp: dev.snmp.versions.length,
      stpMode: dev.stp.mode, igmpSnooping: dev.multicast.igmpSnooping, other: Object.keys(dev.other || {}).length
    };
    dev.debug = {
      at: new Date().toISOString(), app: NP.version + ' (' + NP.build + ')', source: opts.name && opts.name !== 'pasted text' ? 'file' : 'pasted text', part: opts.part || '',
      input: {
        chars: rawChars, lines: text.split('\n').length, cleaned: cleaned.notes,
        sectionCount: yields.length,
        sections: yields.slice(0, 60).map(function (s) { return Object.assign({}, s, { cmd: NP.redact(s.cmd) }); })
      },
      detect: { vendor: vendor, how: how, matches: NP.detectAll ? NP.detectAll(text) : [] },
      target: { asked: target, isNew: isNew, why: why },
      misses: { seen: missed.seen, noise: missed.noise, added: missed.added,
        unusedCommands: yields.filter(function (s) { return s.cmd && !s.noise && !s.used; }).length },
      ms: ms,
      output: {
        ports: dev.ports.length, portsAdded: added, portsChanged: changed, kinds: kinds,
        vlans: dev.vlans.length, vlansAdded: dev.vlans.length - was.vlans,
        physical: phys.length, filled: filled,
        set: Object.keys(have).filter(function (k) { return have[k]; }), empty: Object.keys(have).filter(function (k) { return !have[k]; }),
        children: extra.length
      }
    };
    return { dev: dev, isNew: isNew, vendor: vendor, extra: extra, cleaned: cleaned.notes, debug: dev.debug };
  };

  // ------------------------------------------------------------- port columns
  NP.adminText = function (p) { return p.adminUp === false ? 'disabled' : p.adminUp === true ? 'enabled' : ''; };
  NP.columns = [
    { id: 'name', label: 'Port', get: function (p) { return p.name; }, on: true },
    { id: 'short', label: 'Short', get: function (p) { return p.short; } },
    { id: 'description', label: 'Description', get: function (p) { return p.description; }, on: true },
    { id: 'admin', label: 'Admin', get: NP.adminText, on: true },
    { id: 'link', label: 'Link', get: function (p) { return p.link; }, on: true },
    { id: 'speed', label: 'Speed', get: function (p) { return p.speed; }, on: true },
    { id: 'duplex', label: 'Duplex', get: function (p) { return p.duplex; } },
    { id: 'media', label: 'Media', get: function (p) { return p.media; } },
    { id: 'mode', label: 'Mode', get: function (p) { return p.mode; }, on: true },
    { id: 'untagged', label: 'Untagged / native', get: function (p) { return p.untagged; }, on: true },
    { id: 'tagged', label: 'Tagged VLANs', get: function (p) { return p.tagged; }, on: true },
    { id: 'voiceVlan', label: 'Voice VLAN', get: function (p) { return p.voiceVlan; }, on: true },
    { id: 'lag', label: 'LAG', get: function (p) { return p.lag; }, on: true },
    { id: 'ip', label: 'IP address', get: function (p) { return p.ip; } },
    { id: 'poeAdmin', label: 'PoE admin', get: function (p) { return p.poeAdmin; } },
    { id: 'poeStatus', label: 'PoE', get: function (p) { return p.poeStatus; }, on: true },
    { id: 'poeWatts', label: 'PoE W', get: function (p) { return p.poeWatts; }, on: true },
    { id: 'poeClass', label: 'PoE class', get: function (p) { return p.poeClass; } },
    { id: 'stp', label: 'STP config', get: function (p) { return p.stp; }, on: true },
    { id: 'stpState', label: 'STP state', get: function (p) { return p.stpState; } },
    { id: 'neighbor', label: 'Neighbor', get: function (p) { return p.neighbor; }, on: true },
    { id: 'neighborPort', label: 'Neighbor port', get: function (p) { return p.neighborPort; }, on: true },
    { id: 'neighborInfo', label: 'Neighbor info', get: function (p) { return p.neighborInfo; } },
    { id: 'notes', label: 'Notes', get: function (p) { return p.notes; } },
    { id: 'unit', label: 'Unit', get: function (p) { return NP.portUnit(p); } },
    { id: 'kind', label: 'Kind', get: function (p) { return p.kind; } }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
