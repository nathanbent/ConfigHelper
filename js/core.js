/* ConfigHelper core: shared data model, helpers, vendor registry.
 * Plain script (no modules) so index.html works straight from file://.
 * In Node, require() the files in order; everything hangs off globalThis.NP. */
(function (root) {
  'use strict';
  const NP = root.NP = root.NP || {};

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
    twentyfivegige: 'Twe', twe: 'Twe', twentyfivegigabitethernet: 'Twe', 'twenty-fivegige': 'Twe', wge: 'Twe',
    fortygigabitethernet: 'Fo', fo: 'Fo', 'for': 'Fo', fortygige: 'Fo', fge: 'Fo',
    hundredgige: 'Hu', hu: 'Hu', hun: 'Hu', hundredgigabitethernet: 'Hu', hge: 'Hu',
    appgigabitethernet: 'Ap', ap: 'Ap',
    ethernet: 'Eth', eth: 'Eth', et: 'Eth',
    'port-channel': 'Po', po: 'Po', portchannel: 'Po',
    'bridge-aggregation': 'BAGG', bagg: 'BAGG',
    vlan: 'Vlan', vl: 'Vlan', 'vlan-interface': 'Vlan',
    loopback: 'Lo', lo: 'Lo', loop: 'Lo',
    management: 'Ma', ma: 'Ma', mgmt: 'mgmt',
    tunnel: 'Tu', tu: 'Tu',
    lag: 'lag'
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
      sources: []         // what was pasted in, for the record (names only)
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

  // ------------------------------------------------------- input splitting
  // A paste may be a whole terminal session ("sw1#show run ... sw1#show int status ...").
  // Split it at the prompt lines so each command's output is handled on its own.
  const PROMPT = /^\s*((?:[\w.\-:\/()@~]+\s?[#>]|\[[^\]\n]+\]\s?>?|<[\w.\-]+>))\s*((?:show|sho|sh|display|disp|dis|get|do|export|print|\/[a-z])[^\n]*)$/i;

  NP.sections = function (text) {
    const out = [];
    let cur = { cmd: '', host: '', lines: [] };
    String(text).split(/\r?\n/).forEach(function (line) {
      const m = line.match(PROMPT);
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
    const devices = opts.devices || [];
    let vendor = opts.vendor && opts.vendor !== 'auto' ? opts.vendor : NP.detect(text);
    if (!vendor && opts.current) vendor = opts.current.vendor;
    if (!vendor || !NP.vendors[vendor]) {
      throw new Error('Could not tell which vendor this is. Pick one from the list and try again.');
    }
    const probe = NP.parseInto(text, vendor, NP.newDevice());
    const found = probe.ports.length || probe.vlans.length || probe.hostname || probe.dns.length ||
      probe.ntp.length || probe.version || probe.model;
    if (!found) {
      throw new Error('Nothing recognisable was found in that input (parsed as ' + NP.vendors[vendor].label + ').');
    }
    let dev = null;
    const target = opts.target || 'auto';
    if (target === 'current') dev = opts.current || null;
    else if (target === 'auto') {
      if (probe.hostname) {
        dev = devices.find(function (d) { return d.hostname.toLowerCase() === probe.hostname.toLowerCase(); }) || null;
      } else dev = opts.current || null;
    }
    const isNew = !dev;
    if (isNew) dev = NP.newDevice();
    if (!dev.vendor) dev.vendor = vendor;
    NP.parseInto(text, vendor, dev);
    NP.finalize(dev);
    dev.sources.push({ name: opts.name || 'pasted text', vendor: vendor, lines: text.split('\n').length });
    return { dev: dev, isNew: isNew, vendor: vendor };
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
    { id: 'kind', label: 'Kind', get: function (p) { return p.kind; } }
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
