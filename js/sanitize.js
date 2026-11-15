/* Sanitize raw device output so it can be shared (bug reports, test fixtures).
 * Secrets are always removed. Names, descriptions and addresses are replaced consistently:
 * the same original always becomes the same placeholder, and placeholders keep the original
 * length and punctuation so fixed-width "show" tables still line up and still parse. */
(function (root) {
  'use strict';
  const NP = root.NP;

  // generic words that identify nobody and often double as config keywords: never replaced
  const STOP = {};
  ('default default_vlan default-vlan data voice voip mgmt management native trunk access uplink users user guest guests wifi ' +
   'wireless server servers storage printer printers camera cameras cctv iot lab test spare unused admin root monitor public ' +
   'private internal external wan lan dmz switch router firewall core none all enable disable enabled disabled staff office ' +
   'phones phone vlan lacp static dynamic active passive auto full half time ntp pool dns log syslog www mail').split(' ').forEach(function (w) { STOP[w] = true; });

  const esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  const alnum = function (s) { return (s.match(/[A-Za-z0-9]/g) || []).length; };

  // same length, same punctuation and spacing; letters/digits become <tag><n>xxxx...
  function placeholder(s, tag, n) {
    const fill = tag + n;
    let i = 0;
    return s.replace(/[A-Za-z0-9]/g, function () { const c = i < fill.length ? fill[i] : 'x'; i++; return c; });
  }

  function structure(dev) {
    return JSON.stringify({
      ports: dev.ports.map(function (p) {
        return [p.key, p.kind, p.adminUp, p.link, p.speed, p.mode, p.untagged, p.tagged, p.voiceVlan, p.lag, p.stp, p.poeStatus, p.poeWatts,
          !!p.description, !!p.neighbor, !!p.ip];
      }),
      vlans: dev.vlans.map(function (v) { return v.id; }),
      n: [dev.dns.length, dev.ntp.length, dev.syslog.length, dev.stp.mode, dev.stp.priority.length, !!dev.hostname, !!dev.model, !!dev.version]
    });
  }
  function probe(text, vendor) {
    const d = NP.newDevice();
    try { NP.parseInto(text, vendor, d); } catch (e) { return null; }
    return d;
  }

  // opts: vendor, names (hostnames, domain, users), descriptions, vlanNames, addresses (IP, MAC, serials). Default all true.
  NP.sanitize = function (text, opts) {
    opts = Object.assign({ names: true, descriptions: true, vlanNames: true, addresses: true }, opts || {});
    text = NP.clean ? NP.clean(text).text : String(text).replace(/\r\n/g, '\n');
    const vendor = opts.vendor && opts.vendor !== 'auto' ? opts.vendor : NP.detect(text);
    const before = vendor && NP.vendors[vendor] ? probe(text, vendor) : null;
    const counts = { secrets: 0, names: 0, descriptions: 0, vlanNames: 0, ips: 0, macs: 0, serials: 0 };
    const replaced = [];                         // originals, for the leftover check

    // ---------------------------------------------- 1. strings the parser found
    const cands = {};                            // original -> {kind, tag, ci}
    const portNames = {};                        // interface names are syntax, never replaced (MikroTik and FortiGate name VLANs after them)
    if (before) before.ports.forEach(function (p) { portNames[p.name.toLowerCase()] = portNames[p.short.toLowerCase()] = true; });
    const want = function (s, kind, tag, ci) {
      s = String(s || '').trim();
      if (portNames[s.toLowerCase()]) return;
      if (s.length < 3 || alnum(s) < 3 || /^[\d\/.:\-\s]+$/.test(s) || STOP[s.toLowerCase()]) return;
      if (/^\d+\.\d+\.\d+\.\d+/.test(s)) return;                 // addresses are handled separately
      if (!cands[s]) cands[s] = { kind: kind, tag: tag, ci: !!ci };
    };
    const host = function (name) {                               // "sw1.corp.example.com (x)" -> short name + domain
      name = String(name || '').replace(/\s*\(.*\)$/, '').trim();
      const i = name.indexOf('.');
      if (i > 0 && !/^\d+$/.test(name.slice(0, i))) { want(name.slice(0, i), 'names', 'H', true); want(name.slice(i + 1), 'names', 'dom', true); }
      else want(name, 'names', 'H', true);
    };
    if (before) {
      if (opts.names) {
        host(before.hostname);
        NP.sections(text).forEach(function (s) { if (s.host) host(s.host); });
        want(before.domain, 'names', 'dom', true);
        before.ports.forEach(function (p) {
          host(p.neighbor);
          // a far-end "port" that is really free text (an interface alias such as LAB-ROUTING), not a port name
          if (p.neighborPort.length >= 6 && !/\d/.test(p.neighborPort)) want(p.neighborPort, 'names', 'P');
        });
        ['Local users', 'Admin users'].forEach(function (k) { (before.other[k] || '').split(', ').forEach(function (u) { want(u, 'names', 'U'); }); });
        (before.other['Managed switches'] || '').split(', ').forEach(host);
        want(before.snmp.location, 'names', 'L'); want(before.snmp.contact, 'names', 'L');
        before.stp.notes.forEach(function (t) { const m = t.match(/^MST region (.+)$/); if (m) want(m[1], 'names', 'R'); });
        (before.other.VTP || '').split(', ').forEach(function (t) { const m = t.match(/^domain (.+)$/); if (m) want(m[1], 'names', 'R'); });
        before.ntp.concat(before.syslog).forEach(function (h) { if (/[a-z]/i.test(h) && h.indexOf('.') > 0) host(h.split(' ')[0]); });
      }
      if (opts.descriptions) before.ports.forEach(function (p) { want(p.description, 'descriptions', 'D'); });
      if (opts.vlanNames) before.vlans.forEach(function (v) { want(v.name, 'vlanNames', 'V'); });
      if (opts.addresses) want(before.serial, 'serials', 'SN');
    }
    const WIDTHS = [30, 25, 24, 20, 19, 18, 17, 16, 15, 14, 12, 10];   // where "show" tables cut names off
    let n = 0;
    Object.keys(cands).sort(function (a, b) { return b.length - a.length; }).forEach(function (s) {
      const c = cands[s];
      const ph = placeholder(s, c.tag, ++n);
      let hit = false;
      const flags = c.ci ? 'gi' : 'g';
      const full = new RegExp('(?<![A-Za-z0-9])' + esc(s) + '(?![A-Za-z0-9])', flags);
      text = text.replace(full, function () { hit = true; return ph; });
      WIDTHS.forEach(function (w) {                              // truncated copies in fixed-width tables
        if (w >= s.length) return;
        const pre = s.slice(0, w);
        if (alnum(pre) < 6 || text.indexOf(pre) < 0) return;
        text = text.replace(new RegExp('(?<![A-Za-z0-9])' + esc(pre) + '(?=\\s|$)', 'gm'), function () { hit = true; return ph.slice(0, w); });
      });
      if (hit) { counts[c.kind]++; replaced.push(s); }
    });

    // ---------------------------------------------- 2. secrets (always)
    const sec = function (re, to) { text = text.replace(re, function () { counts.secrets++; return typeof to === 'function' ? to.apply(null, arguments) : to; }); };
    // banners: keep the command, drop the text
    text = text.replace(/^(banner \S+ )(\^C|\S)([\s\S]*?)\2[^\n]*$/gm, function (all, cmd, d) { counts.secrets++; return cmd + d + ' removed ' + d; });
    // certificate / key blobs
    sec(/^[ \t]+(?:[0-9A-Fa-f]{8} ){2,}[0-9A-Fa-f]{1,8}[ \t]*\n(?:[ \t]+(?:[0-9A-Fa-f]{8}[ \t]*)+\n)*/gm, '  00000000 00000000\n');
    sec(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '-----REMOVED-----');
    sec(/\bENC\s+\S+/g, 'ENC removed');
    sec(/\b(password|secret|passphrase|key|community|psksecret|passwd)=("[^"]*"|\S+)/gi, '$1=removed');
    sec(/\b(secret|password|passwd|key|key-string|community|auth|priv|md5|sha\d*|psk|passphrase|pre-shared-key|encrypted-password|cipher|simple|hash|super-user-password)\b(\s+\d)?\s+(?!removed\b)("[^"]*"|\S+)/gi,
      function (all, k, d) { return k + (d || '') + ' removed'; });
    sec(/\$\d\$[^\s"]+|\b[0-9A-Fa-f]{24,}\b|[A-Za-z0-9+\/]{40,}={0,2}/g, 'removed');
    text = text.replace(/^(\s*(?:access-list \S+ )?remark ).+$/gm, '$1removed');
    text = text.replace(/^(VTP Management Domain:\s*)'[^'\n]+'/gm, "$1'removed'");
    // LLDP system descriptions are free text written by whoever set up the neighbor
    text = text.replace(/^(System Description:[ \t]*\n)(?!Time remaining)[^\n]+$/gm, '$1removed');
    text = text.replace(/^(\s*\+ System description\s*:\s*).+$/gm, '$1"removed"');
    text = text.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+/g, 'user@example.net');

    // ---------------------------------------------- 3. addresses and serials
    if (opts.addresses) {
      const macs = {}, nets = {}, v6 = {};
      let mi = 0, ni = 0, vi = 0;
      const hex = function (i) { return ('0000' + i.toString(16)).slice(-4); };
      const mac = function (m) {
        const k = m.toLowerCase().replace(/[^0-9a-f]/g, '');
        if (/^(0{12}|f{12})$/.test(k)) return m;
        if (!macs[k]) { macs[k] = '00005e0053' + hex(++mi).slice(-2) + ''; if (mi > 255) macs[k] = '00005e00' + hex(0x5300 + mi); counts.macs++; }
        const h = macs[k].slice(0, 12);
        const sep = m.indexOf(':') >= 0 ? ':' : m.indexOf('-') >= 0 ? '-' : '.';
        if (sep === '.' || /^[0-9a-f]{4}[.\-]/i.test(m)) return h.match(/.{4}/g).join(/^[0-9a-f]{4}-/i.test(m) ? '-' : '.');
        return h.match(/.{2}/g).join(sep);
      };
      text = text.replace(/\b(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}\b|\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b|\b(?:[0-9A-Fa-f]{4}-){2}[0-9A-Fa-f]{4}\b/g, mac);
      text = text.replace(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g, function (all, a, b, c, d) {
        if ([a, b, c, d].some(function (o) { return +o > 255; })) return all;
        if (+a === 0 || +a === 255 || +a === 127 || +a >= 224) return all;         // masks, wildcards, loopback, multicast
        const k = a + '.' + b;
        if (!nets[k]) { nets[k] = '10.' + (++ni % 256); counts.ips++; }
        return nets[k] + '.' + c + '.' + d;
      });
      text = text.replace(/(?<![0-9A-Fa-f:.])(?:[0-9A-Fa-f]{1,4}:){2,7}(?::?[0-9A-Fa-f]{1,4}){1,6}(?![0-9A-Fa-f:.])/g, function (all) {
        if (all.indexOf('::') < 0 && all.split(':').length < 5) return all;         // times, short hex pairs
        if (/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(all)) return all;         // a MAC address, already handled
        const k = all.toLowerCase();
        if (/^(::1|fe80:)/.test(k)) return all;
        if (!v6[k]) { v6[k] = '2001:db8::' + (++vi).toString(16); counts.ips++; }
        return v6[k];
      });
      text = text.replace(/((?:Serial[ -]?(?:Number|Num|#|No\.?)|Processor [Bb]oard ID|serial number|System serial number)\s*[:=#]?\s*)([A-Z0-9]{6,})/gi, function (all, lead, sn) {
        counts.serials++;
        return lead + placeholder(sn, 'SN', '0').toUpperCase().replace(/X/g, '0');
      });
    }

    // ---------------------------------------------- 4. check the result
    const after = before ? probe(text, vendor) : null;
    const low = text.toLowerCase();
    return {
      text: text, vendor: vendor || '', counts: counts,
      checked: !!(before && after),
      same: !!(before && after && structure(before) === structure(after)),
      ports: after ? after.ports.length : 0, vlans: after ? after.vlans.length : 0,
      leftovers: replaced.filter(function (s) {
        return low.indexOf(s.toLowerCase()) >= 0 && new RegExp('(?<![A-Za-z0-9])' + esc(s) + '(?![A-Za-z0-9])', 'i').test(text);
      }).slice(0, 12)
    };
  };

  // One text file with everything needed to look into a parsing problem: the sanitized input,
  // plus what the parser made of it. opts: sanitize options + note (what looks wrong) + agent (browser).
  NP.problemReport = function (text, opts) {
    opts = opts || {};
    const cleaned = NP.clean ? NP.clean(text) : { text: text, notes: [] };
    const san = NP.sanitize(text, opts);
    const out = ['ConfigHelper problem report', 'Version: ' + NP.version + ' (' + NP.build + ')'];
    if (opts.agent) out.push('Browser: ' + opts.agent);
    out.push('Platform: ' + (san.vendor ? NP.vendors[san.vendor].label + (NP.verified[san.vendor] ? '' : ' (experimental parser)') : 'not recognised') +
      (opts.vendor && opts.vendor !== 'auto' ? ' (chosen by hand)' : ' (auto-detected)'));
    out.push('What looks wrong: ' + (String(opts.note || '').trim() || '(not filled in)'));
    out.push('Cleanup: ' + (cleaned.notes.join('; ') || 'none needed'));
    const c = san.counts;
    out.push('Sanitized: ' + c.secrets + ' secrets removed, ' + c.names + ' names, ' + c.descriptions + ' descriptions, ' + c.vlanNames + ' VLAN names, ' +
      c.ips + ' IP networks, ' + c.macs + ' MACs, ' + c.serials + ' serials replaced');
    out.push('Sanitized text parses the same as the original: ' + (san.checked ? (san.same ? 'yes' : 'NO') : 'could not check'));

    let dev = null;
    if (san.vendor) { try { dev = NP.ingest(san.text, { vendor: san.vendor, devices: [], target: 'new' }).dev; } catch (e) { out.push('Parse error: ' + e.message); } }
    if (dev) {
      const st = NP.portStats(dev);
      out.push('', '=== What the parser made of it ===',
        'Ports: ' + dev.ports.length + ' (' + st.physical + ' physical, ' + st.up + ' up, ' + st.disabled + ' disabled, ' + st.absent + ' not present)',
        'VLANs: ' + dev.vlans.length + '   Neighbors: ' + dev.ports.filter(function (p) { return p.neighbor; }).length +
        '   PoE ports: ' + st.poePorts + '   Model: ' + (dev.model || '-') + '   Software: ' + (dev.version || '-'));
      out.push('', '=== Not parsed ===', NP.unparsedText(dev).split('\n').slice(1).join('\n').trim() || '(nothing)');
      out.push('', '=== Checks ===', NP.checksText(dev).split('\n').slice(1).join('\n').trim());
      out.push('', '=== Port table ===', NP.formatRows(NP.portRows([dev]), 'tsv').trim());
    }
    out.push('', '=== Sanitized input ===', san.text);
    return { text: out.join('\n') + '\n', same: san.same, checked: san.checked, leftovers: san.leftovers, vendor: san.vendor };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
