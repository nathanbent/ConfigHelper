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
      { cmd: 'show running-configuration', gives: CFG }] },
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
      { cmd: 'show poe interface', gives: 'PoE state, watts, class' }] },
    fortigate: { pager: 'config system console\nset output standard\nend', cmds: [
      { cmd: 'show', gives: 'interfaces, zones, DNS, NTP, syslog, routes' },
      { cmd: 'get system status', gives: 'model, firmware version, serial' }] },
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
    speed: function (d, p) { return p.speed; },
    // device-level
    mgmtip: function (d) { return (d.mgmtIp || '').split(',')[0].replace(/\/\d+/, '').replace(/\s*\(.*\)$/, '').trim(); },
    model: function (d) { return d.model; },
    serial: function (d) { return d.serial; },
    version: function (d) { return d.version; },
    location: function (d) { return d.snmp ? d.snmp.location : ''; }
  };
  // per: 'port' = one label per port, 'device' = one label per device
  NP.labelPresets = {
    port: { label: 'Port labels (port + description)', per: 'port', lines: ['{port}', '{desc}', ''] },
    panel: { label: 'Patch panel / faceplate (port number only)', per: 'port', lines: ['{num}', '', ''] },
    vlan: { label: 'Port number + VLAN', per: 'port', lines: ['{num}', '[VLAN {vlan}]', ''] },
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

  // opts: physicalOnly, upOnly, describedOnly, skipDisabled, match ("ap, 1/0/1" = any of these, anywhere in the row)
  NP.labelFilter = function (opts) {
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
      return true;
    };
  };

  // opts adds: lines:[..], per:'port'|'device', refCols (extra Device/Port/Description/VLAN columns),
  //            maxLen (trim each line to N characters, 0 = no limit), dedupe (drop repeated labels)
  NP.labelRows = function (devs, opts) {
    const lines = (opts.lines || []).map(function (l, i) { return { tpl: l, name: 'Line' + (i + 1) }; })
      .filter(function (l) { return l.tpl && l.tpl.trim(); });
    const perDevice = opts.per === 'device';
    const ref = opts.refCols ? (perDevice ? ['Device'] : ['Device', 'Port', 'Description', 'VLAN']) : [];
    const rows = [lines.map(function (l) { return l.name; }).concat(ref)];
    const keep = NP.labelFilter(opts);
    const max = +opts.maxLen || 0;
    const seen = {};
    const add = function (dev, p) {
      const filled = lines.map(function (l) {
        const t = NP.fillTemplate(l.tpl, dev, p);
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
      else NP.eports(dev).filter(keep).forEach(function (p) { add(dev, p); });
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
