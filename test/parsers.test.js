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

test('label options: per-device labels, match filter, max length, dedupe', () => {
  const d = run('ios').dev;
  const dev = NP.labelRows([d], { per: 'device', lines: NP.labelPresets.device.lines });
  assert.deepEqual(dev, [['Line1', 'Line2', 'Line3'], ['SW-ACCESS-01', '10.10.99.11', 'WS-C2960X-48FPD-L SN FOC1234X5YZ']]);
  const ap = NP.labelRows([d], { lines: ['{port}', '{desc}'], physicalOnly: true, match: 'ap-lobby, printer' });
  assert.deepEqual(ap.slice(1).map(r => r[0]), ['Gi1/0/2', 'Gi1/0/3']);
  const short = NP.labelRows([d], { lines: ['{desc}'], physicalOnly: true, maxLen: 8 });
  assert.ok(short.slice(1).every(r => r[0].length <= 8));
  assert.equal(short[1][0], 'Receptio');
  const dup = NP.labelRows([d], { lines: ['VLAN {vlan}'], physicalOnly: true, dedupe: true });
  assert.deepEqual(dup.slice(1).map(r => r[0]), ['VLAN 10', 'VLAN 99']);
});

test('export formats and device report', () => {
  const rows = [['Port', 'Description'], ['Gi1/0/1', 'a|b, "c"'], ['Gi1/0/2', '']];
  assert.equal(NP.formatRows(rows, 'csv'), '\ufeffPort,Description\r\nGi1/0/1,"a|b, ""c"""\r\nGi1/0/2,\r\n');
  assert.equal(NP.formatRows(rows, 'tsv'), 'Port\tDescription\r\nGi1/0/1\ta|b, "c"\r\nGi1/0/2\t\r\n');
  assert.equal(NP.formatRows(rows, 'md').split('\n')[2], '| Gi1/0/1 | a\\|b, "c" |');
  assert.deepEqual(JSON.parse(NP.formatRows(rows, 'json'))[0], { Port: 'Gi1/0/1', Description: 'a|b, "c"' });
  assert.equal(NP.csv([['a;b', 'c']], ';'), '"a;b";c\r\n');
  const rep = NP.deviceReport(run('ios').dev, ['name', 'description', 'untagged']);
  assert.match(rep, /^# SW-ACCESS-01\n/);
  assert.match(rep, /## VLANs\n\n\| VLAN \| Name \|/);
  assert.match(rep, /\| GigabitEthernet1\/0\/1 \| Reception PC \+ phone \| 10 \|/);
});

test('not parsed: skipped lines are reported, noise is dropped, secrets are stripped', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  const d = NP.ingest(text, { devices: [] }).dev;
  assert.deepEqual(d.unparsed.map(e => e.ctx + ': ' + e.text).sort(),
    ['global: vlan configuration 3240', 'interface: negotiation auto']);        // no crypto, class-map, line con ...
  assert.equal(NP.unparsedGroups(d)[0].ctx, 'interface');

  const cfg = ['hostname R1', 'ip ospf authentication-key SuperSecret1', 'router-thing foo', ' child one', ' child two',
    'interface GigabitEthernet0/1', ' mystery knob 5', 'interface GigabitEthernet0/2', ' mystery knob 5', ''].join('\n');
  const r = NP.ingest('R1#show running-config\n' + cfg + 'R1#show clock\n*10:00:00.000 UTC Mon Jan 1 2026\nR1#show interfaces status\n\n' +
    'Port      Name               Status       Vlan       Duplex  Speed Type\nGi0/1                        connected    1          a-full a-1000 10/100/1000BaseTX\n',
    { vendor: 'ios', devices: [] }).dev;
  const get = (ctx, t) => r.unparsed.find(e => e.ctx === ctx && e.text === t);
  assert.ok(!JSON.stringify(r.unparsed).includes('SuperSecret1'));
  assert.ok(get('global', 'ip ospf authentication-key ***'));
  assert.deepEqual([get('global', 'router-thing foo').inner, get('interface', 'mystery knob 5').count], [2, 2]);
  assert.deepEqual(r.unparsed.filter(e => e.ctx === 'command').map(e => [e.text, e.inner]), [['show clock', 1]]);
  assert.match(NP.unparsedText(r), /Commands whose output was not used:\n {2}show clock/);
  // pasting the same thing again does not double the counts
  const again = NP.ingest('R1#show running-config\n' + cfg, { vendor: 'ios', devices: [r] }).dev;
  assert.equal(again, r);
  assert.equal(get('interface', 'mystery knob 5').count, 2);
});

test('not parsed: Fortinet reports setting names and whole sections, never values', () => {
  const text = 'config system global\n    set hostname "FW1"\n    set admintimeout 30\nend\n' +
    'config firewall policy\n    edit 1\n        set name "secret-policy"\n        set action accept\n    next\nend\n' +
    'config system interface\n    edit "port1"\n        set ip 10.0.0.1 255.255.255.0\n        set password ENC abc123\n    next\nend\n';
  const d = NP.ingest(text, { devices: [] }).dev;
  const lines = d.unparsed.map(e => e.ctx + ': ' + e.text + ' ' + e.inner).sort();
  assert.deepEqual(lines, ['block: config firewall policy 2', 'system global: set admintimeout 0', 'system interface: set password 0']);
  assert.ok(!JSON.stringify(d.unparsed).includes('abc123') && !JSON.stringify(d.unparsed).includes('secret-policy'));
});

test('manual edits: laid over parsed data, used by exports and labels, kept across re-paste and backup', () => {
  const devices = [];
  const d = NP.ingest(NP.samples.ios.text, { devices }).dev;
  devices.push(d);
  NP.setEdit(d, NP.portId('Gi1/0/2').key, 'description', 'AP Lobby (ceiling)');
  NP.setEdit(d, NP.portId('Gi1/0/3').key, 'excluded', true);
  NP.setEdit(d, NP.portId('Gi1/0/1').key, 'neighbor', 'PHONE-1');
  assert.equal(port(d, 'Gi1/0/2').description, 'AP-Lobby');                    // parsed value untouched
  assert.deepEqual(NP.editCount(d), { fields: 2, excluded: 1, total: 3 });
  const view = NP.eports(d);
  assert.equal(view.length, d.ports.length - 1);
  const e2 = view.find(p => p.short === 'Gi1/0/2');
  assert.deepEqual([e2.description, e2.edited.description], ['AP Lobby (ceiling)', 'AP-Lobby']);
  assert.equal(NP.eports(d, true).find(p => p.short === 'Gi1/0/3').excluded, true);
  const rows = NP.portRows([d], ['name', 'description']);
  assert.ok(rows.some(r => r[2] === 'AP Lobby (ceiling)'));
  assert.ok(!rows.some(r => r[1] === 'GigabitEthernet1/0/3'));
  const lab = NP.labelRows([d], { lines: ['{port}', '{desc}', '{neighbor}'], physicalOnly: true });
  assert.deepEqual(lab.slice(1, 3), [['Gi1/0/1', 'Reception PC + phone', 'PHONE-1'], ['Gi1/0/2', 'AP Lobby (ceiling)', 'AP-Lobby']]);
  assert.ok(!lab.some(r => r[0] === 'Gi1/0/3'));
  // re-pasting the device output keeps the edits
  assert.equal(NP.ingest(NP.samples.ios.text, { devices }).dev, d);
  assert.equal(NP.eports(d).find(p => p.short === 'Gi1/0/2').description, 'AP Lobby (ceiling)');
  // so does a backup round-trip
  const back = NP.restore(NP.backup([d]))[0];
  assert.deepEqual(NP.editCount(back), { fields: 2, excluded: 1, total: 3 });
  // typing the parsed value back, or re-including, removes the edit
  NP.setEdit(d, NP.portId('Gi1/0/2').key, 'description', 'AP-Lobby');
  NP.setEdit(d, NP.portId('Gi1/0/3').key, 'excluded', false);
  NP.setEdit(d, NP.portId('Gi1/0/1').key, 'neighbor', '');
  assert.deepEqual(d.edits, {});
});

test('config checks: real 3850 findings', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  const d = NP.ingest(text, { devices: [] }).dev;
  const found = NP.checks(d);
  const by = id => found.find(f => f.id === id);
  const ports = id => by(id).ports.map(p => p.short);
  assert.deepEqual(found.filter(f => f.severity === 'warn').map(f => f.id), ['errdisabled', 'nontp', 'http']);
  assert.deepEqual(ports('errdisabled'), ['Gi1/0/14']);
  assert.deepEqual(ports('portfasttrunk'), ['Te1/0/38']);
  assert.ok(by('stpprio'));
  assert.deepEqual(ports('native1'), ['Gi1/0/11', 'Te1/0/44', 'Te1/0/47', 'Te1/0/48', 'Te1/1/4']);
  assert.equal(ports('trunkall').length, 9);
  assert.equal(ports('unusedenabled').length, 45);
  assert.ok(!by('noedge') && !by('noguard') && !by('undefinedvlan') && !by('snoopnotrust') && !by('telnet'));
  assert.ok(!ports('unusedenabled').includes('Te1/1/5'));        // empty module slots are not "unused ports"
  assert.match(NP.checksText(d), /\[Fix\] {4}Ports shut down by the switch[^\n]*\n[^\n]*\n {2}Ports \(1\): Gi1\/0\/14/);
  assert.match(NP.deviceReport(d, ['name']), /## Checks\n\n\| Level \| Finding \| Ports \|/);
});

test('config checks: each rule on a small config', () => {
  const cfg = ['hostname SW9', 'no spanning-tree vlan 30', 'vlan 10', ' name USERS', 'ip http server', 'ip dhcp snooping',
    'snmp-server community x RO',
    'interface GigabitEthernet0/1', ' switchport mode access', ' switchport access vlan 10', ' spanning-tree portfast',
    'interface GigabitEthernet0/2', ' switchport mode access', ' switchport access vlan 77',
    'interface GigabitEthernet0/3', ' description uplink', ' switchport mode trunk', ' channel-group 1 mode active',
    'interface Port-channel1', ' switchport mode trunk', ' switchport trunk allowed vlan 10',
    'line vty 0 4', ' transport input telnet ssh', ''].join('\n');
  const status = 'SW9#show interfaces status\n\nPort      Name               Status       Vlan       Duplex  Speed Type\n' +
    'Gi0/1                        connected    10         a-half  a-100 10/100/1000BaseTX\n' +
    'Gi0/2                        connected    77         a-full a-1000 10/100/1000BaseTX\n';
  const d = NP.ingest('SW9#show running-config\n' + cfg + status, { vendor: 'ios', devices: [] }).dev;
  const ids = NP.checks(d).map(f => f.id).sort();
  assert.deepEqual(ids, ['halfduplex', 'http', 'lagsingle', 'native1', 'nodesc', 'noedge', 'noguard', 'nontp', 'nosyslog',
    'snmpv2', 'snoopnotrust', 'stplegacy', 'telnet', 'undefinedvlan']);
  const f = NP.checks(d).find(x => x.id === 'undefinedvlan');
  assert.match(f.title, /not defined: 77$/);
  assert.deepEqual(f.ports.map(p => p.short), ['Gi0/2']);
  // an edited description clears the "no description" finding
  NP.setEdit(d, NP.portId('Gi0/1').key, 'description', 'Till 1');
  NP.setEdit(d, NP.portId('Gi0/2').key, 'description', 'Till 2');
  assert.ok(!NP.checks(d).some(x => x.id === 'nodesc'));
  // nothing device-level is claimed when only show output was loaded
  const bare = NP.ingest(status, { vendor: 'ios', devices: [] }).dev;
  assert.deepEqual(NP.checks(bare).map(x => x.id), ['halfduplex', 'nodesc']);
  // FortiGate: admin access on WAN, and FortiLink-managed switches are not blamed for missing NTP
  const fg = NP.ingest(NP.samples.fortigate.text.replace('set allowaccess ping\n        set type physical\n        set alias "ISP fibre"',
    'set allowaccess ping https http\n        set type physical\n        set alias "ISP fibre"'), { devices: [] });
  assert.deepEqual(NP.checks(fg.dev).map(x => [x.id, x.ports.map(p => p.short).join()]), [['fgclear', 'wan1'], ['fgwanadmin', 'wan1']]);
  assert.ok(!NP.checks(fg.extra[0].dev).some(x => x.id === 'nontp'));
});

test('snapshots and compare', () => {
  const devices = [];
  const d = NP.ingest(NP.samples.ios.text, { devices }).dev;
  devices.push(d);
  NP.setEdit(d, NP.portId('Gi1/0/2').key, 'description', 'edited');
  const snap = NP.snapshot(d, 'before change', '2026-01-01T00:00:00Z');
  assert.deepEqual([snap.label, snap.data.ports.length, snap.data.edits, snap.data.snapshots], ['before change', 9, undefined, undefined]);
  assert.equal(NP.diff(snap.data, d).total, 0);

  // the "new snapshot" flow: reset, then parse the newer output
  const newer = NP.samples.ios.text
    .replace(' description AP-Lobby\n switchport trunk native vlan 99\n switchport trunk allowed vlan 30,99',
      ' description AP-Lobby-NEW\n switchport trunk native vlan 99\n switchport trunk allowed vlan 30,40,99')
    .replace('vlan 30\n name WIFI\n!', 'vlan 30\n name WIRELESS\n!\nvlan 40\n name GUEST\n!')
    .replace('vlan 20\n name VOICE\n!\n', '')
    .replace('ntp server 10.10.0.2\n', '')
    .replace('interface GigabitEthernet1/0/4\n description SPARE\n switchport access vlan 10\n switchport mode access\n shutdown\n!\n', '')
    .replace('Gi1/0/4   SPARE              disabled     10           auto   auto 10/100/1000BaseTX\n', '')
    .replace('Gi1/0/4   auto   off        0.0     n/a                 n/a   30.0\n', '')
    .replace('Gi1/0/1   Reception PC + pho connected ', 'Gi1/0/1   Reception PC + pho notconnect')
    .replace('Gi1/0/1   auto   on         6.5 ', 'Gi1/0/1   auto   on         7.1 ');
  NP.resetParsed(d);
  assert.deepEqual([d.ports.length, d.vlans.length, d.hostname, d.snapshots.length, NP.editCount(d).total], [0, 0, 'SW-ACCESS-01', 1, 0]);
  assert.equal(NP.ingest(newer, { devices, target: 'current', current: d }).dev, d);
  assert.equal(NP.editCount(d).fields, 1);                                   // the edit survived the reset

  const diff = NP.diff(snap.data, d);
  assert.deepEqual(diff.settings, [{ item: 'Services: NTP servers', before: '10.10.0.1 (prefer), 10.10.0.2', after: '10.10.0.1 (prefer)' }]);
  assert.deepEqual([diff.vlansAdded.map(v => v.id), diff.vlansRemoved.map(v => v.id), diff.vlansRenamed], [[40], [20], [{ id: 30, before: 'WIFI', after: 'WIRELESS' }]]);
  assert.deepEqual(diff.portsRemoved.map(p => p.short), ['Gi1/0/4']);
  assert.deepEqual(diff.ports.map(p => [p.short, p.changes.map(c => c.field + ':' + c.before + '>' + c.after)]),
    [['Gi1/0/2', ['description:AP-Lobby>AP-Lobby-NEW', 'tagged:30,99>30,40,99']]]);     // live changes on Gi1/0/1 not included
  const live = NP.diff(snap.data, d, { live: true });
  assert.deepEqual(live.ports.find(p => p.short === 'Gi1/0/1').changes.map(c => c.field + ':' + c.before + '>' + c.after),
    ['link:up>down', 'speed:1G>', 'duplex:full>', 'poeWatts:6.5>7.1']);
  const md = NP.diffMarkdown(diff, 'SW-ACCESS-01 changes', 'before change', 'Current state');
  assert.match(md, /\| 20 \| removed \| VOICE \|  \|/);
  assert.match(md, /\| Gi1\/0\/2 \| Tagged VLANs \| 30,99 \| 30,40,99 \|/);

  // live fields are skipped, and reported, when only one side has them
  const cfgOnly = NP.ingest(newer.slice(0, newer.indexOf('SW-ACCESS-01#show interfaces status')), { devices: [] }).dev;
  const skipped = NP.diff(snap.data, cfgOnly, { live: true });
  assert.ok(skipped.fieldsSkipped.includes('Link') && !skipped.ports.some(p => p.changes.some(c => c.field === 'link')));

  // capped, and carried through a backup
  for (let i = 0; i < 12; i++) NP.snapshot(d, 's' + i);
  assert.equal(d.snapshots.length, NP.MAX_SNAPSHOTS);
  assert.equal(NP.restore(NP.backup([d]))[0].snapshots.length, NP.MAX_SNAPSHOTS);
});

test('cable list across devices', () => {
  const mk = (host, lines) => NP.ingest(host + '#show running-config\nhostname ' + host + '\n' +
    lines.map(l => 'interface ' + l[0] + '\n description ' + l[1] + '\n').join('') + '!\n' + host + '#show cdp neighbors detail\n' +
    lines.filter(l => l[2]).map(l => '-------------------------\nDevice ID: ' + l[2] + '\nEntry address(es):\n  IP address: 10.0.0.9\nPlatform: cisco X,  Capabilities: Switch\n' +
      'Interface: ' + l[0] + ',  Port ID (outgoing port): ' + l[3] + '\n').join(''), { vendor: 'ios', devices: [] }).dev;
  const core = mk('CORE-01', [['TenGigabitEthernet1/0/1', 'to access A', 'ACCESS-A.corp.example.com', 'TenGigabitEthernet1/1/1'],
    ['TenGigabitEthernet1/0/2', 'to access B', 'ACCESS-B', 'Te1/1/1'], ['TenGigabitEthernet1/0/3', 'to firewall', 'FW-EDGE', 'port5']]);
  const accA = mk('ACCESS-A', [['TenGigabitEthernet1/1/1', 'uplink', 'CORE-01.corp.example.com', 'TenGigabitEthernet1/0/1'],
    ['GigabitEthernet1/0/5', 'AP', 'AP-LOBBY', 'eth0']]);
  const accB = mk('ACCESS-B', [['TenGigabitEthernet1/1/1', 'uplink', '', ''], ['TenGigabitEthernet1/1/2', 'wrong', 'CORE-01', 'Te1/0/9']]);
  const cables = NP.cables([core, accA, accB]);
  const line = c => [c.id, c.a.host, c.a.port, c.b.host, c.b.port, c.status].join(' ');
  assert.deepEqual(cables.map(line), [
    'C001 CORE-01 Te1/0/1 ACCESS-A Te1/1/1 both ends',                 // listed once although both switches report it
    'C002 CORE-01 Te1/0/2 ACCESS-B Te1/1/1 one end only',              // ACCESS-B has no neighbor on that port
    'C003 CORE-01 Te1/0/3 FW-EDGE port5 far end not loaded',
    'C004 ACCESS-A Gi1/0/5 AP-LOBBY eth0 far end not loaded',
    'C005 ACCESS-B Te1/1/2 CORE-01 Te1/0/9 one end only'               // far port does not exist on CORE-01
  ]);
  assert.equal(cables[0].b.desc, 'uplink');
  assert.match(cables[4].note, /not found on CORE-01/);
  assert.deepEqual(NP.cableRows(cables)[1].slice(0, 7), ['C001', 'CORE-01', 'Te1/0/1', 'to access A', 'ACCESS-A', 'Te1/1/1', 'uplink']);

  // a disagreement between the two ends is flagged, and both views are kept
  NP.setEdit(accA, NP.portId('Te1/1/1').key, 'neighborPort', 'Te1/0/2');
  assert.deepEqual(NP.cables([core, accA]).map(c => c.status).slice(0, 1), ['mismatch']);
  NP.setEdit(accA, NP.portId('Te1/1/1').key, 'neighborPort', 'TenGigabitEthernet1/0/1');
  // excluded ports drop out
  NP.setEdit(accA, NP.portId('Gi1/0/5').key, 'excluded', true);
  assert.ok(!NP.cables([core, accA, accB]).some(c => c.a.port === 'Gi1/0/5'));

  const lab = NP.cableLabelRows(cables, { lines: ['{a} {aport}', '{b} {bport}', ''], bothEnds: true, loadedOnly: true });
  assert.deepEqual(lab.slice(0, 3), [['Line1', 'Line2'], ['CORE-01 Te1/0/1', 'ACCESS-A Te1/1/1'], ['ACCESS-A Te1/1/1', 'CORE-01 Te1/0/1']]);
  assert.equal(lab.length, 1 + 3 * 2);
  assert.equal(NP.cableLabelRows(cables, { lines: ['{id} {a}>{b}'], maxLen: 12 })[1][0], 'C001 CORE-01');
});

test('sanitize: every sample still parses to the same structure, with nothing identifying left', () => {
  for (const id of Object.keys(NP.samples)) {
    const before = NP.ingest(NP.samples[id].text, { devices: [] }).dev;
    const r = NP.sanitize(NP.samples[id].text);
    assert.equal(r.vendor, id);
    assert.ok(r.checked && r.same, id + ' parses the same after sanitizing');
    assert.deepEqual(r.leftovers, [], id + ' leftovers');
    assert.ok(!r.text.includes(before.hostname), id + ' hostname gone');
    if (before.domain) assert.ok(!r.text.includes(before.domain), id + ' domain gone');
    assert.equal(NP.detect(r.text), id, id + ' is still detected');
    // sanitizing twice changes nothing more of substance
    assert.ok(NP.sanitize(r.text).same);
  }
});

test('sanitize: real 3850 session', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  const r = NP.sanitize(text);
  assert.deepEqual([r.checked, r.same, r.ports, r.vlans, r.leftovers], [true, true, 65, 27, []]);
  for (const s of ['SW-PATCH-01', 'labadmin', 'example.lab', 'WORKBENCH-3560X', 'FW-HQ-01', 'Office-Room', 'lab-com-mgmt', 'LAB-ROUTING',
    'HQ FortiGate', '10.0.65.169', 'FCW0000X000', '$9$', 'LAB-VTP', 'LAB-MST']) assert.ok(!r.text.includes(s), s + ' removed');
  // names are replaced consistently, so config, status table and neighbor output still line up
  const d = NP.ingest(r.text, { devices: [] }).dev;
  const p = NP.findPort(d, 'Gi1/0/15');
  assert.equal(p.description.length, 'Temp-Trunk-to-OfficeNextDoor'.length);     // full description from config, not the truncated table copy
  assert.equal(NP.cables([d]).length, 6);
  assert.match(d.hostname, /^H\d/);
  assert.equal(NP.checks(d).map(f => f.id).join(), NP.checks(NP.ingest(text, { devices: [] }).dev).map(f => f.id).join());
  // options: leave descriptions and VLAN names alone
  const partial = NP.sanitize(text, { descriptions: false, vlanNames: false });
  assert.ok(partial.text.includes('TechArea-Test-Rack') && partial.text.includes('lab-com-mgmt') && !partial.text.includes('SW-PATCH-01'));
});

