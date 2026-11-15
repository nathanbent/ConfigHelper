// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const NP = require('./load.js');

function run(id) {
  return NP.ingest(NP.samples[id].text, { vendor: 'auto', devices: [] });
}
const port = (dev, name) => {
  const p = NP.findPort(dev, name);
  assert.ok(p, 'port ' + name + ' exists');
  return p;
};

test('every sample is auto-detected as its own vendor', () => {
  for (const id of Object.keys(NP.samples)) assert.equal(NP.detect(NP.samples[id].text), id);
});

test('helpers', () => {
  assert.deepEqual(NP.parseVlanList('1,3-5 7'), [1, 3, 4, 5, 7]);
  assert.equal(NP.compressVlans([5, 1, 3, 4, 7, 3]), '1,3-5,7');
  assert.equal(NP.normVlans('1-4094'), 'all');
  assert.equal(NP.cidr('10.0.0.1', '255.255.255.0'), '10.0.0.1/24');
  assert.equal(NP.portId('GigabitEthernet1/0/1').key, NP.portId('Gi1/0/1').key);
  assert.equal(NP.portId('Gig 1/0/1').key, NP.portId('Gi1/0/1').key);
  assert.equal(NP.portId('Ethernet1/1').key, NP.portId('Eth1/1').key);
  assert.equal(NP.portId('Port-channel1').kind, 'lag');
  assert.equal(NP.portId('ge-0/0/1').short, 'ge-0/0/1');
  assert.equal(NP.portNum('Gi1/0/12'), '12');
});

test('Cisco IOS: config, status, PoE and CDP merge onto the same ports', () => {
  const d = run('ios').dev;
  assert.equal(d.hostname, 'SW-ACCESS-01');
  assert.equal(d.model, 'WS-C2960X-48FPD-L');
  assert.equal(d.version, '15.2(7)E7');
  assert.deepEqual(d.dns, ['10.10.0.53', '10.10.0.54']);
  assert.deepEqual(d.ntp, ['10.10.0.1 (prefer)', '10.10.0.2']);
  assert.equal(d.stp.mode, 'rapid-pvst');
  assert.equal(d.gateway, '10.10.99.1');
  assert.equal(d.ports.length, 9);
  const p1 = port(d, 'Gi1/0/1');
  assert.equal(p1.name, 'GigabitEthernet1/0/1');
  assert.equal(p1.description, 'Reception PC + phone');
  assert.deepEqual([p1.mode, p1.untagged, p1.voiceVlan, p1.link, p1.speed], ['access', '10', '20', 'up', '1G']);
  assert.deepEqual([p1.poeStatus, p1.poeWatts, p1.poeClass], ['on', '6.5', '2']);
  const p2 = port(d, 'Gi1/0/2');
  assert.deepEqual([p2.mode, p2.untagged, p2.tagged, p2.stp], ['trunk', '99', '30,99', 'edge (trunk)']);
  assert.equal(p2.neighbor, 'AP-Lobby');
  assert.equal(port(d, 'Gi1/0/3').poeAdmin, 'disabled');
  assert.equal(port(d, 'Gi1/0/4').adminUp, false);
  const te = port(d, 'Te1/1/1');
  assert.deepEqual([te.lag, te.neighbor, te.neighborPort], ['Po1', 'CORE-01.corp.example.com', 'Ten1/0/1']);
  assert.ok(!JSON.stringify(d).includes('s3cret'), 'SNMP community is not stored');
  assert.ok(!JSON.stringify(d).includes('$9$'), 'password hashes are not stored');
});

test('show output pasted later merges into the same device by prompt hostname', () => {
  const full = NP.samples.ios.text;
  const cut = full.indexOf('SW-ACCESS-01#show interfaces status');
  const devices = [];
  const a = NP.ingest(full.slice(0, cut), { devices });
  devices.push(a.dev);
  assert.equal(port(a.dev, 'Gi1/0/1').link, '');
  const b = NP.ingest(full.slice(cut), { devices });
  assert.equal(b.isNew, false);
  assert.equal(b.dev, a.dev);
  assert.equal(port(a.dev, 'Gi1/0/1').link, 'up');
  assert.equal(a.dev.ports.length, 9);
});

