/* Dell Networking OS6 (N1500/N2000/N3000/N4000 series, formerly PowerConnect).
 * Cisco-like commands, but blocks are closed with "exit" rather than shown by indentation,
 * interface names are short (Gi1/0/1), and there is a third port mode, "general". */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  function parseConfig(text, dev) {
    let ctx = null, m, stpMode = '', stpOff = false;
    const touch = function (n) { const p = NP.port(dev, n); if (p.adminUp === null) p.adminUp = true; return p; };

    function finish() {
      if (!ctx || ctx.type !== 'if') { ctx = null; return; }
      const p = ctx.p, c = ctx.c;
      p.adminUp = !c.shutdown;
      if (c.ip) p.ip = c.ip;
      if (c.lag) p.lag = c.lag;
      if (c.voice) p.voiceVlan = c.voice;
      if (p.kind === 'physical' || p.kind === 'lag') {
        const own = c.mode || c.access || c.native || c.allowed !== null || c.pvid || c.genTagged.length || c.genUntagged.length;
        if (c.lag && !own) { p.mode = ''; p.untagged = ''; p.tagged = ''; }
        else if (c.mode === 'trunk') {
          p.mode = 'trunk'; p.untagged = c.native || '1';
          p.tagged = c.allowed === null ? 'all' : NP.normVlans(NP.compressVlans(NP.parseVlanList(c.allowed).filter(function (v) { return String(v) !== p.untagged; })));
        } else if (c.mode === 'general') {
          p.mode = 'general'; p.untagged = c.pvid || '1';
          p.tagged = NP.compressVlans(c.genTagged);
          const extra = c.genUntagged.filter(function (v) { return String(v) !== p.untagged; });
          if (extra.length) NP.addNote(p, 'also untagged: ' + NP.compressVlans(extra));
        } else { p.mode = 'access'; p.untagged = c.access || '1'; p.tagged = ''; }
      }
      ctx = null;
    }

    text.split(/\r?\n/).forEach(function (raw) {
      const l = raw.trim();
      if (!l) return;
      if (l[0] === '!') {
        if ((m = l.match(/^!System Description "(?:Dell (?:Networking|EMC Networking)? ?)?([^,"]+),\s*([\d.]+)/))) { dev.model = dev.model || m[1].trim(); dev.version = dev.version || m[2]; }
        else if ((m = l.match(/^!System Software Version (\S+)/))) dev.version = dev.version || m[1];
        return;
      }
      if (l === 'exit') { finish(); return; }
      if (l === 'configure' || l === 'stack' || l === 'vlan database') { finish(); if (l === 'stack') ctx = { type: 'stack' }; return; }

      if ((m = l.match(/^interface (.+)$/))) {
        finish();
        const name = m[1].trim();
        if (/^range /i.test(name)) { ctx = { type: 'skip' }; return; }
        const p = touch(/^out-of-band$/i.test(name) ? 'out-of-band' : name);
        if (/^out-of-band$/i.test(name)) p.kind = 'mgmt';
        ctx = { type: 'if', p: p, c: { mode: '', access: '', native: '', allowed: null, pvid: '', genTagged: [], genUntagged: [], voice: '', shutdown: false, ip: '', lag: '' } };
        return;
      }
      if ((m = l.match(/^vlan ([\d,\-]+)$/))) {
        finish();
        const ids = NP.parseVlanList(m[1]);
        ids.forEach(function (id) { NP.addVlan(dev, id); });
        ctx = { type: 'vlan', ids: ids };
        return;
      }

      if (ctx && ctx.type === 'vlan') {
        if ((m = l.match(/^name (.+)/))) NP.addVlan(dev, ctx.ids[0], m[1]);
        else if (/^ip igmp snooping/.test(l)) addUnique(dev.multicast.notes, 'snooping on VLAN ' + ctx.ids.join(','));
        else NP.miss(l, 'vlan');
        return;
      }
      if (ctx && ctx.type === 'stack') {
        if ((m = l.match(/^member (\d+) \d+\s*(?:!\s*(.+))?$/))) NP.addOther(dev, 'Stack members', m[1] + (m[2] ? ': ' + m[2].trim() : ''));
        return;
      }
      if (ctx && ctx.type === 'skip') return;
      if (ctx && ctx.type === 'if') {
        const p = ctx.p, c = ctx.c;
        if ((m = l.match(/^description (.+)/))) p.description = NP.unquote(m[1]);
        else if (l === 'shutdown') c.shutdown = true;
        else if ((m = l.match(/^switchport mode (\S+)/))) c.mode = m[1];
        else if ((m = l.match(/^switchport access vlan (\d+)/))) c.access = m[1];
        else if ((m = l.match(/^switchport trunk native vlan (\d+)/))) c.native = m[1];
        else if ((m = l.match(/^switchport trunk allowed vlan (add |remove )?(.+)/))) {
          if (m[1] === 'remove ') {
            const gone = NP.parseVlanList(m[2]);
            c.allowed = NP.compressVlans(NP.parseVlanList(c.allowed === null ? '1-4093' : c.allowed).filter(function (v) { return !gone.includes(v); }));
          } else c.allowed = m[1] && c.allowed ? c.allowed + ',' + m[2] : m[2];
        }
        else if ((m = l.match(/^switchport general pvid (\d+)/))) c.pvid = m[1];
        else if ((m = l.match(/^switchport general allowed vlan add (\S+)( tagged| untagged)?/))) {
          const ids = NP.parseVlanList(m[1]);
          if (m[2] === ' tagged') c.genTagged = c.genTagged.concat(ids); else c.genUntagged = c.genUntagged.concat(ids);
        }
        else if (/^switchport general /.test(l)) NP.addNote(p, l.replace(/^switchport general /, ''));
        else if ((m = l.match(/^(?:switchport )?voice vlan (\d+)/))) c.voice = m[1];
        else if ((m = l.match(/^channel-group (\d+)/))) c.lag = 'Po' + m[1];
        else if ((m = l.match(/^ip address (\S+)(?: (\d+\.\d+\.\d+\.\d+))?/))) { if (!c.ip) c.ip = /^\d/.test(m[1]) ? NP.cidr(m[1], m[2]) : m[1]; }
        else if (/^spanning-tree portfast/.test(l)) NP.addFlag(p, 'stp', 'edge');
        else if (/^spanning-tree guard root/.test(l)) NP.addFlag(p, 'stp', 'rootguard');
        else if (/^spanning-tree guard loop/.test(l) || /^spanning-tree loopguard/.test(l)) NP.addFlag(p, 'stp', 'loopguard');
        else if (/^spanning-tree bpdu-protection/.test(l) || /^spanning-tree bpduguard/.test(l)) NP.addFlag(p, 'stp', 'bpduguard');
        else if (/^spanning-tree disable/.test(l)) NP.addFlag(p, 'stp', 'stp off');
        else if ((m = l.match(/^spanning-tree (cost \d+|port-priority \d+)/))) NP.addFlag(p, 'stp', m[1].replace('port-priority', 'prio'));
        else if ((m = l.match(/^power inline (\S+)/))) p.poeAdmin = m[1] === 'never' ? 'disabled' : m[1];
        else if ((m = l.match(/^speed (\S+)/))) { if (!p.speed && m[1] !== 'auto') p.speed = NP.fmtSpeed(m[1]); }
        else if (/^(dot1x|authentication) /.test(l)) NP.addNote(p, '802.1X');
        else if (/^switchport port-security/.test(l)) NP.addNote(p, 'port-security');
        else if (/^storm-control/.test(l)) NP.addNote(p, 'storm-control');
        else if (/^ip dhcp snooping trust/.test(l)) NP.addNote(p, 'dhcp-snooping trust');
        else if (/^no lldp (transmit|receive)/.test(l)) NP.addNote(p, 'lldp off');
        else if ((m = l.match(/^mtu (\d+)/))) NP.addNote(p, 'mtu ' + m[1]);
        else if ((m = l.match(/^ip helper-address (\S+)/))) NP.addNote(p, 'helper ' + m[1]);
        else NP.miss(l, 'interface');
        return;
      }

      // ---- global
      NP._lastMiss = null;
      if ((m = l.match(/^hostname (.+)/))) dev.hostname = NP.unquote(m[1]);
      else if ((m = l.match(/^ip default-gateway (\S+)/))) dev.gateway = m[1];
      else if ((m = l.match(/^ip route 0\.0\.0\.0 0\.0\.0\.0 (\d+\.\d+\.\d+\.\d+)/))) dev.gateway = dev.gateway || m[1];
      else if ((m = l.match(/^ip domain-name (.+)/))) dev.domain = NP.unquote(m[1]);
      else if ((m = l.match(/^ip name-server (.+)/))) m[1].split(/\s+/).forEach(function (a) { addUnique(dev.dns, NP.unquote(a)); });
      else if ((m = l.match(/^sntp server (\S+)/))) addUnique(dev.ntp, NP.unquote(m[1]));
      else if ((m = l.match(/^logging (?:host )?("?[\w.\-:]+"?)$/)) && /[.:]/.test(m[1])) { addUnique(dev.syslog, NP.unquote(m[1])); ctx = { type: 'skip' }; }
      else if ((m = l.match(/^snmp-server location (.+)/))) dev.snmp.location = NP.unquote(m[1]);
      else if ((m = l.match(/^snmp-server contact (.+)/))) dev.snmp.contact = NP.unquote(m[1]);
      else if (/^snmp-server community /.test(l)) addUnique(dev.snmp.versions, 'v2c');
      else if (/^snmp-server (user|group) /.test(l)) addUnique(dev.snmp.versions, 'v3');
      else if ((m = l.match(/^spanning-tree mode (\S+)/))) stpMode = m[1];
      else if (l === 'no spanning-tree') stpOff = true;
      else if ((m = l.match(/^spanning-tree (?:vlan (\S+) |mst (\S+) )?priority (\d+)/))) addUnique(dev.stp.priority, (m[1] ? 'VLAN ' + m[1] + ': ' : m[2] ? 'MST ' + m[2] + ': ' : '') + m[3]);
      else if (/^spanning-tree portfast (bpdufilter )?default/.test(l)) addUnique(dev.stp.notes, 'portfast default');
      else if (/^spanning-tree bpdu-protection/.test(l)) addUnique(dev.stp.notes, 'bpdu-protection (global, edge ports)');
      else if (/^spanning-tree /.test(l)) addUnique(dev.stp.notes, l.slice(14));
      else if (l === 'ip igmp snooping') dev.multicast.igmpSnooping = 'enabled';
      else if (l === 'no ip igmp snooping') dev.multicast.igmpSnooping = 'disabled';
      else if (/^ip igmp snooping querier/.test(l)) dev.multicast.querier = 'enabled';
      else if (/^ip multicast(-routing)?$/.test(l)) dev.multicast.routing = 'enabled';
      else if ((m = l.match(/^username "?([^"\s]+)"?/))) NP.addOther(dev, 'Local users', m[1]);
      else if ((m = l.match(/^(radius|tacacs)[- ]server host (?:auth |acct )?"?([^"\s]+)/))) NP.addOther(dev, 'AAA', m[1].toUpperCase() + ' ' + m[2]);
      else if ((m = l.match(/^(no )?ip telnet server/))) dev.other.Telnet = /disable/.test(l) || m[1] ? 'disabled' : 'enabled';
      else if (/^ip ssh server/.test(l)) dev.other.SSH = 'enabled';
      else if ((m = l.match(/^(no )?ip http (secure-)?server/))) dev.other[m[2] ? 'HTTPS server' : 'HTTP server'] = m[1] ? 'disabled' : 'enabled';
      else if (l === 'ip routing') dev.other['IP routing'] = 'enabled';
      else if (l === 'ip dhcp snooping') NP.addOther(dev, 'DHCP snooping', 'enabled');
      else if ((m = l.match(/^ip dhcp snooping vlan (\S+)/))) NP.addOther(dev, 'DHCP snooping', 'VLAN ' + m[1]);
      else if ((m = l.match(/^clock timezone (.+)/))) dev.other['Time zone'] = m[1];
      else if (/^voice vlan$/.test(l)) dev.other['Voice VLAN'] = 'enabled';
      else if ((m = l.match(/^slot (\S+) \d+\s*(?:!\s*(.+))?$/))) { if (m[2] && !dev.model) dev.model = m[2].replace(/^Dell (EMC )?Networking /, '').trim(); }
      else if (/^(sntp |lldp |line |enable |aaa |application |crypto |banner |no |ip access-list|mac access-list|class-map|policy-map|iscsi |router )/.test(l)) {
        if (/^(line |ip access-list|mac access-list|class-map|policy-map|router |aaa |crypto )/.test(l)) ctx = { type: 'skip' };
      }
      else NP.miss(l, 'global');
    });
    finish();
    dev.stp.enabled = stpOff ? 'no' : (dev.stp.enabled || 'yes (default)');
    dev.stp.mode = stpMode || dev.stp.mode || 'rstp (default)';
  }

  function parseShow(text, dev) {
    let m;
    const lines = text.split(/\r?\n/);
    const PORT = /^(Gi|Te|Tw|Fo|Hu)\d+\/\d+\/\d+$/;
    // show interfaces status (physical rows, then a port-channel section)
    if (/^Port\s+Description\s+Duplex\s+Speed\s+Neg/m.test(text)) {
      lines.forEach(function (ln) {
        let x = ln.match(/^(\S+)\s+(.*?)\s*\b(Full|Half|N\/A)\s+(\S+)\s+(\S+)\s+(Up|Down)\b(?:\s+\S+(?:\s+\S+)?)?(?:\s+([ATG])\s+(\S.*))?$/);
        if (x && PORT.test(x[1])) {
          const p = NP.port(dev, x[1]);
          dev.statusLoaded = true;
          if (p.adminUp === null) p.adminUp = true;
          p.link = x[6].toLowerCase();
          if (p.link === 'up') { p.duplex = NP.fmtDuplex(x[3]); p.speed = NP.fmtSpeed(x[4]); }
          if (x[2] && !p.description) p.description = x[2].trim();
          if (x[7] && !p.mode && !p.lag) {
            p.mode = { A: 'access', T: 'trunk', G: 'general' }[x[7]];
            const nat = x[8].match(/\((\d+)\)/);
            if (x[7] === 'A' && /^\d+$/.test(x[8].trim())) p.untagged = x[8].trim();
            else if (nat) { p.untagged = nat[1]; p.tagged = NP.normVlans(x[8].replace(/\(\d+\),?/, '')); }
          }
          return;
        }
        x = ln.match(/^(Po\d+)\s+(.*?)\s*\b(Up|Down)\b/);
        if (x) {
          const p = NP.port(dev, x[1]);
          if (p.adminUp === null) p.adminUp = true;
          p.link = x[3].toLowerCase();
          if (x[2] && !p.description) p.description = x[2].trim();
        }
      });
    }
    // show power inline
    if (/^Port\s+Powered Device\s+State/m.test(text) || /^Port\s+.*Power\s*\[?m?W/m.test(text)) {
      lines.forEach(function (ln) {
        const x = ln.match(/^(\S+)\s+(.*?)\s*\b(Auto|Never|Off|Static)\s+(\S+)\s+(On|Off|Searching|Delivering\S*|Fault\S*|Disabled|Overload|Short|Test|Requesting\S*)\b\s*(?:Class\s?(\d)|Unknown|N\/A)?\s*(\d+)?/i);
        if (!x || !PORT.test(x[1])) return;
        const p = NP.port(dev, x[1]);
        p.poeAdmin = /^(never|off)$/i.test(x[3]) ? 'disabled' : x[3].toLowerCase();
        p.poeStatus = x[5].toLowerCase();
        const on = /^(on|delivering)/i.test(x[5]);
        p.poeWatts = on && x[7] ? String(Math.round(+x[7] / 100) / 10) : '';
        p.poeClass = on && x[6] ? x[6] : '';
      });
    }
    // show lldp remote-device all
    NP.eachTable(text, function (h) { return /^Interface\s+RemID\s+Chassis ID/.test(h); }, function (ln, header) {
      const iPort = header.indexOf('Port ID'), iSys = header.indexOf('System Name');
      const local = ln.trim().split(/\s+/)[0];
      if (!PORT.test(local) || iSys < 0) return;
      const sys = ln.slice(iSys).trim(), pid = ln.slice(iPort, iSys).trim();
      if (!sys && !pid) return;
      const p = NP.port(dev, local);
      p.neighbor = sys || ln.slice(header.indexOf('Chassis ID'), iPort).trim();
      p.neighborPort = pid;
    });
    // show version
    if ((m = text.match(/^System Model ID\.+\s*(\S+)/m)) || (m = text.match(/^Machine Type\.+\s*(?:Dell (?:EMC )?Networking )?(.+)$/m))) dev.model = m[1].trim();
    if ((m = text.match(/^Serial Number\.+\s*(\S+)/m))) dev.serial = m[1];
    if ((m = text.match(/^unit\s+active\s+backup[^\n]*\n[\s\-]+\n\s*\d+\s+(\S+)/m))) dev.version = m[1];
    if (dev.statusLoaded) dev.ports.forEach(function (p) { if (p.kind === 'physical' && !p.link) p.link = 'not present'; });
  }

  NP.registerVendor('os6', 'Dell OS6 (N-series)', function (text, dev) {
    NP.sections(text).forEach(function (s) {
      if (/^\s*(interface (Gi|Te|Tw|Fo|vlan|port-channel|out-of-band)|hostname |vlan [\d,\-]+\s*$|configure\s*$)/m.test(s.text)) parseConfig(s.text, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
