/* MikroTik RouterOS ("/export" output). */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  function kv(s) {
    const out = {};
    const re = /([\w\-.]+)=("((?:[^"\\]|\\.)*)"|\S*)/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
    return out;
  }
  const yes = function (v) { return v === 'yes' || v === 'true'; };

  NP.registerVendor('mikrotik', 'MikroTik RouterOS', function (text, dev) {
    let m;
    if ((m = text.match(/by RouterOS (\S+)/))) dev.version = m[1];
    if ((m = text.match(/^# model = (.+)$/m))) dev.model = m[1].trim();
    if ((m = text.match(/^# serial number = (\S+)/m))) dev.serial = m[1];

    // join "\" continuation lines
    const lines = [];
    let buf = '';
    text.split(/\r?\n/).forEach(function (raw) {
      const l = raw.replace(/\s+$/, '');
      const part = buf ? l.replace(/^\s+/, '') : l;
      if (/\\$/.test(part)) { buf += part.slice(0, -1); return; }
      lines.push(buf + part);
      buf = '';
    });

    const rename = {};                 // default-name -> current name
    const pvid = {}, tagged = {}, untaggedExtra = {};
    const bridges = {};
    let path = '';
    const touch = function (n) { const p = NP.port(dev, n); if (p.adminUp === null) p.adminUp = true; return p; };

    lines.forEach(function (line) {
      let l = line.trim();
      if (!l || l[0] === '#') return;
      if (l[0] === '/') {
        const sp = l.search(/ (add|set|remove)\b/);
        if (sp < 0) { path = l; return; }
        path = l.slice(0, sp); l = l.slice(sp + 1);
      }
      const a = kv(l);
      const find = l.match(/\[\s*find\s+([^\]]*)\]/);
      const f = find ? kv(find[1]) : {};

      if (path === '/interface ethernet') {
        const def = f['default-name'] || a['default-name'];
        const name = a.name || def;
        if (!name) return;
        if (def && a.name) rename[def] = a.name;
        const p = touch(name);
        if (a.comment) p.description = a.comment;
        if (yes(a.disabled)) p.adminUp = false;
        if (a['poe-out']) p.poeAdmin = a['poe-out'] === 'off' ? 'disabled' : a['poe-out'];
        if (a.speed) NP.addNote(p, 'speed ' + a.speed);
        if (a['auto-negotiation'] === 'no') NP.addNote(p, 'autoneg off');
        if (def && a.name && def !== a.name) NP.addNote(p, 'was ' + def);
      } else if (path === '/interface bridge') {
        if (!/^add\b/.test(l) || !a.name) return;
        bridges[a.name] = a;
        const p = touch(a.name);
        p.kind = 'lag'; p.mode = 'bridge';
        if (a.comment) p.description = a.comment;
        dev.stp.enabled = a['protocol-mode'] === 'none' ? 'no' : 'yes';
        dev.stp.mode = a['protocol-mode'] || 'rstp (default)';
        if (a.priority) addUnique(dev.stp.priority, a.name + ': ' + (/^0x/i.test(a.priority) ? parseInt(a.priority, 16) : a.priority));
        addUnique(dev.stp.notes, a.name + ': VLAN filtering ' + (yes(a['vlan-filtering']) ? 'on' : 'off'));
        if (yes(a['igmp-snooping'])) { dev.multicast.igmpSnooping = 'enabled'; addUnique(dev.multicast.notes, 'snooping on ' + a.name); }
        if (yes(a['multicast-querier'])) dev.multicast.querier = 'enabled';
      } else if (path === '/interface bonding') {
        if (!a.name) return;
        const p = touch(a.name);
        p.kind = 'lag';
        if (a.comment) p.description = a.comment;
        if (a.mode) NP.addNote(p, a.mode);
        (a.slaves || '').split(',').filter(Boolean).forEach(function (s) { touch(s).lag = a.name; });
      } else if (path === '/interface vlan') {
        if (!a.name) return;
        const p = touch(a.name);
        p.kind = 'svi'; p.mode = 'vlan'; p.tagged = a['vlan-id'] || '';
        if (a.interface) NP.addNote(p, 'on ' + a.interface);
        if (a.comment) p.description = a.comment;
        if (yes(a.disabled)) p.adminUp = false;
        if (a['vlan-id']) NP.addVlan(dev, a['vlan-id'], a.name);
      } else if (path === '/interface bridge port') {
        if (!a.interface) return;
        const p = touch(a.interface);
        pvid[p.key] = a.pvid || '1';
        if (a.comment && !p.description) p.description = a.comment;
        if (a.edge === 'yes') NP.addFlag(p, 'stp', 'edge');
        if (yes(a['bpdu-guard'])) NP.addFlag(p, 'stp', 'bpduguard');
        if (a['restricted-role'] === 'yes') NP.addFlag(p, 'stp', 'rootguard');
        if (a['frame-types'] && a['frame-types'] !== 'admit-all') NP.addNote(p, a['frame-types']);
        if (a.bridge) NP.addNote(p, 'bridge ' + a.bridge);
        if (yes(a.disabled)) NP.addNote(p, 'bridge port disabled');
      } else if (path === '/interface bridge vlan') {
        const ids = NP.parseVlanList(a['vlan-ids'] || '');
        ids.forEach(function (id) { NP.addVlan(dev, id); });
        (a.tagged || '').split(',').filter(Boolean).forEach(function (n) {
          const p = touch(n);
          (tagged[p.key] = tagged[p.key] || []).push.apply(tagged[p.key], ids);
        });
        (a.untagged || '').split(',').filter(Boolean).forEach(function (n) {
          const p = touch(n);
          (untaggedExtra[p.key] = untaggedExtra[p.key] || []).push.apply(untaggedExtra[p.key], ids);
        });
      } else if (path === '/ip address') {
        if (!a.interface || !a.address) return;
        const p = touch(a.interface);
        if (!p.ip) p.ip = a.address;
        if (a.comment && !p.description) p.description = a.comment;
      } else if (path === '/ip dhcp-client') {
        if (a.interface) { const p = touch(a.interface); if (!p.ip) p.ip = 'dhcp'; }
      } else if (path === '/ip dns') {
        (a.servers || '').split(',').filter(Boolean).forEach(function (s) { addUnique(dev.dns, s); });
      } else if (path === '/ip route') {
        if (a.gateway && (!a['dst-address'] || a['dst-address'] === '0.0.0.0/0') && !dev.gateway) dev.gateway = a.gateway;
      } else if (path === '/system identity') {
        if (a.name) dev.hostname = a.name;
      } else if (path === '/system ntp client') {
        if (a.enabled) dev.other['NTP client'] = yes(a.enabled) ? 'enabled' : 'disabled';
        ['primary-ntp', 'secondary-ntp'].forEach(function (k) { if (a[k] && a[k] !== '0.0.0.0') addUnique(dev.ntp, a[k]); });
        (a.servers || a['server-dns-names'] || '').split(',').filter(Boolean).forEach(function (s) { addUnique(dev.ntp, s); });
      } else if (path === '/system ntp client servers') {
        if (a.address) addUnique(dev.ntp, a.address);
      } else if (path === '/system clock') {
        if (a['time-zone-name']) dev.other['Time zone'] = a['time-zone-name'];
      } else if (path === '/system logging action') {
        if (a.remote && a.remote !== '0.0.0.0') addUnique(dev.syslog, a.remote);
      } else if (path === '/snmp') {
        if (yes(a.enabled)) addUnique(dev.snmp.versions, 'enabled');
        if (a.location) dev.snmp.location = a.location;
        if (a.contact) dev.snmp.contact = a.contact;
      } else if (path === '/routing igmp-proxy' || path === '/routing pimsm instance') {
        dev.multicast.routing = path.split(' ').pop() + ' configured';
      } else if (path === '/user') {
        if (a.name) NP.addOther(dev, 'Local users', a.name);
      } else if (path === '/ip service') {
        const svc = (l.match(/^set (\S+)/) || [])[1];
        if (svc && yes(a.disabled)) NP.addOther(dev, 'Disabled services', svc);
      } else if (path === '/interface list member') {
        if (a.interface && a.list) NP.addNote(touch(a.interface), 'list ' + a.list);
      } else if (path) NP.miss(path, 'section');
    });

    dev.ports.forEach(function (p) {
      if (pvid[p.key] === undefined && !tagged[p.key]) return;
      if (p.kind === 'svi') return;
      const t = tagged[p.key] || [];
      if (pvid[p.key] !== undefined) {
        p.untagged = pvid[p.key];
        p.tagged = NP.compressVlans(t);
        p.mode = t.length ? 'trunk' : 'access';
      } else if (p.mode === 'bridge') p.tagged = NP.compressVlans(t);
    });
    if (!dev.multicast.igmpSnooping && Object.keys(bridges).length) dev.multicast.igmpSnooping = 'disabled (default)';
    void rename; void untaggedExtra;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
