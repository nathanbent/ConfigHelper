/* Fortinet FortiGate ("show" / "show full-configuration" / backup .conf file). */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  function tokens(s) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }

  // -> tree of {name, set:{k:[v..]}, entries:[{name,set,blocks}], blocks:[...]}
  function tree(text) {
    // each node's "set" is wrapped so we can tell afterwards which settings were ever looked at
    const node = function (name, isEntry) {
      const used = {};
      return { name: name, used: used, entries: [], blocks: [], isEntry: !!isEntry,
        set: new Proxy({}, { get: function (o, k) { if (typeof k === 'string' && k in o) used[k] = true; return o[k]; } }) };
    };
    const top = node('');
    const stack = [top];
    unwrap(text.split(/\r?\n/)).forEach(function (raw) {
      const l = raw.trim();
      const cur = stack[stack.length - 1];
      let m;
      if ((m = l.match(/^config (.+)$/))) {
        const b = node(m[1]);
        cur.blocks.push(b); stack.push(b);
      } else if ((m = l.match(/^edit (.+)$/))) {
        const e = node(tokens(m[1])[0] || '', true);
        cur.entries.push(e); stack.push(e);
      } else if (l === 'next') { if (stack.length > 1 && cur.isEntry) stack.pop(); }
      else if (l === 'end') {
        if (stack.length > 1 && cur.isEntry) stack.pop();
        if (stack.length > 1) stack.pop();
      } else if ((m = l.match(/^set (\S+)\s*(.*)$/))) cur.set[m[1]] = tokens(m[2]);
    });
    return top;
  }
  // A long "set" line that the terminal wrapped (a list of 28 VLAN names on a 224-column console) arrives as
  // two lines, usually cut in the middle of a quoted name. Put it back together: a line whose quotes are not
  // closed continues on the next one, and so does a "set" line followed by an unindented line that is not a
  // command. A value that really spans lines (a certificate, a replacement message) keeps its line breaks.
  const KEYWORD = /^(config|edit|set|unset|next|end|append|unselect|select|clear|delete|purge|rename|move|show|get|diagnose|execute)\b/;
  function unwrap(lines) {
    const open = function (s) { return (s.replace(/\\./g, '').match(/"/g) || []).length % 2 === 1; };
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      if (/^\s*set\s/.test(l)) {
        while (i + 1 < lines.length) {
          const nx = lines[i + 1];
          const flush = nx !== '' && !/^\s/.test(nx);          // wrapped text starts in column 1
          if (open(l)) l += (flush && lines[i].length >= 79 ? '' : '\n') + nx;
          else if (flush && lines[i].length >= 79 && !KEYWORD.test(nx) && !/^\S+ ?[#>$]( |$)/.test(nx) && !/^\S*\([^)]*\) ?[#>$]/.test(nx)) l += nx;
          else break;
          i++;
        }
      }
      out.push(l);
    }
    return out;
  }
  function find(node, name, out) {
    out = out || [];
    node.blocks.forEach(function (b) { if (b.name === name) out.push(b); find(b, name, out); });
    node.entries.forEach(function (e) { find(e, name, out); });
    return out;
  }
  const one = function (b, k) { return b && b.set[k] ? b.set[k][0] : ''; };
  // Report what was never read: whole "config" sections as one entry each, and for sections
  // that were used, the individual setting names (never the values).
  // settings that say nothing about how a port is set up (SNMP row numbers, GUI colours, inventory switches)
  const BOOKKEEPING = /^(snmp-index|color|device-identification|ip-managed-by-fortiipam|monitor-bandwidth|uuid|macaddr)$/;
  function report(t) {
    t.blocks.forEach(function (b) {
      const keys = [];
      let any = false;
      (function walk(n, path) {
        Object.keys(n.set).forEach(function (k) { if (n.used[k]) any = true; else if (!BOOKKEEPING.test(k)) keys.push(path + 'set ' + k); });
        n.entries.forEach(function (e) { walk(e, path); });
        n.blocks.forEach(function (c) { walk(c, path + 'config ' + c.name + ' > '); });
      })(b, '');
      if (!any) { if (keys.length) NP.miss('config ' + b.name, 'block', keys.length); }
      else keys.forEach(function (k) { NP.miss(k, b.name); });
    });
  }
  NP.fortiTree = { tree: tree, find: find, one: one, report: report };      // shared with the FortiSwitch parser

  // ---- FortiLink: switches whose port config lives on the FortiGate.
  // Each one becomes its own device (see NP.ingest), so tables and labels work per switch.
  function managedSwitches(t, dev) {
    const vlanId = {};                    // FortiGate VLAN interface name -> VLAN id
    find(t, 'system interface').forEach(function (b) {
      b.entries.forEach(function (e) { if (one(e, 'vlanid')) vlanId[e.name] = +one(e, 'vlanid'); });
    });
    const resolve = function (names) {
      const ids = [], other = [];
      (names || []).forEach(function (n) { if (vlanId[n] !== undefined) ids.push(vlanId[n]); else other.push(n); });
      return { ids: ids, other: other };
    };
    const show = function (r, skip) {
      const ids = r.ids.filter(function (v) { return String(v) !== skip; });
      return [NP.compressVlans(ids)].concat(r.other).filter(Boolean).join(',');
    };
    const stpGlobal = find(t, 'switch-controller stp-settings')[0];
    const snooping = [];                  // VLAN ids with IGMP snooping switched on, on the FortiGate VLAN interface
    find(t, 'system interface').forEach(function (b) {
      b.entries.forEach(function (e) { if (one(e, 'vlanid') && one(e, 'switch-controller-igmp-snooping') === 'enable') snooping.push(+one(e, 'vlanid')); });
    });
    const kids = [];

    find(t, 'switch-controller managed-switch').forEach(function (b) {
      b.entries.forEach(function (sw) {
        const hostname = one(sw, 'name') || sw.name;
        NP.addOther(dev, 'Managed switches', hostname);
        kids.push({ hostname: hostname, vendor: 'fortiswitch', apply: function (c) {
          const touch = function (n) { const p = NP.port(c, n); if (p.adminUp === null) p.adminUp = true; return p; };
          c.serial = c.serial || one(sw, 'sn') || sw.name;
          c.other['Managed by'] = (dev.hostname || 'FortiGate') + ' (FortiLink)';
          if (one(sw, 'description')) c.other.Description = one(sw, 'description');
          if (one(sw, 'switch-profile')) c.other['Switch profile'] = one(sw, 'switch-profile');
          if (one(sw, 'fsw-wan1-peer')) c.other['FortiLink interface'] = one(sw, 'fsw-wan1-peer');
          c.stp.mode = 'mstp'; c.stp.enabled = c.stp.enabled || 'yes';
          if (stpGlobal) {
            if (one(stpGlobal, 'name')) NP.addUnique(c.stp.notes, 'MST region ' + one(stpGlobal, 'name'));
            if (one(stpGlobal, 'revision')) NP.addUnique(c.stp.notes, 'MST revision ' + one(stpGlobal, 'revision'));
          }
          find(sw, 'stp-instance').forEach(function (ib) {
            ib.entries.forEach(function (e) { if (one(e, 'priority')) NP.addUnique(c.stp.priority, 'MST ' + e.name + ': ' + one(e, 'priority')); });
          });
          find(sw, 'stp-settings').forEach(function (ib) { if (one(ib, 'local-override') === 'enable') NP.addUnique(c.stp.notes, 'STP settings overridden on this switch'); });
          find(sw, 'igmp-snooping').forEach(function (ib) { if (one(ib, 'local-override') === 'enable') NP.addUnique(c.multicast.notes, 'IGMP snooping local override'); });

          find(sw, 'ports').forEach(function (pb) {
            pb.entries.forEach(function (e) {
              const p = touch(e.name);
              const isTrunk = one(e, 'type') === 'trunk';
              if (isTrunk) {
                p.kind = 'lag';
                if (one(e, 'mode')) NP.addNote(p, one(e, 'mode'));
                if (one(e, 'lacp-speed') === 'fast') NP.addNote(p, 'lacp fast');
                if (one(e, 'mclag') === 'enable') NP.addNote(p, 'MCLAG');
                (e.set.members || []).forEach(function (mbr) { touch(mbr).lag = e.name; });
              }
              if (one(e, 'description')) p.description = one(e, 'description');
              if (one(e, 'status') === 'down') p.adminUp = false;
              if (one(e, 'poe-status')) p.poeAdmin = one(e, 'poe-status') === 'enable' ? 'enabled' : 'disabled';
              else if (one(e, 'poe-capable') === '1' && !p.poeAdmin) p.poeAdmin = 'enabled (default)';
              if (one(e, 'speed') && !/^(auto|auto-module|detect-by-module)$/.test(one(e, 'speed'))) NP.addNote(p, 'speed ' + one(e, 'speed'));

              const native = resolve(e.set.vlan);
              const nat = native.ids.length ? String(native.ids[0]) : (native.other[0] || '1');
              const allowed = resolve(e.set['allowed-vlans']);
              const all = one(e, 'allowed-vlans-all') === 'enable';
              // "untagged-vlans" leave the port without a tag (every port has the quarantine VLAN there by default),
              // so they do not make the port a trunk
              const bare = resolve(e.set['untagged-vlans']);
              const tagged = { ids: allowed.ids.filter(function (v) { return bare.ids.indexOf(v) < 0; }),
                other: allowed.other.filter(function (n) { return bare.other.indexOf(n) < 0; }) };
              p.untagged = nat;
              p.tagged = all ? 'all' : show(tagged, nat);
              p.mode = p.tagged ? 'trunk' : 'access';
              allowed.ids.concat(native.ids).forEach(function (id) {
                const name = Object.keys(vlanId).find(function (k) { return vlanId[k] === id; });
                NP.addVlan(c, id, name);
              });
              // auto-built FortiLink / inter-switch trunks carry every VLAN; they have no VLAN settings here
              if (isTrunk && !e.set.vlan && (one(e, 'isl-peer-device-name') || /^_FlInK/i.test(e.name))) {
                p.mode = 'FortiLink'; p.untagged = ''; p.tagged = 'all';
              }
              if (e.set['untagged-vlans']) NP.addNote(p, 'also untagged: ' + show(resolve(e.set['untagged-vlans']), ''));

              if (one(e, 'edge-port') === 'disable') NP.addFlag(p, 'stp', 'edge off');
              if (/^enabled?$/.test(one(e, 'stp-bpdu-guard'))) NP.addFlag(p, 'stp', 'bpduguard');
              if (/^enabled?$/.test(one(e, 'stp-root-guard'))) NP.addFlag(p, 'stp', 'rootguard');
              if (/^disabled?$/.test(one(e, 'stp-state'))) NP.addFlag(p, 'stp', 'stp off');
              if (/^enabled?$/.test(one(e, 'loop-guard'))) NP.addFlag(p, 'stp', 'loopguard');
              if (one(e, 'dhcp-snooping') === 'trusted') NP.addNote(p, 'dhcp-snooping trust');
              if (one(e, 'port-security-policy')) NP.addNote(p, '802.1X ' + one(e, 'port-security-policy'));
              if (one(e, 'lldp-profile')) NP.addNote(p, 'lldp ' + one(e, 'lldp-profile'));
              if (one(e, 'fortilink-port') === '1') NP.addNote(p, 'FortiLink uplink');
              if (one(e, 'isl-peer-device-name')) {
                p.neighbor = one(e, 'isl-peer-device-name');
                p.neighborPort = one(e, 'isl-peer-port-name') || p.neighborPort;
                NP.addNote(p, 'inter-switch link');
              }
            });
          });
          snooping.forEach(function (id) {
            if (!c.vlans.some(function (v) { return v.id === id; })) return;
            c.multicast.igmpSnooping = 'enabled (per VLAN)';
            NP.addUnique(c.multicast.notes, 'snooping on VLAN ' + id);
          });
          // members of a trunk carry no VLAN settings of their own
          c.ports.forEach(function (p) { if (p.lag && p.kind === 'physical') { p.mode = ''; p.untagged = ''; p.tagged = ''; } });
        } });
      });
    });
    if (kids.length) dev.pendingChildren = kids;
  }

  NP.registerVendor('fortigate', 'Fortinet FortiGate', function (text, dev) {
    let m;
    if ((m = text.match(/^#config-version=([^-]+)-([\d.]+)-/m))) { dev.model = dev.model || m[1]; dev.version = dev.version || m[2]; }
    if ((m = text.match(/^Version:\s*(\S+) v([\d.]+)/m))) { dev.model = m[1]; dev.version = m[2]; }
    if ((m = text.match(/^Serial-Number:\s*(\S+)/m))) dev.serial = m[1];
    if ((m = text.match(/^Hostname:\s*(\S+)/m))) dev.hostname = m[1];
    if ((m = text.match(/^Current HA mode:\s*(.+?)\s*$/m)) && !/^standalone/i.test(m[1])) dev.other.HA = dev.other.HA || m[1];
    if (!/^\s*config /m.test(text)) return;
    const t = tree(text);

    find(t, 'system global').forEach(function (b) {
      if (one(b, 'hostname')) dev.hostname = one(b, 'hostname');
      if (one(b, 'timezone')) dev.other['Time zone'] = one(b, 'timezone');
      if (one(b, 'admin-sport')) dev.other['Admin HTTPS port'] = one(b, 'admin-sport');
    });
    find(t, 'system dns').forEach(function (b) {
      ['primary', 'secondary'].forEach(function (k) { if (one(b, k) && one(b, k) !== '0.0.0.0') addUnique(dev.dns, one(b, k)); });
      if (one(b, 'domain')) dev.domain = one(b, 'domain');
    });
    // which service sections were pasted at all: without them "no NTP server" would be a guess (see NP.checks)
    const seen = function (k) { (dev.seen = dev.seen || {})[k] = true; };
    if (find(t, 'system ntp').length) seen('ntp');
    if (find(t, 'log syslogd setting').length || find(t, 'system global').length) seen('syslog');
    find(t, 'system ntp').forEach(function (b) {
      if (one(b, 'ntpsync')) dev.other['NTP sync'] = one(b, 'ntpsync');
      if (one(b, 'type') === 'fortiguard') addUnique(dev.ntp, 'FortiGuard');
      find(b, 'ntpserver').forEach(function (n) {
        n.entries.forEach(function (e) { addUnique(dev.ntp, one(e, 'server')); });
      });
    });
    ['log syslogd setting', 'log syslogd2 setting', 'log syslogd3 setting'].forEach(function (n) {
      find(t, n).forEach(function (b) { if (one(b, 'status') === 'enable') addUnique(dev.syslog, one(b, 'server')); });
    });
    find(t, 'system snmp sysinfo').forEach(function (b) {
      dev.snmp.location = one(b, 'location') || dev.snmp.location;
      dev.snmp.contact = one(b, 'contact-info') || dev.snmp.contact;
    });
    if (find(t, 'system snmp community').some(function (b) { return b.entries.length; })) addUnique(dev.snmp.versions, 'v2c');
    if (find(t, 'system snmp user').some(function (b) { return b.entries.length; })) addUnique(dev.snmp.versions, 'v3');
    find(t, 'router static').forEach(function (b) {
      b.entries.forEach(function (e) {
        const dst = e.set.dst ? e.set.dst.join(' ') : '0.0.0.0 0.0.0.0';
        if (/^0\.0\.0\.0[ \/]0(\.0\.0\.0)?$/.test(dst) && one(e, 'gateway') && !dev.gateway) {
          dev.gateway = one(e, 'gateway') + (one(e, 'device') ? ' (' + one(e, 'device') + ')' : '');
        }
      });
    });
    find(t, 'router multicast').forEach(function (b) {
      if (one(b, 'multicast-routing') === 'enable') dev.multicast.routing = 'enabled';
    });
    find(t, 'system settings').forEach(function (b) {
      if (one(b, 'multicast-forward')) addUnique(dev.multicast.notes, 'multicast-forward ' + one(b, 'multicast-forward'));
      if (one(b, 'opmode')) dev.other['Operation mode'] = one(b, 'opmode');
    });
    find(t, 'system admin').forEach(function (b) {
      b.entries.forEach(function (e) { NP.addOther(dev, 'Admin users', e.name); });
    });
    find(t, 'system ha').forEach(function (b) {
      if (one(b, 'mode') && one(b, 'mode') !== 'standalone') dev.other.HA = one(b, 'mode') + (one(b, 'group-name') ? ' (' + one(b, 'group-name') + ')' : '');
    });
    find(t, 'system dhcp server').forEach(function (b) {
      b.entries.forEach(function (e) { if (one(e, 'interface')) NP.addOther(dev, 'DHCP server on', one(e, 'interface')); });
    });

    const zones = {};
    find(t, 'system zone').forEach(function (b) {
      b.entries.forEach(function (e) { (e.set.interface || []).forEach(function (i) { zones[i] = e.name; }); });
    });

    const vlanName = {};                  // two interfaces can share a VLAN id (one on FortiLink, one on a VXLAN): the first names it
    find(t, 'system interface').forEach(function (b) {
      b.entries.forEach(function (e) {
        const p = NP.port(dev, e.name);
        const type = one(e, 'type');
        p.kind = { aggregate: 'lag', 'redundant': 'lag', loopback: 'loopback', tunnel: 'tunnel', vxlan: 'tunnel', geneve: 'tunnel', vlan: 'svi',
          'hard-switch': 'svi', 'vap-switch': 'svi', 'switch': 'svi' }[type] || p.kind;
        if (!type && one(e, 'vlanid')) p.kind = 'svi';
        p.description = [one(e, 'alias'), one(e, 'description')].filter(Boolean).join(' - ') || p.description;
        p.adminUp = one(e, 'status') !== 'down';
        if (e.set.ip && e.set.ip[0] && e.set.ip[0] !== '0.0.0.0') p.ip = NP.cidr(e.set.ip[0], e.set.ip[1]);
        else if (one(e, 'mode') && one(e, 'mode') !== 'static') p.ip = one(e, 'mode');
        if (one(e, 'vlanid')) {
          vlanName[one(e, 'vlanid')] = vlanName[one(e, 'vlanid')] || e.name;
          NP.addVlan(dev, one(e, 'vlanid'), vlanName[one(e, 'vlanid')]);
        }
        if (one(e, 'fortilink') === 'enable') NP.addNote(p, 'FortiLink');
        if (one(e, 'vlanid')) { p.mode = 'vlan'; p.tagged = one(e, 'vlanid'); }
        else if (p.ip && p.kind !== 'loopback' && p.kind !== 'tunnel') p.mode = 'routed';
        if (one(e, 'interface')) NP.addNote(p, 'on ' + one(e, 'interface'));
        find(e, 'secondaryip').forEach(function (sb) {
          sb.entries.forEach(function (se) { if (se.set.ip && se.set.ip[0]) NP.addNote(p, 'secondary ' + NP.cidr(se.set.ip[0], se.set.ip[1])); });
        });
        if (one(e, 'dhcp-relay-service') === 'enable' && e.set['dhcp-relay-ip']) NP.addNote(p, 'dhcp relay ' + e.set['dhcp-relay-ip'].join(','));
        if (one(e, 'switch-controller-igmp-snooping') === 'enable') NP.addNote(p, 'igmp snooping');
        if (one(e, 'dedicated-to') === 'management') p.kind = 'mgmt';
        (e.set.member || []).forEach(function (mbr) {
          const mp = NP.port(dev, mbr);
          if (type === 'aggregate' || type === 'redundant') mp.lag = e.name; else NP.addNote(mp, 'member of ' + e.name);
        });
        if (type && !/^(physical|vlan)$/.test(type)) NP.addNote(p, 'type ' + type);
        if (one(e, 'role')) NP.addNote(p, 'role ' + one(e, 'role'));
        if (zones[e.name]) NP.addNote(p, 'zone ' + zones[e.name]);
        if (e.set.allowaccess && e.set.allowaccess.length) {
          NP.addNote(p, 'access ' + e.set.allowaccess.join('/'));
          if (!dev.mgmtIp && /\d+\.\d+/.test(p.ip) && p.adminUp && /https|ssh/.test(e.set.allowaccess.join(' '))) {
            dev.mgmtIp = p.ip + ' (' + p.name + ')';
            dev.mgmtIpFixed = true;
          }
        }
        if (one(e, 'vdom') && one(e, 'vdom') !== 'root') NP.addNote(p, 'vdom ' + one(e, 'vdom'));
        if (one(e, 'speed') && one(e, 'speed') !== 'auto') NP.addNote(p, 'speed ' + one(e, 'speed'));
        if (one(e, 'stp') === 'enable') NP.addFlag(p, 'stp', 'stp on');
        if (one(e, 'lldp-reception') === 'enable') NP.addNote(p, 'lldp rx');
      });
    });
    ['system virtual-switch', 'system switch-interface'].forEach(function (n) {
      find(t, n).forEach(function (b) {
        b.entries.forEach(function (e) {
          (e.set.member || []).forEach(function (mbr) { NP.addNote(NP.port(dev, mbr), 'member of ' + e.name); });
          find(e, 'port').forEach(function (pb) {
            pb.entries.forEach(function (pe) { NP.addNote(NP.port(dev, pe.name), 'member of ' + e.name); });
          });
        });
      });
    });
    managedSwitches(t, dev);
    // FortiLink switch settings are only read later, when the switch devices are built: do not report them
    t.blocks = t.blocks.filter(function (b) { return !/^switch-controller (managed-switch|stp-settings)$/.test(b.name); });
    report(t);
    if (!dev.stp.enabled) dev.stp.enabled = 'n/a (firewall)';
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