test('sanitize: secrets and addresses without a recognised platform', () => {
  const r = NP.sanitize(['enable secret 5 $1$abcd$efghijklmnop', 'snmp-server community s3cr3tRO RO', 'tacacs-server key 7 0822455D0A16',
    'set password ENC AbCdEf123456', 'add name=u1 password=hunter2 group=full', 'ntp server 203.0.113.9', 'ip route 0.0.0.0 0.0.0.0 198.51.100.1',
    'ip address 198.51.100.7 255.255.255.0', 'mac 00:1a:2b:3c:4d:5e and 001a.2b3c.4d5e', 'clock 10:15:30', 'contact bob@corp.example.com',
    'ipv6 address 2001:470:abcd::1/64', 'access-list 10 remark Bob Smith desk'].join('\n'), { vendor: 'auto' });
  for (const s of ['abcd$efgh', 's3cr3tRO', '0822455D0A16', 'AbCdEf123456', 'hunter2', '203.0.113', '198.51.100', '1a:2b', '2b3c', 'bob@', '2001:470', 'Bob Smith']) {
    assert.ok(!r.text.includes(s), s + ' removed');
  }
  assert.ok(r.text.includes('255.255.255.0') && r.text.includes('0.0.0.0 0.0.0.0') && r.text.includes('10:15:30'));
  assert.match(r.text, /ip route 0\.0\.0\.0 0\.0\.0\.0 10\.2\.100\.1\nip address 10\.2\.100\.7 /);       // same network, same replacement
  assert.match(r.text, /mac 00:00:5e:00:53:01 and 0000\.5e00\.5301/);                                          // same MAC in both notations
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
  const lean = NP.labelRows([d], { lines: ['{port}', '{desc}', ''], physicalOnly: true, skipDisabled: true });
  assert.deepEqual(lean[0], ['Line1', 'Line2']);           // lean by default: only the label lines
  assert.deepEqual(lean[1], ['Gi1/0/1', 'Reception PC + phone']);
  const rows = NP.labelRows([d], { lines: ['{port}', '{desc}', ''], physicalOnly: true, skipDisabled: true, refCols: true });
  assert.deepEqual(rows[0], ['Line1', 'Line2', 'Device', 'Port', 'Description', 'VLAN']);
  assert.equal(rows.length, 1 + 5);       // 6 physical ports, one disabled
  assert.equal(NP.csv([['a', 'b,c', 'say "hi"']]), 'a,"b,c","say ""hi"""\r\n');
  const back = NP.restore(NP.backup([d]));
  assert.equal(back[0].hostname, d.hostname);
  assert.equal(back[0].ports.length, d.ports.length);
  assert.throws(() => NP.restore('{"x":1}'), /not a ConfigHelper backup/);
});