test('real Catalyst 3850 (IOS-XE 16.12) session: status first, then config', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  const d = NP.ingest(text, { devices: [] }).dev;
  assert.equal(d.vendor, 'ios');
  assert.equal(d.hostname, 'SW-PATCH-01');
  assert.equal(d.model, 'WS-C3850-12X48U');
  assert.equal(d.domain, 'example.lab');
  assert.equal(d.gateway, '10.0.0.1');
  assert.equal(d.mgmtIp, '10.0.65.169/24 (Gi0/0), 10.0.0.11/24 (Vlan3000)');
  assert.equal(d.stp.mode, 'mst');
  assert.deepEqual(d.stp.priority, ['VLAN 3000-3099: 8192', 'MST 0: 61440']);
  assert.equal(d.vlans.length, 27);
  assert.equal(d.vlans.find(v => v.id === 4094).name, 'FortiLink');
  assert.equal(d.other['VTY access'], 'ssh');
  const phys = d.ports.filter(p => p.kind === 'physical');
  assert.deepEqual(phys.slice(0, 2).map(p => p.short), ['Gi1/0/1', 'Gi1/0/2']);
  assert.deepEqual(phys.slice(35, 38).map(p => p.short), ['Gi1/0/36', 'Te1/0/37', 'Te1/0/38']);
  assert.equal(port(d, 'Gi0/0').kind, 'mgmt');
  assert.equal(port(d, 'Gi1/0/14').link, 'err-disabled');
  assert.equal(port(d, 'Gi1/0/15').description, 'Temp-Trunk-to-OfficeNextDoor');   // config beats truncated status name
  assert.deepEqual([port(d, 'Gi1/0/15').mode, port(d, 'Gi1/0/15').untagged, port(d, 'Gi1/0/15').tagged], ['trunk', '3000', 'all']);
  const t38 = port(d, 'Te1/0/38');
  assert.deepEqual([t38.mode, t38.untagged, t38.stp, t38.notes], ['trunk', '4094', 'edge, bpduguard', 'lldp off']);
  assert.deepEqual([port(d, 'Te1/0/45').link, port(d, 'Te1/0/45').speed], ['up', '2.5G']);
  assert.equal(port(d, 'Te1/0/47').tagged, '1-3299,3301-4094');
  assert.deepEqual([port(d, 'Te1/1/4').speed, port(d, 'Te1/1/4').media], ['10G', 'SFP-10GBase-LRM']);
  assert.equal(port(d, 'Te1/1/1').link, 'down');
  assert.equal(port(d, 'Te1/1/5').link, 'not present');
  assert.equal(port(d, 'Fo1/1/1').link, 'not present');
  const st = NP.portStats(d);
  assert.deepEqual([st.physical, st.up, st.absent], [62, 6, 10]);
  const t45 = port(d, 'Te1/0/45');
  assert.deepEqual([t45.poeAdmin, t45.poeStatus, t45.poeWatts, t45.poeClass], ['auto', 'on', '30.0', '4']);
  assert.deepEqual([port(d, 'Gi1/0/10').poeStatus, port(d, 'Gi1/0/10').poeWatts], ['off', '']);
  assert.deepEqual([st.poePorts, st.poeWatts], [1, 30]);
  assert.ok(!JSON.stringify(d).includes('$9$'));
  // show version
  assert.deepEqual([d.version, d.serial], ['16.12.12', 'FCW0000X000']);
  // CDP + LLDP detail
  const nb = n => { const p = port(d, n); return [p.neighbor, p.neighborPort, p.neighborInfo]; };
  assert.deepEqual(nb('Gi1/0/7'), ['LAB-ToR', 'Gi1/0/48', 'WS-C2960S-48TS-L, 10.0.0.66']);
  assert.deepEqual(nb('Gi1/0/11'), ['WORKBENCH-3560X.example.lab', 'Gi0/24', 'WS-C3560X-24P, 10.0.0.4']);
  assert.deepEqual(nb('Gi1/0/36'), ['FW-HQ-01', 'LAB-ROUTING', '']);
  assert.deepEqual(nb('Te1/0/45'), ['LAB-AP01 (Office)', 'mgt0', '10.0.5.51']);
  assert.deepEqual(nb('Te1/0/48'), ['Office-Sw1', '10GigabitEthernet1/3/4', '10.0.0.7']);   // port id was a MAC
  assert.deepEqual(nb('Te1/1/4'), ['MDF-SW-1', 'port1', '10.255.1.2']);
  assert.equal(d.ports.filter(p => p.neighbor).length, 6);
  // neighbor output on its own must not be mistaken for this device's "show version"
  const a = text.indexOf('SW-PATCH-01#show cdp'), b = text.indexOf('SW-PATCH-01# show version');
  const only = NP.ingest(text.slice(a, b), { devices: [] }).dev;
  assert.deepEqual([only.hostname, only.version, only.model], ['SW-PATCH-01', '', '']);
});

