/* Parser for the "industry standard CLI" family:
 * Cisco IOS / IOS-XE, Cisco NX-OS, Arista EOS, Dell OS10, Aruba AOS-CX. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;
  const IP = /^(\d+\.\d+\.\d+\.\d+|[0-9a-fA-F]*:[0-9a-fA-F:]+)$/;

  function parse(text, dev, fl) {
    NP.sections(text).forEach(function (s) {
      if (/^(interface|hostname|switchname|vlan) \S/m.test(s.text)) parseConfig(s.text, dev, fl);
      parseShow(s.text, dev, fl);
    });
    // Ports that exist in the config but not in the status table are placeholders
    // (e.g. uplink-module slots with no module fitted).
    if (dev.statusLoaded) {
      dev.ports.forEach(function (p) { if (p.kind === 'physical' && !p.link) p.link = 'not present'; });
    }
  }

  // ================================================================ config
  function parseConfig(text, dev, fl) {
    const stp = dev.stp, mc = dev.multicast;
    const cxNoShut = fl === 'aoscx' && /^\s+no shutdown\s*$/m.test(text);
    let ctx = null;
    let stpSeen = false;

    function finish() {
      if (ctx && ctx.type === 'if') finishIf(ctx.p, ctx.c);
      ctx = null;
    }

    function finishIf(p, c) {
      const l2 = p.kind === 'physical' || p.kind === 'lag';
      let defUp = true;
      if (fl === 'aoscx' && cxNoShut && p.kind === 'physical') defUp = false;
      if (fl === 'nxos' && p.kind === 'svi') defUp = false;
      p.adminUp = c.shutdown === true ? false : c.shutdown === false ? true : defUp;
      if (c.ip) p.ip = c.ip;
      if (c.lag) p.lag = c.lag;
      if (c.voice) p.voiceVlan = c.voice;
      if (!l2) return;
      // LAG members with no VLAN settings of their own inherit from the LAG: leave blank
      if (c.lag && !c.mode && !c.access && !c.native && c.allowed === null) { p.mode = ''; p.untagged = ''; p.tagged = ''; return; }
      let mode = c.mode;
      if (c.sw === false || (c.ip && c.sw !== true && !mode)) mode = 'routed';
      if (!mode) mode = 'access';
      p.mode = mode;
      if (mode === 'routed') { p.untagged = ''; p.tagged = ''; }
      else if (/trunk/.test(mode)) {
        if (fl === 'os10') {
          p.untagged = c.access || '1';
          p.tagged = NP.normVlans(c.allowed || '');
        } else {
          p.untagged = c.native || '1';
          p.tagged = c.allowed === null ? (fl === 'aoscx' ? '' : 'all') : NP.normVlans(c.allowed);
        }
      } else {
        p.untagged = c.access || '1';
        p.tagged = '';
      }
    }

    function comment(l) {
      let m;
      if ((m = l.match(/^!\s*Version ArubaOS-CX (\S+)/))) dev.version = dev.version || m[1];
      else if ((m = l.match(/^! Version (10\.\S+)/))) dev.version = dev.version || m[1];
      else if ((m = l.match(/^! device: (\S+) \(([^,]+), EOS-([^)]+)\)/))) {
        dev.model = dev.model || m[2]; dev.version = dev.version || m[3];
      }
    }

    function global(l) {
      let m;
      if ((m = l.match(/^(?:hostname|switchname) (\S+)/))) { dev.hostname = NP.unquote(m[1]); return; }
      if ((m = l.match(/^interface (.+)$/))) {
        const name = m[1].trim();
        if (/^range /i.test(name)) return;
        ctx = { type: 'if', p: NP.port(dev, name),
          c: { sw: null, mode: '', access: '', native: '', allowed: null, voice: '', shutdown: null, ip: '', lag: '' } };
        return;
      }
      if ((m = l.match(/^vlan ([\d,\-\s]+)$/))) {
        const ids = NP.parseVlanList(m[1]);
        ids.forEach(function (id) { NP.addVlan(dev, id); });
        ctx = { type: 'vlan', ids: ids };
        return;
      }
      if ((m = l.match(/^ip (?:domain[- ]name|dns domain-name) (?:vrf \S+ )?(\S+)/))) { dev.domain = m[1]; return; }
      if ((m = l.match(/^ip (?:name-server|dns server-address) (.+)/))) {
        m[1].split(/\s+/).forEach(function (t) { if (IP.test(t)) addUnique(dev.dns, t); });
        return;
      }
      if ((m = l.match(/^(ntp|sntp) (server|peer) (.+)/))) {
        const t = m[3].split(/\s+/);
        let i = 0;
        if (t[0] === 'vrf') i = 2;
        if (t[i]) addUnique(dev.ntp, t[i] + (m[2] === 'peer' ? ' (peer)' : '') + (/\bprefer\b/.test(m[3]) ? ' (prefer)' : ''));
        return;
      }
      if ((m = l.match(/^logging (?:host |server )?(\d+\.\d+\.\d+\.\d+|[0-9a-fA-F]*:[0-9a-fA-F:]+)\b/)) ||
          (m = l.match(/^logging (?:host|server) (\S+)/))) { addUnique(dev.syslog, m[1]); return; }
      if ((m = l.match(/^snmp-server location (.+)/))) { dev.snmp.location = NP.unquote(m[1]); return; }
      if ((m = l.match(/^snmp-server contact (.+)/))) { dev.snmp.contact = NP.unquote(m[1]); return; }
      if (/^snmp-server community /.test(l)) { addUnique(dev.snmp.versions, 'v2c'); return; }
      if (/^snmp-server (group|user) .*\bv3\b/.test(l) || /^snmpv3 /.test(l)) { addUnique(dev.snmp.versions, 'v3'); return; }
      if ((m = l.match(/^snmp-server host (\S+)/))) { NP.addOther(dev, 'SNMP trap hosts', m[1]); return; }

      // ---- spanning tree
      if (/^(no )?spanning-tree\b/.test(l)) {
        stpSeen = true;
        if (l === 'spanning-tree') { stp.enabled = 'yes'; return; }
        if (l === 'no spanning-tree') { stp.enabled = 'no'; return; }
        if ((m = l.match(/^spanning-tree mode (\S+)/))) { stp.mode = m[1]; return; }
        if ((m = l.match(/^spanning-tree (?:(vlan|mst) (\S+) |rstp |)priority (\d+)/))) {
          let pr = +m[3];
          if (fl === 'aoscx' && pr <= 15) pr = pr * 4096;
          addUnique(stp.priority, (m[1] ? m[1].toUpperCase() + ' ' + m[2] + ': ' : '') + pr);
          return;
        }
        if ((m = l.match(/^spanning-tree (vlan|mst) (\S+) root (primary|secondary)/))) {
          addUnique(stp.priority, m[1].toUpperCase() + ' ' + m[2] + ': root ' + m[3]); return;
        }
        if ((m = l.match(/^no spanning-tree vlan (\S+)/))) { addUnique(stp.notes, 'disabled on VLAN ' + m[1]); return; }
        if (/^spanning-tree mst configuration/.test(l)) { ctx = { type: 'mst' }; return; }
        if (/^spanning-tree extend system-id/.test(l)) return;
        addUnique(stp.notes, l.replace(/^spanning-tree /, ''));
        return;
      }

      // ---- multicast
      if (l === 'no ip igmp snooping') { mc.igmpSnooping = 'disabled'; return; }
      if (l === 'ip igmp snooping') { mc.igmpSnooping = 'enabled'; return; }
      if (/^ip igmp snooping querier/.test(l)) { mc.querier = 'enabled'; return; }
      if ((m = l.match(/^ip igmp snooping vlan (\S+) querier/))) { addUnique(mc.notes, 'querier on VLAN ' + m[1]); return; }
      if ((m = l.match(/^no ip igmp snooping vlan (\S+)$/))) { addUnique(mc.notes, 'snooping off on VLAN ' + m[1]); return; }
      if (/^ip multicast-routing/.test(l)) { mc.routing = 'enabled'; return; }
      if ((m = l.match(/^ip pim rp-address (\S+)/))) { addUnique(mc.notes, 'PIM RP ' + m[1]); return; }

      // ---- routing / gateway
      if ((m = l.match(/^ip default-gateway (\S+)/))) { dev.gateway = m[1]; return; }
      if ((m = l.match(/^ip route (?:vrf \S+ )?0\.0\.0\.0(?:\/0| 0\.0\.0\.0) (?:[A-Za-z]\S* )?(\d+\.\d+\.\d+\.\d+)/))) {
        if (!dev.gateway) dev.gateway = m[1];
        return;
      }
      if (l === 'ip routing') { dev.other['IP routing'] = 'enabled'; return; }
      if ((m = l.match(/^router (\S+)(?: (\S+))?/))) { NP.addOther(dev, 'Routing protocols', m[1] + (m[2] ? ' ' + m[2] : '')); return; }
      if ((m = l.match(/^vrf (?:definition|context) (\S+)/))) { NP.addOther(dev, 'VRFs', m[1]); return; }

      // ---- everything else worth a line in the summary
      if ((m = l.match(/^version (\S+)/))) { dev.version = dev.version || m[1]; return; }
      if ((m = l.match(/^switch (\d+) provision (\S+)/))) {
        const mdl = m[2].toUpperCase();
        NP.addOther(dev, 'Stack members', m[1] + ': ' + mdl);
        if (!dev.model) dev.model = mdl;
        return;
      }
      if (/^line vty/.test(l)) { ctx = { type: 'line' }; return; }
      if (/^aaa new-model/.test(l)) { NP.addOther(dev, 'AAA', 'new-model'); return; }
      if (/^radius[- ]server/.test(l) || /^aaa group server radius/.test(l)) { NP.addOther(dev, 'AAA', 'RADIUS'); return; }
      if (/^tacacs[- ]server/.test(l) || /^aaa group server tacacs/.test(l)) { NP.addOther(dev, 'AAA', 'TACACS+'); return; }
      if ((m = l.match(/^username (\S+)/))) { NP.addOther(dev, 'Local users', m[1]); return; }
      if ((m = l.match(/^vtp mode (\S+)/))) { NP.addOther(dev, 'VTP', 'mode ' + m[1]); return; }
      if ((m = l.match(/^vtp domain (\S+)/))) { NP.addOther(dev, 'VTP', 'domain ' + m[1]); return; }
      if ((m = l.match(/^(no )?lldp run/))) { dev.other.LLDP = m[1] ? 'disabled' : 'enabled'; return; }
      if ((m = l.match(/^(no )?cdp run/))) { dev.other.CDP = m[1] ? 'disabled' : 'enabled'; return; }
      if ((m = l.match(/^ip ssh version (\d)/))) { dev.other.SSH = 'version ' + m[1]; return; }
      if ((m = l.match(/^(no )?ip http (secure-)?server/))) {
        dev.other[m[2] ? 'HTTPS server' : 'HTTP server'] = m[1] ? 'disabled' : 'enabled'; return;
      }
      if ((m = l.match(/^feature (\S+)/))) { NP.addOther(dev, 'Features', m[1]); return; }
      if ((m = l.match(/^clock timezone (.+)/))) { dev.other['Time zone'] = m[1]; return; }
      if (l === 'ip dhcp snooping') { NP.addOther(dev, 'DHCP snooping', 'enabled'); return; }
      if ((m = l.match(/^ip dhcp snooping vlan (\S+)/))) { NP.addOther(dev, 'DHCP snooping', 'VLAN ' + m[1]); return; }
      if ((m = l.match(/^ip dhcp pool (\S+)/))) { NP.addOther(dev, 'DHCP pools', m[1]); return; }
      if ((m = l.match(/^errdisable recovery cause (\S+)/))) { NP.addOther(dev, 'Errdisable recovery', m[1]); return; }
    }

    function sub(l) {
      let m;
      if (ctx.type === 'vlan') {
        if ((m = l.match(/^name (.+)/))) NP.addVlan(dev, ctx.ids[0], m[1]);
        else if (/^ip igmp snooping( enable)?$/.test(l)) addUnique(mc.notes, 'snooping on VLAN ' + ctx.ids.join(','));
        return;
      }
      if (ctx.type === 'line') {
        if ((m = l.match(/^transport input (.+)/))) NP.addOther(dev, 'VTY access', m[1]);
        return;
      }
      if (ctx.type === 'mst') {
        if ((m = l.match(/^name (\S+)/))) addUnique(stp.notes, 'MST region ' + m[1]);
        else if ((m = l.match(/^revision (\d+)/))) addUnique(stp.notes, 'MST revision ' + m[1]);
        else if ((m = l.match(/^instance (\d+) vlan (.+)/))) addUnique(stp.notes, 'MST ' + m[1] + ' = VLAN ' + m[2]);
        return;
      }
      const p = ctx.p, c = ctx.c;
      if ((m = l.match(/^description (.+)/))) { p.description = NP.unquote(m[1]); return; }
      if (l === 'shutdown') { c.shutdown = true; return; }
      if (l === 'no shutdown') { c.shutdown = false; return; }
      if (l === 'no switchport' || l === 'routing') { c.sw = false; return; }
      if (l === 'switchport' || l === 'no routing') { c.sw = true; return; }
      if ((m = l.match(/^switchport mode (.+)/))) { c.mode = m[1]; return; }
      if ((m = l.match(/^switchport access vlan (\d+)/))) { c.access = m[1]; return; }
      if ((m = l.match(/^switchport trunk native vlan (\d+)/))) { c.native = m[1]; return; }
      if ((m = l.match(/^switchport trunk allowed vlan (add )?(.+)/))) {
        c.allowed = m[1] && c.allowed ? c.allowed + ',' + m[2] : m[2];
        return;
      }
      if ((m = l.match(/^switchport voice vlan (\S+)/))) { c.voice = m[1]; return; }
      // AOS-CX
      if ((m = l.match(/^vlan access (\d+)/))) { c.mode = 'access'; c.access = m[1]; return; }
      if ((m = l.match(/^vlan trunk native (\d+)/))) { c.mode = 'trunk'; c.native = m[1]; return; }
      if ((m = l.match(/^vlan trunk allowed (.+)/))) { c.mode = 'trunk'; c.allowed = m[1]; return; }
      if ((m = l.match(/^lag (\d+)/))) { c.lag = 'lag' + m[1]; return; }
      if ((m = l.match(/^channel-group (\d+)/))) { c.lag = 'Po' + m[1]; return; }
      if ((m = l.match(/^ip(?:v4)? (?:address|static) (\S+)(?: (\d+\.\d+\.\d+\.\d+))?(.*)/))) {
        if (!/secondary/.test(m[3]) && !c.ip) c.ip = NP.cidr(m[1], m[2]);
        return;
      }
      if ((m = l.match(/^spanning-tree (.+)/))) { NP.addFlag(p, 'stp', stpFlag(m[1])); return; }
      if ((m = l.match(/^power inline (\S+)/))) { p.poeAdmin = m[1] === 'never' ? 'disabled' : m[1]; return; }
      if (/^(no power-over-ethernet|poe disabled|no power inline)/.test(l)) { p.poeAdmin = 'disabled'; return; }
      if ((m = l.match(/^speed (\S+)/))) { if (!p.speed && m[1] !== 'auto') p.speed = NP.fmtSpeed(m[1]); return; }
      if ((m = l.match(/^duplex (\S+)/))) { if (!p.duplex) p.duplex = NP.fmtDuplex(m[1]); return; }
      if ((m = l.match(/^ip pim (\S+)/))) { addUnique(mc.notes, 'PIM ' + m[1] + ' on ' + p.short); return; }
      if (/^switchport port-security/.test(l)) { NP.addNote(p, 'port-security'); return; }
      if (/^(authentication port-control|dot1x |mab\b|access-session )/.test(l)) { NP.addNote(p, '802.1X/MAB'); return; }
      if (/^storm-control/.test(l)) { NP.addNote(p, 'storm-control'); return; }
      if ((m = l.match(/^ip helper-address (\S+)/))) { NP.addNote(p, 'helper ' + m[1]); return; }
      if (/^ip dhcp snooping trust/.test(l)) { NP.addNote(p, 'dhcp-snooping trust'); return; }
      if ((m = l.match(/^(vpc|mlag) (\S+)/))) { NP.addNote(p, m[1] + ' ' + m[2]); return; }
      if ((m = l.match(/^mtu (\d+)/))) { NP.addNote(p, 'mtu ' + m[1]); return; }
      if ((m = l.match(/^ip access-group (\S+) (in|out)/))) { NP.addNote(p, 'acl ' + m[1] + ' ' + m[2]); return; }
      if ((m = l.match(/^vrf (?:forwarding|member|attach) (\S+)/))) {
        NP.addNote(p, 'vrf ' + m[1]);
        if (/^mgmt/i.test(m[1])) p.kind = 'mgmt';       // Catalyst Gi0/0 out-of-band port
        return;
      }
      if (/^no lldp (transmit|receive)/.test(l)) { NP.addNote(p, 'lldp off'); return; }
      if (/^no cdp enable/.test(l)) { NP.addNote(p, 'cdp off'); return; }
    }

    text.split(/\r?\n/).forEach(function (raw) {
      const line = raw.replace(/\s+$/, '');
      const l = line.trim();
      if (!l) return;
      const indented = /^\s/.test(line);
      if (l[0] === '!') { comment(l); if (!indented) finish(); return; }
      if (!indented) { finish(); global(l); }
      else if (ctx) sub(l);
    });
    finish();

    // platform defaults, only where the config was silent
    if (!stp.mode) {
      if (fl === 'aoscx') {
        if (stp.enabled === 'yes') stp.mode = 'mstp (default)';
        else if (!stp.enabled) stp.enabled = 'no (default)';
      } else {
        stp.mode = { ios: 'pvst (default)', nxos: 'rapid-pvst (default)', eos: 'mstp (default)', os10: 'rpvst (default)' }[fl] || '';
      }
    }
    if (!mc.igmpSnooping && (fl === 'ios' || fl === 'nxos' || fl === 'eos')) mc.igmpSnooping = 'enabled (default)';
    void stpSeen;
  }

  function stpFlag(s) {
    if (/^(portfast|port type edge|port-type admin-edge)/.test(s)) {
      if (/disable/.test(s)) return 'portfast off';
      return 'edge' + (/trunk/.test(s) ? ' (trunk)' : '');
    }
    if (/^(bpduguard|bpdu-guard)/.test(s)) return /disable/.test(s) ? 'bpduguard off' : 'bpduguard';
    if (/^(bpdufilter|bpdu-filter)/.test(s)) return /disable/.test(s) ? 'bpdufilter off' : 'bpdufilter';
    if (/^(guard root|root-guard)/.test(s)) return 'rootguard';
    if (/^(guard loop|loop-guard)/.test(s)) return 'loopguard';
    let m;
    if ((m = s.match(/^(?:vlan \S+ |mst \S+ )?cost (\d+)/))) return 'cost ' + m[1];
    if ((m = s.match(/^(?:vlan \S+ |mst \S+ )?port-priority (\d+)/))) return 'prio ' + m[1];
    return s;
  }

  // ========================================================= show commands
  const STATUS = /^(connected|notconnect|notconnec|disabled|err-disabled|errdisabled|inactive|monitoring|suspended|suspnd|sfpAbsent|xcvrAbsent|noOperMem|down|up|linkFlap|channelDo|faulty)$/i;

  function applyStatus(p, st) {
    st = st.toLowerCase();
    if (st === 'connected' || st === 'up') { p.link = 'up'; if (p.adminUp === null) p.adminUp = true; }
    else if (st === 'disabled') { p.link = 'down'; p.adminUp = false; }
    else if (/^err/.test(st)) { p.link = 'err-disabled'; }
    else { p.link = 'down'; if (p.adminUp === null) p.adminUp = true; if (!/^(notconnec|down)/.test(st)) NP.addNote(p, st); }
  }

  function parseShow(text, dev, fl) {
    let m;

    // ---- show interfaces status (IOS, NX-OS, EOS)
    NP.eachTable(text, function (h) { return /^Port\s+Name\s+Status\s+Vlan/.test(h); }, function (ln, header) {
      const iName = header.indexOf('Name'), iStatus = header.indexOf('Status');
      const port = ln.trim().split(/\s+/)[0];
      if (!/\d/.test(port)) return;
      let name = ln.slice(iName, iStatus).trim();
      let rest = ln.slice(iStatus).trim().split(/\s+/);
      if (!STATUS.test(rest[0] || '')) {            // columns shifted: fall back to token search
        const t = ln.trim().split(/\s+/);
        const i = t.findIndex(function (x, k) { return k > 0 && STATUS.test(x); });
        if (i < 0) return;
        name = t.slice(1, i).join(' ');
        rest = t.slice(i);
      }
      const p = NP.port(dev, port);
      dev.statusLoaded = true;
      if (name && !p.description) p.description = name;
      applyStatus(p, rest[0]);
      let k = 1;
      let vlan = rest[k++] || '';
      if (vlan === 'in') vlan = 'in ' + (rest[k++] || '');
      if (/^\d+$/.test(vlan)) { if (!p.mode) { p.mode = 'access'; p.untagged = vlan; } }
      else if (vlan === 'trunk') { if (!p.mode) p.mode = 'trunk'; }
      else if (vlan === 'routed') { if (!p.mode) p.mode = 'routed'; }
      else if (/^in /.test(vlan) && !p.lag) p.lag = vlan.slice(3);
      const up = p.link === 'up';
      p.duplex = up ? NP.fmtDuplex(rest[k]) : p.duplex; k++;
      p.speed = up ? NP.fmtSpeed(rest[k]) : p.speed; k++;
      const media = rest.slice(k).join(' ');
      if (media && media !== '--') p.media = media;
    });

    // ---- show ip interface brief
    NP.eachTable(text, function (h) { return /^Interface\s+IP-Address\s+OK\?/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 5 || !/\d/.test(t[0])) return;
      const p = NP.port(dev, t[0]);
      if (!p.ip && IP.test(t[1])) p.ip = t[1];
      if (/administratively down/.test(ln)) { p.adminUp = false; p.link = 'down'; }
      else { if (p.adminUp === null) p.adminUp = true; p.link = t[t.length - 1] === 'up' ? 'up' : 'down'; }
    });

    // ---- show interfaces (one status line per interface)
    text.split(/\r?\n/).forEach(function (ln) {
      const x = ln.match(/^([A-Za-z][A-Za-z\-]*\d[\d\/.:]*) is (administratively down|up|down)\b(?:.*line protocol is (up|down))?/);
      if (!x) return;
      const p = NP.port(dev, x[1]);
      if (x[2] === 'administratively down') { p.adminUp = false; p.link = 'down'; }
      else { if (p.adminUp === null) p.adminUp = true; p.link = (x[3] || x[2]) === 'up' ? 'up' : 'down'; }
    });

    // ---- show power inline
    NP.eachTable(text, function (h) { return /^Interface\s+Admin\s+Oper\s+Power/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 6 || !/^[A-Za-z]+\d/.test(t[0]) || !/^[\d.]+$/.test(t[3])) return;
      const p = NP.port(dev, t[0]);
      p.poeAdmin = t[1] === 'off' ? 'disabled' : t[1];
      p.poeStatus = t[2];
      p.poeWatts = t[2] === 'on' ? t[3] : '';
      const cls = t[t.length - 2];
      p.poeClass = /^\d/.test(cls) ? cls : '';
    });

    // ---- CDP detail: one block per "Device ID:"
    let cdp = null;
    text.split(/\r?\n/).forEach(function (ln) {
      let x;
      if ((x = ln.match(/^Device ID:\s*(\S+)/))) cdp = { name: x[1].replace(/\(.*\)$/, ''), ip: '', platform: '' };
      else if (!cdp) return;
      else if ((x = ln.match(/^\s+IP(?:v4)? [Aa]ddress: (\S+)/))) cdp.ip = cdp.ip || x[1];
      else if ((x = ln.match(/^Platform: (?:cisco )?([^,]+),/i))) cdp.platform = x[1].trim();
      else if ((x = ln.match(/^Interface: (\S+?),\s+Port ID \(outgoing port\): (.+)$/))) {
        const p = NP.port(dev, x[1]);
        p.neighbor = cdp.name; p.neighborPort = x[2].trim();
        p.neighborInfo = [cdp.platform, cdp.ip].filter(Boolean).join(', ');
      }
    });

    // ---- LLDP detail: one block per "Local Intf:" (applied after CDP, so LLDP wins where both exist)
    const MAC = /^([0-9a-f]{4}\.){2}[0-9a-f]{4}$|^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$/i;
    let lldp = null;
    const flush = function () {
      if (!lldp) return;
      const b = lldp; lldp = null;
      const p = NP.port(dev, b.local);
      const info = [p.neighborInfo && p.neighbor && b.name && p.neighbor.split('.')[0] === b.name.split('.')[0]
        ? p.neighborInfo.split(', ')[0] : '', b.ip].filter(Boolean);
      p.neighbor = b.name || b.chassis || p.neighbor;
      // some vendors send a MAC as the port id and the real port name in the description
      p.neighborPort = MAC.test(b.port) && b.desc ? b.desc : b.port;
      p.neighborInfo = Array.from(new Set(info)).join(', ');
    };
    text.split(/\r?\n/).forEach(function (ln) {
      let x;
      if ((x = ln.match(/^Local (?:Intf|Port id): (\S+)/))) { flush(); lldp = { local: x[1], name: '', port: '', desc: '', chassis: '', ip: '' }; }
      else if (!lldp) return;
      else if ((x = ln.match(/^Chassis id: (\S+)/))) lldp.chassis = x[1];
      else if ((x = ln.match(/^Port id: (.+)$/))) lldp.port = x[1].trim();
      else if ((x = ln.match(/^Port Description: (.+)$/))) lldp.desc = x[1].trim();
      else if ((x = ln.match(/^System Name: (.+)$/))) lldp.name = x[1].trim();
      else if ((x = ln.match(/^\s+IP(?:v4)?: (\S+)/))) lldp.ip = lldp.ip || x[1];
      else if (/^Total entries displayed/.test(ln)) flush();
    });
    flush();

    // ---- show cdp neighbors (brief; long device names wrap onto their own line)
    let pending = '';
    NP.eachTable(text, function (h) { return /^Device ID\s+Local Intrfce/.test(h); }, function (ln, header) {
      const iLocal = header.indexOf('Local'), iHold = header.search(/Hold/), iPort = header.indexOf('Port ID');
      if (/^Total /.test(ln)) return false;
      if (!/^\s/.test(ln) && ln.trim().split(/\s+/).length === 1) { pending = ln.trim(); return; }
      const devId = /^\s/.test(ln) && pending ? pending : ln.slice(0, iLocal).trim();
      pending = '';
      const loc = ln.slice(iLocal, iHold).trim().replace(/\s+/g, '');
      const rp = ln.slice(iPort).trim().replace(/\s+/g, '');
      if (!devId || !/\d/.test(loc)) return;
      const p = NP.port(dev, loc);
      if (!p.neighbor) { p.neighbor = devId.replace(/\(.*\)$/, ''); p.neighborPort = rp; }
    });

    // ---- show lldp neighbors (IOS / NX-OS brief)
    NP.eachTable(text, function (h) { return /^Device ID\s+Local Intf\s+Hold-?time/i.test(h); }, function (ln, header) {
      const iLocal = header.indexOf('Local');
      if (/^Total /.test(ln)) return false;
      const devId = ln.slice(0, iLocal).trim();
      const rest = ln.slice(iLocal).trim().split(/\s+/);
      if (!devId || rest.length < 3 || !/\d/.test(rest[0])) return;
      const p = NP.port(dev, rest[0]);
      if (!p.neighbor) { p.neighbor = devId; p.neighborPort = rest[rest.length - 1]; }
    });

    // ---- show lldp neighbors (EOS)
    NP.eachTable(text, function (h) { return /^Port\s+Neighbor Device ID\s+Neighbor Port ID/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 3 || !/\d/.test(t[0])) return;
      const p = NP.port(dev, t[0]); p.neighbor = t[1]; p.neighborPort = t[2];
    });

    // ---- show lldp neighbor-info (AOS-CX)
    NP.eachTable(text, function (h) { return /^LOCAL-PORT\s+CHASSIS-ID\s+PORT-ID/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 5 || !/^\d/.test(t[0])) return;
      const p = NP.port(dev, t[0]); p.neighbor = t[t.length - 1]; p.neighborPort = t[2];
    });

    // ---- show interface brief (AOS-CX)
    NP.eachTable(text, function (h) { return /^Port\s+Native\s+Mode\s+Type\s+Enabled\s+Status/.test(h); }, function (ln, header) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 6 || !/^(\d+\/\d+\/\d+|lag\d+|vlan\d+)$/i.test(t[0])) return;
      const iSpeed = header.indexOf('Speed'), iDesc = header.indexOf('Description');
      const p = NP.port(dev, t[0]);
      p.adminUp = t[4] === 'yes';
      p.link = t[5] === 'up' ? 'up' : 'down';
      if (!p.mode && /^(access|trunk|routed)$/.test(t[2])) { p.mode = t[2]; if (/^\d+$/.test(t[1])) p.untagged = t[1]; }
      if (t[3] !== '--') p.media = t[3];
      if (iSpeed > 0 && iDesc > iSpeed) {
        if (p.link === 'up') p.speed = NP.fmtSpeed(ln.slice(iSpeed, iDesc).trim());
        const d = ln.slice(iDesc).trim();
        if (d && d !== '--' && !p.description) p.description = d;
      }
    });

    // ---- show vlan [brief]
    NP.eachTable(text, function (h) { return /^VLAN\s+Name\s+Status\s+Ports/.test(h); }, function (ln) {
      const x = ln.match(/^(\d+)\s+(\S+)\s+(active|act\/\S+|sus\S*)/);
      if (x) NP.addVlan(dev, x[1], x[2]);
    });

    // ---- show spanning-tree
    const states = {};
    NP.eachTable(text, function (h) { return /^Interface\s+Role\s+Sts\s+Cost/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 4 || !/\d/.test(t[0])) return;
      (states[t[0]] = states[t[0]] || []).push(t[1] + ' ' + t[2]);
    });
    Object.keys(states).forEach(function (name) {
      NP.port(dev, name).stpState = Array.from(new Set(states[name])).join(' / ');
    });
    if (/This bridge is the root/.test(text)) addUnique(dev.stp.notes, 'this switch is root for at least one instance');

    // ---- show version
    // (not in CDP/LLDP output: that quotes the neighbors' software versions)
    if (/uptime is|Cisco IOS|NX-?OS|Arista|ArubaOS-CX/.test(text) && !/^(Device ID:|Local Intf:|Local Port id:)/m.test(text)) {
      if ((m = text.match(/Cisco IOS.*?Version ([^,\s]+)/)) || (m = text.match(/^\s*(?:NXOS|system):\s+version (\S+)/m)) ||
          (m = text.match(/^Software image version:\s*(\S+)/m)) || (m = text.match(/^Version\s+:\s*(\S+)/m))) dev.version = m[1];
      if ((m = text.match(/^Model [Nn]umber\s*:\s*(\S+)/m)) || (m = text.match(/^\s*cisco (\S+(?: \S+)?) .*(?:processor|Chassis)/mi)) ||
          (m = text.match(/^Arista (\S+)/m)) || (m = text.match(/^Platform\s+:\s*(\S+)/m))) dev.model = m[1];
      if ((m = text.match(/^System [Ss]erial [Nn]umber\s*:\s*(\S+)/m)) || (m = text.match(/^\s*Processor [Bb]oard ID (\S+)/m)) ||
          (m = text.match(/^Serial number:\s*(\S+)/m)) || (m = text.match(/^Chassis Serial Nbr\s*:\s*(\S+)/m))) dev.serial = m[1];
      if (!dev.hostname && (m = text.match(/^(\S+) uptime is/m))) dev.hostname = m[1];
    }
    void fl;
  }

  NP.registerVendor('ios', 'Cisco IOS / IOS-XE', function (t, d) { parse(t, d, 'ios'); });
  NP.registerVendor('nxos', 'Cisco NX-OS', function (t, d) { parse(t, d, 'nxos'); });
  NP.registerVendor('eos', 'Arista EOS', function (t, d) { parse(t, d, 'eos'); });
  NP.registerVendor('os10', 'Dell OS10', function (t, d) { parse(t, d, 'os10'); });
  NP.registerVendor('aoscx', 'Aruba AOS-CX', function (t, d) { parse(t, d, 'aoscx'); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
