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

  // FortiGate interface names that ship with the unit or are created by FortiLink: they identify nobody.
  // Everything else under "config system interface" was typed in by the admin.
  const FORTI_BUILTIN = new RegExp('^(?:port\\d+|x\\d+|s\\d+|sfp\\d*|mgmt\\d*|ha\\d*|lan\\d*|wan\\d*|dmz\\d*|internal\\d*|[ab]|fortilink\\d*|modem|' +
    'npu\\d+_vlink\\d+|vsw|any|virtual-wan-link|.+\\.root|' +
    '(?:quarantine|qtn|voice|video|rspan|onboarding|nac_segment|_default|default|snf|vsw)(?:\\.[\\w\\-]+)?)$', 'i');

  // ren: original interface name -> its placeholder, for a "before" device whose interfaces were renamed
  function structure(dev, ren) {
    const nm = function (s) { return ren && ren[s] ? ren[s] : s; };
    return JSON.stringify({
      ports: dev.ports.map(function (p) {
        return [NP.portId(nm(p.name)).key, p.kind, p.adminUp, p.link, p.speed, p.mode, p.untagged, p.tagged, p.voiceVlan, nm(p.lag), p.stp, p.poeStatus, p.poeWatts,
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
    // FortiGate is the exception: there the admin names the interfaces, often after ISPs, customers or people
    const forti = vendor === 'fortigate' && before && NP.fortiTree ? NP.fortiTree.tree(text) : null;
    const fortiIf = {};                          // admin-chosen interface names
    const bare = {};                             // unquoted words of the config language: a name equal to one is only replaced inside quotes
    if (forti && opts.names) {
      NP.fortiTree.find(forti, 'system interface').forEach(function (b) {
        b.entries.forEach(function (e) {
          const s = e.name.trim();
          if (s.length < 3 || alnum(s) < 3 || /^[\d\/.:\-\s]+$/.test(s) || FORTI_BUILTIN.test(s) || STOP[s.toLowerCase()]) return;
          fortiIf[s] = true;
          delete portNames[s.toLowerCase()];
        });
      });
      // trunks on FortiLink-managed switches are named by the admin too, usually after what is plugged in
      NP.fortiTree.find(forti, 'switch-controller managed-switch').forEach(function (b) {
        b.entries.forEach(function (sw) {
          NP.fortiTree.find(sw, 'ports').forEach(function (pb) {
            pb.entries.forEach(function (e) {
              const s = e.name.trim();
              if (!e.set.type || e.set.type[0] !== 'trunk' || /^_FlInK/i.test(s)) return;      // _FlInK...: built by FortiLink itself
              if (s.length < 3 || alnum(s) < 3 || /^[\d\/.:\-\s]+$/.test(s) || FORTI_BUILTIN.test(s) || STOP[s.toLowerCase()] || portNames[s.toLowerCase()]) return;
              fortiIf[s] = true;
            });
          });
        });
      });
      (text.match(/^[ \t]*(?:set|unset|config|edit)[ \t].*$/gm) || []).forEach(function (ln) {
        ln.replace(/"(?:[^"\\]|\\.)*"?/g, ' ').trim().split(/\s+/).forEach(function (w) { bare[w] = true; });
      });
    }
    const want = function (s, kind, tag, ci) {
      s = String(s || '').trim();
      if (portNames[s.toLowerCase()]) return;
      if (s.length < 3 || alnum(s) < 3 || /^[\d\/.:\-\s]+$/.test(s) || STOP[s.toLowerCase()]) return;
      if (/^\d+\.\d+\.\d+\.\d+/.test(s)) return;                 // addresses are handled separately
      if (!cands[s]) cands[s] = { kind: kind, tag: tag, ci: !!ci };
    };
    if (forti) {
      const sw = NP.fortiTree.find(forti, 'switch-controller managed-switch');
      if (opts.addresses) {
        (text.match(/^[ \t]*set sn[ \t]+\S+/gm) || []).forEach(function (ln) { want(NP.unquote(ln.replace(/^[ \t]*set sn[ \t]+/, '')), 'serials', 'SN'); });
        // an unnamed switch is listed under its serial number
        sw.forEach(function (b) { b.entries.forEach(function (e) { if (/^[A-Z0-9]{12,}$/.test(e.name) && /\d/.test(e.name)) want(e.name, 'serials', 'SN'); }); });
      }
      if (opts.names) {
        Object.keys(fortiIf).forEach(function (s) { cands[s] = cands[s] || { kind: 'names', tag: 'IF', ci: false, iface: true }; });
        (text.match(/^[ \t]*set (?:ike-saml-server|switch-profile)[ \t]+"[^"\n]+"/gm) || []).forEach(function (ln) {
          want(ln.replace(/^[^"]*"/, '').slice(0, -1), 'names', 'N');
        });
      }
      // the port description is "alias - description": neither half appears in the text in that form
      if (opts.descriptions) (function walk(nd) {
        ['alias', 'description'].forEach(function (k) { if (nd.set[k] && nd.set[k][0]) want(nd.set[k][0], 'descriptions', 'D'); });
        nd.entries.forEach(walk); nd.blocks.forEach(walk);
      })(forti);
    }
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
        // prompts of other boxes in the session (a firewall used as the jump host: "fw1 # execute ssh ...")
        (text.match(/^[A-Za-z][\w.\-]{2,}(?:\([\w\-]+\))? ?[#>](?= ?[a-z]|$)/gm) || []).forEach(function (pr) { host(pr.replace(/(\(.*\))? ?[#>]$/, '')); });
        want(before.domain, 'names', 'dom', true);
        before.ports.forEach(function (p) {
          host(p.neighbor);
          // a far-end "port" that is really free text (an interface alias such as LAB-ROUTING), not a port name
          if (p.neighborPort.length >= 6 && !/\d/.test(p.neighborPort)) want(p.neighborPort, 'names', 'P');
        });
        ['Local users', 'Admin users'].forEach(function (k) { (before.other[k] || '').split(', ').forEach(function (u) { want(u, 'names', 'U'); }); });
        (before.other['Managed switches'] || '').split(', ').forEach(host);
        host(before.other['Chassis name']);
        want(before.snmp.location, 'names', 'L'); want(before.snmp.contact, 'names', 'L');
        before.stp.notes.forEach(function (t) { const m = t.match(/^MST region (.+)$/); if (m) want(m[1], 'names', 'R'); });
        (before.other.VTP || '').split(', ').forEach(function (t) { const m = t.match(/^domain (.+)$/); if (m) want(m[1], 'names', 'R'); });
        before.ntp.concat(before.syslog).forEach(function (h) { if (/[a-z]/i.test(h) && h.indexOf('.') > 0) host(h.split(' ')[0]); });
      }
      if (opts.names) (before.other.ACLs || '').split(', ').forEach(function (a) { want(a, 'names', 'A'); });
      if (opts.descriptions) before.ports.forEach(function (p) { want(p.description, 'descriptions', 'D'); });
      // LLDP detail quotes the far port's description, which the parser only uses when the port ID is a MAC
      if (opts.descriptions) (text.match(/^\s*\+ Port description\s*:.*$/gm) || []).forEach(function (ln) {
        const d = NP.unquote(ln.replace(/^[^:]*:\s*/, '').trim());
        if (!/^[A-Za-z\-]{0,24}\d+(?:[\/.:]\d+)*$/.test(d)) want(d, 'descriptions', 'D');      // xe-0/1/1 and eth1 are port names
      });
      if (opts.vlanNames) before.vlans.forEach(function (v) { want(v.name, 'vlanNames', 'V'); });
      if (opts.addresses) want(before.serial, 'serials', 'SN');
    }
    const WIDTHS = [30, 25, 24, 20, 19, 18, 17, 16, 15, 14, 12, 10];   // where "show" tables cut names off
    let n = 0;
    const renamed = {};                          // interface name -> placeholder
    const taken = {};
    let ifn = 0;
    // interface placeholders must stay distinct from each other and from every real port, or two ports would merge
    const ifPlaceholder = function (s) {
      const id = NP.portId(s);
      // the parser reads a port's kind from how its name starts (lag, vlan, ipsec ...): keep that part
      const lead = id.kind === 'physical' ? '' : (s.match(/^(?:ae|bond|trk|lag|bridge|vlan|irb|vl|loopback|lo|mgmt|management|me|fxp|em|vme|oobm|tunnel|gre|ipsec|wg|ssl\.)/i) || [''])[0];
      const rest = s.slice(lead.length);
      if (id.short !== s || !alnum(rest)) return '';
      for (let tries = 0; tries < 2000; tries++) {
        const k = ++ifn;
        const ph = lead + (('IF' + k).length <= alnum(rest) ? placeholder(rest, 'IF', k) : placeholder(rest, '', k.toString(36)));
        const low = ph.toLowerCase(), pid = NP.portId(ph);
        if (taken[low] || portNames[low] || fortiIf[ph] || pid.kind !== id.kind || pid.short !== ph) continue;
        taken[low] = true;
        return ph;
      }
      return '';
    };
    Object.keys(cands).sort(function (a, b) { return b.length - a.length; }).forEach(function (s) {
      const c = cands[s];
      const ph = c.iface ? ifPlaceholder(s) : placeholder(s, c.tag, ++n);
      if (!ph) return;                                           // no safe replacement: leave the name alone
      let hit = false;
      const flags = c.ci ? 'gi' : 'g';
      const full = bare[s] ? new RegExp('"' + esc(s) + '"', flags) : new RegExp('(?<![A-Za-z0-9])' + esc(s) + '(?![A-Za-z0-9])', flags);
      text = text.replace(full, function () { hit = true; return bare[s] ? '"' + ph + '"' : ph; });
      if (forti && text.indexOf('"' + s[0]) >= 0) {
        // a quoted name that the terminal wrapped onto the next line: `set allowed-vlans "a" "Cust` / `omer" "b"`
        const split = new RegExp('"' + s.split('').map(esc).join('\n?') + '"', flags);
        text = text.replace(split, function (all) {
          if (all.indexOf('\n') < 0) return all;
          hit = true;
          let i = 0;
          return all.replace(/[^"\n]/g, function () { return ph[i++]; });
        });
      }
      if (c.iface && hit) renamed[s] = ph;
      WIDTHS.forEach(function (w) {                              // truncated copies in fixed-width tables
        if (w >= s.length) return;
        const pre = s.slice(0, w);
        if (alnum(pre) < 6 || text.indexOf(pre) < 0) return;
        text = text.replace(new RegExp('(?<![A-Za-z0-9])' + esc(pre) + '(?=\\s|$)', 'gm'), function () { hit = true; return ph.slice(0, w); });
      });
      if (hit) { counts[c.kind]++; replaced.push(s); }
    });

    // ---------------------------------------------- 2. secrets (always)
    // (a string replacement may use $1, $2 ... for captured groups, as with String.replace)
    const sec = function (re, to) {
      text = text.replace(re, function () {
        counts.secrets++;
        const args = arguments;
        return typeof to === 'function' ? to.apply(null, args) : to.replace(/\$(\d)/g, function (all, n) { return args[+n] === undefined ? '' : args[+n]; });
      });
    };
    // terminal program banners drawn in a box (MobaXterm prints the licensee there)
    text = text.replace(/^[ \t]*[\u2500-\u257f].*\n/gm, function () { counts.secrets++; return ''; });
    // trap receivers carry the community last, with no keyword in front: "snmp-server host 10.1.1.1 version 2c public"
    sec(/^(snmp-server host \S+(?:[ \t]+vrf \S+)?(?:[ \t]+(?:traps|informs))?(?:[ \t]+version[ \t]+\S+(?:[ \t]+(?:auth|noauth|priv))?)?)([ \t]+\d)?[ \t]+(?!removed\b|version\b|vrf\b|traps\b|informs\b)\S+/gm, '$1$2 removed');
    // banners: keep the command, drop the text
    text = text.replace(/^(banner \S+ )(\^C|\S)([\s\S]*?)\2[^\n]*$/gm, function (all, cmd, d) { counts.secrets++; return cmd + d + ' removed ' + d; });
    // FastIron ends every banner line with ^C: the lines after the command are banner text too
    text = text.replace(/^(banner \S+ \^C removed \^C\n)(?:.*\^C[ \t]*\n)+/gm, '$1');
    // certificate / key blobs
    sec(/^[ \t]+(?:[0-9A-Fa-f]{8} ){2,}[0-9A-Fa-f]{1,8}[ \t]*\n(?:[ \t]+(?:[0-9A-Fa-f]{8}[ \t]*)+\n)*/gm, '  00000000 00000000\n');
    sec(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '-----REMOVED-----');
    // XML configs keep secrets as element content: <bcrypt-hash>, <password>, <prv>, <pre-shared-key>, <rocommunity> ...
    sec(/<([\w.\-]*(?:password|passwd|secret|hash|psk|community|prv|crt|key|passphrase)[\w.\-]*)>(?!removed<)([\s\S]*?)<\/\1>/gi, '<$1>removed</$1>');
    // JSON (UniFi): "x_authkey": "...", "x_passphrase": "...", any key that names a secret
    sec(/"(x_\w+|\w*(?:password|passphrase|secret|authkey|psk|private_key|fingerprint)\w*)"(\s*:\s*)"(?!removed")[^"]*"/gi, '"$1"$2"removed"');
    sec(/\bENC\s+\S+/g, 'ENC removed');
    sec(/\b(password|secret|passphrase|key|community|psksecret|passwd)=("[^"]*"|\S+)/gi, '$1=removed');
    sec(/\b(secret|password|passwd|key|key-string|community|auth|priv|md5|sha\d*|psk|passphrase|pre-shared-key|encrypted-password|cipher|simple|hash|super-user-password)\b([ \t]+\d)?[ \t]+(?!removed\b)("[^"]*"|\S+)/gi,
      function (all, k, d) { return k + (d || '') + ' removed'; });
    sec(/\$\d\$[^\s"]+|\b[0-9A-Fa-f]{24,}\b|[A-Za-z0-9+\/]{40,}={0,2}/g, 'removed');
    text = text.replace(/^(\s*(?:access-list \S+ )?remark ).+$/gm, '$1removed');
    text = text.replace(/^(VTP Management Domain:\s*)'[^'\n]+'/gm, "$1'removed'");
    // LLDP system descriptions are free text written by whoever set up the neighbor
    text = text.replace(/^(System Description:[ \t]*\n)(?!Time remaining)[^\n]+$/gm, '$1removed');
    text = text.replace(/^(\s*\+ System description\s*:\s*).+$/gm, '$1"removed"');
    // (user@10.1.1.1 is an SSH target, not a mail address: its address is handled below)
    text = text.replace(/[A-Za-z0-9._%+\-]+@(?!\d+\.\d+\.\d+\.\d+(?![\w.\-]))[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+/g, 'user@example.net');

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
      text = text.replace(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g, function (all, a, b, c, d, at, whole) {
        if ([a, b, c, d].some(function (o) { return +o > 255; })) return all;
        if (/\bversion\s*:?\s*$/i.test(whole.slice(Math.max(0, at - 24), at))) return all;      // "! Version 10.5.0.4" is software, not a host
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
      same: !!(before && after && structure(before, renamed) === structure(after)),
      ports: after ? after.ports.length : 0, vlans: after ? after.vlans.length : 0,
      leftovers: replaced.filter(function (s) {
        if (bare[s]) return text.indexOf('"' + s + '"') >= 0;      // also a keyword: only the quoted copies were names
        if (!cands[s].ci) return new RegExp('(?<![A-Za-z0-9])' + esc(s) + '(?![A-Za-z0-9])').test(text);      // replaced with its case: "vrtx-lag" is another name
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
      out.push('', '=== Parse debug ===', NP.debugText(dev).split('\n').slice(2).join('\n').trim());
      out.push('', '=== Checks ===', NP.checksText(dev).split('\n').slice(1).join('\n').trim());
      out.push('', '=== Port table ===', NP.formatRows(NP.portRows([dev]), 'tsv').trim());
    }
    out.push('', '=== Sanitized input ===', san.text);
    return { text: out.join('\n') + '\n', same: san.same, checked: san.checked, leftovers: san.leftovers, vendor: san.vendor };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