test('Cisco NX-OS', () => {
  const d = run('nxos').dev;
  assert.equal(d.hostname, 'DC-LEAF-01');
  assert.equal(d.stp.mode, 'mst');
  assert.deepEqual(d.dns, ['10.20.0.53']);
  const e1 = port(d, 'Ethernet1/1');
  assert.deepEqual([e1.mode, e1.tagged, e1.lag], ['trunk', '100,200', 'Po10']);
  assert.deepEqual([port(d, 'Eth1/2').untagged, port(d, 'Eth1/2').stp], ['100', 'edge']);
  assert.deepEqual([port(d, 'Eth1/49').mode, port(d, 'Eth1/49').ip], ['routed', '10.255.0.1/31']);
  assert.match(d.mgmtIp, /^10\.20\.99\.21\/24/);
});

test('Aruba AOS-CX', () => {
  const d = run('aoscx').dev;
  assert.equal(d.hostname, 'CX-IDF-3');
  assert.equal(d.stp.enabled, 'yes');
  assert.deepEqual(d.stp.priority, ['32768']);
  const p = port(d, '1/1/1');
  assert.deepEqual([p.mode, p.untagged, p.link, p.speed, p.stp], ['access', '10', 'up', '1G', 'edge, bpduguard']);
  assert.equal(port(d, '1/1/3').adminUp, false);
  assert.equal(port(d, '1/1/49').lag, 'lag1');
  assert.deepEqual([port(d, 'lag 1').mode, port(d, 'lag 1').tagged], ['trunk', '10,20,40']);
});

test('ArubaOS-Switch / ProCurve', () => {
  const d = run('arubaos').dev;
  assert.equal(d.hostname, 'HP-2530-IDF1');
  assert.equal(d.model, 'J9772A');
  assert.equal(d.vlans.find(v => v.id === 10).name, 'DATA');
  const p1 = port(d, '1');
  assert.deepEqual([p1.description, p1.mode, p1.untagged, p1.tagged], ['AP Front Office', 'trunk', '99', '10']);
  assert.deepEqual([p1.link, p1.speed, p1.poeStatus, p1.poeWatts], ['up', '1G', 'delivering', '9.8']);
  const p3 = port(d, '3');
  assert.deepEqual([p3.adminUp, p3.untagged, p3.voiceVlan, p3.mode], [false, '10', '20', 'access']);
  assert.equal(port(d, '49').lag, 'Trk1');
  assert.equal(port(d, 'Trk1').tagged, '10,20,99');
  assert.match(port(d, '10').stp, /edge/);
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 50);
});

