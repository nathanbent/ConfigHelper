/* Palo Alto Networks PAN-OS. Reads the config in any of its three shapes: the XML backup file
 * (running-config.xml), "set" format, and the default brace format; all are turned into set
 * lines first. Also "show system info" and "show interface all". */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  const decode = function (s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  };
  const q = function (s) { return /[\s\[\]]/.test(s) || s === '' ? '"' + s.replace(/"/g, "'") + '"' : s; };

  // XML -> "set a b c value" lines. <entry name="x"> contributes x; <member> values attach to their parent.
  function xmlToSet(xml, meta) {
    const out = [];
    const stack = [];                          // {tok, emitted}
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w.\-:]+)((?:\s+[\w.\-:]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
    const path = function () { return stack.map(function (f) { return f.tok; }).filter(Boolean).join(' '); };
    const emit = function (value) {
      out.push('set ' + path() + (value !== undefined ? ' ' + q(value) : ''));
      stack.forEach(function (f) { f.emitted = true; });
    };
    let m;
    while ((m = re.exec(xml))) {
      if (m[3]) {
        const tag = m[3], attrs = m[4] || '';
        if (m[2]) {                             // closing tag
          const f = stack.pop();
          if (f && !f.emitted && f.tok) { stack.push(f); emit(); stack.pop(); }
          continue;
        }
        if (tag === 'config' && !stack.length) {
          const v = attrs.match(/detail-version="([^"]+)"/) || attrs.match(/\bversion="([^"]+)"/);
          if (v) meta.version = v[1];
        }
        const name = attrs.match(/\bname="([^"]*)"/);
        const tok = tag === 'entry' ? q(decode(name ? name[1] : '')) : tag === 'member' ? '' : tag;
        stack.push({ tok: tok, emitted: false, member: tag === 'member' });
        if (m[5]) {                             // self-closing
          if (tok) emit();
          stack.pop();
        }
      } else {
        const text = decode(m[1] !== undefined ? m[1] : m[6] || '').trim();
        if (text && stack.length) emit(text);
      }
    }
    return out;
  }

  function tokens(s) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }
  // values after position i, with "[ a b ]" brackets dropped
  const vals = function (t, i) { return t.slice(i).filter(function (x) { return x !== '[' && x !== ']'; }); };

  function parseConfig(lines, dev) {
    const ifs = {};                              // name -> working state
    const I = function (n) { return ifs[n] = ifs[n] || { ips: [], mode: '', comment: '', down: false, lag: '', tag: '', parent: '', profile: '', lldp: false }; };
    const profiles = {}, zones = {}, vrs = {}, routes = {}, sys = {};
    let m;

    lines.forEach(function (line) {
      // strip the wrappers the XML export and multi-vsys configs add
      const l = line.replace(/^set (?:config )?(?:devices \S+ )?(?:vsys \S+ )?/, 'set ').replace(/^set config shared /, 'set shared ');
      const t = tokens(l).slice(1);
      if (!t.length) return;
      const s = t.join(' ');

      if (t[0] === 'deviceconfig' && t[1] === 'system') {
        const k = t[2], v = t[3];
        if (k === 'hostname') dev.hostname = v;
        else if (k === 'ip-address' || k === 'netmask' || k === 'default-gateway') sys[k] = v;
        else if (k === 'domain') dev.domain = v;
        else if (k === 'timezone') dev.other['Time zone'] = v;
        else if (k === 'dns-setting' && t[3] === 'servers') addUnique(dev.dns, t[5]);
        else if (k === 'ntp-servers' && t[4] === 'ntp-server-address') addUnique(dev.ntp, t[5]);
        else if (k === 'snmp-setting' && t[3] === 'snmp-system' && t[4] === 'location') dev.snmp.location = t.slice(5).join(' ');
        else if (k === 'snmp-setting' && t[3] === 'snmp-system' && t[4] === 'contact') dev.snmp.contact = t.slice(5).join(' ');
        else if (k === 'snmp-setting' && t[3] === 'access-setting' && t[4] === 'version') addUnique(dev.snmp.versions, t[5]);
        else if (k === 'service' && (m = (t[3] || '').match(/^disable-(http|telnet|https|ssh)$/))) {
          const label = { http: 'HTTP server', https: 'HTTPS server', telnet: 'Telnet', ssh: 'SSH' }[m[1]];
          dev.other[label] = t[4] === 'no' ? 'enabled' : 'disabled';
        }
        else if (/^panorama/.test(k) && (m = s.match(/panorama-server(?:-2)? (\S+)/))) NP.addOther(dev, 'Panorama', m[1]);
        else if (k === 'type' && v === 'dhcp-client') sys.dhcp = true;
        else if (/^(login-banner|update-schedule|update-server|device-telemetry|motd-and-banner|geo-location|permitted-ip|locale|setting)$/.test(k)) { /* nothing useful */ }
        else NP.miss('set ' + t.slice(0, 3).join(' ') + ' …', 'global');
        return;
      }
      if (t[0] === 'deviceconfig' && t[1] === 'high-availability') {
        if (t[2] === 'enabled' && t[3] === 'yes') dev.other.HA = dev.other.HA || 'enabled';
        if ((m = s.match(/ mode (active-passive|active-active)/))) dev.other.HA = m[1];
        return;
      }
      if (t[0] === 'network' && t[1] === 'interface') {
        const kind = t[2];
        if (kind === 'ethernet' || kind === 'aggregate-ethernet') {
          const name = t[3], x = I(name);
          let r = t.slice(4);
          if (/^(layer3|layer2|virtual-wire|tap|ha|decrypt-mirror)$/.test(r[0] || '')) {
            x.mode = r[0];
            if (r[1] === 'units' && r[2]) {                     // sub-interface
              const u = I(r[2]);
              u.parent = name; u.mode = x.mode;
              r = r.slice(3);
              if (r[0] === 'tag') u.tag = r[1];
              else if (r[0] === 'ip') vals(r, 1).forEach(function (a) { if (/^\d/.test(a)) addUnique(u.ips, a); });
              else if (r[0] === 'comment') u.comment = r.slice(1).join(' ');
              else if (r[0] === 'interface-management-profile') u.profile = r[1];
              else if (r[0] === 'dhcp-client') addUnique(u.ips, 'dhcp');
              return;
            }
            r = r.slice(1);
            if (r[0] === 'ip') vals(r, 1).forEach(function (a) { if (/^\d/.test(a)) addUnique(x.ips, a); });
            else if (r[0] === 'dhcp-client') addUnique(x.ips, 'dhcp');
            else if (r[0] === 'interface-management-profile') x.profile = r[1];
            else if (r[0] === 'lldp' && r[1] === 'enable' && r[2] === 'yes') x.lldp = true;
            return;
          }
          if (r[0] === 'comment') x.comment = r.slice(1).join(' ');
          else if (r[0] === 'link-state') x.down = r[1] === 'down';
          else if (r[0] === 'aggregate-group') x.lag = r[1];
          else if (r[0] === 'link-speed' && r[1] !== 'auto') x.speedCfg = r[1];
          return;
        }
        if (/^(vlan|loopback|tunnel)$/.test(kind) && t[3] === 'units' && t[4]) {
          const u = I(t[4]), r = t.slice(5);
          if (r[0] === 'ip') vals(r, 1).forEach(function (a) { if (/^\d/.test(a)) addUnique(u.ips, a); });
          else if (r[0] === 'comment') u.comment = r.slice(1).join(' ');
          else if (r[0] === 'interface-management-profile') u.profile = r[1];
          return;
        }
        return;
      }
      if (t[0] === 'network' && t[1] === 'profiles' && t[2] === 'interface-management-profile') {
        const p = profiles[t[3]] = profiles[t[3]] || [];
        if (t[5] === 'yes' && /^(https|ssh|ping|http|telnet|snmp)$/.test(t[4])) addUnique(p, t[4]);
        return;
      }
      if (t[0] === 'network' && t[1] === 'virtual-router') {
        const vr = t[2];
        NP.addOther(dev, 'Virtual routers', vr);
        if (t[3] === 'interface') vals(t, 4).forEach(function (n) { vrs[n] = vr; });
        else if (t[3] === 'routing-table' && t[5] === 'static-route') {
          const r = routes[vr + '/' + t[6]] = routes[vr + '/' + t[6]] || {};
          if (t[7] === 'destination') r.dst = t[8];
          else if (t[7] === 'nexthop' && t[8] === 'ip-address') r.hop = t[9];
          else if (t[7] === 'interface') r.dev = t[8];
        }
        else if (t[3] === 'protocol' && t[4] && t[5] === 'enable' && t[6] === 'yes') NP.addOther(dev, 'Routing protocols', t[4]);
        return;
      }
      if (t[0] === 'network' && t[1] === 'vlan' && t[2]) {
        if (t[3] === 'interface') vals(t, 4).forEach(function (n) { I(n).l2vlan = t[2]; });
        else if (t[3] === 'virtual-interface') I(t[4]).l2vlan = t[2];
        return;
      }
      if (t[0] === 'zone' && t[2] === 'network' && /^(layer3|layer2|virtual-wire|tap|tunnel|external)$/.test(t[3] || '')) {
        NP.addOther(dev, 'Zones', t[1]);
        vals(t, 4).forEach(function (n) { zones[n] = t[1]; });
        return;
      }
      if ((m = s.match(/^(?:shared )?log-settings syslog \S+ server \S+ server (\S+)/))) { addUnique(dev.syslog, m[1]); return; }
      if (t[0] === 'mgt-config' && t[1] === 'users' && t[2]) { NP.addOther(dev, 'Admin users', t[2]); return; }
      if (t[0] === 'network' && /^(ike|tunnel|qos|dhcp|dns-proxy|lldp|shared-gateway|virtual-wire)$/.test(t[1])) {
        if (t[1] === 'dhcp' && t[2] === 'interface' && t[4] === 'server') NP.addOther(dev, 'DHCP server on', t[3]);
        if (t[1] === 'lldp' && t[2] === 'enable' && t[3] === 'yes') dev.other.LLDP = 'enabled';
        return;
      }
      // everything else (policies, objects, profiles ...): one entry per section, never the values
      NP.miss('set ' + t.slice(0, 2).join(' ') + ' …', 'global');
    });

    // ---- management interface
    if (sys['ip-address'] || sys.dhcp) {
      const mg = NP.port(dev, 'mgmt');
      mg.kind = 'mgmt'; mg.adminUp = true;
      mg.ip = sys['ip-address'] ? NP.cidr(sys['ip-address'], sys.netmask) : 'dhcp';
      if (!mg.description) mg.description = 'Management port';
    }
    Object.keys(routes).forEach(function (k) {
      const r = routes[k];
      if (r.dst === '0.0.0.0/0' && r.hop) NP.addOther(dev, 'Default route', r.hop + (r.dev ? ' via ' + r.dev : '') + ' (' + k.split('/')[0] + ')');
    });
    dev.gateway = sys['default-gateway'] ? sys['default-gateway'] + ' (mgmt)' : dev.gateway;

    // ---- interfaces
    Object.keys(ifs).forEach(function (name) {
      const x = ifs[name], p = NP.port(dev, name);
      if (/^ae\d+$/.test(name)) p.kind = 'lag';
      else if (x.parent || /^vlan\./.test(name)) p.kind = 'svi';
      else if (/^loopback\./.test(name)) p.kind = 'loopback';
      else if (/^tunnel\./.test(name)) p.kind = 'tunnel';
      p.adminUp = !x.down;
      if (x.comment) p.description = x.comment;
      if (x.ips.length) p.ip = x.ips[0];
      if (x.ips.length > 1) NP.addNote(p, 'also ' + x.ips.slice(1).join(', '));
      if (x.lag) { p.lag = x.lag; I(x.lag); NP.port(dev, x.lag).kind = 'lag'; }
      if (x.parent) {
        p.mode = 'vlan'; p.tagged = x.tag || '';
        NP.addNote(p, 'on ' + x.parent);
        if (x.tag) NP.addVlan(dev, x.tag, x.comment || zones[name] || '');
      } else if (!x.lag && (p.kind === 'physical' || p.kind === 'lag')) {
        p.mode = { layer3: 'routed', layer2: 'layer2', 'virtual-wire': 'vwire', tap: 'tap', ha: 'HA', 'decrypt-mirror': 'decrypt-mirror' }[x.mode] || '';
      }
      if (zones[name]) NP.addNote(p, 'zone ' + zones[name]);
      if (vrs[name]) NP.addNote(p, 'vr ' + vrs[name]);
      if (x.l2vlan) NP.addNote(p, 'vlan object ' + x.l2vlan);
      if (x.profile) NP.addNote(p, 'access ' + ((profiles[x.profile] || []).join('/') || 'none') + ' (' + x.profile + ')');
      if (x.speedCfg) NP.addNote(p, 'speed ' + x.speedCfg);
    });
    if (!dev.stp.enabled) dev.stp.enabled = 'n/a (firewall)';
  }

  function parseShow(text, dev) {
    let m;
    // show system info
    if (/^sw-version:/m.test(text)) {
      if ((m = text.match(/^hostname:\s*(\S+)/m))) dev.hostname = m[1];
      if ((m = text.match(/^model:\s*(\S+)/m))) dev.model = m[1];
      if ((m = text.match(/^serial:\s*(\S+)/m))) dev.serial = m[1];
      if ((m = text.match(/^sw-version:\s*(\S+)/m))) dev.version = m[1];
    }
    // show interface all: hardware table (link) then logical table (zone, tag, address)
    text.split(/\r?\n/).forEach(function (ln) {
      const x = ln.match(/^(\S+)\s+\d+\s+([^\s\/]+)\/([^\s\/]+)\/(up|down)\S*\s+[0-9a-f]{2}(?::[0-9a-f]{2}){5}\s*$/i);
      if (!x) return;
      const p = NP.port(dev, x[1]);
      if (/^ae\d+$/.test(x[1])) p.kind = 'lag';
      if (p.adminUp === null) p.adminUp = true;
      p.link = x[4].toLowerCase();
      if (p.link === 'up') { p.speed = NP.fmtSpeed(x[2]); p.duplex = NP.fmtDuplex(x[3]); }
    });
    NP.eachTable(text, function (h) { return /^name\s+id\s+vsys\s+zone\s+forwarding/.test(h); }, function (ln, header) {
      const iZone = header.indexOf('zone'), iFwd = header.indexOf('forwarding'), iTag = header.indexOf('tag'), iAddr = header.indexOf('address');
      const name = ln.trim().split(/\s+/)[0];
      if (!/^(ethernet|ae|vlan|loopback|tunnel)/.test(name) || iAddr < 0) return;
      const p = NP.findPort(dev, name) || NP.port(dev, name);
      const zone = ln.slice(iZone, iFwd).trim(), addr = ln.slice(iAddr).trim(), tag = ln.slice(iTag, iAddr).trim();
      if (zone && !/zone /.test(p.notes)) NP.addNote(p, 'zone ' + zone);
      if (/^\d/.test(addr) && addr !== 'N/A' && !p.ip) p.ip = addr.split(/\s+/)[0];
      if (/\./.test(name) && /^[1-9]\d*$/.test(tag) && !p.tagged) { p.kind = 'svi'; p.mode = 'vlan'; p.tagged = tag; }
    });
  }

  NP.registerVendor('paloalto', 'Palo Alto PAN-OS', function (text, dev) {
    const meta = {};
    if (/<config[\s>]/.test(text) && /<\/config>/.test(text)) {
      const a = text.indexOf('<config'), b = text.lastIndexOf('</config>') + 9;
      const lines = xmlToSet(text.slice(a, b), meta);
      if (meta.version) dev.version = dev.version || meta.version;
      parseConfig(lines, dev);
      text = text.slice(0, a) + text.slice(b);
    }
    NP.sections(text).forEach(function (s) {
      let lines = s.text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return /^set (deviceconfig|network|zone|vsys|shared|mgt-config|config|rulebase|address|service|import|log-settings|tag|profiles|profile-group|application|schedule|global-protect|certificate|ssl-tls-service-profile|response-page|admin-role|authentication-profile|external-list|region|template|device-group|panorama|readonly|address-group|service-group|application-group|application-filter|log-collector|pre-rulebase|post-rulebase) /.test(l); });
      if (!lines.length && /^\s*(deviceconfig|network|mgt-config) \{\s*$/m.test(s.text) && NP.braceToSet) lines = NP.braceToSet(s.text);
      if (lines.length) parseConfig(lines, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
