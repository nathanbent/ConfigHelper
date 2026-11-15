/* Summary rows, CSV, label rows, JSON backup. No DOM in here so it is testable in Node. */
(function (root) {
  'use strict';
  const NP = root.NP;

  NP.csv = function (rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? '' : c);
        return /[",\r\n]/.test(c) || /^\s|\s$/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n') + '\r\n';
  };

  NP.vendorLabel = function (dev) {
    return NP.vendors[dev.vendor] ? NP.vendors[dev.vendor].label : dev.vendor || '';
  };

  NP.portStats = function (dev) {
    const phys = dev.ports.filter(function (p) { return p.kind === 'physical'; });
    const watts = phys.reduce(function (s, p) { return s + (parseFloat(p.poeWatts) || 0); }, 0);
    return {
      physical: phys.length,
      up: phys.filter(function (p) { return p.link === 'up'; }).length,
      down: phys.filter(function (p) { return p.link && p.link !== 'up' && p.link !== 'not present' && p.adminUp !== false; }).length,
      absent: phys.filter(function (p) { return p.link === 'not present'; }).length,
      disabled: phys.filter(function (p) { return p.adminUp === false; }).length,
      linkKnown: phys.some(function (p) { return p.link; }),
      poePorts: phys.filter(function (p) { return parseFloat(p.poeWatts) > 0; }).length,
      poeWatts: Math.round(watts * 10) / 10
    };
  };

  // -> [{title, rows:[[label, value], ...]}], empty values dropped
  NP.summary = function (dev) {
    const st = NP.portStats(dev);
    const sec = [
      { title: 'System', rows: [
        ['Hostname', dev.hostname], ['Platform', NP.vendorLabel(dev)], ['Model', dev.model],
        ['Software', dev.version], ['Serial', dev.serial], ['Management IP', dev.mgmtIp],
        ['Default gateway', dev.gateway], ['Domain', dev.domain]] },
      { title: 'Services', rows: [
        ['DNS servers', dev.dns.join(', ')], ['NTP servers', dev.ntp.join(', ')],
        ['Syslog servers', dev.syslog.join(', ')], ['SNMP', dev.snmp.versions.join(', ')],
        ['SNMP location', dev.snmp.location], ['SNMP contact', dev.snmp.contact]] },
      { title: 'Spanning tree', rows: [
        ['Enabled', dev.stp.enabled], ['Mode', dev.stp.mode], ['Bridge priority', dev.stp.priority.join('; ')],
        ['Notes', dev.stp.notes.join('; ')]] },
      { title: 'Multicast', rows: [
        ['IGMP snooping', dev.multicast.igmpSnooping], ['Querier', dev.multicast.querier],
        ['Multicast routing', dev.multicast.routing], ['Notes', dev.multicast.notes.join('; ')]] },
      { title: 'Ports', rows: [
        ['Physical ports', st.physical ? st.physical + (st.absent ? ' (' + st.absent + ' not present)' : '') : ''],
        ['Link up / down / disabled', st.linkKnown ? st.up + ' / ' + st.down + ' / ' + st.disabled : (st.disabled ? 'link state not loaded; ' + st.disabled + ' disabled' : '')],
        ['PoE in use', st.poePorts ? st.poePorts + ' ports, ' + st.poeWatts + ' W' : ''],
        ['VLANs defined', dev.vlans.length || '']] },
      { title: 'Other', rows: Object.keys(dev.other).map(function (k) { return [k, dev.other[k]]; }) }
    ];
    sec.forEach(function (s) { s.rows = s.rows.filter(function (r) { return r[1] !== '' && r[1] != null; }); });
    return sec.filter(function (s) { return s.rows.length; });
  };

  NP.summaryRows = function (dev) {
    const rows = [['Section', 'Item', 'Value']];
    NP.summary(dev).forEach(function (s) { s.rows.forEach(function (r) { rows.push([s.title, r[0], r[1]]); }); });
    dev.vlans.forEach(function (v) { rows.push(['VLANs', v.id, v.name]); });
    return rows;
  };

  NP.portRows = function (devs, colIds, filter) {
    const cols = NP.columns.filter(function (c) { return !colIds || colIds.includes(c.id); });
    const rows = [['Device'].concat(cols.map(function (c) { return c.label; }))];
    devs.forEach(function (dev) {
      dev.ports.filter(filter || function () { return true; }).forEach(function (p) {
        rows.push([dev.hostname].concat(cols.map(function (c) { return c.get(p); })));
      });
    });
    return rows;
  };

  // ------------------------------------------------------- command suggestions
  // Only commands whose output the parsers understand. "pager" turns off --More-- prompts.
  const CFG = 'VLANs, descriptions, STP, DNS, NTP and the rest';
  NP.commands = {
    ios: { pager: 'terminal length 0', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces status', gives: 'link state, speed, media type' },
      { cmd: 'show power inline', gives: 'PoE state, watts, class' },
      { cmd: 'show cdp neighbors detail', gives: 'what is plugged in (Cisco gear)' },
      { cmd: 'show lldp neighbors detail', gives: 'what is plugged in (everything else)' },
      { cmd: 'show version', gives: 'model, exact software version, serial' },
      { cmd: 'show spanning-tree', gives: 'per-port STP role and state (optional)' }] },
    nxos: { pager: 'terminal length 0', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interface status', gives: 'link state, speed, media type' },
      { cmd: 'show lldp neighbors', gives: 'what is plugged in' },
      { cmd: 'show cdp neighbors detail', gives: 'what is plugged in (Cisco gear)' },
      { cmd: 'show version', gives: 'model, software version, serial' }] },
    eos: { pager: 'terminal length 0', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces status', gives: 'link state, speed, media type' },
      { cmd: 'show lldp neighbors', gives: 'what is plugged in' },
      { cmd: 'show version', gives: 'model, software version, serial' }] },
    os10: { pager: 'terminal length 0', cmds: [
      { cmd: 'show running-configuration', gives: CFG }] },
    aoscx: { pager: 'no page', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interface brief', gives: 'link state, speed, media type' },
      { cmd: 'show lldp neighbor-info', gives: 'what is plugged in' }] },
    arubaos: { pager: 'no page', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces brief', gives: 'link state, speed, media type' },
      { cmd: 'show power-over-ethernet brief', gives: 'PoE state, watts, class' },
      { cmd: 'show lldp info remote-device', gives: 'what is plugged in' }] },
    comware: { pager: 'screen-length disable', cmds: [
      { cmd: 'display current-configuration', gives: CFG },
      { cmd: 'display interface brief', gives: 'link state, speed, duplex' }] },
    junos: { pager: 'set cli screen-length 0', cmds: [
      { cmd: 'show configuration | display set', gives: CFG },
      { cmd: 'show interfaces terse', gives: 'admin and link state' },
      { cmd: 'show lldp neighbors', gives: 'what is plugged in' },
      { cmd: 'show poe interface', gives: 'PoE state, watts, class' }] },
    fortigate: { pager: 'config system console\nset output standard\nend', cmds: [
      { cmd: 'show', gives: 'interfaces, zones, DNS, NTP, syslog, routes' },
      { cmd: 'get system status', gives: 'model, firmware version, serial' }] },
    mikrotik: { pager: '', cmds: [
      { cmd: '/export', gives: 'bridge ports, VLANs, addresses, DNS, NTP and the rest (on RouterOS 6 use "/export hide-sensitive")' }] }
  };
  // One block to paste into the terminal.
  NP.commandScript = function (vendor) {
    const c = NP.commands[vendor];
    if (!c) return '';
    return (c.pager ? [c.pager] : []).concat(c.cmds.map(function (x) { return x.cmd; })).join('\n') + '\n';
  };

  // ------------------------------------------------------------------ labels
  NP.labelTokens = {
    host: function (d) { return d.hostname; },
    port: function (d, p) { return p.short; },
    portfull: function (d, p) { return p.name; },
    num: function (d, p) { return NP.portNum(p.name); },
    desc: function (d, p) { return p.description; },
    vlan: function (d, p) { return p.untagged; },
    tagged: function (d, p) { return p.tagged; },
    voice: function (d, p) { return p.voiceVlan; },
    mode: function (d, p) { return p.mode; },
    neighbor: function (d, p) { return p.neighbor; },
    nport: function (d, p) { return p.neighborPort; },
    ninfo: function (d, p) { return p.neighborInfo; },
    ip: function (d, p) { return p.ip; },
    lag: function (d, p) { return p.lag; },
    speed: function (d, p) { return p.speed; }
  };
  NP.labelPresets = {
    port: { label: 'Port labels (faceplate / patch panel)', lines: ['{port}', '{desc}', ''] },
    cable: { label: 'Cable labels (both ends)', lines: ['{host} {port}', '{neighbor|desc} {nport}', ''] },
    vlan: { label: 'Port number + VLAN', lines: ['{num}', '[VLAN {vlan}]', '{desc}'] }
  };

  // "{a|b}" = first non-empty of a, b.  "[text {a}]" = dropped entirely when a is empty.
  NP.fillTemplate = function (tpl, dev, p) {
    const sub = function (s) {
      let empty = false;
      const out = s.replace(/\{([^}]+)\}/g, function (all, names) {
        let val = '';
        names.split('|').some(function (n) {
          const f = NP.labelTokens[n.trim().toLowerCase()];
          val = f ? String(f(dev, p) || '') : '';
          return val;
        });
        if (!val) empty = true;
        return val;
      });
      return { text: out, empty: empty };
    };
    const withOpt = String(tpl || '').replace(/\[([^\]]*)\]/g, function (all, inner) {
      const r = sub(inner);
      return r.empty ? '' : r.text;
    });
    return sub(withOpt).text.replace(/\s+/g, ' ').trim();
  };

  // opts: {lines:[..], physicalOnly, upOnly, describedOnly, skipDisabled}
  NP.labelFilter = function (opts) {
    return function (p) {
      if (opts.physicalOnly && p.kind !== 'physical') return false;
      if (p.link === 'not present') return false;
      if (opts.upOnly && p.link !== 'up') return false;
      if (opts.describedOnly && !p.description && !p.neighbor) return false;
      if (opts.skipDisabled && p.adminUp === false) return false;
      return true;
    };
  };
  NP.labelRows = function (devs, opts) {
    const lines = (opts.lines || []).map(function (l, i) { return { tpl: l, name: 'Line' + (i + 1) }; })
      .filter(function (l) { return l.tpl && l.tpl.trim(); });
    const rows = [lines.map(function (l) { return l.name; }).concat(['Device', 'Port', 'Description', 'VLAN'])];
    const keep = NP.labelFilter(opts);
    devs.forEach(function (dev) {
      dev.ports.filter(keep).forEach(function (p) {
        const filled = lines.map(function (l) { return NP.fillTemplate(l.tpl, dev, p); });
        if (!filled.some(Boolean)) return;
        rows.push(filled.concat([dev.hostname, p.short, p.description, p.untagged]));
      });
    });
    return rows;
  };

  // ------------------------------------------------------------------ backup
  NP.backup = function (devices) {
    return JSON.stringify({ format: 'confighelper-backup', version: 1, exported: new Date().toISOString(), devices: devices }, null, 1);
  };
  NP.restore = function (json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || (data.format !== 'confighelper-backup' && data.format !== 'portsheet-backup') || !Array.isArray(data.devices)) {
      throw new Error('That file is not a ConfigHelper backup.');
    }
    return data.devices.map(function (d) {
      const dev = Object.assign(NP.newDevice(), d);
      dev.ports = (d.ports || []).map(function (p) { return Object.assign(NP.newPort(p.name || '?'), p); });
      return dev;
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