test('Ruckus ICX (FastIron)', () => {
  const d = run('icx').dev;
  assert.equal(d.hostname, 'ICX-OFFICE-1');
  assert.deepEqual([d.model, d.version], ['ICX7150-48P-POE', '08.0.95hT213']);
  assert.deepEqual(d.dns, ['10.80.0.53', '10.80.0.54']);
  assert.deepEqual(d.ntp, ['10.80.0.1']);
  assert.equal(d.gateway, '10.80.10.1');
  assert.match(d.stp.mode, /802\.1w/);
  assert.deepEqual(d.stp.priority, ['VLAN 10: 4096']);
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 54);     // 48 + 2 + 4 from the module lines
  const p1 = port(d, '1/1/1');
  assert.deepEqual([p1.description, p1.mode, p1.untagged, p1.tagged, p1.poeStatus, p1.poeWatts, p1.poeClass],
    ['AP Reception', 'trunk', '99', '10', 'on', '9.8', '4']);
  assert.deepEqual([p1.neighbor, p1.neighborPort, p1.neighborInfo], ['AP-Reception', 'eth0', '10.80.99.21']);
  const p2 = port(d, '1/1/2');
  assert.deepEqual([p2.mode, p2.untagged, p2.tagged, p2.voiceVlan, p2.stp, p2.link, p2.speed],
    ['access', '10', '20', '20', 'edge, bpduguard', 'up', '1G']);
  assert.equal(port(d, '1/1/3').adminUp, false);
  assert.deepEqual([port(d, '1/1/30').untagged, port(d, '1/1/30').link], ['1', 'not present']);
  const u = port(d, '1/3/1');
  assert.deepEqual([u.lag, u.mode, u.neighbor, u.neighborPort], ['lag1', '', 'CORE-01', 'TenGigabitEthernet1/0/47']);
  const lag = port(d, 'lg1');
  assert.deepEqual([lag.name, lag.kind, lag.description, lag.mode, lag.untagged, lag.tagged, lag.link, lag.speed],
    ['lag 1', 'lag', 'Uplink to core', 'trunk', '', '10,20,99', 'up', '20G']);
  assert.deepEqual([port(d, 've10').kind, port(d, 've10').ip], ['svi', '10.80.10.2/24']);
  assert.equal(lag.lag, '');
});

test('HPE Comware', () => {
  const d = run('comware').dev;
  assert.equal(d.hostname, 'CW-STACK-1');
  assert.equal(d.stp.mode, 'rstp');
  assert.equal(d.gateway, '10.50.99.1');
  const g2 = port(d, 'GE1/0/2');
  assert.deepEqual([g2.mode, g2.untagged, g2.tagged, g2.voiceVlan], ['hybrid', '10', '20', '20']);
  assert.equal(port(d, 'GigabitEthernet1/0/3').adminUp, false);
  const x = port(d, 'XGE1/0/49');
  assert.deepEqual([x.name, x.mode, x.tagged, x.lag, x.link, x.speed], ['Ten-GigabitEthernet1/0/49', 'trunk', '10,20,99', 'BAGG1', 'up', '10G']);
  assert.equal(d.ports.length, 6);
});

test('Juniper Junos (set format)', () => {
  const d = run('junos').dev;
  assert.equal(d.hostname, 'EX-FLOOR2');
  assert.equal(d.stp.mode, 'rstp');
  const g0 = port(d, 'ge-0/0/0');
  assert.deepEqual([g0.mode, g0.untagged, g0.tagged, g0.link, g0.neighbor], ['trunk', '99', '30,99', 'up', 'AP-F2-North']);
  assert.equal(port(d, 'ge-0/0/1').adminUp, false);
  assert.deepEqual([port(d, 'ge-0/0/4').mode, port(d, 'ge-0/0/4').untagged], ['access', '10']);
  assert.equal(port(d, 'ge-0/0/2').voiceVlan, '20');
  assert.equal(port(d, 'xe-0/1/0').lag, 'ae0');
  assert.equal(port(d, 'ae0').tagged, 'all');
  assert.equal(port(d, 'irb.99').ip, '10.60.99.12/24');
});

test('Juniper Junos (curly-brace format)', () => {
  const text = `system {
    host-name EX-CURLY;
    name-server {
        10.1.1.1;
    }
}
interfaces {
    ge-0/0/7 {
        description "Lab bench";
        unit 0 {
            family ethernet-switching {
                interface-mode trunk;
                vlan {
                    members [ LAB MGMT ];
                }
            }
        }
    }
}
vlans {
    LAB {
        vlan-id 70;
    }
    MGMT {
        vlan-id 99;
    }
}`;
  const d = NP.ingest(text, { devices: [] }).dev;
  assert.equal(d.vendor, 'junos');
  assert.equal(d.hostname, 'EX-CURLY');
  assert.deepEqual(d.dns, ['10.1.1.1']);
  const p = port(d, 'ge-0/0/7');
  assert.deepEqual([p.description, p.mode, p.tagged], ['Lab bench', 'trunk', '70,99']);
});

