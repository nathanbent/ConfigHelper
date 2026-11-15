/* Juniper Junos: "display set" output or the default curly-brace config
 * (converted to set lines first), plus a few show commands. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  // curly-brace config -> "set ..." lines
  function toSet(text) {
    const out = [], stack = [];
    text.split(/\r?\n/).forEach(function (raw) {
      let l = raw.replace(/\s+#.*$/, '').trim();
      if (!l || l[0] === '#' || /^\/\*/.test(l)) return;
      if (/^inactive: /.test(l)) return;
      l = l.replace(/^(protect|replace|active): /, '');
      if (/\{$/.test(l)) { stack.push(l.slice(0, -1).trim()); return; }
      if (l === '}') { stack.pop(); return; }
      if (/;$/.test(l)) {
        const stmt = l.slice(0, -1).trim();
        const prefix = 'set ' + stack.concat(['']).join(' ');
        const br = stmt.match(/^(.*?)\[\s*(.*?)\s*\]$/);
        if (br) br[2].split(/\s+/).forEach(function (v) { out.push(prefix + br[1] + v); });
        else out.push(prefix + stmt);
      }
    });
    return out;
  }

  function expandRange(a, b) {
    const x = a.match(/^(.*?)(\d+)$/), y = b.match(/^(.*?)(\d+)$/);
    if (!x || !y || x[1] !== y[1] || +y[2] < +x[2]) return [a, b];
    const out = [];
    for (let i = +x[2]; i <= +y[2] && out.length < 512; i++) out.push(x[1] + i);
    return out;
  }

  function parseConfig(lines, dev) {
    const vlanIds = {};                 // name -> id
    const ranges = {};                  // interface-range name -> members
    const cfg = {};                     // ifname -> working state
    const c = function (n) {
      return cfg[n] = cfg[n] || { members: [], mode: '', native: '', l2: false, ip: '', disable: false, lag: '' };
    };
    let m;

    // pass 1: vlan names and interface-range membership
    lines.forEach(function (l) {
      l = l.replace(/^set groups \S+ /, 'set ');
      if ((m = l.match(/^set vlans (\S+) vlan-id (\d+)/))) { vlanIds[m[1]] = +m[2]; NP.addVlan(dev, m[2], m[1]); }
      else if ((m = l.match(/^set interfaces interface-range (\S+) member-range (\S+) to (\S+)/))) {
        ranges[m[1]] = (ranges[m[1]] || []).concat(expandRange(m[2], m[3]));
      } else if ((m = l.match(/^set interfaces interface-range (\S+) member (\S+)/))) {
        (ranges[m[1]] = ranges[m[1]] || []).push(m[2]);
      }
    });
    if (vlanIds.default === undefined) vlanIds.default = 1;

    // expand interface-range statements onto their members
    const expanded = [];
    lines.forEach(function (l) {
      l = l.replace(/^set groups \S+ /, 'set ');
      if ((m = l.match(/^set interfaces interface-range (\S+) (.+)$/))) {
        if (/^member(-range)? /.test(m[2])) return;
        (ranges[m[1]] || []).forEach(function (n) { expanded.push('set interfaces ' + n + ' ' + m[2]); });
      } else expanded.push(l);
    });

    expanded.forEach(function (l) {
      if ((m = l.match(/^set interfaces (\S+) (.+)$/))) {
        let name = m[1], rest = m[2];
        const u = rest.match(/^unit (\d+) (.+)$/);
        const unitOnly = rest.match(/^unit (\d+)$/);
        if (unitOnly) return;
        if (u) {
          rest = u[2];
          if (u[1] !== '0' || /^(irb|vlan|lo\d)/.test(name)) name = name + '.' + u[1];
        }
        const p = NP.port(dev, name), s = c(name);
        let x;
        if ((x = rest.match(/^description (.+)/))) p.description = NP.unquote(x[1]);
        else if (rest === 'disable') s.disable = true;
        else if ((x = rest.match(/^family ethernet-switching (?:interface-mode|port-mode) (\S+)/))) { s.l2 = true; s.mode = x[1]; }
        else if ((x = rest.match(/^family ethernet-switching vlan members (\S+)/))) { s.l2 = true; s.members.push(x[1]); }
        else if ((x = rest.match(/^family ethernet-switching native-vlan-id (\S+)/))) s.native = x[1];
        else if (/^family ethernet-switching/.test(rest)) s.l2 = true;
        else if ((x = rest.match(/^native-vlan-id (\d+)/))) s.native = x[1];
        else if ((x = rest.match(/^family inet address (\S+)/))) { if (!s.ip) s.ip = x[1]; }
        else if (/^family inet dhcp/.test(rest)) { if (!s.ip) s.ip = 'dhcp'; }
        else if ((x = rest.match(/^(?:giga)?ether-options 802\.3ad (ae\d+)/))) s.lag = x[1];
        else if ((x = rest.match(/^vlan-id (\d+)/))) { p.tagged = x[1]; p.mode = 'subinterface'; }
        else if ((x = rest.match(/^mtu (\d+)/))) NP.addNote(p, 'mtu ' + x[1]);
        else if ((x = rest.match(/^(?:giga)?ether-options (no-auto-negotiation|speed \S+)/))) NP.addNote(p, x[1]);
        else NP.miss(rest.replace(/ \d+\.\d+\.\d+\.\d+\S*/g, ' <addr>'), 'interface');
        return;
      }
      if ((m = l.match(/^set system host-name (\S+)/))) dev.hostname = m[1];
      else if ((m = l.match(/^set version (\S+)/))) dev.version = dev.version || m[1];
      else if ((m = l.match(/^set system domain-name (\S+)/))) dev.domain = m[1];
      else if ((m = l.match(/^set system name-server (\S+)/))) addUnique(dev.dns, m[1]);
      else if ((m = l.match(/^set system ntp server (\S+)( .*prefer)?/))) addUnique(dev.ntp, m[1] + (m[2] ? ' (prefer)' : ''));
      else if ((m = l.match(/^set system syslog host (\S+)/))) addUnique(dev.syslog, m[1]);
      else if ((m = l.match(/^set system time-zone (\S+)/))) dev.other['Time zone'] = m[1];
      else if ((m = l.match(/^set system login user (\S+)/))) NP.addOther(dev, 'Local users', m[1]);
      else if ((m = l.match(/^set system services (\S+)/))) NP.addOther(dev, 'Services', m[1]);
      else if ((m = l.match(/^set system (radius|tacplus)-server (\S+)/))) NP.addOther(dev, 'AAA', m[1] + ' ' + m[2]);
      else if ((m = l.match(/^set snmp location (.+)/))) dev.snmp.location = NP.unquote(m[1]);
      else if ((m = l.match(/^set snmp contact (.+)/))) dev.snmp.contact = NP.unquote(m[1]);
      else if (/^set snmp community /.test(l)) addUnique(dev.snmp.versions, 'v2c');
      else if (/^set snmp v3 /.test(l)) addUnique(dev.snmp.versions, 'v3');
      else if ((m = l.match(/^set routing-options static route 0\.0\.0\.0\/0 next-hop (\S+)/))) dev.gateway = dev.gateway || m[1];
      else if ((m = l.match(/^set vlans (\S+) l3-interface (\S+)/))) {
        const p = NP.port(dev, m[2]); if (!p.description) p.description = m[1];
      }
      else if ((m = l.match(/^set (?:switch-options|ethernet-switching-options) voip interface (\S+) vlan (\S+)/))) {
        const tgt = m[1].replace(/\.0$/, '');
        const v = String(vlanIds[m[2]] !== undefined ? vlanIds[m[2]] : m[2]);
        if (tgt === 'access-ports') dev.other['Voice VLAN'] = v + ' on all access ports';
        else NP.port(dev, tgt).voiceVlan = v;
      }
      else if ((m = l.match(/^set protocols (rstp|mstp|vstp|stp)\b(.*)$/))) {
        dev.stp.enabled = 'yes';
        if (!dev.stp.mode || m[1] !== 'stp') dev.stp.mode = m[1];
        const r = m[2].trim();
        let x;
        if ((x = r.match(/^(?:vlan (\S+) )?bridge-priority (\S+)/))) addUnique(dev.stp.priority, (x[1] ? 'VLAN ' + x[1] + ': ' : '') + x[2]);
        else if ((x = r.match(/^(?:vlan \S+ )?interface (\S+)(?: (.+))?$/))) {
          const flag = !x[2] ? '' : x[2] === 'edge' ? 'edge' : x[2] === 'no-root-port' ? 'rootguard' :
            /^cost /.test(x[2]) ? x[2] : /^mode /.test(x[2]) ? x[2].slice(5) : x[2];
          if (x[1] === 'all') { if (flag) addUnique(dev.stp.notes, 'all interfaces: ' + flag); }
          else if (flag) NP.addFlag(NP.port(dev, x[1].replace(/\.0$/, '')), 'stp', flag);
        }
        else if (r === 'bpdu-block-on-edge') addUnique(dev.stp.notes, 'bpdu-block-on-edge (BPDU guard on edge ports)');
        else if ((x = r.match(/^configuration-name (\S+)/))) addUnique(dev.stp.notes, 'MST region ' + x[1]);
        else if (r && !/^interface/.test(r)) addUnique(dev.stp.notes, r);
      }
      else if ((m = l.match(/^set protocols igmp-snooping vlan (\S+)/))) {
        dev.multicast.igmpSnooping = 'enabled';
        addUnique(dev.multicast.notes, 'snooping on VLAN ' + m[1]);
      }
      else if (/^set protocols pim /.test(l)) dev.multicast.routing = 'PIM configured';
      else if (/^set protocols lldp /.test(l)) dev.other.LLDP = 'enabled';
      else if ((m = l.match(/^set protocols (ospf3?|bgp|isis|rip)\b/))) NP.addOther(dev, 'Routing protocols', m[1]);
      else if ((m = l.match(/^set poe interface (\S+)( disable)?/))) {
        if (m[1] === 'all') dev.other.PoE = m[2] ? 'disabled on all ports' : 'enabled on all ports';
        else NP.port(dev, m[1]).poeAdmin = m[2] ? 'disabled' : 'enabled';
      }
      else if ((m = l.match(/^set virtual-chassis member (\d+)(?: role (\S+))?/))) NP.addOther(dev, 'Virtual chassis', 'member ' + m[1] + (m[2] ? ' ' + m[2] : ''));
      // everything else: group by the first three words so a long policy counts as one entry
      else if (!/^set (vlans|interfaces) /.test(l)) NP.miss(l.split(/\s+/).slice(0, 3).join(' ') + ' …', 'global');
    });

    const resolve = function (list) {
      const ids = [], names = [];
      list.forEach(function (v) {
        if (v === 'all') names.push('all');
        else if (/^[\d\-]+$/.test(v)) ids.push.apply(ids, NP.parseVlanList(v));
        else if (vlanIds[v] !== undefined) ids.push(vlanIds[v]);
        else names.push(v);
      });
      if (names.includes('all')) return 'all';
      return [NP.compressVlans(ids)].concat(names).filter(Boolean).join(',');
    };
    Object.keys(cfg).forEach(function (name) {
      const s = cfg[name], p = NP.port(dev, name);
      p.adminUp = !s.disable;
      if (s.ip) p.ip = s.ip;
      if (s.lag) p.lag = s.lag;
      if (/^ae\d/.test(name)) p.kind = 'lag';
      if (p.kind !== 'physical' && p.kind !== 'lag') return;
      if (s.l2) {
        if (s.mode === 'trunk') {
          p.mode = 'trunk';
          p.untagged = s.native ? String(vlanIds[s.native] !== undefined ? vlanIds[s.native] : s.native) : '';
          p.tagged = resolve(s.members);
        } else {
          p.mode = 'access';
          p.untagged = resolve(s.members.length ? s.members : ['default']);
          p.tagged = '';
        }
      } else if (s.ip && p.mode !== 'subinterface') p.mode = 'routed';
    });
    if (!dev.stp.enabled) dev.stp.enabled = '';
    if (!dev.multicast.igmpSnooping) dev.multicast.igmpSnooping = '';
  }

  function parseShow(text, dev) {
    // show interfaces terse
    NP.eachTable(text, function (h) { return /^Interface\s+Admin\s+Link\s+Proto/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 3 || !/^(up|down)$/.test(t[1])) return;
      let name = t[0];
      if (!/^(ge|xe|et|mge|fe|ae|me|fxp|em|irb|vlan|vme)[\-\d.]/.test(name)) return;
      if (/\.\d+$/.test(name)) {
        if (!/^(irb|vlan)\./.test(name) && !NP.findPort(dev, name)) return;
      }
      const p = NP.port(dev, name);
      if (/^ae\d/.test(name)) p.kind = 'lag';
      p.adminUp = t[1] === 'up';
      p.link = t[2] === 'up' ? 'up' : 'down';
    });
    // show lldp neighbors
    NP.eachTable(text, function (h) { return /^Local Interface\s+Parent Interface\s+Chassis Id/.test(h); }, function (ln, header) {
      const iPort = header.indexOf('Port info'), iSys = header.indexOf('System Name');
      const local = ln.trim().split(/\s+/)[0];
      if (!/\d/.test(local)) return;
      const p = NP.port(dev, local.replace(/\.0$/, ''));
      p.neighbor = ln.slice(iSys).trim();
      p.neighborPort = ln.slice(iPort, iSys).trim();
    });
    // show poe interface
    text.split(/\r?\n/).forEach(function (ln) {
      const x = ln.match(/^\s*([a-z]+-\d+\/\d+\/\d+)\s+(Enabled|Disabled)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+)W\s+(\S+)/);
      if (!x) return;
      const p = NP.port(dev, x[1]);
      p.poeAdmin = x[2].toLowerCase();
      p.poeStatus = x[3].toLowerCase();
      p.poeWatts = /^on$/i.test(x[3]) ? x[6] : '';
      p.poeClass = /^\d/.test(x[7]) ? x[7] : '';
    });
    let m;
    if ((m = text.match(/^Model: (\S+)/m))) dev.model = m[1];
    if ((m = text.match(/^Junos: (\S+)/m)) || (m = text.match(/^JUNOS .*\[(\S+)\]/m))) dev.version = m[1];
    if (!dev.hostname && (m = text.match(/^Hostname: (\S+)/m))) dev.hostname = m[1];
  }

  NP.registerVendor('junos', 'Juniper Junos', function (text, dev) {
    NP.sections(text).forEach(function (s) {
      let lines = s.text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return /^set /.test(l); });
      if (!lines.length && /\{\s*$/m.test(s.text) && /;\s*$/m.test(s.text)) lines = toSet(s.text);
      if (lines.length) parseConfig(lines, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
