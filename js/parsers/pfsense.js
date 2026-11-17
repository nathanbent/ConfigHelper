/* pfSense and OPNsense: the exported config.xml (Diagnostics > Backup & Restore).
 * There is no CLI config; the XML is the configuration. Link state is not in it. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  const decode = function (s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  };
  // minimal XML reader -> {tag, kids:[], text}
  function xmlTree(xml) {
    const top = { tag: '', kids: [], text: '' };
    const stack = [top];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w.\-:]+)(?:\s+[\w.\-:]+\s*=\s*"[^"]*")*\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
      const cur = stack[stack.length - 1];
      if (m[3]) {
        if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
        const n = { tag: m[3], kids: [], text: '' };
        cur.kids.push(n);
        if (!m[4]) stack.push(n);
      } else if (m[1] !== undefined) cur.text += m[1];
      else if (m[5].trim()) cur.text += decode(m[5].trim());
    }
    return top;
  }
  const kid = function (n, tag) { return n ? n.kids.find(function (k) { return k.tag === tag; }) : undefined; };
  const kids = function (n, tag) { return n ? n.kids.filter(function (k) { return k.tag === tag; }) : []; };
  const txt = function (n, tag) { const k = kid(n, tag); return k ? k.text.trim() : ''; };
  // pfSense marks "on" with an empty element; OPNsense writes 1
  const isOn = function (n, tag) { const k = kid(n, tag); return !!k && k.text.trim() !== '0' && k.text.trim() !== 'disabled'; };

  NP.registerVendor('pfsense', 'pfSense / OPNsense', function (text, dev) {
    const a = text.search(/<(pfsense|opnsense)[\s>]/);
    if (a < 0) return;
    const doc = xmlTree(text.slice(a)).kids[0];
    if (!doc) return;
    const product = doc.tag === 'opnsense' ? 'OPNsense' : 'pfSense';
    const used = {};
    const sec = function (tag) { used[tag] = true; return kid(doc, tag); };
    const touch = function (name) { const p = NP.port(dev, name); p.kind = 'physical'; if (p.adminUp === null) p.adminUp = true; return p; };

    dev.model = dev.model || product;
    if (txt(doc, 'version')) dev.other['Config format version'] = txt(doc, 'version');
    used.version = used.revision = used.lastchange = used.theme = true;

    // ---- system
    const sys = sec('system');
    if (sys) {
      if (txt(sys, 'hostname')) dev.hostname = txt(sys, 'hostname');
      if (txt(sys, 'domain')) dev.domain = txt(sys, 'domain');
      kids(sys, 'dnsserver').forEach(function (d) { addUnique(dev.dns, d.text.trim()); });
      txt(sys, 'timeservers').split(/\s+/).filter(Boolean).forEach(function (t) { addUnique(dev.ntp, t); });
      if (txt(sys, 'timezone')) dev.other['Time zone'] = txt(sys, 'timezone');
      const gui = kid(sys, 'webgui');
      if (gui) {
        const proto = txt(gui, 'protocol') || 'http';
        dev.other['Web interface'] = proto + (txt(gui, 'port') ? ' port ' + txt(gui, 'port') : '');
        dev.other[proto === 'http' ? 'HTTP server' : 'HTTPS server'] = 'enabled';
      }
      const ssh = kid(sys, 'ssh');
      if (txt(sys, 'enablesshd') || (ssh && (txt(ssh, 'enable') === 'enabled' || txt(ssh, 'enabled') === 'enabled'))) dev.other.SSH = 'enabled';
      kids(sys, 'user').forEach(function (u) { if (txt(u, 'name')) NP.addOther(dev, 'Admin users', txt(u, 'name')); });
    }

    // ---- VLANs and LAGGs first, so assigned interfaces can refer to them
    const vlanOf = {};
    const vl = sec('vlans');
    kids(vl, 'vlan').forEach(function (v) {
      const name = txt(v, 'vlanif'), parent = txt(v, 'if'), tag = txt(v, 'tag');
      if (!name) return;
      vlanOf[name] = { parent: parent, tag: tag, descr: txt(v, 'descr') };
      const p = touch(name);
      p.kind = 'svi'; p.mode = 'vlan'; p.tagged = tag;
      if (txt(v, 'descr')) p.description = txt(v, 'descr');
      NP.addNote(p, 'on ' + parent);
      if (parent && !/^lagg\d/.test(parent)) touch(parent);
      NP.addVlan(dev, tag, txt(v, 'descr'));
    });
    const lg = sec('laggs');
    kids(lg, 'lagg').forEach(function (l) {
      const name = txt(l, 'laggif');
      if (!name) return;
      const p = touch(name);
      p.kind = 'lag';
      if (txt(l, 'descr')) p.description = txt(l, 'descr');
      if (txt(l, 'proto')) NP.addNote(p, txt(l, 'proto'));
      txt(l, 'members').split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (mb) { touch(mb).lag = name; });
    });
    Object.keys(vlanOf).forEach(function (n) { if (/^lagg\d/.test(vlanOf[n].parent)) { const p = touch(vlanOf[n].parent); p.kind = 'lag'; } });

    // ---- assigned interfaces (wan, lan, opt1 ...)
    const gwIface = {};
    const gws = sec('gateways');
    let gwDefault = '';
    const gwByName = {};
    kids(gws, 'gateway_item').forEach(function (g) {
      gwIface[txt(g, 'interface')] = txt(g, 'gateway');
      gwByName[txt(g, 'name')] = g;
      if (kid(g, 'defaultgw') || txt(g, 'name') === txt(gws, 'defaultgw4')) {
        gwDefault = txt(g, 'gateway') + ' (' + txt(g, 'name') + ')';
        NP.addRoute(dev, { dest: '0.0.0.0/0', via: txt(g, 'gateway'), iface: txt(g, 'interface'), name: txt(g, 'name'), note: 'default gateway' });
      }
    });
    if (gwDefault) dev.gateway = gwDefault;
    kids(sec('staticroutes'), 'route').forEach(function (r) {
      const g = gwByName[txt(r, 'gateway')];
      NP.addRoute(dev, { dest: txt(r, 'network'), via: g ? txt(g, 'gateway') : '', iface: g ? txt(g, 'interface') : '',
        name: [txt(r, 'gateway'), txt(r, 'descr')].filter(Boolean).join(': '), note: kid(r, 'disabled') ? 'disabled' : '' });
    });
    const ifs = sec('interfaces');
    (ifs ? ifs.kids : []).forEach(function (n) {
      const os = txt(n, 'if');
      if (!os) return;
      const p = NP.findPort(dev, os) || touch(os);
      const on = isOn(n, 'enable');
      p.adminUp = on;
      p.description = txt(n, 'descr') || n.tag.toUpperCase();
      const ip = txt(n, 'ipaddr');
      if (/^\d/.test(ip)) p.ip = ip + (txt(n, 'subnet') ? '/' + txt(n, 'subnet') : '');
      else if (ip) p.ip = ip;                                   // dhcp, pppoe ...
      if (p.kind === 'physical' || p.kind === 'lag') p.mode = p.ip ? 'routed' : p.mode;
      NP.addNote(p, 'assigned as ' + n.tag);
      if (n.tag === 'wan' || gwIface[n.tag] || txt(n, 'gateway')) NP.addNote(p, 'role wan');
      if (kid(n, 'blockpriv')) NP.addNote(p, 'blocks private nets');
      if (n.tag === 'lan' && /^\d/.test(ip) && on) { dev.mgmtIp = p.ip + ' (' + p.description + ')'; dev.mgmtIpFixed = true; }
    });
    // members of a LAGG carry no settings of their own
    dev.ports.forEach(function (p) { if (p.lag && p.kind === 'physical') p.mode = ''; });

    // ---- services
    const sl = sec('syslog');
    if (sl && (isOn(sl, 'enable') || txt(sl, 'remoteserver'))) {
      ['remoteserver', 'remoteserver2', 'remoteserver3'].forEach(function (k) { if (txt(sl, k)) addUnique(dev.syslog, txt(sl, k)); });
    }
    const sn = sec('snmpd');
    if (sn) {
      dev.snmp.location = txt(sn, 'syslocation'); dev.snmp.contact = txt(sn, 'syscontact');
      if (isOn(sn, 'enable') && txt(sn, 'rocommunity')) addUnique(dev.snmp.versions, 'v2c');
    }
    const dh = sec('dhcpd');
    (dh ? dh.kids : []).forEach(function (n) { if (isOn(n, 'enable')) NP.addOther(dev, 'DHCP server on', n.tag); });
    if (kid(doc, 'hasync') && txt(kid(doc, 'hasync'), 'synchronizetoip')) dev.other.HA = 'config sync to ' + txt(kid(doc, 'hasync'), 'synchronizetoip');
    dev.stp.enabled = dev.stp.enabled || 'n/a (firewall)';

    // ---- everything else: section names and sizes only, never contents
    doc.kids.forEach(function (n) {
      if (used[n.tag] || !n.kids.length) return;
      const count = (function walk(x) { return x.kids.reduce(function (s, k) { return s + 1 + walk(k); }, 0); })(n);
      NP.miss('<' + n.tag + '>', 'section', count);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