test('Fortinet FortiGate', () => {
  const d = run('fortigate').dev;
  assert.equal(d.hostname, 'FW-BRANCH-01');
  assert.deepEqual([d.model, d.version], ['FGT60F', '7.2.8']);
  assert.deepEqual(d.dns, ['1.1.1.1', '9.9.9.9']);
  assert.deepEqual(d.ntp, ['time.example.net']);
  assert.match(d.mgmtIp, /^192\.168\.10\.1\/24/);
  assert.equal(port(d, 'wan2').adminUp, false);
  const g = port(d, 'guest');
  assert.deepEqual([g.tagged, g.ip, g.description], ['50', '192.168.50.1/24', 'Guest WiFi']);
  assert.match(g.notes, /on internal1/);
  assert.match(port(d, 'internal1').notes, /zone LAN/);
});

test('FortiGate: FortiLink-managed switches become their own devices', () => {
  const devices = [];
  const r = NP.ingest(NP.samples.fortigate.text, { devices });
  devices.push(r.dev, ...r.extra.map(x => x.dev));
  assert.equal(r.dev.other['Managed switches'], 'IDF1-SW1, IDF1-SW2');
  assert.equal(r.dev.vlans.find(v => v.id === 40).name, 'cameras');
  assert.equal(r.dev.pendingChildren, undefined);
  assert.deepEqual(r.extra.map(x => [x.dev.hostname, x.isNew, x.dev.vendor]),
    [['IDF1-SW1', true, 'fortiswitch'], ['IDF1-SW2', true, 'fortiswitch']]);
  const sw = r.extra[0].dev;
  assert.equal(sw.serial, 'S124FPTF00000001');
  assert.equal(sw.other['Managed by'], 'FW-BRANCH-01 (FortiLink)');
  const p1 = port(sw, 'port1');
  assert.deepEqual([p1.description, p1.mode, p1.untagged, p1.tagged, p1.poeAdmin, p1.stp],
    ['Front desk phone+PC', 'trunk', '10', '20', 'enabled (default)', 'bpduguard']);
  assert.deepEqual([port(sw, 'port2').mode, port(sw, 'port2').untagged], ['access', '40']);
  assert.deepEqual([port(sw, 'port3').adminUp, port(sw, 'port3').poeAdmin], [false, 'disabled']);
  assert.equal(port(sw, 'port4').tagged, 'all');
  const up = port(sw, 'port23');
  assert.deepEqual([up.lag, up.mode, up.untagged], ['_FlInK1_MLAG0_', '', '']);
  const tr = port(sw, '_FlInK1_MLAG0_');
  assert.deepEqual([tr.kind, tr.neighbor, tr.mode, tr.tagged], ['lag', 'FW-BRANCH-01', 'FortiLink', 'all']);
  assert.deepEqual(sw.vlans.map(v => v.id + ':' + v.name), ['10:staff', '20:voice', '40:cameras']);
  // pasting the FortiGate config again updates the same switch devices rather than duplicating them
  const again = NP.ingest(NP.samples.fortigate.text, { devices });
  assert.deepEqual([again.isNew, again.extra.map(x => x.isNew)], [false, [false, false]]);
  assert.equal(again.extra[0].dev, sw);
  // and standalone output from the switch itself merges into that device by hostname
  const live = NP.ingest('IDF1-SW1 # diagnose switch physical-ports summary\n\n  Portname    Status  Tpid  Vlan  Duplex  Speed  Flags         Discard\n' +
    '  port1       up      8100  10    full    1G      QS,  ,       none\n', { devices });
  assert.equal(live.dev, sw);
  assert.deepEqual([port(sw, 'port1').link, port(sw, 'port1').tagged], ['up', '20']);
});

