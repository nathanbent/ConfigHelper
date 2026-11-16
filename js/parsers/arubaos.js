/* ArubaOS-Switch / HP ProCurve. VLAN membership lives under "vlan N" blocks
 * (untagged/tagged port lists), so ports are assembled from those. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  // "1-4,A1-A3,1/10-1/12,Trk1" -> individual port names
  function expandPorts(s) {
    const out = [];
    String(s).split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      const r = part.match(/^(.*?)(\d+)-(.*?)(\d+)$/);
      if (r && r[1].toLowerCase() === r[3].toLowerCase() && +r[4] >= +r[2] && +r[4] - +r[2] < 512) {
        for (let i = +r[2]; i <= +r[4]; i++) out.push(r[1] + i);
      } else out.push(part);
    });
    return out;
  }
  const isPortList = function (s) { return /^(\d|[A-Za-z]\d|trk\d)/i.test(s) && !/[^\w,\-\/]/.test(s); };
  const pname = function (s) { return /^trk/i.test(s) ? 'Trk' + s.slice(3) : s.toUpperCase(); };

  function stpFlags(dev, ports, rest) {
    const map = [[/admin-edge-port/, 'edge'], [/bpdu-protection/, 'bpduguard'], [/bpdu-filter/, 'bpdufilter'],
      [/root-guard/, 'rootguard'], [/loop-guard/, 'loopguard'], [/tcn-guard/, 'tcn-guard']];
    ports.forEach(function (n) {
      const p = NP.port(dev, pname(n));
      map.forEach(function (f) { if (f[0].test(rest) && !/no-/.test(rest)) NP.addFlag(p, 'stp', f[1]); });
      let m;
      if ((m = rest.match(/\bpriority (\d+)/))) NP.addFlag(p, 'stp', 'prio ' + m[1]);
      if ((m = rest.match(/\bpath-cost (\d+)/))) NP.addFlag(p, 'stp', 'cost ' + m[1]);
    });
  }

  function parseConfig(text, dev) {
    const untag = {}, tag = {};          // port key -> vlan ids
    const voice = [];
    let ctx = null, stpOn = false, m;
    const touch = function (n) { const p = NP.port(dev, pname(n)); if (p.adminUp === null) p.adminUp = true; return p; };

    text.split(/\r?\n/).forEach(function (raw) {
      const l = raw.trim();
      if (!l) return;
      if (l[0] === ';') {
        if ((m = l.match(/^; (\S+) Configuration Editor; Created on release #?(\S+)/))) {
          dev.model = dev.model || m[1]; dev.version = dev.version || m[2];
        }
        return;
      }
      if (l === 'exit') { ctx = null; return; }
      const indented = /^\s/.test(raw);
      if (!indented) ctx = null;

      if (!indented && (m = l.match(/^interface (\S+)$/))) { ctx = { type: 'if', ports: expandPorts(m[1]).map(touch) }; return; }
      if (!indented && (m = l.match(/^vlan (\d+)$/))) { NP.addVlan(dev, m[1]); ctx = { type: 'vlan', id: +m[1] }; return; }

      if (ctx && ctx.type === 'if') {
        ctx.ports.forEach(function (p) {
          if ((m = l.match(/^name (.+)/))) p.description = NP.unquote(m[1]);
          else if (l === 'disable') p.adminUp = false;
          else if (l === 'enable') p.adminUp = true;
          else if (/^no power-over-ethernet/.test(l)) p.poeAdmin = 'disabled';
          else if ((m = l.match(/^power-over-ethernet (\S+)/))) p.poeAdmin = 'enabled (' + m[1] + ')';
          else if ((m = l.match(/^poe-allocate-by (\S+)/))) NP.addNote(p, 'poe alloc ' + m[1]);
          else if ((m = l.match(/^speed-duplex (\S+)/))) NP.addNote(p, 'speed-duplex ' + m[1]);
          else if ((m = l.match(/^(untagged|tagged) vlan (.+)/))) {
            const bucket = m[1] === 'untagged' ? untag : tag;
            (bucket[p.key] = bucket[p.key] || []).push.apply(bucket[p.key], NP.parseVlanList(m[2]));
          }
          else if (/^spanning-tree /.test(l)) stpFlags(dev, [p.name], l);
          else if (/^(aaa port-access|port-security)/.test(l)) NP.addNote(p, l.split(' ').slice(0, 2).join(' '));
          else if (p === ctx.ports[0]) NP.miss(l, 'interface');
        });
        return;
      }
      if (ctx && ctx.type === 'vlan') {
        const id = ctx.id;
        if ((m = l.match(/^name (.+)/))) NP.addVlan(dev, id, m[1]);
        else if ((m = l.match(/^(untagged|tagged) (\S+)/))) {
          const bucket = m[1] === 'untagged' ? untag : tag;
          expandPorts(m[2]).forEach(function (n) {
            const p = touch(n);
            (bucket[p.key] = bucket[p.key] || []).push(id);
          });
        }
        else if (l === 'voice') voice.push(id);
        else if ((m = l.match(/^ip address (\S+)(?: (\S+))?/))) {
          const svi = NP.port(dev, 'Vlan' + id);
          svi.adminUp = true;
          svi.ip = /^\d/.test(m[1]) ? NP.cidr(m[1], m[2]) : m[1];
          const v = dev.vlans.find(function (x) { return x.id === id; });
          if (v && v.name && !svi.description) svi.description = v.name;
        }
        else if (l === 'ip igmp') { dev.multicast.igmpSnooping = 'enabled'; addUnique(dev.multicast.notes, 'IGMP on VLAN ' + id); }
        else if (/^ip igmp querier/.test(l)) addUnique(dev.multicast.notes, 'querier on VLAN ' + id);
        else if ((m = l.match(/^ip helper-address (\S+)/))) NP.addNote(NP.port(dev, 'Vlan' + id), 'helper ' + m[1]);
        else NP.miss(l, 'vlan');
        return;
      }

      // ---- global
      if ((m = l.match(/^hostname (.+)/))) dev.hostname = NP.unquote(m[1]);
      else if ((m = l.match(/^trunk (\S+) (trk\d+)(?: (\S+))?/i))) {
        const t = touch(m[2]);
        t.kind = 'lag';
        if (m[3]) NP.addNote(t, m[3]);
        expandPorts(m[1]).forEach(function (n) { touch(n).lag = t.name; });
      }
      else if ((m = l.match(/^ip default-gateway (\S+)/))) dev.gateway = m[1];
      else if ((m = l.match(/^ip route (.+)/)) && NP.addRoute(dev, NP.parseIpRoute(m[1]))) { /* gateway from the routes, after the walk */ }
      else if ((m = l.match(/^ip dns domain-name (.+)/))) dev.domain = NP.unquote(m[1]);
      else if ((m = l.match(/^ip dns server-address (?:priority \d+ )?(\S+)/))) addUnique(dev.dns, m[1]);
      else if ((m = l.match(/^(?:ntp|sntp) server (?:priority \d+ )?(\S+)/))) addUnique(dev.ntp, m[1]);
      else if ((m = l.match(/^timesync (\S+)/))) dev.other['Time sync'] = m[1];
      else if ((m = l.match(/^time timezone (\S+)/))) dev.other['Time zone'] = 'UTC offset ' + m[1] + ' min';
      else if ((m = l.match(/^logging (\d+\.\d+\.\d+\.\d+)/))) addUnique(dev.syslog, m[1]);
      else if ((m = l.match(/^snmp-server location (.+)/))) dev.snmp.location = NP.unquote(m[1]);
      else if ((m = l.match(/^snmp-server contact (.+)/))) dev.snmp.contact = NP.unquote(m[1]);
      else if (/^snmp-server community /.test(l)) addUnique(dev.snmp.versions, 'v2c');
      else if (/^snmpv3 /.test(l)) addUnique(dev.snmp.versions, 'v3');
      else if (l === 'ip routing') dev.other['IP routing'] = 'enabled';
      else if (l === 'spanning-tree') stpOn = true;
      else if ((m = l.match(/^spanning-tree mode (\S+)/))) dev.stp.mode = m[1];
      else if ((m = l.match(/^spanning-tree priority (\d+)/))) addUnique(dev.stp.priority, String(+m[1] <= 15 ? +m[1] * 4096 : +m[1]));
      else if ((m = l.match(/^spanning-tree config-name (.+)/))) addUnique(dev.stp.notes, 'MST region ' + NP.unquote(m[1]));
      else if ((m = l.match(/^spanning-tree (\S+) (.+)/)) && isPortList(m[1])) stpFlags(dev, expandPorts(m[1]), m[2]);
      else if (/^spanning-tree /.test(l)) addUnique(dev.stp.notes, l.replace(/^spanning-tree /, ''));
      else if ((m = l.match(/^(radius|tacacs)-server host (\S+)/))) NP.addOther(dev, 'AAA', m[1].toUpperCase() + ' ' + m[2]);
      else if (/^no (telnet-server|web-management)/.test(l)) NP.addOther(dev, 'Disabled services', l.slice(3));
      else if (/^ip ssh/.test(l)) dev.other.SSH = 'enabled';
      else if ((m = l.match(/^dhcp-snooping( vlan (.+))?$/))) NP.addOther(dev, 'DHCP snooping', m[2] ? 'VLAN ' + m[2] : 'enabled');
      else if (/^loop-protect /.test(l)) NP.addOther(dev, 'Loop protect', l.replace(/^loop-protect /, ''));
      else if (indented) NP.missInner();
      else NP.miss(l, 'global');
    });

    dev.stp.enabled = stpOn ? 'yes' : (dev.stp.enabled || 'no (default)');
    if (stpOn && !dev.stp.mode) dev.stp.mode = 'mstp (default)';
    if (!dev.multicast.igmpSnooping) dev.multicast.igmpSnooping = 'disabled (default)';

    dev.ports.forEach(function (p) {
      if (p.kind === 'svi') return;
      const u = untag[p.key] || [], t = tag[p.key] || [];
      if (!u.length && !t.length) return;
      p.untagged = u.length ? String(u[u.length - 1]) : '';
      const v = t.filter(function (id) { return voice.includes(id); });
      p.tagged = NP.compressVlans(t);
      const data = t.filter(function (id) { return !voice.includes(id); });
      if (v.length && !data.length) p.voiceVlan = String(v[0]);
      p.mode = data.length ? 'trunk' : 'access';
    });
  }

  function parseShow(text, dev) {
    // show interfaces brief
    text.split(/\r?\n/).forEach(function (ln) {
      const i = ln.indexOf('|');
      if (i < 0) return;
      const left = ln.slice(0, i).trim().split(/\s+/), right = ln.slice(i + 1).trim().split(/\s+/);
      if (right.length < 4 || !/^(Yes|No)$/.test(right[1]) || !/^(Up|Down)$/.test(right[2]) || !left[0]) return;
      const p = NP.port(dev, pname(left[0].replace(/-Trk\d+$/i, '')));
      if (left[1]) p.media = left[1];
      p.adminUp = right[1] === 'Yes';
      p.link = right[2].toLowerCase();
      const md = (right[3] || '').match(/^(\d+G?)(FDx|HDx)/i);
      if (md && p.link === 'up') { p.speed = NP.fmtSpeed(md[1]); p.duplex = /^F/i.test(md[2]) ? 'full' : 'half'; }
    });

    // show power-over-ethernet brief
    text.split(/\r?\n/).forEach(function (ln) {
      const x = ln.match(/^\s*(\S+)\s+\|\s+(Yes|No)\s+(\S+)\s+(\S+)\s+(\d+) W\s+([\d.]+) W\s+.*?(Delivering|Searching|Disabled|Other Fault|Fault|Denied)\s+(\d+)/);
      if (!x) return;
      const p = NP.port(dev, pname(x[1]));
      p.poeAdmin = x[2] === 'Yes' ? 'enabled' : 'disabled';
      p.poeStatus = x[7].toLowerCase();
      p.poeWatts = x[7] === 'Delivering' ? x[6] : '';
      p.poeClass = x[7] === 'Delivering' ? x[8] : '';
    });

    // show lldp info remote-device
    NP.eachTable(text, function (h) { return /LocalPort\s+\|\s+ChassisId/.test(h); }, function (ln, header) {
      const bar = ln.indexOf('|');
      if (bar < 0) return;
      const iPort = header.indexOf('PortId'), iDescr = header.indexOf('PortDescr'), iSys = header.indexOf('SysName');
      const local = ln.slice(0, bar).trim();
      if (!local) return;
      const p = NP.port(dev, pname(local));
      p.neighbor = ln.slice(iSys).trim();
      p.neighborPort = ln.slice(iPort, iDescr).trim();
    });
  }

  NP.registerVendor('arubaos', 'ArubaOS-Switch / HP ProCurve', function (text, dev) {
    NP.sections(text).forEach(function (s) {
      if (/^(hostname|vlan \d+|interface \S+)\s*/m.test(s.text) && /^\s+(untagged|tagged|name|exit)\b/m.test(s.text)) parseConfig(s.text, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
