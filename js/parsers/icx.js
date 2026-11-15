/* Ruckus / Brocade ICX (FastIron). Like ProCurve, VLAN membership lives under the
 * "vlan N" blocks; interfaces only appear in the config when they have non-default settings,
 * so the port list is also seeded from the "stack unit / module" lines. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;
  const MAC = /^([0-9a-f]{4}\.){2}[0-9a-f]{4}$|^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$/i;

  function range(a, b) {
    const x = a.match(/^(.*?)(\d+)$/), y = b.match(/^(.*?)(\d+)$/);
    if (!x || !y || x[1] !== y[1] || +y[2] < +x[2] || +y[2] - +x[2] > 512) return [a, b];
    const out = [];
    for (let i = +x[2]; i <= +y[2]; i++) out.push(x[1] + i);
    return out;
  }
  // "ethe 1/1/1 to 1/1/4 ethe 1/2/1 lag 1 ve 10 management 1" -> port names
  function portList(s) {
    const t = String(s).trim().split(/\s+/), out = [];
    let kind = 'ethe';
    for (let i = 0; i < t.length; i++) {
      const w = t[i].toLowerCase();
      if (/^(ethe|ethernet|e)$/.test(w)) { kind = 'ethe'; continue; }
      if (w === 'lag') { kind = 'lag'; continue; }
      if (w === 've') { kind = 've'; continue; }
      if (/^(management|mgmt)$/.test(w)) { kind = 'mgmt'; continue; }
      if (w === 'to') continue;
      if (!/^\d/.test(w)) break;
      let list = [w];
      if (t[i + 1] === 'to' && t[i + 2]) { list = range(w, t[i + 2]); i += 2; }
      list.forEach(function (n) { out.push(kind === 'ethe' ? n : kind === 'lag' ? 'lag ' + n : kind + n); });
    }
    return out;
  }
  // names as "show" commands print them: lg1, ve10, mgmt1
  function showName(n) {
    const m = n.match(/^lg(\d+)$/i);
    return m ? 'lag ' + m[1] : n;
  }
  function touch(dev, name) {
    const p = NP.port(dev, name);
    if (/^ve\d+$/i.test(name)) p.kind = 'svi';
    if (p.adminUp === null) p.adminUp = true;
    return p;
  }

  function parseConfig(text, dev) {
    const tagged = {}, untag = {}, dual = {};
    let defaultVlan = 1, ctx = null, m;
    const stpModes = [], mst = {}, routerIf = {};
    // FastIron 10 dropped "router-interface": ve N always belongs to VLAN N. It also keeps a port
    // that is only tagged as an untagged member of the default VLAN (older releases need dual-mode).
    let v10 = /^10\./.test(dev.version || '');

    text.split(/\r?\n/).forEach(function (raw) {
      const l = raw.trim();
      if (!l) return;
      if (l === '!') { ctx = null; return; }
      const indented = /^\s/.test(raw);
      if (!indented) ctx = null;

      if (!indented) {
        if ((m = l.match(/^vlan (\d+)(?: name (.+?))?(?: by port)?$/))) {
          NP.addVlan(dev, m[1], m[2] || '');
          ctx = { type: 'vlan', id: +m[1] };
          return;
        }
        if ((m = l.match(/^interface (.+)$/))) { ctx = { type: 'if', ports: portList(m[1]).map(function (n) { return touch(dev, n); }) }; return; }
        if ((m = l.match(/^lag (\S+) (dynamic|static)(?: id (\d+))?/))) {
          const lag = touch(dev, 'lag ' + (m[3] || m[1]));
          lag.kind = 'lag';
          if (!lag.description) lag.description = m[1];
          NP.addNote(lag, m[2] === 'dynamic' ? 'LACP' : 'static');
          ctx = { type: 'lag', lag: lag };
          return;
        }
        if ((m = l.match(/^stack unit (\d+)/))) { ctx = { type: 'unit', unit: m[1] }; return; }
        if (l === 'ntp') { ctx = { type: 'ntp' }; return; }
        if ((m = l.match(/^(?:ip|ipv6) access-list (?:(?:standard|extended) )?(\S+)/))) { NP.addOther(dev, 'ACLs', m[1]); ctx = { type: 'acl' }; return; }
        if (/^mstp /.test(l)) {
          dev.stp.enabled = 'yes'; addUnique(stpModes, 'mstp');
          if ((m = l.match(/^mstp name (\S+)/))) addUnique(dev.stp.notes, 'MST region ' + m[1]);
          else if ((m = l.match(/^mstp revision (\d+)/))) addUnique(dev.stp.notes, 'MST revision ' + m[1]);
          else if ((m = l.match(/^mstp instance (\d+) priority (\d+)/))) addUnique(dev.stp.priority, 'MST ' + m[1] + ': ' + m[2]);
          else if ((m = l.match(/^mstp instance (\d+) vlan (\d+)(?: to (\d+))?/))) {
            const list = mst[m[1]] = mst[m[1]] || [];
            for (let v = +m[2]; v <= +(m[3] || m[2]) && v <= 4094; v++) list.push(v);
          }
          return;
        }
      }

      if (ctx && ctx.type === 'vlan') {
        const id = ctx.id;
        if ((m = l.match(/^(tagged|untagged) (.+)/))) {
          portList(m[2]).forEach(function (n) {
            const p = touch(dev, n);
            if (m[1] === 'tagged') (tagged[p.key] = tagged[p.key] || []).push(id); else untag[p.key] = id;
          });
        }
        else if ((m = l.match(/^router-interface ve (\d+)/))) {
          const ve = touch(dev, 've' + m[1]);
          routerIf[ve.key] = true;
          const v = dev.vlans.find(function (x) { return x.id === id; });
          if (!ve.description) ve.description = v && v.name ? v.name : 'VLAN ' + id;
        }
        else if ((m = l.match(/^spanning-tree(?: (802-1w))?(?: priority (\d+))?$/))) {
          dev.stp.enabled = 'yes';
          addUnique(stpModes, m[1] ? '802.1w rapid, per VLAN' : '802.1D, per VLAN');
          if (m[2]) addUnique(dev.stp.priority, 'VLAN ' + id + ': ' + m[2]);
        }
        else if (l === 'no spanning-tree') addUnique(dev.stp.notes, 'disabled on VLAN ' + id);
        else if ((m = l.match(/^multicast (active|passive)/))) {
          dev.multicast.igmpSnooping = dev.multicast.igmpSnooping || 'enabled (per VLAN)';
          addUnique(dev.multicast.notes, 'VLAN ' + id + ' ' + m[1] + (m[1] === 'active' ? ' (querier)' : ''));
        }
        else NP.miss(l, 'vlan');
        return;
      }
      if (ctx && ctx.type === 'if') {
        ctx.ports.forEach(function (p) {
          if ((m = l.match(/^port-name (.+)/))) p.description = NP.unquote(m[1]);
          else if (l === 'disable') p.adminUp = false;
          else if ((m = l.match(/^dual-mode(?:\s+(\d+))?/))) dual[p.key] = m[1] ? +m[1] : 0;
          else if ((m = l.match(/^voice-vlan (\d+)/))) p.voiceVlan = m[1];
          else if (/^inline power/.test(l)) {
            p.poeAdmin = 'enabled';
            if ((m = l.match(/power-limit (\d+)/))) NP.addNote(p, 'poe limit ' + (+m[1] / 1000) + ' W');
            if ((m = l.match(/power-by-class (\d+)/))) NP.addNote(p, 'poe class ' + m[1]);
          }
          else if (/^no inline power/.test(l)) p.poeAdmin = 'disabled';
          else if (/^spanning-tree 802-1w admin-edge-port/.test(l)) NP.addFlag(p, 'stp', 'edge');
          else if (/^spanning-tree 802-1w admin-pt2pt-port/.test(l)) NP.addFlag(p, 'stp', 'p2p');
          else if (/^stp-bpdu-guard/.test(l)) NP.addFlag(p, 'stp', 'bpduguard');
          else if (/^stp-protect/.test(l)) NP.addFlag(p, 'stp', 'bpdufilter');
          else if (/^spanning-tree root-protect/.test(l)) NP.addFlag(p, 'stp', 'rootguard');
          else if (/^no spanning-tree/.test(l)) NP.addFlag(p, 'stp', 'stp off');
          else if ((m = l.match(/^ip address (\S+)(?: (\d+\.\d+\.\d+\.\d+))?/))) { if (!p.ip) p.ip = NP.cidr(m[1], m[2]); }
          else if ((m = l.match(/^ip helper-address (?:\d+ )?(\d+\.\d+\.\d+\.\d+)/))) NP.addNote(p, 'helper ' + m[1]);
          else if ((m = l.match(/^speed-duplex (\S+)/))) NP.addNote(p, 'speed-duplex ' + m[1]);
          else if (/^(dot1x|mac-authentication|authentication)\b/.test(l)) NP.addNote(p, '802.1X/MAC-auth');
          else if (/^port security/.test(l)) NP.addNote(p, 'port-security');
          else if (/^(broadcast|multicast|unknown-unicast) limit/.test(l)) NP.addNote(p, 'storm limit');
          else if (/^dhcp snooping trust/.test(l)) NP.addNote(p, 'dhcp-snooping trust');
          else if (/^no lldp|^lldp disable/.test(l)) NP.addNote(p, 'lldp off');
          else if ((m = l.match(/^ip pim(?:-(\S+))?/))) addUnique(dev.multicast.notes, 'PIM on ' + p.short);
          else if (p === ctx.ports[0]) NP.miss(l, 'interface');
        });
        return;
      }
      if (ctx && ctx.type === 'lag') {
        if ((m = l.match(/^ports (.+)/))) portList(m[1]).forEach(function (n) { touch(dev, n).lag = ctx.lag.short; });
        return;
      }
      if (ctx && ctx.type === 'unit') {
        if ((m = l.match(/^module (\d+) (\S+)/))) {
          const name = m[2];
          NP.addOther(dev, 'Modules', ctx.unit + '/' + m[1] + ' ' + name);
          const mm = name.match(/^(icx\d+-\w+?(?:-poe)?)-(?:port-)?management-module$/i);
          if (mm && m[1] === '1') { NP.addOther(dev, 'Stack members', ctx.unit + ': ' + mm[1].toUpperCase()); if (!dev.model) dev.model = mm[1].toUpperCase(); }
          const cnt = name.match(/(\d+)-?port/i) || name.replace(/^icx\d+-/i, '').match(/^c?(\d+)/i);
          const n = cnt ? +cnt[1] : 0;
          if (n > 0 && n <= 96) for (let i = 1; i <= n; i++) touch(dev, ctx.unit + '/' + m[1] + '/' + i);
        }
        return;
      }
      if (ctx && ctx.type === 'acl') return;
      if (ctx && ctx.type === 'ntp') {
        if ((m = l.match(/^(server|peer) (\S+)/))) addUnique(dev.ntp, m[2] + (m[1] === 'peer' ? ' (peer)' : ''));
        return;
      }
      if (indented) { NP.missInner(); return; }
      NP._lastMiss = null;

      // ---- global
      if ((m = l.match(/^hostname (\S+)/))) dev.hostname = NP.unquote(m[1]);
      else if ((m = l.match(/^ver (\S+)/))) { dev.version = dev.version || m[1]; v10 = /^10\./.test(m[1]); }
      else if ((m = l.match(/^default-vlan-id (\d+)/))) defaultVlan = +m[1];
      else if ((m = l.match(/^ip address (\d+\.\d+\.\d+\.\d+)(?:\/(\d+)| (\d+\.\d+\.\d+\.\d+))?/))) { dev.mgmtIp = NP.cidr(m[1], m[2] || m[3]); dev.mgmtIpFixed = true; }
      else if ((m = l.match(/^ip default-gateway (\S+)/))) dev.gateway = m[1];
      else if ((m = l.match(/^ip route 0\.0\.0\.0(?:\/0| 0\.0\.0\.0) (\d+\.\d+\.\d+\.\d+)/))) dev.gateway = dev.gateway || m[1];
      else if ((m = l.match(/^ip dns domain-(?:list|name) (\S+)/))) dev.domain = dev.domain || m[1];
      else if ((m = l.match(/^ip dns server-address (.+)/))) m[1].split(/\s+/).forEach(function (a) { addUnique(dev.dns, a); });
      else if ((m = l.match(/^sntp server (\S+)/))) addUnique(dev.ntp, m[1]);
      else if ((m = l.match(/^logging host (\S+)/)) || (m = l.match(/^logging (\d+\.\d+\.\d+\.\d+)/))) addUnique(dev.syslog, m[1]);
      else if ((m = l.match(/^snmp-server location (.+)/))) dev.snmp.location = NP.unquote(m[1]);
      else if ((m = l.match(/^snmp-server contact (.+)/))) dev.snmp.contact = NP.unquote(m[1]);
      else if (/^snmp-server community /.test(l)) addUnique(dev.snmp.versions, 'v2c');
      else if (/^snmp-server (group|user) /.test(l)) addUnique(dev.snmp.versions, 'v3');
      else if ((m = l.match(/^snmp-server host (\S+)/))) NP.addOther(dev, 'SNMP trap hosts', m[1]);
      else if ((m = l.match(/^spanning-tree single(?: (802-1w))?/))) { dev.stp.enabled = 'yes'; addUnique(stpModes, 'single ' + (m[1] ? '802.1w' : '802.1D')); }
      else if ((m = l.match(/^ip multicast(?: (active|passive))?$/))) { dev.multicast.igmpSnooping = 'enabled'; if (m[1] === 'active') dev.multicast.querier = 'enabled'; }
      else if ((m = l.match(/^ip multicast version (\d)/))) addUnique(dev.multicast.notes, 'IGMP snooping v' + m[1]);
      else if ((m = l.match(/^ip igmp version (\d)/))) addUnique(dev.multicast.notes, 'IGMP v' + m[1]);
      else if (/^ip multicast-routing/.test(l) || /^router pim/.test(l)) dev.multicast.routing = 'enabled';
      else if ((m = l.match(/^username (\S+)/))) NP.addOther(dev, 'Local users', m[1]);
      else if ((m = l.match(/^aaa authentication (login|web-server|enable|snmp-server) default (.+)/))) NP.addOther(dev, 'AAA', m[1] + ' ' + m[2]);
      else if ((m = l.match(/^(radius|tacacs)-server host (\S+)/))) NP.addOther(dev, 'AAA', m[1].toUpperCase() + ' ' + m[2]);
      else if (/^no telnet server/.test(l)) dev.other.Telnet = 'disabled';
      else if ((m = l.match(/^(no )?web-management(?: (https?|disable))?/))) {
        // "web-management http" followed by "web-management disable" is how FastIron 10 writes "off"
        if (m[1] || m[2] === 'disable') dev.other['Web management'] = 'disabled';
        else if (dev.other['Web management'] !== 'disabled') dev.other['Web management'] = m[2] || 'enabled';
      }
      else if ((m = l.match(/^clock timezone (.+)/))) dev.other['Time zone'] = m[1];
      else if ((m = l.match(/^router (\S+)/))) NP.addOther(dev, 'Routing protocols', m[1]);
      else if ((m = l.match(/^ip dhcp snooping vlan (.+)/))) NP.addOther(dev, 'DHCP snooping', 'VLAN ' + m[1]);
      else if (/^lldp run/.test(l)) dev.other.LLDP = 'enabled';
      else if ((m = l.match(/^(no )?cdp run/))) dev.other.CDP = m[1] ? 'disabled' : 'enabled';
      else if ((m = l.match(/^stack (enable|disable)/))) dev.other.Stacking = m[1] + 'd';
      else if (/^restconf enable/.test(l)) dev.other.RESTCONF = 'enabled';
      else if (/^ip dhcp-client disable/.test(l)) dev.other['DHCP client'] = 'disabled';
      else if ((m = l.match(/^manager (registrar|active-list .+|disable)/))) dev.other['SmartZone / cloud manager'] = m[1] === 'registrar' ? 'registrar lookup' : m[1];
      else if ((m = l.match(/^cli timeout (\d+)/))) dev.other['CLI timeout'] = m[1] === '0' ? 'never' : m[1] + ' min';
      else NP.miss(l, 'global');
    });

    Object.keys(mst).forEach(function (i) { addUnique(dev.stp.notes, 'MST ' + i + ' = VLAN ' + NP.compressVlans(mst[i])); });
    dev.stp.mode = stpModes.join('; ') || dev.stp.mode;
    if (!dev.stp.enabled) dev.stp.enabled = 'no';
    if (!dev.multicast.igmpSnooping) dev.multicast.igmpSnooping = 'disabled (default)';
    if (!dev.vlans.some(function (v) { return v.id === defaultVlan; })) NP.addVlan(dev, defaultVlan, 'DEFAULT-VLAN');

    dev.ports.forEach(function (p) {
      if (v10 && p.kind === 'svi' && !p.description && !routerIf[p.key] && (m = p.short.match(/^ve(\d+)$/i))) {
        const v = dev.vlans.find(function (x) { return x.id === +m[1]; });
        if (v) p.description = v.name || 'VLAN ' + v.id;
      }
      if (p.kind !== 'physical' && p.kind !== 'lag') return;
      const t = (tagged[p.key] || []).slice();
      const own = t.length || untag[p.key] !== undefined || dual[p.key] !== undefined;
      if (p.lag && !own) { p.mode = ''; p.untagged = ''; p.tagged = ''; return; }
      let u = untag[p.key];
      if (u === undefined && dual[p.key] !== undefined) u = dual[p.key] || defaultVlan;
      if (u === undefined && (!t.length || v10)) u = defaultVlan;
      p.untagged = u === undefined ? '' : String(u);
      p.tagged = NP.compressVlans(t.filter(function (id) { return id !== u; }));
      const data = t.filter(function (id) { return id !== u && String(id) !== p.voiceVlan; });
      p.mode = data.length ? 'trunk' : 'access';
    });
  }

  function parseShow(text, dev) {
    let m;
    // show interfaces brief
    NP.eachTable(text, function (h) { return /^Port\s+Link\s+State\s+Dupl\s+Speed\s+Trunk\s+Tag\s+Pvid/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 9 || !/^(\d+\/\d+\/\d+|mgmt\d+|ve\d+|lg\d+|lb\d+)$/i.test(t[0])) return;
      const p = touch(dev, showName(t[0]));
      dev.statusLoaded = true;
      if (/^disable/i.test(t[1])) { p.adminUp = false; p.link = 'down'; }
      else { p.adminUp = true; p.link = /^up$/i.test(t[1]) ? 'up' : /^err/i.test(t[1]) ? 'err-disabled' : 'down'; }
      if (p.link === 'up') { p.duplex = NP.fmtDuplex(t[3]); p.speed = /^(None|N\/A)$/i.test(t[4]) ? '' : NP.fmtSpeed(t[4].replace(/M$/, '')); }
      if (/^(Forward|Blocking|Listen|Learn|Discard)/i.test(t[2])) p.stpState = t[2];
      if (/^\d+$/.test(t[5]) && !p.lag && p.kind === 'physical') p.lag = 'lag' + t[5];
      if (!p.mode && (p.kind === 'physical' || p.kind === 'lag') && !p.lag) {
        p.mode = /^yes$/i.test(t[6]) ? 'trunk' : 'access';
        if (/^\d+$/.test(t[7])) p.untagged = t[7];
      }
      // the config alone cannot always say which VLAN a tagged port sends untagged; the PVID column can
      else if (!p.untagged && p.mode && !p.lag && /^\d+$/.test(t[7])) p.untagged = t[7];
      const name = t.slice(10).join(' ');
      if (name && !p.description) p.description = name;
    });

    // show inline power
    text.split(/\r?\n/).forEach(function (ln) {
      const x = ln.match(/^\s*(\d+\/\d+\/\d+)\s+(On|Off)\s+(\S+)\s+(\d+)\s+(\d+)\s+(.*?)\s+(Class \d|n\/a|Unknown)\s+(\d+)\s/i);
      if (!x) return;
      const p = touch(dev, x[1]);
      p.poeAdmin = /^on$/i.test(x[2]) ? 'enabled' : 'disabled';
      p.poeStatus = x[3].toLowerCase();
      p.poeWatts = +x[4] > 0 ? String(Math.round(+x[4] / 100) / 10) : '';
      p.poeClass = /^Class/i.test(x[7]) ? x[7].replace(/\D/g, '') : '';
    });

    // show lldp neighbors (table)
    NP.eachTable(text, function (h) { return /^Lcl Port\s+Chassis ID\s+Port ID/.test(h); }, function (ln, header) {
      const iPort = header.indexOf('Port ID'), iDesc = header.indexOf('Port Description'), iSys = header.indexOf('System Name');
      const local = ln.trim().split(/\s+/)[0];
      if (!/^\d+\/\d+\/\d+$|^mgmt\d+$/.test(local) || iSys < 0) return;
      const p = touch(dev, local);
      const pid = ln.slice(iPort, iDesc).trim(), desc = ln.slice(iDesc, iSys).trim();
      if (!p.neighbor) {
        p.neighbor = ln.slice(iSys).trim();
        p.neighborPort = MAC.test(pid) && desc ? desc : pid;
      }
    });

    // show lldp neighbors detail
    let cur = null;
    const flush = function () {
      if (!cur) return;
      const b = cur; cur = null;
      if (!b.name && !b.port) return;
      const p = touch(dev, b.local);
      p.neighbor = b.name || b.chassis;
      p.neighborPort = MAC.test(b.port) && b.desc ? b.desc : b.port;
      p.neighborInfo = b.ip;
    };
    text.split(/\r?\n/).forEach(function (ln) {
      let x;
      if ((x = ln.match(/^Local port: (\S+)/))) { flush(); cur = { local: x[1], name: '', port: '', desc: '', chassis: '', ip: '' }; }
      else if (!cur) return;
      else if ((x = ln.match(/\+ Chassis ID \([^)]*\): (\S+)/))) cur.chassis = x[1];
      else if ((x = ln.match(/\+ Port ID \([^)]*\): (.+)$/))) cur.port = NP.unquote(x[1]);
      else if ((x = ln.match(/\+ System name\s*: (.+)$/))) cur.name = NP.unquote(x[1]);
      else if ((x = ln.match(/\+ Port description\s*: (.+)$/))) cur.desc = NP.unquote(x[1]);
      else if ((x = ln.match(/\+ Management address \(IPv4\): (\S+)/))) cur.ip = cur.ip || x[1];
    });
    flush();

    // show version
    if ((m = text.match(/^\s*SW: Version (\S+)/m))) dev.version = m[1];
    // the "HW:" line names the family (ICX7150-48-POE); slot 1 of unit 1 carries the part number (ICX7150-48P-4X1G)
    if ((m = text.match(/^\s*UNIT 1: SL 1: (ICX[\w\-]+)/m)) || (m = text.match(/^\s*HW: (?:Stackable )?(ICX\S+)/m))) dev.model = m[1];
    if ((m = text.match(/^\s*Serial\s+#:\s*(\S+)/m))) dev.serial = m[1];

    if (dev.statusLoaded) {
      dev.ports.forEach(function (p) { if (p.kind === 'physical' && !p.link) p.link = 'not present'; });
    }
  }

  NP.registerVendor('icx', 'Ruckus ICX (FastIron)', function (text, dev) {
    NP.sections(text).forEach(function (s) {
      if (/^(vlan \d+|interface (ethernet|ve|lag|management) |hostname |stack unit )/m.test(s.text)) parseConfig(s.text, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
