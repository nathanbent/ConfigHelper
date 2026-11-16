/* Dell Networking OS9 (FTOS: S3000/S4000/S5000/S6000, Z9000, MXL). Cisco-like blocks, but
 * interface names have a space ("TenGigabitEthernet 1/1"), VLAN membership lives under
 * "interface Vlan N" as tagged / untagged port lists, and ports are shut down unless told otherwise. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;
  const TYPES = 'GigabitEthernet|TenGigabitEthernet|twentyFiveGigE|fortyGigE|fiftyGigE|hundredGigE|Port-channel|ManagementEthernet|Vlan|Loopback';

  // "1/1-1/4,1/7" or the older "0/1-4,7" -> ["1/1", ... "1/7"]
  function expand(list) {
    const out = [];
    String(list).split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      const r = part.split('-');
      if (r.length !== 2) { out.push(part); return; }
      const a = r[0].match(/^(.*?)(\d+)$/);
      if (!a) return;
      const b = r[1].match(/^(?:(.*?))?(\d+)$/);
      if (!b || (b[1] && b[1] !== a[1]) || +b[2] < +a[2] || +b[2] - +a[2] > 512) { out.push(r[0]); return; }
      for (let i = +a[2]; i <= +b[2]; i++) out.push(a[1] + i);
    });
    return out;
  }
  // "TenGigabitEthernet 1/1-1/4,1/7 Port-channel 10" -> full port names
  function portList(s) {
    const out = [];
    const re = new RegExp('(' + TYPES + ')\\s+([\\d\\/,\\-]+)', 'gi');
    let m;
    while ((m = re.exec(s))) expand(m[2]).forEach(function (n) { out.push(m[1] + ' ' + n); });
    return out;
  }

  function parseConfig(text, dev) {
    const tagged = {}, untag = {};        // port key -> VLAN ids
    const cfg = {};                       // port key -> { l2, hybrid, shut }
    let defaultVlan = 1, ctx = null, m;
    const touch = function (n) {
      const p = NP.port(dev, n);
      if (!cfg[p.key]) cfg[p.key] = { l2: false, hybrid: false };
      return p;
    };

    text.split(/\r?\n/).forEach(function (raw) {
      const l = raw.trim();
      let r;
      if (!l) return;
      if (l[0] === '!') {
        // not the end of a block: OS9 prints a "!" inside an interface, before its LACP lines
        if ((m = l.match(/^! Version (\S+)/))) dev.version = dev.version || m[1];
        return;
      }
      const indented = /^\s/.test(raw);
      if (!indented) {
        ctx = null;
        if ((m = l.match(new RegExp('^interface (' + TYPES + ')\\s+(\\S+)$', 'i')))) {
          const p = touch(m[1] + ' ' + m[2]);
          p.adminUp = true;
          ctx = { type: 'if', p: p, vlan: /^vlan$/i.test(m[1]) ? +m[2] : 0 };
          if (ctx.vlan) NP.addVlan(dev, ctx.vlan);
          return;
        }
        if ((m = l.match(/^protocol spanning-tree (\S+)/))) {
          dev.stp.mode = m[1] === '0' ? 'stp' : m[1];
          dev.stp.enabled = dev.stp.enabled || 'no';             // off until "no disable"
          ctx = { type: 'stp' };
          return;
        }
        if (l === 'protocol lldp') { dev.other.LLDP = 'enabled'; ctx = { type: 'skip' }; return; }
        if ((m = l.match(/^vlt domain (\d+)/))) { dev.other.VLT = 'domain ' + m[1]; ctx = { type: 'vlt' }; return; }
      }

      if (ctx && ctx.type === 'if') {
        const p = ctx.p, c = cfg[p.key];
        if ((m = l.match(/^description (.+)/))) p.description = NP.unquote(m[1]);
        else if (ctx.vlan && (m = l.match(/^name (.+)/))) NP.addVlan(dev, ctx.vlan, NP.unquote(m[1]));
        else if (l === 'shutdown') p.adminUp = false;
        else if (l === 'no shutdown') p.adminUp = true;
        else if (l === 'switchport') c.l2 = true;
        else if (l === 'portmode hybrid') c.hybrid = true;
        else if (l === 'no ip address') { /* default */ }
        else if ((m = l.match(/^ip address (\S+)(?: (\d+\.\d+\.\d+\.\d+))?/))) { if (!p.ip) p.ip = /^\d/.test(m[1]) ? NP.cidr(m[1], m[2]) : m[1]; }
        else if (ctx.vlan && (m = l.match(/^(tagged|untagged) (.+)/))) {
          portList(m[2]).forEach(function (n) {
            const q = touch(n);
            if (m[1] === 'tagged') (tagged[q.key] = tagged[q.key] || []).push(ctx.vlan); else untag[q.key] = ctx.vlan;
          });
        }
        else if ((m = l.match(/^port-channel (\d+) mode (\S+)/))) { p.lag = 'Po' + m[1]; NP.addNote(p, 'LACP ' + m[2]); }
        else if (/^port-channel-protocol /i.test(l)) { /* the member line follows */ }
        else if ((m = l.match(/^channel-member (.+)/))) portList(m[1]).forEach(function (n) { touch(n).lag = p.short; });
        else if ((m = l.match(/^vlt-peer-lag port-channel (\d+)/))) NP.addNote(p, 'VLT peer Po' + m[1]);
        else if ((m = l.match(/^spanning-tree \S+ (.+)/))) {
          if (/edge-port|portfast/.test(m[1])) NP.addFlag(p, 'stp', 'edge');
          if (/bpduguard/.test(m[1])) NP.addFlag(p, 'stp', 'bpduguard');
          if (/rootguard/.test(m[1])) NP.addFlag(p, 'stp', 'rootguard');
          if (/loopguard/.test(m[1])) NP.addFlag(p, 'stp', 'loopguard');
          if (!/edge-port|portfast|bpduguard|rootguard|loopguard/.test(m[1])) NP.addFlag(p, 'stp', m[1]);
        }
        else if (l === 'no spanning-tree') NP.addFlag(p, 'stp', 'stp off');
        else if ((m = l.match(/^mtu (\d+)/))) NP.addNote(p, 'mtu ' + m[1]);
        else if ((m = l.match(/^speed (\S+)/))) { if (m[1] !== 'auto') NP.addNote(p, 'speed ' + m[1]); }
        else if ((m = l.match(/^ip helper-address (\S+)/))) NP.addNote(p, 'helper ' + m[1]);
        else if (/^(dot1x|mac-authentication)\b/.test(l)) NP.addNote(p, '802.1X');
        else if (/^storm-control /.test(l)) NP.addNote(p, 'storm-control');
        else if (/^ip dhcp snooping trust/.test(l)) NP.addNote(p, 'dhcp-snooping trust');
        else if (/^ip igmp snooping|^ip igmp$/.test(l) && ctx.vlan) addUnique(dev.multicast.notes, 'IGMP on VLAN ' + ctx.vlan);
        else if (/^(flowcontrol|negotiation|no negotiation|dcb|protocol lldp|advertise |no advertise|rate-interval|link-bundle)/.test(l)) { /* not shown */ }
        else NP.miss(l, 'interface');
        return;
      }
      if (ctx && ctx.type === 'stp') {
        if (l === 'no disable') dev.stp.enabled = 'yes';
        else if (l === 'disable') dev.stp.enabled = 'no';
        else if ((m = l.match(/^(?:vlan (\S+) |msti (\d+) )?bridge-priority (\d+)/))) addUnique(dev.stp.priority, (m[1] ? 'VLAN ' + m[1] + ': ' : m[2] ? 'MST ' + m[2] + ': ' : '') + m[3]);
        else if ((m = l.match(/^name (\S+)/))) addUnique(dev.stp.notes, 'MST region ' + m[1]);
        else if ((m = l.match(/^revision (\d+)/))) addUnique(dev.stp.notes, 'MST revision ' + m[1]);
        else if ((m = l.match(/^msti (\d+) vlan (\S+)/))) addUnique(dev.stp.notes, 'MST ' + m[1] + ' = VLAN ' + m[2]);
        else NP.miss(l, 'spanning-tree');
        return;
      }
      if (ctx && ctx.type === 'vlt') {
        if ((m = l.match(/^peer-link port-channel (\d+)/))) NP.addNote(touch('Port-channel ' + m[1]), 'VLT peer link');
        return;
      }
      if (ctx && ctx.type === 'skip') return;
      if (indented) { NP.missInner(); return; }
      NP._lastMiss = null;

      // ---- global
      if ((m = l.match(/^hostname (\S+)/))) dev.hostname = NP.unquote(m[1]);
      else if ((m = l.match(/^default vlan-id (\d+)/))) defaultVlan = +m[1];
      else if ((m = l.match(/^stack-unit (\d+) provision (\S+)/))) { NP.addOther(dev, 'Stack members', m[1] + ': ' + m[2]); if (!dev.model) dev.model = m[2]; }
      else if ((m = l.match(/^management route (.+)/)) && (r = NP.parseIpRoute(m[1]))) {
        NP.addRoute(dev, Object.assign(r, { vrf: 'management' }));
        if (NP.isDefaultRoute(r) && r.via) dev.gateway = r.via;      // the gateway the box is managed through
      }
      else if ((m = l.match(/^ip route (.+)/)) && NP.addRoute(dev, NP.parseIpRoute(m[1]))) { /* gateway from the routes, after the walk */ }
      else if ((m = l.match(/^ip domain-name (\S+)/))) dev.domain = m[1];
      else if ((m = l.match(/^ip name-server (.+)/))) m[1].split(/\s+/).forEach(function (a) { addUnique(dev.dns, a); });
      else if ((m = l.match(/^ntp server (\S+)/))) addUnique(dev.ntp, m[1]);
      else if ((m = l.match(/^logging (\d+\.\d+\.\d+\.\d+|[\da-f:]+:[\da-f:]+)/i))) addUnique(dev.syslog, m[1]);
      else if ((m = l.match(/^snmp-server location (.+)/))) dev.snmp.location = NP.unquote(m[1]);
      else if ((m = l.match(/^snmp-server contact (.+)/))) dev.snmp.contact = NP.unquote(m[1]);
      else if (/^snmp-server community /.test(l)) addUnique(dev.snmp.versions, 'v2c');
      else if (/^snmp-server (user|group) /.test(l)) addUnique(dev.snmp.versions, 'v3');
      else if ((m = l.match(/^snmp-server host (\S+)/))) NP.addOther(dev, 'SNMP trap hosts', m[1]);
      else if ((m = l.match(/^username (\S+)/))) NP.addOther(dev, 'Local users', m[1]);
      else if ((m = l.match(/^(radius|tacacs)-server host (\S+)/))) NP.addOther(dev, 'AAA', m[1].toUpperCase() + ' ' + m[2]);
      else if ((m = l.match(/^(no )?ip telnet server enable/))) dev.other.Telnet = m[1] ? 'disabled' : 'enabled';
      else if (/^ip ssh server enable/.test(l)) dev.other.SSH = 'enabled';
      else if (/^ip igmp snooping enable/.test(l)) dev.multicast.igmpSnooping = 'enabled';
      else if (/^ip multicast-routing/.test(l)) dev.multicast.routing = 'enabled';
      else if ((m = l.match(/^clock timezone (.+)/))) dev.other['Time zone'] = m[1];
      else if ((m = l.match(/^router (\S+)/))) NP.addOther(dev, 'Routing protocols', m[1]);
      else if (/^ip dhcp snooping$/.test(l)) NP.addOther(dev, 'DHCP snooping', 'enabled');
      else NP.miss(l, 'global');
    });

    if (!dev.stp.enabled) dev.stp.enabled = 'no';
    if (!dev.multicast.igmpSnooping) dev.multicast.igmpSnooping = 'disabled (default)';
    if (!dev.vlans.some(function (v) { return v.id === defaultVlan; })) NP.addVlan(dev, defaultVlan);

    dev.ports.forEach(function (p) {
      const c = cfg[p.key];
      if (!c || (p.kind !== 'physical' && p.kind !== 'lag')) return;
      const t = tagged[p.key] || [];
      if (p.lag && p.kind === 'physical') { p.mode = ''; p.untagged = ''; p.tagged = ''; return; }
      if (!c.l2 && !t.length && untag[p.key] === undefined) { if (p.ip) p.mode = 'routed'; return; }
      // a switchport sits untagged in the default VLAN until it is tagged somewhere (hybrid ports keep it)
      let u = untag[p.key];
      if (u === undefined && (!t.length || c.hybrid)) u = defaultVlan;
      p.untagged = u === undefined ? '' : String(u);
      p.tagged = NP.compressVlans(t);
      p.mode = t.length ? 'trunk' : 'access';
      if (c.hybrid) NP.addNote(p, 'hybrid');
    });
  }

  function parseShow(text, dev) {
    let m;
    const PORT = /^(Gi|Te|Tf|Fo|Fi|Hu|Ma|Po)\s?\d+(\/\d+)*$/;
    // show interfaces status
    NP.eachTable(text, function (h) { return /^Port\s+Description\s+Status\s+Speed\s+Duplex\s+Vlan/.test(h); }, function (ln) {
      const x = ln.match(/^(\S+ \S+)\s+(.*?)\s*\b(Up|Down)\s+(\d+ [MG]bit|\S+)\s+(Full|Half|Auto)\s+(\S.*?)\s*$/);
      if (!x || !PORT.test(x[1])) return;
      const p = NP.port(dev, x[1]);
      dev.statusLoaded = true;
      if (p.adminUp === null) p.adminUp = true;
      p.link = x[3].toLowerCase();
      if (p.link === 'up') {
        p.duplex = NP.fmtDuplex(x[5]);
        const sp = x[4].match(/^(\d+) ([MG])bit/);
        if (sp) p.speed = NP.fmtSpeed(sp[2] === 'G' ? String(+sp[1] * 1000) : sp[1]);
      }
      if (x[2] && !p.description) p.description = x[2].trim();
      if (!p.mode && !p.lag && p.kind === 'physical' && /^\d+$/.test(x[6])) { p.mode = 'access'; p.untagged = x[6]; }
    });
    // show lldp neighbors
    NP.eachTable(text, function (h) { return /^\s*Loc PortID\s+Rem Host Name\s+Rem Port Id/.test(h); }, function (ln, header) {
      const iHost = header.indexOf('Rem Host Name'), iPort = header.indexOf('Rem Port Id'), iCh = header.indexOf('Rem Chassis Id');
      const local = ln.slice(0, iHost).trim();
      if (!PORT.test(local)) return;
      const host = ln.slice(iHost, iPort).trim(), pid = ln.slice(iPort, iCh < 0 ? undefined : iCh).trim();
      const p = NP.port(dev, local);
      p.neighbor = host && host !== '-' ? host : (iCh < 0 ? '' : ln.slice(iCh).trim());
      p.neighborPort = pid;
    });
    // show version
    if ((m = text.match(/^Dell Application Software Version:\s*(\S+)/m))) dev.version = m[1];
    if ((m = text.match(/^System Type:\s*(\S+)/m))) dev.model = m[1];
    if (dev.statusLoaded) dev.ports.forEach(function (p) { if (p.kind === 'physical' && !p.link) p.link = 'not present'; });
  }

  NP.registerVendor('os9', 'Dell OS9', function (text, dev) {
    const isConfig = new RegExp('^(interface (' + TYPES + ') \\S+|hostname \\S+|protocol spanning-tree )', 'im');
    NP.sections(text).forEach(function (s) {
      if (isConfig.test(s.text)) parseConfig(s.text, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