test('Fortinet FortiSwitch', () => {
  const d = run('fortiswitch').dev;
  assert.equal(d.hostname, 'FS-IDF-2');
  assert.deepEqual([d.model, d.version, d.serial], ['FortiSwitch-124F', '7.4.3', 'S124FT0000000000']);
  assert.deepEqual(d.dns, ['10.90.0.53', '10.90.0.54']);
  assert.deepEqual(d.ntp, ['10.90.0.1']);
  assert.equal(d.gateway, '10.90.99.1');
  assert.equal(d.mgmtIp, '10.90.99.22/24 (mgmt), 10.90.10.22/24 (internal)');
  assert.deepEqual([d.stp.mode, d.stp.priority[0]], ['mstp', 'MST 0: 24576']);
  assert.equal(d.vlans.find(v => v.id === 10).name, 'STAFF');
  const p1 = port(d, 'port1');
  assert.deepEqual([p1.description, p1.mode, p1.untagged, p1.tagged, p1.poeAdmin, p1.link, p1.speed],
    ['AP corridor', 'trunk', '99', '10,20', 'enabled', 'up', '1G']);
  assert.deepEqual([p1.neighbor, p1.neighborPort], ['AP-Corridor', 'eth0']);
  const p2 = port(d, 'port2');
  assert.deepEqual([p2.adminUp, p2.mode, p2.untagged, p2.stp, p2.neighbor], [false, 'access', '10', 'bpduguard', '']);
  assert.deepEqual([port(d, 'port3').speed, port(d, 'port3').stp], ['100M', 'edge']);
  const p23 = port(d, 'port23');
  assert.deepEqual([p23.lag, p23.mode, p23.neighbor, p23.neighborPort], ['uplink', '', 'CORE-01', 'Te1/0/45']);
  const up = port(d, 'uplink');
  assert.deepEqual([up.kind, up.mode, up.untagged, up.tagged], ['lag', 'trunk', '99', '1-98,100-4094']);
  assert.equal(port(d, 'internal').kind, 'svi');
});

test('MikroTik RouterOS', () => {
  const d = run('mikrotik').dev;
  assert.equal(d.hostname, 'MT-WORKSHOP');
  assert.equal(d.model, 'CRS328-24P-4S+');
  assert.deepEqual(d.dns, ['10.70.0.53', '1.1.1.1']);
  assert.deepEqual(d.ntp, ['10.70.0.1']);
  const e1 = port(d, 'ether1');
  assert.deepEqual([e1.description, e1.mode, e1.untagged, e1.tagged], ['AP workshop', 'trunk', '99', '30']);
  const e2 = port(d, 'ether2');
  assert.deepEqual([e2.adminUp, e2.untagged, e2.poeAdmin, e2.stp], [false, '10', 'disabled', 'edge']);
  assert.equal(port(d, 'sfp-sfpplus1').tagged, '10,30,99');
});

test('every vendor has command suggestions the parser can actually read', () => {
  for (const id of NP.vendorOrder) {
    const c = NP.commands[id];
    assert.ok(c && c.cmds.length, id + ' has commands');
    for (const x of c.cmds) assert.ok(x.cmd && x.gives, id + ': ' + x.cmd);
  }
  assert.match(NP.commandScript('ios'), /^terminal length 0\nshow running-config\n/);
});

test('forcing a vendor and unknown input', () => {
  assert.throws(() => NP.ingest('hello world\nnothing here', { devices: [] }), /vendor/);
  assert.throws(() => NP.ingest('hello world', { vendor: 'ios', devices: [] }), /Nothing recognisable/);
});

test('label templates, CSV and backup round-trip', () => {
  const d = run('ios').dev;
  const p = port(d, 'Gi1/0/2');
  assert.equal(NP.fillTemplate('{host} {port}', d, p), 'SW-ACCESS-01 Gi1/0/2');
  assert.equal(NP.fillTemplate('{neighbor|desc}', d, port(d, 'Gi1/0/3')), 'Printer 2nd floor');
  assert.equal(NP.fillTemplate('{num} [VLAN {voice}]', d, p), '2');
  assert.equal(NP.fillTemplate('{num} [VLAN {vlan}]', d, p), '2 VLAN 99');
  const rows = NP.labelRows([d], { lines: ['{port}', '{desc}', ''], physicalOnly: true, skipDisabled: true });
  assert.deepEqual(rows[0], ['Line1', 'Line2', 'Device', 'Port', 'Description', 'VLAN']);
  assert.equal(rows.length, 1 + 5);       // 6 physical ports, one disabled
  assert.equal(NP.csv([['a', 'b,c', 'say "hi"']]), 'a,"b,c","say ""hi"""\r\n');
  const back = NP.restore(NP.backup([d]));
  assert.equal(back[0].hostname, d.hostname);
  assert.equal(back[0].ports.length, d.ports.length);
  assert.throws(() => NP.restore('{"x":1}'), /not a ConfigHelper backup/);
});
