/* HPE Comware / H3C (display current-configuration, display interface brief). */
(function (root) {
  'use strict';
  const NP = root.NP;
  const addUnique = NP.addUnique;

  // "1 10 20 to 30" -> "1,10,20-30"
  function vl(s) {
    s = s.trim();
    if (/^all$/i.test(s)) return 'all';
    return NP.normVlans(s.replace(/(\d+)\s+to\s+(\d+)/g, '$1-$2').replace(/\s+/g, ','));
  }

  function parseConfig(text, dev) {
    let ctx = null, m;
    function finish() {
      if (!ctx || ctx.type !== 'if') { ctx = null; return; }
      const p = ctx.p, c = ctx.c;
      p.adminUp = !c.shutdown;
      if (c.ip) p.ip = c.ip;
      if (p.kind === 'physical' || p.kind === 'lag') {
        if (c.route || c.ip) p.mode = 'routed';
        else if (c.type === 'trunk') {
          p.mode = 'trunk'; p.untagged = c.pvid || '1';
          const perm = c.permit.filter(function (v) { return !c.undo.includes(v); });
          p.tagged = c.permitAll ? 'all' : NP.compressVlans(perm.filter(function (v) { return String(v) !== p.untagged; }));
        } else if (c.type === 'hybrid') {
          p.mode = 'hybrid'; p.untagged = c.pvid || '1'; p.tagged = NP.compressVlans(c.hyTagged);
        } else { p.mode = 'access'; p.untagged = c.access || '1'; p.tagged = ''; }
      }
      ctx = null;
    }

    text.split(/\r?\n/).forEach(function (raw) {
      const l = raw.trim();
      if (!l) return;
      if (l === '#' || l === 'return') { finish(); return; }
      if ((m = l.match(/^interface (\S+)$/))) {
        finish();
        ctx = { type: 'if', p: NP.port(dev, m[1]),
          c: { type: '', access: '', pvid: '', permit: [], undo: [], permitAll: false, hyTagged: [], shutdown: false, ip: '', route: false } };
        return;
      }
      if ((m = l.match(/^vlan (\d+)$/))) { finish(); NP.addVlan(dev, m[1]); ctx = { type: 'vlan', id: +m[1] }; return; }
      if ((m = l.match(/^vlan (\d+(?: to \d+)?(?: \d+(?: to \d+)?)*)$/))) {
        finish();
        NP.parseVlanList(vl(m[1])).forEach(function (id) { NP.addVlan(dev, id); });
        return;
      }
      if (ctx && !/^\s/.test(raw)) finish();

      if (ctx && ctx.type === 'vlan') {
        if ((m = l.match(/^(?:name|description) (.+)/))) NP.addVlan(dev, ctx.id, m[1]);
        else if (/^igmp-snooping enable/.test(l)) addUnique(dev.multicast.notes, 'snooping on VLAN ' + ctx.id);
        return;
      }
      if (ctx && ctx.type === 'if') {
        const p = ctx.p, c = ctx.c;
        if ((m = l.match(/^description (.+)/))) p.description = m[1];
        else if (l === 'shutdown') c.shutdown = true;
        else if (l === 'port link-mode route') c.route = true;
        else if ((m = l.match(/^port link-type (\S+)/))) c.type = m[1];
        else if ((m = l.match(/^port access vlan (\d+)/))) c.access = m[1];
        else if ((m = l.match(/^port (?:trunk|hybrid) pvid vlan (\d+)/))) c.pvid = m[1];
        else if ((m = l.match(/^port trunk permit vlan (.+)/))) {
          if (/^all$/i.test(m[1].trim())) c.permitAll = true;
          else c.permit = c.permit.concat(NP.parseVlanList(vl(m[1])));
        }
        else if ((m = l.match(/^undo port trunk permit vlan (.+)/))) c.undo = c.undo.concat(NP.parseVlanList(vl(m[1])));
        else if ((m = l.match(/^port hybrid vlan (.+) (tagged|untagged)$/))) {
          if (m[2] === 'tagged') c.hyTagged = c.hyTagged.concat(NP.parseVlanList(vl(m[1])));
        }
        else if ((m = l.match(/^voice[- ]vlan (\d+) enable/))) p.voiceVlan = m[1];
        else if ((m = l.match(/^port link-aggregation group (\d+)/))) p.lag = 'BAGG' + m[1];
        else if ((m = l.match(/^ip address (\S+) (\S+)/))) { if (!/ sub$/.test(l) && !c.ip) c.ip = NP.cidr(m[1], m[2]); }
        else if (/^stp edged-port/.test(l)) NP.addFlag(p, 'stp', 'edge');
        else if (/^stp root-protection/.test(l)) NP.addFlag(p, 'stp', 'rootguard');
        else if (/^stp loop-protection/.test(l)) NP.addFlag(p, 'stp', 'loopguard');
        else if (/^stp port bpdu-protection/.test(l) || /^bpdu-protection/.test(l)) NP.addFlag(p, 'stp', 'bpduguard');
        else if (/^(undo stp enable|stp disable)/.test(l)) NP.addFlag(p, 'stp', 'stp off');
        else if ((m = l.match(/^stp (?:instance \d+ )?cost (\d+)/))) NP.addFlag(p, 'stp', 'cost ' + m[1]);
        else if (l === 'poe enable') p.poeAdmin = 'enabled';
        else if (l === 'undo poe enable') p.poeAdmin = 'disabled';
        else if ((m = l.match(/^speed (\S+)/))) { if (!p.speed && m[1] !== 'auto') p.speed = NP.fmtSpeed(m[1]); }
        else if (/^port-security/.test(l)) NP.addNote(p, 'port-security');
        else if (/^dot1x/.test(l) || /^mac-authentication/.test(l)) NP.addNote(p, '802.1X/MAC-auth');
        else if (/^(broadcast|multicast|unicast)-suppression/.test(l)) NP.addNote(p, 'storm suppression');
        else if (/^dhcp snooping trust/.test(l)) NP.addNote(p, 'dhcp-snooping trust');
        else if (/^igmp enable/.test(l)) addUnique(dev.multicast.notes, 'IGMP on ' + p.short);
        else if ((m = l.match(/^pim (sm|dm)/))) addUnique(dev.multicast.notes, 'PIM-' + m[1].toUpperCase() + ' on ' + p.short);
        return;
      }

      // ---- global
      if ((m = l.match(/^sysname (\S+)/))) dev.hostname = m[1];
      else if ((m = l.match(/^version ([^,\s]+)(?:, (.+))?/))) dev.version = dev.version || m[1] + (m[2] ? ' ' + m[2] : '');
      else if ((m = l.match(/^dns server (\S+)/))) addUnique(dev.dns, m[1]);
      else if ((m = l.match(/^dns domain (\S+)/))) dev.domain = m[1];
      else if ((m = l.match(/^(?:ntp-service|ntp) unicast-(server|peer) (\S+)/))) addUnique(dev.ntp, m[2] + (m[1] === 'peer' ? ' (peer)' : ''));
      else if ((m = l.match(/^info-center loghost (?:vpn-instance \S+ )?(\S+)/))) addUnique(dev.syslog, m[1]);
      else if ((m = l.match(/^snmp-agent sys-info location (.+)/))) dev.snmp.location = m[1];
      else if ((m = l.match(/^snmp-agent sys-info contact (.+)/))) dev.snmp.contact = m[1];
      else if ((m = l.match(/^snmp-agent sys-info version (.+)/))) m[1].split(/\s+/).forEach(function (v) { addUnique(dev.snmp.versions, v); });
      else if ((m = l.match(/^ip route-static 0\.0\.0\.0 (?:0|0\.0\.0\.0) (?:\S*[A-Za-z]\S* )?(\d+\.\d+\.\d+\.\d+)/))) dev.gateway = dev.gateway || m[1];
      else if ((m = l.match(/^stp mode (\S+)/))) dev.stp.mode = m[1];
      else if (/^stp (global )?enable/.test(l)) dev.stp.enabled = 'yes';
      else if (/^(undo stp (global )?enable|stp (global )?disable)/.test(l)) dev.stp.enabled = 'no';
      else if ((m = l.match(/^stp (?:instance (\S+) )?priority (\d+)/))) addUnique(dev.stp.priority, (m[1] ? 'MST ' + m[1] + ': ' : '') + m[2]);
      else if ((m = l.match(/^stp (?:instance (\S+) )?root (primary|secondary)/))) addUnique(dev.stp.priority, (m[1] ? 'MST ' + m[1] + ': ' : '') + 'root ' + m[2]);
      else if (/^stp bpdu-protection/.test(l)) addUnique(dev.stp.notes, 'bpdu-protection (global, edge ports)');
      else if (/^stp /.test(l)) addUnique(dev.stp.notes, l.slice(4));
      else if (l === 'igmp-snooping') dev.multicast.igmpSnooping = 'enabled';
      else if (/^multicast routing/.test(l)) dev.multicast.routing = 'enabled';
      else if (/^lldp (global )?enable/.test(l)) dev.other.LLDP = 'enabled';
      else if ((m = l.match(/^local-user (\S+)/))) NP.addOther(dev, 'Local users', m[1]);
      else if ((m = l.match(/^(radius|hwtacacs) scheme (\S+)/))) NP.addOther(dev, 'AAA', m[1] + ' ' + m[2]);
      else if (/^ssh server enable/.test(l)) dev.other.SSH = 'enabled';
      else if (/^telnet server enable/.test(l)) dev.other.Telnet = 'enabled';
      else if (/^dhcp snooping enable/.test(l) || l === 'dhcp-snooping') dev.other['DHCP snooping'] = 'enabled';
      else if ((m = l.match(/^irf member (\d+) priority (\d+)/))) NP.addOther(dev, 'IRF members', m[1] + ' (prio ' + m[2] + ')');
    });
    finish();
    if (!dev.stp.mode) dev.stp.mode = 'mstp (default)';
    if (!dev.multicast.igmpSnooping) dev.multicast.igmpSnooping = 'disabled (default)';
  }

  function parseShow(text, dev) {
    // display interface brief (bridge-mode table)
    NP.eachTable(text, function (h) { return /^Interface\s+Link\s+Speed\s+Duplex\s+Type\s+PVID/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 6 || !/\d/.test(t[0])) return;
      const p = NP.port(dev, t[0]);
      linkOf(p, t[1]);
      if (p.link === 'up') { p.speed = NP.fmtSpeed(t[2]); p.duplex = NP.fmtDuplex(t[3]); }
      if (!p.mode) {
        p.mode = { A: 'access', T: 'trunk', H: 'hybrid' }[t[4]] || '';
        if (/^\d+$/.test(t[5])) p.untagged = t[5];
      }
      const d = t.slice(6).join(' ');
      if (d && !p.description) p.description = d;
    });
    // display interface brief (route-mode table)
    NP.eachTable(text, function (h) { return /^Interface\s+Link\s+Protocol\s+(Main|Primary) IP/.test(h); }, function (ln) {
      const t = ln.trim().split(/\s+/);
      if (t.length < 3 || !/\d/.test(t[0])) return;
      const p = NP.port(dev, t[0]);
      linkOf(p, t[1]);
      if (!p.ip && /^\d+\.\d+\.\d+\.\d+$/.test(t[3] || '')) p.ip = t[3];
    });
    let m;
    if ((m = text.match(/^(?:HPE?|H3C) (\S+(?: \S+)?) (?:Switch )?(?:with|uptime)/m))) dev.model = dev.model || m[1];
  }
  function linkOf(p, s) {
    if (/^ADM/i.test(s)) { p.adminUp = false; p.link = 'down'; }
    else { if (p.adminUp === null) p.adminUp = true; p.link = /^UP/i.test(s) ? 'up' : 'down'; }
  }

  NP.registerVendor('comware', 'HPE Comware / H3C', function (text, dev) {
    NP.sections(text).forEach(function (s) {
      if (/^\s*(sysname \S|interface \S+\d|vlan \d)/m.test(s.text)) parseConfig(s.text, dev);
      parseShow(s.text, dev);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
