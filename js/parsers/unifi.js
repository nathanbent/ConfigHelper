/* Ubiquiti UniFi. UniFi switches have no text config: the controller holds it. This reads JSON:
 *  - the controller's device list (api/s/<site>/stat/device), optionally together with its
 *    network list (rest/networkconf) and port profiles (rest/portconf) so VLANs can be resolved
 *  - "mca-dump" run on a switch over SSH (live state of that one switch, no VLAN names)
 * Each switch or gateway in the JSON becomes its own device. */
(function (root) {
  'use strict';
  const NP = root.NP;

  // pull every top-level JSON document out of the text (several may be pasted one after another)
  function jsonDocs(text) {
    const docs = [];
    let i = 0;
    while (i < text.length) {
      const a = text.slice(i).search(/[{\[]/);
      if (a < 0) break;
      const start = i + a;
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let k = start; k < text.length; k++) {
        const ch = text[k];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = k + 1; break; } }
      }
      if (end < 0) break;
      try { docs.push(JSON.parse(text.slice(start, end))); i = end; } catch (e) { i = start + 1; }
    }
    return docs;
  }
  const list = function (doc) { return Array.isArray(doc) ? doc : doc && Array.isArray(doc.data) ? doc.data : doc && typeof doc === 'object' ? [doc] : []; };
  const str = function (v) { return v === undefined || v === null ? '' : String(v); };

  function build(o, ctx) {
    return function (dev) {
      const touch = function (idx) { const p = NP.port(dev, 'Port ' + idx); p.kind = 'physical'; return p; };
      dev.model = o.model_display || o.shortname || o.model || dev.model;
      dev.version = str(o.version || o.displayable_version) || dev.version;
      dev.serial = str(o.serial) || dev.serial;
      if (o.ip) { dev.mgmtIp = o.ip; dev.mgmtIpFixed = true; }
      const cn = o.config_network || {};
      if (cn.gateway) dev.gateway = cn.gateway;
      [cn.dns1, cn.dns2].forEach(function (d) { if (d) NP.addUnique(dev.dns, d); });
      if (cn.type) dev.other['Address assignment'] = cn.type;
      if (o.type) dev.other['UniFi device type'] = o.type;
      if (o.mac) dev.other.MAC = o.mac;
      if (o.adopted !== undefined) dev.other.Adopted = o.adopted ? 'yes' : 'no';
      dev.stp.enabled = 'yes';
      dev.stp.mode = o.stp_version || dev.stp.mode || 'rstp (default)';
      if (o.stp_priority !== undefined) NP.addUnique(dev.stp.priority, str(o.stp_priority));
      if (!ctx.haveNetworks) NP.addUnique(dev.stp.notes, 'VLAN names and numbers need the controller network list (rest/networkconf) pasted with the device list');
      ctx.vlans.forEach(function (v) { NP.addVlan(dev, v.id, v.name); });

      const over = {};
      (o.port_overrides || []).forEach(function (x) { if (x && x.port_idx !== undefined) over[x.port_idx] = x; });
      const vlanOf = function (id) { const n = ctx.net[id]; return n ? str(n.vlan) : ''; };

      (o.port_table || []).forEach(function (t) {
        if (!t || t.port_idx === undefined) return;
        const ov = over[t.port_idx] || {};
        const prof = ctx.prof[ov.portconf_id || t.portconf_id] || {};
        const pick = function (k) { return ov[k] !== undefined ? ov[k] : t[k] !== undefined ? t[k] : prof[k]; };
        const p = touch(t.port_idx);
        const name = str(ov.name || t.name);
        if (name && !/^(Port|SFP\+?|SFP28|QSFP\S*) ?\d+$/i.test(name)) p.description = name;
        const forward = str(pick('forward')), tagMgmt = str(pick('tagged_vlan_mgmt'));
        p.adminUp = !(t.enable === false || forward === 'disabled' || str(pick('op_mode')) === 'disabled');
        p.link = t.up ? 'up' : 'down';
        if (t.up) { p.speed = NP.fmtSpeed(str(t.speed)); p.duplex = t.full_duplex === false ? 'half' : 'full'; }
        if (t.media) p.media = str(t.media);
        if (t.stp_state) p.stpState = str(t.stp_state);
        if (t.is_uplink) NP.addNote(p, 'uplink');

        // VLANs: native network, then what is tagged
        const nat = pick('native_networkconf_id');
        if (nat !== undefined && nat !== '') p.untagged = vlanOf(nat) || (ctx.haveNetworks ? '' : '');
        else if (ctx.haveNetworks && ctx.defaultVlan) p.untagged = ctx.defaultVlan;
        let tagged = '';
        if (forward === 'all' || tagMgmt === 'auto' || (!forward && !tagMgmt && ctx.haveNetworks)) tagged = 'all';
        else if (forward === 'customize' || tagMgmt === 'custom') {
          const inc = pick('tagged_networkconf_ids'), exc = pick('excluded_networkconf_ids');
          let ids = [];
          if (Array.isArray(inc)) ids = inc.map(vlanOf);
          else if (Array.isArray(exc)) ids = ctx.vlans.map(function (v) { return str(v.id); }).filter(function (v) { return !exc.map(vlanOf).includes(v); });
          tagged = NP.compressVlans(ids.filter(function (v) { return v && v !== p.untagged; }).map(Number));
        }
        if (ctx.haveNetworks || forward || tagMgmt) { p.tagged = tagged; p.mode = tagged ? 'trunk' : 'access'; }
        if (prof.name) NP.addNote(p, 'profile ' + prof.name);
        const voice = pick('voice_networkconf_id');
        if (voice) p.voiceVlan = vlanOf(voice);

        // link aggregation
        if (typeof t.aggregated_by === 'number') { p.lag = 'LAG ' + t.aggregated_by; p.mode = ''; p.untagged = ''; p.tagged = ''; }
        else if (str(pick('op_mode')) === 'aggregate') { p.lag = 'LAG ' + t.port_idx; NP.addNote(p, 'LAG lead port' + (pick('aggregate_num_ports') ? ', ' + pick('aggregate_num_ports') + ' ports' : '')); }

        // PoE
        if (t.port_poe || t.poe_caps) {
          const mode = str(pick('poe_mode'));
          p.poeAdmin = mode === 'off' ? 'disabled' : mode || 'auto';
          const w = parseFloat(t.poe_power);
          const on = !!t.poe_good || w > 0;
          p.poeStatus = on ? 'on' : 'off';
          p.poeWatts = on && w > 0 ? str(Math.round(w * 10) / 10) : '';
          p.poeClass = on ? (str(t.poe_class).match(/\d/) || [''])[0] : '';
        }
        (t.lldp_table || []).forEach(function (l) { neighbor(p, l); });
      });
      (o.lldp_table || []).forEach(function (l) {
        if (l && l.local_port_idx !== undefined) neighbor(touch(l.local_port_idx), l);
      });
      function neighbor(p, l) {
        const mac = str(l.chassis_id || l.lldp_chassis_id).toLowerCase();
        const known = ctx.byMac[mac];
        p.neighbor = str(l.lldp_system_name || l.chassis_name || l.system_name) || known || mac || p.neighbor;
        p.neighborPort = str(l.lldp_port_id || l.port_id || l.lldp_port_desc || l.port_descr) || p.neighborPort;
        if (p.adminUp === null) p.adminUp = true;
      }
    };
  }

  NP.registerVendor('unifi', 'Ubiquiti UniFi', function (text, dev) {
    const docs = jsonDocs(text);
    const devices = [], ctx = { net: {}, prof: {}, vlans: [], byMac: {}, haveNetworks: false, defaultVlan: '' };
    docs.forEach(function (doc) {
      list(doc).forEach(function (o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o.port_table)) devices.push(o);
        else if (o.purpose !== undefined && o.name !== undefined && o._id) {             // a network
          const vlan = o.vlan_enabled === false || o.vlan === undefined || o.vlan === '' ? (o.purpose === 'wan' ? '' : 1) : +o.vlan;
          if (o.purpose === 'wan' || !vlan) return;
          ctx.net[o._id] = { vlan: vlan, name: o.name };
          ctx.haveNetworks = true;
          if (vlan === 1) ctx.defaultVlan = '1';
          if (!ctx.vlans.some(function (v) { return v.id === vlan; })) ctx.vlans.push({ id: vlan, name: o.name });
        }
        else if (o._id && o.name !== undefined && (o.forward !== undefined || o.native_networkconf_id !== undefined)) ctx.prof[o._id] = o;   // a port profile
      });
    });
    devices.forEach(function (o) { if (o.mac) ctx.byMac[String(o.mac).toLowerCase()] = o.name || o.hostname || ''; });
    // access points have one port and nothing to label; keep switches, gateways and consoles
    const keep = devices.filter(function (o) { return o.type !== 'uap' && o.port_table.length; });
    if (!keep.length) return;
    const nameOf = function (o) { return String(o.name || o.hostname || o.mac || 'unifi-device'); };
    const first = keep[0];
    // merging: if the device being filled already has a name, use the entry of that name (if any) as "this" device
    const self = (dev.hostname && keep.find(function (o) { return nameOf(o).toLowerCase() === dev.hostname.toLowerCase(); })) || first;
    dev.hostname = dev.hostname || nameOf(self);
    build(self, ctx)(dev);
    const kids = keep.filter(function (o) { return o !== self; }).map(function (o) {
      return { hostname: nameOf(o), vendor: 'unifi', apply: build(o, ctx) };
    });
    if (kids.length) dev.pendingChildren = kids;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
