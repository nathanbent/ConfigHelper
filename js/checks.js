/* Config checks: things worth a second look, worked out from the parsed model (so they are
 * the same for every vendor). Each check only fires when the data it needs was actually loaded.
 * Findings are prompts to review, not verdicts: the tool cannot know intent. */
(function (root) {
  'use strict';
  const NP = root.NP;

  const IOS_FAMILY = ['ios', 'nxos', 'eos', 'os10'];
  // platforms where an edge port is something you configure per port (elsewhere it is automatic or on by default)
  const EXPLICIT_EDGE = ['ios', 'nxos', 'eos', 'os10', 'aoscx', 'arubaos', 'comware', 'junos', 'icx'];

  NP.checks = function (dev) {
    const out = [];
    const add = function (id, severity, title, detail, ports) {
      out.push({ id: id, severity: severity, title: title, detail: detail,
        ports: (ports || []).map(function (p) { return { key: p.key, short: p.short }; }) });
    };
    const all = NP.eports(dev, true);
    const phys = all.filter(function (p) { return p.kind === 'physical' && p.link !== 'not present'; });
    const l2 = all.filter(function (p) { return (p.kind === 'physical' || p.kind === 'lag') && p.link !== 'not present'; });
    const linkKnown = phys.some(function (p) { return p.link; });
    const managed = !!dev.other['Managed by'];                       // FortiLink child: services live on the FortiGate
    const isSwitch = dev.vendor !== 'fortigate' && dev.vendor !== 'paloalto';
    const configSeen = !!(dev.stp.mode || dev.vlans.length || dev.dns.length || dev.ntp.length || Object.keys(dev.other).length);
    const stpNotes = dev.stp.notes.join(' | ');
    const has = function (p, flag) { return p.stp.split(', ').some(function (f) { return f === flag || f.indexOf(flag + ' ') === 0; }); };
    const live = function (p) { return p.adminUp !== false && (!linkKnown || p.link === 'up'); };

    // ------------------------------------------------------------ port state
    let list = phys.filter(function (p) { return p.link === 'err-disabled'; });
    if (list.length) add('errdisabled', 'warn', 'Ports shut down by the switch (err-disabled)',
      'The switch disabled these ports itself, usually after a BPDU guard, port-security or link-flap event. Find the cause before re-enabling.', list);

    list = phys.filter(function (p) { return p.link === 'up' && p.duplex === 'half'; });
    if (list.length) add('halfduplex', 'warn', 'Ports running at half duplex',
      'Half duplex on a modern link nearly always means a speed/duplex mismatch or a bad cable.', list);

    list = phys.filter(function (p) { return /fault|deny|denied/i.test(p.poeStatus); });
    if (list.length) add('poefault', 'warn', 'PoE faults', 'The switch reports a PoE fault or refused power on these ports.', list);

    list = phys.filter(function (p) { return p.link === 'up' && !p.description && !p.lag; });
    if (list.length) add('nodesc', 'info', 'Connected ports with no description',
      'These ports have link but nothing says what is plugged in. Add a description on the switch, or on the Ports tab with Edit.', list);

    if (linkKnown) {
      list = phys.filter(function (p) { return p.adminUp === true && p.link === 'down'; });
      if (list.length) add('unusedenabled', 'info', 'Enabled ports with no link',
        'Nothing is connected right now. Ports that are permanently unused are safer shut down, or parked in an unused VLAN.', list);
    }

    // ------------------------------------------------------------ VLANs
    list = l2.filter(function (p) { return p.mode === 'trunk' && p.tagged === 'all' && p.adminUp !== false && !p.lag; });
    if (list.length) add('trunkall', 'info', 'Trunks carrying every VLAN',
      'No allowed-VLAN list is set, so every VLAN (and its broadcasts) reaches the far end. Usually fine on core uplinks; worth pruning towards APs and edge switches.', list);

    list = l2.filter(function (p) { return p.mode === 'trunk' && p.untagged === '1' && p.adminUp !== false && !p.lag; });
    if (list.length) add('native1', 'info', 'Trunks using VLAN 1 as the native VLAN',
      'Untagged traffic on these trunks lands in VLAN 1. Many sites move the native VLAN to a dedicated unused VLAN.', list);

    list = phys.filter(function (p) { return p.mode === 'access' && p.untagged === '1' && live(p) && !p.lag; });
    if (list.length && dev.vlans.some(function (v) { return v.id !== 1; })) add('accessvlan1', 'info', 'Access ports in the default VLAN 1',
      'These ports are ' + (linkKnown ? 'connected' : 'enabled') + ' and still in VLAN 1 although other VLANs are defined.', list);

    if (dev.vlans.length && isSwitch) {
      const defined = {};
      dev.vlans.forEach(function (v) { defined[v.id] = true; });
      const missing = {};
      list = l2.filter(function (p) {
        const ids = [p.untagged, p.voiceVlan].filter(function (v) { return /^\d+$/.test(v); }).map(Number);
        if (p.tagged && p.tagged !== 'all' && /^[\d,\-]+$/.test(p.tagged)) {
          const t = NP.parseVlanList(p.tagged);
          if (t.length <= 64) ids.push.apply(ids, t);
        }
        const bad = ids.filter(function (id) { return id !== 1 && !defined[id]; });
        bad.forEach(function (id) { missing[id] = true; });
        return bad.length > 0;
      });
      if (list.length) add('undefinedvlan', 'warn', 'Ports use VLANs that are not defined: ' + NP.compressVlans(Object.keys(missing).map(Number)),
        'A port assigned to a VLAN that does not exist on the switch passes no traffic in that VLAN. (If VLANs come from VTP or another source the config does not show, ignore this.)', list);
    }

    // ------------------------------------------------------------ spanning tree
    const stpOn = !/^no/.test(dev.stp.enabled) && !/^n\/a/.test(dev.stp.enabled);
    if (isSwitch && configSeen && /^no/.test(dev.stp.enabled)) {
      add('stpoff', 'warn', 'Spanning tree is disabled', 'With spanning tree off, one accidental loop can take the network down.', []);
    }
    if (dev.vendor === 'ios' && /^pvst\b/.test(dev.stp.mode)) {
      add('stplegacy', 'info', 'Legacy spanning-tree mode (PVST+)', 'Classic 802.1D timers mean 30 to 50 seconds to recover from a topology change. Rapid PVST+ or MST converge in about a second.', []);
    }
    if (IOS_FAMILY.includes(dev.vendor) && /^mst/.test(dev.stp.mode) && dev.stp.priority.some(function (p) { return /^VLAN /.test(p); })) {
      add('stpprio', 'info', 'Per-VLAN spanning-tree priority has no effect in MST mode',
        'The switch runs MST, where only the per-instance priority counts (' +
        (dev.stp.priority.filter(function (p) { return /^MST /.test(p); }).join('; ') || 'none set') + '). The "spanning-tree vlan ... priority" lines are leftovers.', []);
    }
    if (IOS_FAMILY.includes(dev.vendor)) {
      list = l2.filter(function (p) { return p.mode === 'trunk' && has(p, 'edge') && !/edge \(trunk\)/.test(p.stp); });
      if (list.length) add('portfasttrunk', 'info', 'PortFast on a trunk without the "trunk" keyword',
        'Plain "spanning-tree portfast" is ignored on trunk ports, so these ports still go through listening and learning. Use "portfast trunk" (or "port type edge trunk") if that is what you want, or remove it.', list);
    }
    if (stpOn && configSeen && EXPLICIT_EDGE.includes(dev.vendor)) {
      const edgeDefault = /portfast (edge )?default|port type edge default|all interfaces: edge/.test(stpNotes);
      const guardDefault = /bpduguard default|bpdu-block-on-edge|bpdu-protection/.test(stpNotes);
      if (!edgeDefault) {
        list = phys.filter(function (p) { return p.mode === 'access' && !p.lag && live(p) && !has(p, 'edge') && !p.neighbor; });
        if (list.length) add('noedge', 'info', 'Access ports not set as edge ports (PortFast)',
          'Without it, a device waits through spanning-tree listening and learning at link-up (DHCP timeouts on boot), and every link flap sends a topology change through the network.', list);
      }
      if (!guardDefault) {
        list = phys.filter(function (p) { return has(p, 'edge') && !has(p, 'bpduguard') && p.adminUp !== false; });
        if (list.length) add('noguard', 'info', 'Edge ports without BPDU guard',
          'An edge port skips the loop check at link-up. BPDU guard shuts the port if someone plugs a switch into it.', list);
      }
    }

    // ------------------------------------------------------------ services
    if (configSeen && !managed) {
      if (!dev.ntp.length) add('nontp', 'warn', 'No NTP server configured', 'Without time sync, log timestamps cannot be compared across devices and certificate checks can fail.', []);
      if (!dev.syslog.length) add('nosyslog', 'info', 'No syslog server configured', 'Logs only live in the device buffer and are lost on reload.', []);
      if (dev.snmp.versions.includes('v2c') && !dev.snmp.versions.includes('v3')) {
        add('snmpv2', 'info', 'SNMP uses community strings only (no v3)', 'SNMP v1/v2c sends the community string and all data in clear text.', []);
      }
      if (dev.other['HTTP server'] === 'enabled' || dev.other['Web management'] === 'enabled') {
        add('http', 'warn', 'Management over plain HTTP is enabled', 'Logins to the web interface cross the network unencrypted. Disable the HTTP server and keep HTTPS.', []);
      }
      if (dev.other.Telnet === 'enabled' || /\b(telnet|all)\b/.test(dev.other['VTY access'] || '')) {
        add('telnet', 'warn', 'Telnet management is allowed', 'Telnet sends passwords in clear text. Restrict remote access to SSH.', []);
      }
      if (dev.other['DHCP snooping'] && !all.some(function (p) { return /dhcp-snooping trust/.test(p.notes); })) {
        add('snoopnotrust', 'warn', 'DHCP snooping is on but no port is trusted', 'With no trusted port, replies from the real DHCP server are dropped and clients get no address.', []);
      }
    }

    // ------------------------------------------------------------ LAGs
    const members = {};
    all.forEach(function (p) { if (p.lag) (members[p.lag.toLowerCase()] = members[p.lag.toLowerCase()] || []).push(p); });
    list = all.filter(function (p) {
      return p.kind === 'lag' && [p.short, p.name].some(function (n) { const m = members[n.toLowerCase()]; return m && m.length === 1; });
    });
    if (list.length) add('lagsingle', 'info', 'Link aggregation groups with a single member',
      'A LAG with one port gives no redundancy or extra capacity. Fine if the second link is planned; otherwise it may be a leftover.', list);

    // ------------------------------------------------------------ firewall interfaces
    if (dev.vendor === 'fortigate' || dev.vendor === 'paloalto') {
      const acc = function (p) { const m = p.notes.match(/access ([^;]+)/); return m ? m[1].split('/') : []; };
      list = all.filter(function (p) { return acc(p).some(function (a) { return a === 'http' || a === 'telnet'; }); });
      if (list.length) add('fgclear', 'warn', 'Interfaces allowing HTTP or Telnet administration', 'Administrative logins on these interfaces can cross the network unencrypted.', list);
      // FortiGate marks WAN interfaces with a role; on PAN-OS go by the usual zone names
      const wan = function (p) { return /role wan/.test(p.notes) || /zone \S*(untrust|wan|internet|outside|external)/i.test(p.notes); };
      list = all.filter(function (p) { return wan(p) && p.adminUp !== false && acc(p).some(function (a) { return /^(https|ssh|http|telnet|snmp)$/.test(a); }); });
      if (list.length) add('fgwanadmin', 'warn', 'Administrative access enabled on WAN interfaces',
        'The management interface is reachable from the internet side. Restrict it with trusted hosts or a local-in policy, or turn it off.', list);
    }

    const rank = { warn: 0, info: 1 };
    return out.sort(function (a, b) { return rank[a.severity] - rank[b.severity]; });
  };

  NP.checksText = function (dev) {
    const out = ['ConfigHelper checks for ' + (dev.hostname || 'device') + ' (' + NP.vendorLabel(dev) + ')'];
    const c = NP.checks(dev);
    if (!c.length) out.push('', 'Nothing flagged.');
    c.forEach(function (f) {
      out.push('', (f.severity === 'warn' ? '[Fix]    ' : '[Review] ') + f.title, '  ' + f.detail);
      if (f.ports.length) out.push('  Ports (' + f.ports.length + '): ' + f.ports.map(function (p) { return p.short; }).join(', '));
    });
    return out.join('\n') + '\n';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
