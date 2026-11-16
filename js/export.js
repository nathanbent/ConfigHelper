/* Summary rows, CSV, label rows, JSON backup. No DOM in here so it is testable in Node. */
(function (root) {
  'use strict';
  const NP = root.NP;

  NP.csv = function (rows, delim) {
    delim = delim || ',';
    const needs = new RegExp('["\\r\\n' + (delim === '\t' ? '\\t' : delim) + ']');
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? '' : c);
        return needs.test(c) || /^\s|\s$/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(delim);
    }).join('\r\n') + '\r\n';
  };

  // rows (first row = header) -> text in one of the export formats
  NP.formats = {
    csv: { label: 'CSV (Excel, Sheets)', ext: 'csv', mime: 'text/csv' },
    tsv: { label: 'Tab-separated text', ext: 'txt', mime: 'text/plain' },
    md: { label: 'Markdown table (wiki, tickets)', ext: 'md', mime: 'text/markdown' },
    json: { label: 'JSON', ext: 'json', mime: 'application/json' }
  };
  NP.mdTable = function (rows) {
    const cell = function (c) { return String(c == null ? '' : c).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); };
    if (!rows.length) return '';
    return ['| ' + rows[0].map(cell).join(' | ') + ' |', '|' + rows[0].map(function () { return ' --- '; }).join('|') + '|']
      .concat(rows.slice(1).map(function (r) { return '| ' + r.map(cell).join(' | ') + ' |'; })).join('\n') + '\n';
  };
  NP.formatRows = function (rows, fmt) {
    if (fmt === 'tsv') {
      return rows.map(function (r) {
        return r.map(function (c) { return String(c == null ? '' : c).replace(/[\t\r\n]+/g, ' '); }).join('\t');
      }).join('\r\n') + '\r\n';
    }
    if (fmt === 'md') return NP.mdTable(rows);
    if (fmt === 'json') {
      return JSON.stringify(rows.slice(1).map(function (r) {
        const o = {};
        rows[0].forEach(function (h, i) { o[h] = r[i] == null ? '' : r[i]; });
        return o;
      }), null, 1) + '\n';
    }
    return '\ufeff' + NP.csv(rows);          // BOM so Excel reads UTF-8
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
      NP.eports(dev).filter(filter || function () { return true; }).forEach(function (p) {
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
      { cmd: 'show running-configuration', gives: CFG },
      { cmd: 'show interface status', gives: 'link state, speed, duplex' },
      { cmd: 'show lldp neighbors', gives: 'what is plugged in' },
      { cmd: 'show version', gives: 'model, software version' }] },
    os9: { pager: 'terminal length 0', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces status', gives: 'link state, speed, duplex' },
      { cmd: 'show lldp neighbors', gives: 'what is plugged in' },
      { cmd: 'show version', gives: 'model, software version' }] },
    os6: { pager: 'terminal length 0', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces status', gives: 'link state, speed, duplex' },
      { cmd: 'show power inline', gives: 'PoE state, watts, class' },
      { cmd: 'show lldp remote-device all', gives: 'what is plugged in' },
      { cmd: 'show version', gives: 'model, software version, serial' }] },
    aoscx: { pager: 'no page', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interface brief', gives: 'link state, speed, media type' },
      { cmd: 'show lldp neighbor-info', gives: 'what is plugged in' }] },
    arubaos: { pager: 'no page', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces brief', gives: 'link state, speed, media type' },
      { cmd: 'show power-over-ethernet brief', gives: 'PoE state, watts, class' },
      { cmd: 'show lldp info remote-device', gives: 'what is plugged in' }] },
    icx: { pager: 'skip-page-display', cmds: [
      { cmd: 'show running-config', gives: CFG },
      { cmd: 'show interfaces brief', gives: 'link state, speed, STP state, LAG membership' },
      { cmd: 'show inline power', gives: 'PoE state, watts, class' },
      { cmd: 'show lldp neighbors detail', gives: 'what is plugged in' },
      { cmd: 'show version', gives: 'model, software version, serial' }] },
    comware: { pager: 'screen-length disable', cmds: [
      { cmd: 'display current-configuration', gives: CFG },
      { cmd: 'display interface brief', gives: 'link state, speed, duplex' }] },
    junos: { pager: 'set cli screen-length 0', cmds: [
      { cmd: 'show configuration | display set', gives: CFG },
      { cmd: 'show interfaces terse', gives: 'admin and link state' },
      { cmd: 'show lldp neighbors', gives: 'what is plugged in' },
      { cmd: 'show poe interface', gives: 'PoE state, watts, class' },
      { cmd: 'show version', gives: 'model, software version' },
      { cmd: 'show chassis hardware', gives: 'serial number' }] },
    // FortiOS "show" with no argument prints the whole configuration (policies, objects, VPNs ...).
    // These ask only for the sections that are read.
    fortigate: { pager: 'config system console\nset output standard\nend',
      note: 'With VDOMs enabled, enter "config global" first. A full backup .conf (or plain "show") works too: the rest of it is ignored.',
      cmds: [
        { cmd: 'get system status', gives: 'model, firmware version, serial, hostname' },
        { cmd: 'show system interface', gives: 'ports, VLAN interfaces, aggregates, addresses' },
        { cmd: 'show system zone', gives: 'which zone each interface is in' },
        { cmd: 'show system dns', gives: 'DNS servers' },
        { cmd: 'show system ntp', gives: 'NTP servers' },
        { cmd: 'show log syslogd setting', gives: 'syslog server' },
        { cmd: 'show system snmp sysinfo', gives: 'SNMP location and contact' },
        { cmd: 'show router static', gives: 'default route' },
        { cmd: 'show system ha', gives: 'HA mode' }] },
    fortilink: { pager: 'config system console\nset output standard\nend',
      note: 'Run these on the FortiGate: each managed switch becomes its own device. With VDOMs enabled, enter "config global" first. ' +
        'Link state, PoE draw and LLDP neighbours are not in the FortiGate configuration; for those, log in to the switch itself ' +
        '(its CLI still works while it is managed) and use the "standalone" list.',
      cmds: [
        { cmd: 'get system status', gives: 'FortiGate model, firmware version, hostname' },
        { cmd: 'show system interface', gives: 'VLAN names and IDs the switch ports refer to' },
        { cmd: 'show switch-controller managed-switch', gives: 'every managed switch: ports, VLANs, PoE, trunks' },
        { cmd: 'show switch-controller stp-settings', gives: 'MST region shared by the switches' }] },
    fortiswitch: { pager: 'config system console\nset output standard\nend', cmds: [
      { cmd: 'show', gives: 'ports, VLANs, trunks, STP, DNS, NTP, syslog' },
      { cmd: 'get system status', gives: 'model, firmware version, serial' },
      { cmd: 'diagnose switch physical-ports summary', gives: 'link state, speed, duplex' },
      { cmd: 'get switch poe inline', gives: 'PoE state and watts' },
      { cmd: 'get switch lldp neighbors-summary', gives: 'what is plugged in' }] },
    paloalto: { pager: 'set cli pager off\nset cli config-output-format set', cmds: [
      { cmd: 'configure', gives: 'enter configuration mode (needed to print the config)' },
      { cmd: 'show', gives: 'interfaces, zones, virtual routers, DNS, NTP, syslog (or upload the exported running-config.xml instead)' },
      { cmd: 'exit', gives: 'leave configuration mode' },
      { cmd: 'show system info', gives: 'model, software version, serial' },
      { cmd: 'show interface all', gives: 'link state, speed, zone, addresses' }] },
    pfsense: { pager: '', cmds: [
      { cmd: 'cat /conf/config.xml', gives: 'the whole configuration. Easier: in the web interface use Diagnostics > Backup & Restore (pfSense) or System > Configuration > Backups (OPNsense), download the XML and drop the file on the box below' }] },
    unifi: { pager: '', cmds: [
      { cmd: 'mca-dump', gives: 'run on the switch over SSH: ports, link, speed, PoE and neighbors as JSON, but no VLAN names. For VLANs use the controller instead: while logged in, open https://<controller>/proxy/network/api/s/default/stat/device and .../rest/networkconf (on a classic controller, https://<host>:8443/api/s/default/...), save both and paste or drop them together' }] },
    mikrotik: { pager: '', cmds: [
      { cmd: '/export', gives: 'bridge ports, VLANs, addresses, DNS, NTP and the rest (on RouterOS 6 use "/export hide-sensitive")' }] }
  };
  // The platform picker: brand, then operating system. "id" names the command list above; "parser" is the
  // parser the pasted output goes to when that differs (FortiLink switches are read out of a FortiGate config).
  NP.platforms = [
    { id: 'eos', brand: 'Arista', name: 'EOS' },
    { id: 'aoscx', brand: 'Aruba / HPE', name: 'AOS-CX' },
    { id: 'arubaos', brand: 'Aruba / HPE', name: 'AOS-Switch / ProCurve' },
    { id: 'comware', brand: 'Aruba / HPE', name: 'Comware / H3C' },
    { id: 'ios', brand: 'Cisco', name: 'IOS / IOS-XE' },
    { id: 'nxos', brand: 'Cisco', name: 'NX-OS' },
    { id: 'os10', brand: 'Dell', name: 'OS10 (SmartFabric)' },
    { id: 'os9', brand: 'Dell', name: 'OS9 (S/Z-series, FTOS)' },
    { id: 'os6', brand: 'Dell', name: 'OS6 (N-series)' },
    { id: 'fortigate', brand: 'Fortinet', name: 'FortiGate' },
    { id: 'fortilink', parser: 'fortigate', brand: 'Fortinet', name: 'FortiSwitch via FortiGate (FortiLink)' },
    { id: 'fortiswitch', brand: 'Fortinet', name: 'FortiSwitch standalone (own CLI)' },
    { id: 'junos', brand: 'Juniper', name: 'Junos' },
    { id: 'mikrotik', brand: 'MikroTik', name: 'RouterOS' },
    { id: 'paloalto', brand: 'Palo Alto', name: 'PAN-OS' },
    { id: 'pfsense', brand: 'pfSense / OPNsense', name: 'config.xml' },
    { id: 'icx', brand: 'Ruckus / Brocade', name: 'FastIron (ICX)' },
    { id: 'unifi', brand: 'Ubiquiti', name: 'UniFi' }
  ];
  NP.platform = function (id) { return NP.platforms.find(function (p) { return p.id === id; }) || null; };
  // platform id -> parser id ('auto' and unknown ids pass through)
  NP.platformParser = function (id) { const p = NP.platform(id); return p ? p.parser || p.id : id; };
  NP.platformLabel = function (id) { const p = NP.platform(id); return p ? p.brand + ' ' + p.name : id; };
  NP.brands = function () {
    const out = [];
    NP.platforms.forEach(function (p) { if (!out.includes(p.brand)) out.push(p.brand); });
    return out;
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
    portid: function (d, p) { return String(p.short || '').replace(/^[^\d]*/, ''); },
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
    speed: function (d, p) { return p.speed; },
    // device-level
    mgmtip: function (d) { return (d.mgmtIp || '').split(',')[0].replace(/\/\d+/, '').replace(/\s*\(.*\)$/, '').trim(); },
    model: function (d) { return d.model; },
    serial: function (d) { return d.serial; },
    version: function (d) { return d.version; },
    location: function (d) { return d.snmp ? d.snmp.location : ''; }
  };
  // what each field holds, shown when hovering a field button on the Labels tab
  NP.labelTokenHelp = {
    host: 'Device hostname', port: 'Short port name (Gi1/0/1)', portfull: 'Full port name (GigabitEthernet1/0/1)',
    portid: 'Port without its type prefix (Eth1/1/1 -> 1/1/1)',
    num: 'Port number only (1)', desc: 'Port description', vlan: 'Access or native (untagged) VLAN',
    tagged: 'Tagged (trunk) VLANs', voice: 'Voice VLAN', mode: 'access, trunk, routed ...', neighbor: 'CDP/LLDP neighbor name',
    nport: 'Neighbor port', ninfo: 'Neighbor platform / details', ip: 'Port IP address', lag: 'Port-channel / LAG',
    speed: 'Port speed', mgmtip: 'Device management IP', model: 'Device model', serial: 'Device serial number',
    version: 'Software version', location: 'SNMP location'
  };
  NP.labelDeviceTokens = { host: true, mgmtip: true, model: true, serial: true, version: true, location: true };
  // ready-made snippets offered next to the fields
  NP.labelSnippets = [
    { text: '[n{vlan}] [t{tagged}]', help: 'Native and tagged VLANs: n10 t20,30 (each part left out when empty)' },
    { text: '[VLAN {vlan}]', help: 'VLAN 10, left out when the port has no VLAN' },
    { text: '{neighbor|desc}', help: 'Neighbor name, or the description when there is no neighbor' }
  ];
  // per: 'port' = one label per port, 'device' = one label per device
  NP.labelPresets = {
    port: { label: 'Port labels (port + description)', per: 'port', lines: ['{port}', '{desc}', ''] },
    panel: { label: 'Patch panel / faceplate (port number only)', per: 'port', lines: ['{num}', '', ''] },
    vlan: { label: 'Port number + VLAN', per: 'port', lines: ['{num}', '[VLAN {vlan}]', ''] },
    vlans: { label: 'Port number + native/tagged VLAN', per: 'port', lines: ['{num}', '[n{vlan}] [t{tagged}]', ''] },
    wrap: { label: 'Cable wrap (port, <description>, native/tagged VLAN)', per: 'port', lines: ['{port}', '[<{desc}>]', '[n{vlan}] [t{tagged}]'] },
    cable: { label: 'Cable labels (this end and far end)', per: 'port', lines: ['{host} {port}', '{neighbor|desc} {nport}', ''] },
    device: { label: 'Device / asset labels (one per device)', per: 'device', lines: ['{host}', '{mgmtip}', '{model} [SN {serial}]'] }
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

  // ------------------------------------------------------- text replacements
  // [{find, replace, off}] applied in order to each filled label line (off: switched off, skipped). find is plain text matched in any case, or
  // /pattern/flags for a regular expression ($1 in replace for its groups). -> fn(text), with fn.errors listing
  // the finds that are not valid regular expressions (those are skipped).
  NP.labelReplacer = function (list) {
    const errors = [];
    const steps = (list || []).filter(function (r) { return r && r.find && !r.off; }).map(function (r) {
      const m = /^\/(.+)\/([a-z]*)$/.exec(r.find);
      try {
        const re = m ? new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g')
          : new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return { re: re, to: m ? String(r.replace || '') : String(r.replace || '').replace(/\$/g, '$$$$') };
      } catch (e) { errors.push(r.find); return null; }
    }).filter(Boolean);
    const fn = function (text) {
      if (!steps.length) return text;
      return steps.reduce(function (t, x) { return t.replace(x.re, x.to); }, text).replace(/\s+/g, ' ').trim();
    };
    fn.errors = errors;
    return fn;
  };

  // opts: physicalOnly, upOnly, describedOnly, skipDisabled, match ("ap, 1/0/1" = any of these, anywhere in the row),
  //       rules ([{field, op, value}], all must match; see NP.labelRuleTest)
  NP.labelFilter = function (opts) {
    const rules = (opts.rules || []).filter(function (r) { return r && r.field && r.op; });
    const terms = String(opts.match || '').toLowerCase().split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    return function (p) {
      if (opts.unit && NP.portUnit(p) !== opts.unit) return false;
      if (opts.physicalOnly && p.kind !== 'physical') return false;
      if (p.link === 'not present') return false;
      if (opts.upOnly && p.link !== 'up') return false;
      if (opts.describedOnly && !p.description && !p.neighbor) return false;
      if (opts.skipDisabled && p.adminUp === false) return false;
      if (terms.length) {
        const hay = [p.name, p.short, p.description, p.neighbor, p.untagged, p.mode, p.lag].join(' ').toLowerCase();
        if (!terms.some(function (t) { return hay.includes(t); })) return false;
      }
      if (rules.length && !rules.every(function (r) { return NP.labelRuleTest(r, p); })) return false;
      return true;
    };
  };

  // ------------------------------------------------------------ label conditions
  // Custom conditions on any port column: {field, op, value}. All set conditions must match.
  // VLAN columns compare as VLAN lists ("tagged contains 30" is true for 10,30-40 but not for 130);
  // in other columns a comma means "any of" (description contains "ap, printer").
  NP.labelRuleOps = [['is', 'is'], ['not', 'is not'], ['has', 'contains'], ['lacks', 'does not contain'],
    ['empty', 'is empty'], ['set', 'is not empty']];
  const VLAN_COLS = { untagged: true, tagged: true, voiceVlan: true };
  const vlanList = function (s) { return /^[\d,\-\s]+$/.test(s) ? NP.parseVlanList(s.replace(/\s+/g, '')) : null; };
  NP.labelRuleTest = function (rule, p) {
    const c = NP.columns.find(function (x) { return x.id === rule.field; });
    if (!c || !rule.op) return true;
    const v = String(c.get(p) == null ? '' : c.get(p)).trim().toLowerCase();
    if (rule.op === 'empty') return !v;
    if (rule.op === 'set') return !!v;
    const want = String(rule.value || '').trim().toLowerCase();
    if (!want) return true;                                  // half-filled condition: ignored until it has a value
    const negate = rule.op === 'not' || rule.op === 'lacks';
    const exact = rule.op === 'is' || rule.op === 'not';
    let hit;
    const wl = VLAN_COLS[rule.field] ? vlanList(want) : null, vl = wl ? vlanList(v || '') : null;
    if (wl && vl) {
      hit = exact ? wl.length === vl.length && wl.every(function (x) { return vl.includes(x); })
        : wl.every(function (x) { return vl.includes(x); });
    } else {
      const terms = want.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      hit = terms.some(function (t) { return exact ? v === t : v.includes(t); });
    }
    return negate ? !hit : hit;
  };

  // ------------------------------------------------------------- print only ...
  // opts.only narrows the ports further, using the device as a whole:
  //   'odd'     ports whose VLAN setup (mode, native, tagged, voice) is not the one most ports have
  //   'edited'  ports with a manual edit (Edit on the Ports tab, or a Normalize correction)
  //   'snap'    ports whose label text differs from what it was in a snapshot (opts.snap = index, default the
  //             latest), plus ports that are new since. Devices without a snapshot give no labels.
  NP.labelOddFields = ['mode', 'untagged', 'tagged', 'voiceVlan'];
  const setupSig = function (p) { return NP.labelOddFields.map(function (f) { return p[f] || ''; }).join('|'); };
  // The setup most of these ports share: {sig, text, count, of, tied (other setups with as many ports)}, or null.
  NP.labelUsual = function (ports) {
    const n = {};
    ports.forEach(function (p) { const s = setupSig(p); n[s] = (n[s] || 0) + 1; });
    const best = Object.keys(n).sort(function (a, b) { return n[b] - n[a] || NP.naturalCompare(a, b); })[0];
    if (best === undefined) return null;
    const f = best.split('|');
    const text = [f[0], f[1] && (f[0] === 'access' ? 'VLAN ' : 'native ') + f[1], f[2] && 'tagged ' + f[2], f[3] && 'voice ' + f[3]]
      .filter(Boolean).join(', ') || 'no VLAN settings';
    const tied = Object.keys(n).filter(function (k) { return k !== best && n[k] === n[best]; }).length;
    return { sig: best, text: text, count: n[best], of: ports.length, tied: tied };
  };
  NP.labelSnapshot = function (dev, opts) {
    const snaps = dev.snapshots || [];
    const i = opts.snap == null || opts.snap === '' ? snaps.length - 1 : +opts.snap;
    return snaps[i] || snaps[snaps.length - 1] || null;       // a deleted snapshot falls back to the latest
  };
  NP.labelOnly = function (dev, ports, opts, lines) {
    if (opts.only === 'edited') {
      return ports.filter(function (p) { return p.edited && Object.keys(p.edited).length; });
    }
    if (opts.only === 'odd') {
      const u = NP.labelUsual(ports);
      return u ? ports.filter(function (p) { return setupSig(p) !== u.sig; }) : ports;
    }
    if (opts.only === 'snap') {
      const snap = NP.labelSnapshot(dev, opts);
      if (!snap) return [];
      const old = {};
      (snap.data.ports || []).forEach(function (p) { old[p.key] = p; });
      return ports.filter(function (p) {
        const o = old[p.key];
        return !o || lines.some(function (l) { return NP.fillTemplate(l.tpl, dev, p) !== NP.fillTemplate(l.tpl, snap.data, o); });
      });
    }
    return ports;
  };

  // opts adds: lines:[..], per:'port'|'device', refCols (extra Device/Port/Description/VLAN columns),
  //            maxLen (trim each line to N characters, 0 = no limit), dedupe (drop repeated labels),
  //            only ('odd' | 'edited' | 'snap', see NP.labelOnly) and snap (snapshot index for 'snap'),
  //            replace ([{find, replace}], see NP.labelReplacer; applied before the character limit)
  NP.labelRows = function (devs, opts) {
    const lines = (opts.lines || []).map(function (l, i) { return { tpl: l, name: 'Line' + (i + 1) }; })
      .filter(function (l) { return l.tpl && l.tpl.trim(); });
    const perDevice = opts.per === 'device';
    const ref = opts.refCols ? (perDevice ? ['Device'] : ['Device', 'Port', 'Description', 'VLAN']) : [];
    const rows = [lines.map(function (l) { return l.name; }).concat(ref)];
    const keep = NP.labelFilter(opts);
    const max = +opts.maxLen || 0;
    const edit = NP.labelReplacer(opts.replace);
    const seen = {};
    const add = function (dev, p) {
      const filled = lines.map(function (l) {
        const t = edit(NP.fillTemplate(l.tpl, dev, p));
        return max > 0 && t.length > max ? t.slice(0, max).trim() : t;
      });
      if (!filled.some(Boolean)) return;
      if (opts.dedupe) {
        const k = filled.join('\u0001');
        if (seen[k]) return;
        seen[k] = true;
      }
      rows.push(filled.concat(!opts.refCols ? [] : perDevice ? [dev.hostname] : [dev.hostname, p.short, p.description, p.untagged]));
    };
    devs.forEach(function (dev) {
      if (perDevice) add(dev, NP.newPort(''));
      else NP.labelOnly(dev, NP.eports(dev).filter(keep), opts, lines).forEach(function (p) { add(dev, p); });
    });
    return rows;
  };

  // --------------------------------------------------------------- not parsed
  // -> [{title, hint, items:[{text, count, inner}]}] in a fixed, useful order
  NP.unparsedGroups = function (dev) {
    const known = {
      command: ['Commands whose output was not used', 'Either the parser does not know this command, or its output format was not recognised.'],
      'interface': ['Interface settings not read', 'Lines under an interface that were skipped.'],
      vlan: ['VLAN settings not read', 'Lines under a VLAN that were skipped.'],
      global: ['Global lines not read', 'Top-level config lines that were skipped. "+N lines" counts the indented lines beneath one.'],
      section: ['Config sections not read', 'Whole sections that were skipped.'],
      block: ['Config sections not read', 'Whole "config ..." sections that were skipped, with the number of settings inside.']
    };
    const order = ['command', 'interface', 'vlan', 'global'];
    const by = {};
    (dev.unparsed || []).forEach(function (e) { (by[e.ctx] = by[e.ctx] || []).push(e); });
    const ctxs = Object.keys(by).sort(function (a, b) {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      const ra = ia >= 0 ? ia : known[a] ? 90 : 50, rb = ib >= 0 ? ib : known[b] ? 90 : 50;
      return ra - rb || (a < b ? -1 : 1);
    });
    return ctxs.map(function (c) {
      const k = known[c] || ['Settings not read in "config ' + c + '"', 'Setting names only; values are never kept.'];
      return { ctx: c, title: k[0], hint: k[1], items: by[c].slice().sort(function (a, b) { return b.count - a.count || (a.text < b.text ? -1 : 1); }) };
    });
  };
  NP.unparsedText = function (dev) {
    const out = ['ConfigHelper: input not parsed for ' + (dev.hostname || 'device') + ' (' + NP.vendorLabel(dev) + ')'];
    NP.unparsedGroups(dev).forEach(function (g) {
      out.push('', g.title + ':');
      g.items.forEach(function (e) {
        out.push('  ' + e.text + (e.count > 1 ? '   x' + e.count : '') + (e.inner ? '   (+' + e.inner + ' lines)' : ''));
      });
    });
    return out.join('\n') + '\n';
  };

  // -------------------------------------------------------------- parse debug
  // The last paste for this device as plain text: what went in, what was worked out, what came out.
  // Counts, commands and pattern names only, so it is safe to copy into a bug report.
  NP.debugText = function (dev) {
    const d = dev && dev.debug;
    if (!d) return '';
    const label = function (v) { return NP.vendors[v] ? NP.vendors[v].label : v; };
    const out = ['ConfigHelper parse debug: ' + d.app + ', ' + d.at];
    const i = d.input, o = d.output, m = d.misses;
    out.push('', 'INPUT',
      '  source: ' + d.source + (d.part ? ' (device ' + d.part + ' in the paste)' : '') + ', ' + i.chars + ' chars, ' + i.lines + ' lines',
      '  cleanup: ' + (i.cleaned.join('; ') || 'none needed'),
      '  sections: ' + i.sectionCount + (i.sectionCount > i.sections.length ? ' (first ' + i.sections.length + ' shown)' : ''));
    i.sections.forEach(function (s) {
      out.push('    ' + (s.cmd || '(no command: text before the first prompt)') + ' | ' + s.lines + ' lines | ' +
        (s.noise ? 'skipped: terminal setup' : s.used ? 'used: ' + s.ports + ' ports, ' + s.vlans + ' VLANs on its own' : 'NOT USED'));
    });
    out.push('', 'WORKED OUT',
      '  platform: ' + label(d.detect.vendor) + ' [' + d.detect.vendor + '], ' + d.detect.how);
    d.detect.matches.forEach(function (x, n) {
      out.push('    ' + (n ? 'also matches ' : 'detected as ') + x.vendor + ' by ' + x.pattern);
    });
    if (!d.detect.matches.length) out.push('    no detection rule matches this input');
    else if (d.detect.matches[0].vendor !== d.detect.vendor) out.push('    NOTE: auto-detection would have picked ' + d.detect.matches[0].vendor);
    out.push('  target: ' + (d.target.isNew ? 'new device' : 'merged into an existing device') + ' (' + d.target.why + ')',
      '  lines not used: ' + m.seen + ' distinct, ' + m.noise + ' dropped as known noise, ' + m.added + ' new on the Not parsed list; ' +
        m.unusedCommands + ' command(s) with unused output',
      '  time: ' + d.ms.total + ' ms (' + ['clean', 'detect', 'probe', 'parse', 'sections', 'finish'].map(function (k) { return k + ' ' + d.ms[k]; }).join(', ') + ')');
    out.push('', 'OUTPUT',
      '  ports: ' + o.ports + ' (' + o.portsAdded + ' new, ' + o.portsChanged + ' changed by this paste): ' +
        (Object.keys(o.kinds).map(function (k) { return o.kinds[k] + ' ' + k; }).join(', ') || 'none'),
      '  VLANs: ' + o.vlans + ' (' + o.vlansAdded + ' new)' + (o.children ? '   managed switches: ' + o.children : ''));
    const cols = Object.keys(o.filled);
    out.push('  filled on the ' + o.physical + ' physical ports: ' +
      (cols.filter(function (k) { return o.filled[k]; }).map(function (k) { return k + ' ' + o.filled[k]; }).join(', ') || 'nothing'),
      '  empty on every physical port: ' + (cols.filter(function (k) { return !o.filled[k]; }).join(', ') || 'none'),
      '  device fields set: ' + (o.set.join(', ') || 'none'),
      '  device fields empty: ' + (o.empty.join(', ') || 'none'));
    return out.join('\n') + '\n';
  };

  // ------------------------------------------------------------- device report
  // One Markdown document per device: overview, VLANs, port table.
  NP.deviceReport = function (dev, colIds) {
    const out = ['# ' + (dev.hostname || 'Device'), ''];
    NP.summary(dev).forEach(function (s) {
      out.push('## ' + s.title, '', NP.mdTable([['Item', 'Value']].concat(s.rows)));
    });
    if (dev.vlans.length) {
      out.push('## VLANs', '', NP.mdTable([['VLAN', 'Name']].concat(dev.vlans.map(function (v) { return [v.id, v.name]; }))));
    }
    const found = NP.checks ? NP.checks(dev) : [];
    if (found.length) {
      out.push('## Checks', '', NP.mdTable([['Level', 'Finding', 'Ports']].concat(found.map(function (f) {
        return [f.severity === 'warn' ? 'Fix' : 'Review', f.title, f.ports.map(function (p) { return p.short; }).join(', ')];
      }))));
    }
    const rows = NP.portRows([dev], colIds).map(function (r) { return r.slice(1); });
    out.push('## Ports', '', NP.mdTable(rows));
    return out.join('\n');
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
