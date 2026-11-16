/* Fortinet FortiSwitchOS (standalone CLI: "show", plus a few get/diagnose commands).
 * Same config/edit/set syntax as FortiGate, so it reuses that tree reader. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;
  const F = NP.fortiTree;
  const one = F.one;
  const on = function (v) { return /^(enable|enabled)$/.test(v); };

  function parseConfig(text, dev) {
    const t = F.tree(text);
    const each = function (name, fn) { F.find(t, name).forEach(function (b) { b.entries.forEach(function (e) { fn(e, b); }); }); };
    const touch = function (n) { const p = NP.port(dev, n); if (p.adminUp === null) p.adminUp = true; return p; };

    F.find(t, 'system global').forEach(function (b) {
      if (one(b, 'hostname')) dev.hostname = one(b, 'hostname');
      if (one(b, 'timezone')) dev.other['Time zone'] = one(b, 'timezone');
      if (one(b, 'switch-mgmt-mode')) dev.other['Management mode'] = one(b, 'switch-mgmt-mode');
    });
    F.find(t, 'system dns').forEach(function (b) {
      ['primary', 'secondary'].forEach(function (k) { if (one(b, k) && one(b, k) !== '0.0.0.0') addUnique(dev.dns, one(b, k)); });
      if (one(b, 'domain')) dev.domain = one(b, 'domain');
    });
    F.find(t, 'system ntp').forEach(function (b) {
      if (one(b, 'ntpsync')) dev.other['NTP sync'] = one(b, 'ntpsync');
      F.find(b, 'ntpserver').forEach(function (n) { n.entries.forEach(function (e) { addUnique(dev.ntp, one(e, 'server')); }); });
    });
    ['log syslogd setting', 'log syslogd2 setting', 'log syslogd3 setting'].forEach(function (n) {
      F.find(t, n).forEach(function (b) { if (one(b, 'status') === 'enable') addUnique(dev.syslog, one(b, 'server')); });
    });
    F.find(t, 'system snmp sysinfo').forEach(function (b) {
      dev.snmp.location = one(b, 'location') || dev.snmp.location;
      dev.snmp.contact = one(b, 'contact-info') || dev.snmp.contact;
    });
    if (F.find(t, 'system snmp community').some(function (b) { return b.entries.length; })) addUnique(dev.snmp.versions, 'v2c');
    if (F.find(t, 'system snmp user').some(function (b) { return b.entries.length; })) addUnique(dev.snmp.versions, 'v3');
    each('router static', function (e) {
      F.staticRoute(dev, e);
      const dst = e.set.dst ? e.set.dst.join(' ') : '0.0.0.0 0.0.0.0';
      if (/^0\.0\.0\.0[ \/]0(\.0\.0\.0)?$/.test(dst) && one(e, 'gateway') && !dev.gateway) dev.gateway = one(e, 'gateway');
    });
    each('system admin', function (e) { NP.addOther(dev, 'Admin users', e.name); });

    // ---- spanning tree (FortiSwitch is always MSTP)
    dev.stp.mode = 'mstp';
    dev.stp.enabled = dev.stp.enabled || 'yes (default)';
    F.find(t, 'switch stp settings').forEach(function (b) {
      if (one(b, 'status')) dev.stp.enabled = on(one(b, 'status')) ? 'yes' : 'no';
      if (one(b, 'name')) addUnique(dev.stp.notes, 'MST region ' + one(b, 'name'));
      if (one(b, 'revision')) addUnique(dev.stp.notes, 'MST revision ' + one(b, 'revision'));
    });
    each('switch stp instance', function (e) {
      if (one(e, 'priority')) addUnique(dev.stp.priority, 'MST ' + e.name + ': ' + one(e, 'priority'));
      if (e.set['vlan-range']) addUnique(dev.stp.notes, 'MST ' + e.name + ' = VLAN ' + e.set['vlan-range'].join(','));
    });
    F.find(t, 'switch lldp settings').forEach(function (b) { if (one(b, 'status')) dev.other.LLDP = one(b, 'status'); });

    // ---- VLANs
    each('switch vlan', function (e) {
      NP.addVlan(dev, e.name, one(e, 'description'));
      if (on(one(e, 'igmp-snooping'))) {
        dev.multicast.igmpSnooping = 'enabled (per VLAN)';
        addUnique(dev.multicast.notes, 'snooping on VLAN ' + e.name);
      }
      if (on(one(e, 'dhcp-snooping'))) NP.addOther(dev, 'DHCP snooping', 'VLAN ' + e.name);
    });
    if (!dev.multicast.igmpSnooping) dev.multicast.igmpSnooping = 'disabled (default)';

    // ---- ports
    each('switch physical-port', function (e) {
      const p = touch(e.name);
      if (one(e, 'description')) p.description = one(e, 'description');
      if (one(e, 'status') === 'down') p.adminUp = false;
      if (one(e, 'poe-status')) p.poeAdmin = on(one(e, 'poe-status')) ? 'enabled' : 'disabled';
      if (one(e, 'speed') && one(e, 'speed') !== 'auto') NP.addNote(p, 'speed ' + one(e, 'speed'));
      if (one(e, 'lldp-profile')) NP.addNote(p, 'lldp ' + one(e, 'lldp-profile'));
    });
    each('switch trunk', function (e) {
      const tr = touch(e.name);
      tr.kind = 'lag';
      if (one(e, 'description')) tr.description = one(e, 'description');
      if (one(e, 'mode')) NP.addNote(tr, one(e, 'mode'));
      (e.set.members || []).forEach(function (mbr) { touch(mbr).lag = e.name; });
    });
    each('switch interface', function (e) {
      const p = touch(e.name);
      if (e.name === 'internal') { p.kind = 'svi'; if (!p.description) p.description = 'CPU / in-band management'; return; }
      if (one(e, 'description') && !p.description) p.description = one(e, 'description');
      const native = one(e, 'native-vlan') || '1';
      const allowed = e.set['allowed-vlans'] ? NP.parseVlanList(e.set['allowed-vlans'].join(',')) : [];
      const tagged = allowed.filter(function (v) { return String(v) !== native; });
      if (!p.lag) {
        p.untagged = native;
        p.tagged = NP.normVlans(NP.compressVlans(tagged));
        p.mode = tagged.length ? 'trunk' : 'access';
        if (e.set['untagged-vlans']) NP.addNote(p, 'also untagged: ' + e.set['untagged-vlans'].join(','));
      }
      if (one(e, 'stp-state') === 'disabled') NP.addFlag(p, 'stp', 'stp off');
      if (one(e, 'edge-port')) NP.addFlag(p, 'stp', on(one(e, 'edge-port')) ? 'edge' : 'edge off');
      if (on(one(e, 'stp-bpdu-guard'))) NP.addFlag(p, 'stp', 'bpduguard');
      if (on(one(e, 'stp-root-guard'))) NP.addFlag(p, 'stp', 'rootguard');
      if (on(one(e, 'stp-loop-protection'))) NP.addFlag(p, 'stp', 'loopguard');
      if (on(one(e, 'auto-discovery-fortilink'))) NP.addNote(p, 'FortiLink auto-discovery');
      if (one(e, 'security-groups') || one(e, 'port-security')) NP.addNote(p, '802.1X');
      if (on(one(e, 'dhcp-snooping')) || one(e, 'dhcp-snooping') === 'trusted') NP.addNote(p, 'dhcp-snooping trust');
    });

    // ---- L3 interfaces: mgmt, internal, VLAN interfaces
    each('system interface', function (e) {
      const p = touch(e.name);
      if (e.name === 'mgmt') p.kind = 'mgmt';
      else if (e.name === 'internal' || one(e, 'vlanid')) p.kind = 'svi';
      if (one(e, 'status') === 'down') p.adminUp = false;
      if (e.set.ip && e.set.ip[0] && e.set.ip[0] !== '0.0.0.0') p.ip = NP.cidr(e.set.ip[0], e.set.ip[1]);
      else if (one(e, 'mode') && one(e, 'mode') !== 'static') p.ip = one(e, 'mode');
      if (one(e, 'vlanid')) { p.tagged = one(e, 'vlanid'); p.mode = 'vlan'; }
      if (one(e, 'description') && !p.description) p.description = one(e, 'description');
      if (e.set.allowaccess && e.set.allowaccess.length) NP.addNote(p, 'access ' + e.set.allowaccess.join('/'));
    });
    F.report(t);
  }

  function parseShow(text, dev) {
    let m;
    if ((m = text.match(/^Version:\s*(\S+) v([\d.]+)/m))) { dev.model = m[1]; dev.version = m[2]; }
    if ((m = text.match(/^Serial-Number:\s*(\S+)/m))) dev.serial = m[1];
    if ((m = text.match(/^Hostname:\s*(\S+)/m))) dev.hostname = m[1];
    if ((m = text.match(/^#config-version=([^-]+)-([\d.]+)-/m))) { dev.model = dev.model || m[1]; dev.version = dev.version || m[2]; }

    const lines = text.split(/\r?\n/);
    // diagnose switch physical-ports summary
    if (/Portname\s+Status\s+Tpid\s+Vlan\s+Duplex\s+Speed/.test(text)) {
      lines.forEach(function (ln) {
        const x = ln.match(/^\s*(\S+)\s+(up|down)\s+[0-9a-f]{4}\s+(\d+)\s+(full|half)\s+(\S+)/i);
        if (!x) return;
        const p = NP.port(dev, x[1]);
        if (x[1] === 'internal') p.kind = 'svi';
        if (p.adminUp === null) p.adminUp = true;
        p.link = x[2].toLowerCase();
        if (p.link === 'up') { p.duplex = NP.fmtDuplex(x[4]); p.speed = NP.fmtSpeed(x[5].replace(/M$/i, '')); }
        if (!p.mode && p.kind === 'physical' && !p.lag) { p.untagged = x[3]; p.mode = 'access'; }
      });
    }
    // get switch poe inline
    if (/^\s*(Portname|Port|Interface)\s+Status\s+.*Power/im.test(text)) {
      lines.forEach(function (ln) {
        const x = ln.match(/^\s*(port\d+)\s+(Enabled|Disabled)\s+(.*?)\s+([\d.]+)\s+([\d.]+)\s+(\S+)(?:\s+(\d))?/i);
        if (!x) return;
        const p = NP.port(dev, x[1]);
        p.poeAdmin = x[2].toLowerCase();
        p.poeStatus = /deliver/i.test(x[3]) ? 'delivering' : (x[3] || '').toLowerCase();
        const w = parseFloat(x[5]);
        p.poeWatts = /deliver/i.test(x[3]) && w > 0 ? String(w) : '';
        p.poeClass = /deliver/i.test(x[3]) && x[7] ? x[7] : '';
      });
    }
    // get switch lldp neighbors-summary
    if (/Portname\s+Status\s+Device-name/.test(text)) {
      lines.forEach(function (ln) {
        const t = ln.trim().split(/\s+/);
        if (t.length < 7 || !/^(Up|Down)$/i.test(t[1]) || t[2] === '-') return;
        const i = t.findIndex(function (x, k) { return k > 2 && /^\d+$/.test(x); });
        if (i < 0) return;
        const p = NP.port(dev, t[0]);
        p.neighbor = t.slice(2, i).join(' ');
        p.neighborPort = t.slice(i + 3).join(' ');
      });
    }
  }

  NP.registerVendor('fortiswitch', 'Fortinet FortiSwitch', function (text, dev) {
    NP.sections(text).forEach(function (s) {
      if (/^\s*config (switch|system) /m.test(s.text)) parseConfig(s.text, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
