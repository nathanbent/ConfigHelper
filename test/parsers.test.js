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

test('Dell OS6 (N-series)', () => {
  const r = run('os6');
  const d = r.dev;
  assert.deepEqual(r.cleaned, []);                                           // flush-left "exit" style is not mistaken for lost indentation
  assert.deepEqual([d.hostname, d.model, d.version, d.serial], ['N2048-IDF1', 'N2048P', '6.3.3.10', 'CN0000000000000001']);
  assert.deepEqual([d.gateway, d.domain, d.dns.join(), d.ntp.join(), d.syslog.join()], ['10.95.99.1', 'site.example.org', '10.95.0.53', '10.95.0.1', '10.95.0.60']);
  assert.deepEqual([d.stp.mode, d.stp.priority.join()], ['rapid-pvst', '8192']);
  assert.equal(d.vlans.map(v => v.id + ':' + v.name).join(), '10:Staff,20:Phones,30:,99:Mgmt');
  assert.match(d.mgmtIp, /^10\.95\.99\.14\/24 \(Vlan99\)/);
  const g1 = port(d, 'Gi1/0/1');
  assert.deepEqual([g1.description, g1.mode, g1.untagged, g1.tagged, g1.link, g1.speed, g1.poeStatus, g1.poeWatts, g1.poeClass, g1.neighbor, g1.neighborPort],
    ['AP east wing', 'trunk', '99', '10,30', 'up', '1G', 'on', '9.2', '4', 'AP-EastWing', 'eth0']);
  const g2 = port(d, 'Gi1/0/2');
  assert.deepEqual([g2.mode, g2.untagged, g2.tagged, g2.stp, g2.speed, g2.neighbor], ['general', '10', '20', 'edge', '100M', '']);
  const g3 = port(d, 'Gi1/0/3');
  assert.deepEqual([g3.mode, g3.untagged, g3.poeAdmin, g3.link], ['access', '10', 'disabled', 'down']);
  assert.equal(port(d, 'Gi1/0/4').adminUp, false);
  const te = port(d, 'Te1/0/1');
  assert.deepEqual([te.lag, te.mode, te.speed, te.neighbor, te.neighborPort], ['Po1', '', '10G', 'CORE-01', 'Te1/0/45']);
  const po = port(d, 'Po1');
  assert.deepEqual([po.name, po.kind, po.description, po.mode, po.untagged, po.tagged, po.link], ['port-channel 1', 'lag', 'Uplink to core', 'trunk', '1', 'all', 'up']);
  assert.deepEqual(d.unparsed.map(e => e.text), []);
  assert.ok(!JSON.stringify(d).includes('0123456789abcdef'));
  assert.match(NP.commandScript('os6'), /show lldp remote-device all/);
});

test('Dell OS9', () => {
  const r = run('os9');
  const d = r.dev;
  assert.equal(r.vendor, 'os9');
  assert.deepEqual(r.cleaned, []);
  assert.deepEqual([d.hostname, d.model, d.version], ['S4048-TOR1', 'S4048-ON', '9.14(2.4)']);
  assert.deepEqual([d.gateway, d.domain, d.dns.join(), d.ntp.join(), d.syslog.join()], ['10.70.99.1', 'dc.example.org', '10.70.0.53', '10.70.0.1', '10.70.0.60']);
  assert.deepEqual([d.stp.enabled, d.stp.mode, d.stp.priority.join()], ['yes', 'rstp', '8192']);
  assert.equal(d.vlans.map(v => v.id + ':' + v.name).join(), '1:,10:Servers,20:vMotion,30:Backup');
  const t1 = port(d, 'Te1/1');
  assert.deepEqual([t1.description, t1.mode, t1.untagged, t1.tagged, t1.stp, t1.link, t1.speed, t1.neighbor],
    ['ESX-01 vmnic0', 'trunk', '1', '10,20', 'edge, bpduguard', 'up', '10G', 'esx-01']);     // hybrid keeps the default VLAN untagged
  assert.deepEqual([port(d, 'Te1/2').mode, port(d, 'Te1/2').untagged], ['access', '10']);
  assert.deepEqual([port(d, 'Te1/3').untagged, port(d, 'Te1/3').speed], ['30', '1G']);
  assert.deepEqual([port(d, 'Te1/4').adminUp, port(d, 'Te1/4').link], [false, 'down']);
  const u = port(d, 'Te1/47');
  assert.deepEqual([u.lag, u.mode, u.neighbor, u.neighborPort], ['Po10', '', 'CORE-1', 'TenGigabitEthernet 1/10']);
  const po = port(d, 'Po10');
  assert.deepEqual([po.kind, po.mode, po.untagged, po.tagged], ['lag', 'trunk', '', '10,20,30']);
  assert.deepEqual([port(d, 'Fo1/49').lag, port(d, 'Fo1/50').lag], ['Po100', 'Po100']);
  assert.match(d.mgmtIp, /^10\.70\.99\.11\/24 \(Ma1\/1\)/);
  assert.equal(port(d, 'Vlan30').ip, '10.70.30.2/24');
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 8);
  assert.match(NP.commandScript('os9'), /^terminal length 0\nshow running-config\n/);
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

test('Palo Alto PAN-OS (set format + show commands)', () => {
  const d = run('paloalto').dev;
  assert.deepEqual([d.hostname, d.model, d.version, d.serial], ['PA-EDGE-01', 'PA-440', '10.2.4-h4', '000000000001']);
  assert.deepEqual([d.domain, d.dns.join(), d.ntp.join(), d.syslog.join(), d.gateway], ['edge.example.org', '10.98.0.53,9.9.9.9', '10.98.0.1', '10.98.0.60', '10.98.99.1 (mgmt)']);
  assert.match(d.mgmtIp, /^10\.98\.99\.5\/24 \(mgmt\)/);
  assert.deepEqual([d.other['Default route'], d.other.Zones, d.other['Admin users'], d.other.Telnet, d.snmp.versions.join()],
    ['203.0.113.1 (default)', 'untrust, trust, guest, dmz', 'admin, netops', 'disabled', 'v3']);
  const e1 = port(d, 'ethernet1/1');
  assert.deepEqual([e1.description, e1.mode, e1.ip, e1.link, e1.speed, e1.notes], ['ISP fibre', 'routed', '203.0.113.2/30', 'up', '1G', 'zone untrust; vr default; access ping (allow-ping)']);
  const s10 = port(d, 'ethernet1/2.10');
  assert.deepEqual([s10.kind, s10.mode, s10.tagged, s10.ip, s10.description], ['svi', 'vlan', '10', '10.98.10.1/24', 'Staff']);
  assert.match(s10.notes, /on ethernet1\/2; zone trust; vr default; access https\/ssh\/ping \(allow-mgmt\)/);
  assert.deepEqual([port(d, 'ethernet1/3').adminUp, port(d, 'ethernet1/3').mode, port(d, 'ethernet1/3').link], [false, 'tap', 'down']);
  assert.deepEqual([port(d, 'ethernet1/5').lag, port(d, 'ethernet1/5').mode, port(d, 'ethernet1/5').speed], ['ae1', '', '10G']);
  const ae = port(d, 'ae1');
  assert.deepEqual([ae.kind, ae.mode, ae.ip, ae.description, ae.link], ['lag', 'routed', '10.98.30.1/24', 'DMZ switch', 'up']);
  assert.equal(port(d, 'loopback.1').kind, 'loopback');
  assert.equal(d.vlans.map(v => v.id + ':' + v.name).join(), '10:Staff,20:Guest wifi');
  // policies and objects are reported as sections, never with their contents; the password hash is not kept anywhere
  assert.deepEqual(d.unparsed.map(e => e.text + ' x' + e.count).sort(), ['set address web-server … x1', 'set rulebase security … x3']);
  assert.ok(!JSON.stringify(d).includes('abcdefgh'));
  assert.deepEqual(NP.checks(d).map(f => f.id), ['unusedenabled']);              // ethernet1/6 is enabled with no link
});

test('Palo Alto PAN-OS: XML export and brace format give the same result as set format', () => {
  const xml = `<?xml version="1.0"?>
<config version="10.2.0" urldb="paloaltonetworks" detail-version="10.2.4">
  <mgt-config><users><entry name="admin"><phash>$1$abcdefgh$ijklmnopqrstuvwx</phash></entry></users></mgt-config>
  <shared><log-settings><syslog><entry name="central"><server><entry name="srv1"><server>10.98.0.60</server></entry></server></entry></syslog></log-settings></shared>
  <devices><entry name="localhost.localdomain">
    <deviceconfig><system>
      <hostname>PA-XML</hostname><ip-address>10.98.99.6</ip-address><netmask>255.255.255.0</netmask><default-gateway>10.98.99.1</default-gateway>
      <dns-setting><servers><primary>10.98.0.53</primary></servers></dns-setting>
      <ntp-servers><primary-ntp-server><ntp-server-address>10.98.0.1</ntp-server-address></primary-ntp-server></ntp-servers>
      <service><disable-http>no</disable-http><disable-telnet>yes</disable-telnet></service>
    </system></deviceconfig>
    <network>
      <profiles><interface-management-profile><entry name="mgmt &amp; ping"><https>yes</https><http>yes</http><ping>yes</ping></entry></interface-management-profile></profiles>
      <interface><ethernet>
        <entry name="ethernet1/1"><layer3><ip><entry name="198.51.100.2/30"/></ip><interface-management-profile>mgmt &amp; ping</interface-management-profile></layer3><comment>Internet &lt;primary&gt;</comment></entry>
        <entry name="ethernet1/2"><layer3><units>
          <entry name="ethernet1/2.30"><tag>30</tag><ip><entry name="10.98.30.1/24"/></ip><comment>Servers</comment></entry>
        </units></layer3></entry>
        <entry name="ethernet1/4"><link-state>down</link-state><layer2/></entry>
      </ethernet></interface>
      <virtual-router><entry name="default"><interface><member>ethernet1/1</member><member>ethernet1/2.30</member></interface>
        <routing-table><ip><static-route><entry name="dflt"><nexthop><ip-address>198.51.100.1</ip-address></nexthop><destination>0.0.0.0/0</destination></entry></static-route></ip></routing-table>
      </entry></virtual-router>
    </network>
    <vsys><entry name="vsys1"><zone>
      <entry name="untrust"><network><layer3><member>ethernet1/1</member></layer3></network></entry>
      <entry name="servers"><network><layer3><member>ethernet1/2.30</member></layer3></network></entry>
    </zone><rulebase><security><rules><entry name="r1"><action>allow</action></entry></rules></security></rulebase></entry></vsys>
  </entry></devices>
</config>`;
  const r = NP.ingest(xml, { devices: [] });
  const d = r.dev;
  assert.equal(r.vendor, 'paloalto');
  assert.deepEqual([d.hostname, d.version, d.dns.join(), d.ntp.join(), d.syslog.join(), d.other['HTTP server'], d.other.Zones], ['PA-XML', '10.2.4', '10.98.0.53', '10.98.0.1', '10.98.0.60', 'enabled', 'untrust, servers']);
  const e1 = port(d, 'ethernet1/1');
  assert.deepEqual([e1.description, e1.mode, e1.ip, e1.notes], ['Internet <primary>', 'routed', '198.51.100.2/30', 'zone untrust; vr default; access https/http/ping (mgmt & ping)']);
  const s30 = port(d, 'ethernet1/2.30');
  assert.deepEqual([s30.tagged, s30.ip, s30.description], ['30', '10.98.30.1/24', 'Servers']);
  assert.deepEqual([port(d, 'ethernet1/4').adminUp, port(d, 'ethernet1/4').mode], [false, 'layer2']);
  assert.equal(d.other['Default route'], '198.51.100.1 (default)');
  assert.ok(!JSON.stringify(d).includes('abcdefgh'));
  // HTTP management left on, and admin access on the untrust interface, are both flagged
  assert.deepEqual(NP.checks(d).map(f => f.id).sort(), ['fgclear', 'fgwanadmin', 'http', 'nosyslog'].filter(x => x !== 'nosyslog').sort());

  const brace = `deviceconfig {
  system {
    hostname PA-BRACE;
    dns-setting {
      servers {
        primary 10.98.0.53;
      }
    }
  }
}
network {
  interface {
    ethernet {
      ethernet1/1 {
        layer3 {
          ip {
            192.0.2.2/30;
          }
        }
        comment "Uplink";
      }
    }
  }
  virtual-router {
    default {
      interface [ ethernet1/1 ];
    }
  }
}`;
  const b = NP.ingest(brace, { devices: [] }).dev;
  assert.deepEqual([b.vendor, b.hostname, b.dns.join()], ['paloalto', 'PA-BRACE', '10.98.0.53']);
  assert.deepEqual([port(b, 'ethernet1/1').ip, port(b, 'ethernet1/1').description, port(b, 'ethernet1/1').notes], ['192.0.2.2/30', 'Uplink', 'vr default']);
});

test('prompt detection is not fooled by words or XML that merely start like a command', () => {
  const cmds = t => NP.sections(t).map(s => s.cmd);
  assert.deepEqual(cmds('<name>shopkeeper</name>\n<domain>shop.example.net</domain>\n<x>display</x>\nsw1#shutdown now\nsw1>getting started'), ['']);
  assert.deepEqual(cmds('<SW1>display current-configuration\n sysname SW1\n<SW1>dis int brief\nx\nsw1#sh run\ny\nfw # get system status\nz\n[admin@mt] > /export\nq'),
    ['display current-configuration', 'dis int brief', 'sh run', 'get system status', '/export']);
});

test('pfSense / OPNsense config.xml', () => {
  const d = run('pfsense').dev;
  assert.deepEqual([d.hostname, d.domain, d.model, d.dns.join(), d.ntp.join(), d.syslog.join()],
    ['fw-shop', 'shop.example.net', 'pfSense', '1.1.1.1,9.9.9.9', '2.pfsense.pool.ntp.org,time.example.net', '192.168.40.60']);
  assert.deepEqual([d.gateway, d.mgmtIp, d.other['Web interface'], d.other.SSH, d.other['Admin users'], d.other['DHCP server on'], d.snmp.versions.join(), d.snmp.location],
    ['203.0.113.1 (WANGW)', '192.168.40.1/24 (LAN)', 'https port 8443', 'enabled', 'admin, shopkeeper', 'lan', 'v2c', 'Back office']);
  const wan = port(d, 'igb0');
  assert.deepEqual([wan.kind, wan.description, wan.ip, wan.adminUp, wan.notes], ['physical', 'WAN', 'dhcp', true, 'assigned as wan; role wan; blocks private nets']);
  assert.deepEqual([port(d, 'igb1').description, port(d, 'igb1').ip, port(d, 'igb1').mode], ['LAN', '192.168.40.1/24', 'routed']);
  const g = port(d, 'igb1.20');
  assert.deepEqual([g.kind, g.mode, g.tagged, g.description, g.ip, g.notes], ['svi', 'vlan', '20', 'GUESTWIFI', '192.168.41.1/24', 'on igb1; assigned as opt1']);
  const lag = port(d, 'lagg0');
  assert.deepEqual([lag.kind, lag.adminUp, lag.description, lag.ip, lag.notes], ['lag', false, 'NASLINK', '192.168.42.1/24', 'lacp; assigned as opt2']);   // no <enable>: disabled
  assert.deepEqual([port(d, 'igb2').lag, port(d, 'igb3').lag, port(d, 'igb2').mode], ['lagg0', 'lagg0', '']);
  assert.equal(d.vlans.map(v => v.id + ':' + v.name).join(), '20:Guest wifi');
  assert.deepEqual(d.unparsed.map(e => [e.ctx, e.text, e.inner]), [['section', '<filter>', 8]]);        // rules: named, counted, not read
  assert.ok(!JSON.stringify(d).includes('$2y$') && !JSON.stringify(d).includes('shopmon') && !JSON.stringify(d).includes('Guests cannot'));
  // OPNsense: same shape, <enable>1</enable>
  const opn = NP.ingest('<?xml version="1.0"?>\n<opnsense>\n<system><hostname>opn1</hostname><domain>lab.example</domain></system>\n' +
    '<interfaces><wan><if>vtnet0</if><enable>1</enable><ipaddr>dhcp</ipaddr></wan><lan><if>vtnet1</if><enable>0</enable><ipaddr>10.9.0.1</ipaddr><subnet>24</subnet></lan></interfaces>\n</opnsense>', { devices: [] }).dev;
  assert.deepEqual([opn.vendor, opn.model, opn.hostname, port(opn, 'vtnet0').adminUp, port(opn, 'vtnet1').adminUp, port(opn, 'vtnet1').ip], ['pfsense', 'OPNsense', 'opn1', true, false, '10.9.0.1/24']);
  // the sanitizer strips secrets kept as XML element content
  const s = NP.sanitize(NP.samples.pfsense.text);
  assert.ok(s.same && !s.text.includes('$2y$') && !s.text.includes('shopmon') && !s.text.includes('fw-shop') && s.text.includes('<if>igb0</if>'));
});

test('Ubiquiti UniFi: controller JSON with networks', () => {
  const r = run('unifi');
  const d = r.dev;
  assert.deepEqual([d.hostname, d.model, d.version, d.serial, d.mgmtIp, d.stp.mode, d.stp.priority.join()],
    ['UNIFI-IDF1', 'US-24-250W', '6.6.65.15248', '0000000000A1', '10.44.0.11', 'rstp', '8192']);
  assert.equal(d.vlans.map(v => v.id + ':' + v.name).join(), '1:Default,10:Staff,20:Cameras,30:Guest');
  assert.deepEqual(r.extra.map(x => [x.dev.hostname, x.dev.vendor, x.dev.ports.length]), [['UNIFI-CORE', 'unifi', 1]]);   // the access point is left out
  const p1 = port(d, 'Port 1');
  assert.deepEqual([p1.description, p1.mode, p1.untagged, p1.tagged, p1.link, p1.speed, p1.poeStatus, p1.poeWatts, p1.poeClass, p1.neighbor, p1.neighborPort, p1.stpState],
    ['AP hallway', 'trunk', '1', 'all', 'up', '1G', 'on', '7.4', '4', 'AP-Hallway', 'eth0', 'forwarding']);
  const p2 = port(d, 'Port 2');
  assert.deepEqual([p2.mode, p2.untagged, p2.tagged, p2.speed], ['access', '20', '', '100M']);
  const p3 = port(d, 'Port 3');
  assert.deepEqual([p3.mode, p3.untagged, p3.tagged, p3.link, p3.poeAdmin, p3.poeStatus], ['trunk', '10', '30', 'down', 'disabled', 'off']);   // custom: all except 1 and 20
  assert.deepEqual([port(d, 'Port 4').adminUp, port(d, 'Port 4').description], [false, '']);
  const up = port(d, 'Port 25');
  assert.deepEqual([up.media, up.neighbor, up.neighborPort, up.notes, up.poeAdmin], ['SFP', 'UNIFI-CORE', 'Port 8', 'uplink', '']);   // neighbor named from its MAC
  assert.ok(!JSON.stringify(d).includes('0123456789abcdef'));
  // the two switches report each other, so the cable list pairs them up
  const cables = NP.cables([d, r.extra[0].dev]);
  assert.deepEqual(cables.filter(c => c.status === 'both ends').map(c => c.a.host + ' ' + c.a.port + ' - ' + c.b.host + ' ' + c.b.port), ['UNIFI-IDF1 Port 25 - UNIFI-CORE Port 8']);
  assert.equal(NP.units(d).length, 0);
});

test('Ubiquiti UniFi: mca-dump from one switch (no network list)', () => {
  const dump = 'UNIFI-IDF1-US.6.6.65# mca-dump\n' + JSON.stringify({ hostname: 'UNIFI-IDF1', model: 'US24P250', version: '6.6.65.15248', serial: 'A1', ip: '10.44.0.11',
    port_table: [{ port_idx: 1, media: 'GE', port_poe: true, up: true, speed: 1000, full_duplex: true, poe_good: true, poe_power: '7.42', poe_class: 'Class 4' },
      { port_idx: 2, media: 'GE', port_poe: true, up: false, speed: 0, poe_power: '0.00' }],
    lldp_table: [{ local_port_idx: 1, chassis_id: '00:00:5e:00:53:c1', port_id: 'eth0' }] }, null, 2);
  const r = NP.ingest(dump, { devices: [] });
  const d = r.dev;
  assert.deepEqual([r.vendor, d.hostname, d.ports.length, r.extra.length], ['unifi', 'UNIFI-IDF1', 2, 0]);
  const p1 = port(d, 'Port 1');
  assert.deepEqual([p1.link, p1.speed, p1.poeWatts, p1.neighbor, p1.neighborPort, p1.mode, p1.untagged], ['up', '1G', '7.4', '00:00:5e:00:53:c1', 'eth0', '', '']);
  assert.match(d.stp.notes.join(), /network list/);
  // pasted after the controller JSON, it merges into the same device
  const devices = [];
  const c = NP.ingest(NP.samples.unifi.text, { devices });
  devices.push(c.dev, ...c.extra.map(x => x.dev));
  const m = NP.ingest(dump, { devices });
  assert.deepEqual([m.isNew, m.dev === c.dev, port(c.dev, 'Port 1').untagged, port(c.dev, 'Port 1').description], [false, true, '1', 'AP hallway']);
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

test('label print-only: odd setups, edited ports, changed since a snapshot, custom conditions', () => {
  const d = run('ios').dev;
  const L = ['{port}', '{desc}'];
  const ports = rows => rows.slice(1).map(r => r[0]);
  // most physical ports are access VLAN 10; the others get labels
  assert.equal(NP.labelUsual(NP.eports(d).filter(NP.labelFilter({ physicalOnly: true }))).text, 'access, VLAN 10');
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, only: 'odd' })), ['Gi1/0/1', 'Gi1/0/2', 'Te1/1/1', 'Te1/1/2']);
  // VLAN columns compare as lists: 30 is in 10,20,30,99 and 30,99 but "3" is in neither
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, rules: [{ field: 'tagged', op: 'has', value: '30' }] })),
    ['Gi1/0/2', 'Te1/1/1', 'Te1/1/2']);
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, rules: [{ field: 'tagged', op: 'has', value: '3' }] })), []);
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, rules: [{ field: 'tagged', op: 'is', value: '99,30' }] })), ['Gi1/0/2']);
  // conditions all apply; text columns take "any of"; a condition without a value is ignored
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, rules: [
    { field: 'mode', op: 'is', value: 'access' }, { field: 'description', op: 'lacks', value: 'spare, printer' }, { field: 'notes', op: 'is', value: '' }] })),
    ['Gi1/0/1']);
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, rules: [{ field: 'voiceVlan', op: 'set' }] })), ['Gi1/0/1']);
  // since a snapshot: only labels whose text changed
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, only: 'snap' })), [], 'no snapshot, no labels');
  NP.snapshot(d, 'before');
  NP.setEdit(d, NP.findPort(d, 'Gi1/0/2').key, 'description', 'AP-Changed');
  NP.setEdit(d, NP.findPort(d, 'Gi1/0/3').key, 'untagged', '77');
  assert.deepEqual(NP.labelRows([d], { lines: L, physicalOnly: true, only: 'snap' }).slice(1), [['Gi1/0/2', 'AP-Changed']]);
  assert.deepEqual(ports(NP.labelRows([d], { lines: ['{port}', '[VLAN {vlan}]'], physicalOnly: true, only: 'snap' })), ['Gi1/0/3']);
  assert.deepEqual(ports(NP.labelRows([d], { lines: L, physicalOnly: true, only: 'edited' })), ['Gi1/0/2', 'Gi1/0/3']);
});

test('label text: {portid} and find-and-replace', () => {
  const d = run('nxos').dev;
  const rows = NP.labelRows([d], { lines: ['{port}', '{portid}'], physicalOnly: true });
  assert.deepEqual(rows[1], ['Eth1/1', '1/1']);
  // plain text in any case, applied in order; regular expressions with groups; then the character limit
  const r = NP.labelRows([d], { lines: ['{port} {desc}'], physicalOnly: true, maxLen: 6, replace: [{ find: 'eth', replace: '' }] });
  assert.equal(r[1][0], '1/1 ' + d.ports.find(p => p.short === 'Eth1/1').description.slice(0, 2).trim());
  const re = NP.labelReplacer([{ find: '/^Eth(\\d+)\\/(\\d+)$/', replace: 'S$1 P$2' }, { find: 'a.b', replace: '$1' }]);
  assert.equal(re('Eth1/49'), 'S1 P49');
  assert.equal(re('xA.By aXb'), 'x$1y aXb', 'plain finds are literal, and so is $ in their replacement');
  const broken = NP.labelReplacer([{ find: '/[/', replace: '' }, { find: 'Gi', replace: '' }]);
  assert.deepEqual(broken.errors, ['/[/']);
  assert.equal(broken('Gi1/0/1'), '1/0/1');
  assert.equal(NP.labelTokens.portid(null, { short: 'ge-0/0/3' }), '0/0/3');
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

test('normalizer: spelling and VLAN outliers in a group, applied as edits that reach the labels', () => {
  const intf = (n, desc, body) => 'interface GigabitEthernet1/0/' + n + '\n description ' + desc + '\n' + body.map(l => ' ' + l + '\n').join('') + '!\n';
  const trunk = allowed => ['switchport mode trunk', 'switchport trunk native vlan 10', 'switchport trunk allowed vlan ' + allowed];
  const cfg = 'hostname SW-NORM\n!\n' +
    intf(1, 'AP-Lobby', trunk('20,30,40')) + intf(2, 'AP-Hall', trunk('20,30,40')) + intf(3, 'AP 3rd floor', trunk('20,30,40')) +
    intf(4, 'Access Point Kitchen', trunk('20,30,40')) + intf(5, 'ap-roof', trunk('20,30')) + intf(6, 'WAP-Dock', trunk('20,30,40')) +
    intf(7, 'Printer HR', ['switchport mode access', 'switchport access vlan 50']) +
    intf(8, 'printer Sales', ['switchport mode access', 'switchport access vlan 60']) +
    intf(9, 'Uplink to core', ['switchport mode trunk']) + 'end\n';
  const d = NP.ingest(cfg, { devices: [] }).dev;
  assert.deepEqual(['Wireless AP 2', 'Lobby access-point', 'AccessPoint1', 'MAP room', 'Laptop', 'Cam-3'].map(s => { const r = NP.portRole(s); return r.id + ':' + r.text; }),
    ['ap:Wireless AP', 'ap:access-point', 'ap:AccessPoint', 'w:map:MAP', 'w:laptop:Laptop', 'camera:Cam']);
  let g = NP.normalize([d]);
  assert.deepEqual(g.map(x => [x.id, x.label, x.count]), [['ap', 'AP', 6], ['printer', 'Printer', 2]]);
  const ap = g[0];
  assert.deepEqual(ap.spelling.variants, [{ text: 'AP', count: 3 }, { text: 'Access Point', count: 1 }, { text: 'WAP', count: 1 }, { text: 'ap', count: 1 }]);
  assert.deepEqual(ap.spelling.rows.map(r => [r.short, r.to]), [['Gi1/0/4', 'AP Kitchen'], ['Gi1/0/5', 'AP-roof'], ['Gi1/0/6', 'AP-Dock']]);
  assert.deepEqual(ap.vlans.rows.map(r => [r.short, r.from, r.diff]), [['Gi1/0/5', 'trunk, native 10, tagged 20,30', 'missing tagged 40']]);
  assert.equal(ap.vlans.targetLabel, 'trunk, native 10, tagged 20,30,40');
  assert.equal(g[1].vlans, null);                                            // two printers in different VLANs: too few to call one of them wrong
  assert.equal(NP.normalizeCount(g), 5);
  assert.match(NP.normalizeText([d]), /AP \(6 ports\)\n {2}Written 4 ways: "AP" x3[^\n]*\n {4}Gi1\/0\/4: "Access Point Kitchen" -> "AP Kitchen"/);
  // the other spelling can be chosen instead
  assert.deepEqual(NP.normalize([d], { ap: { spelling: 'Access Point' } })[0].spelling.rows.map(r => r.to).slice(0, 2), ['Access Point-Lobby', 'Access Point-Hall']);
  // applying is a manual edit: parsed data untouched, labels follow, and the finding goes away
  NP.normalizeApply('spelling', ap.spelling.rows);
  NP.normalizeApply('vlans', ap.vlans.rows);
  assert.deepEqual([port(d, 'Gi1/0/5').description, port(d, 'Gi1/0/5').tagged], ['ap-roof', '20,30']);
  assert.deepEqual(NP.editCount(d), { fields: 4, excluded: 0, total: 4 });
  const lab = NP.labelRows([d], { lines: ['{port}', '{desc}', '[n{vlan}] [t{tagged}]'], physicalOnly: true });
  assert.deepEqual(lab[5], ['Gi1/0/5', 'AP-roof', 'n10 t20,30,40']);
  g = NP.normalize([d]);
  assert.deepEqual(g.map(x => x.id), ['printer']);
  assert.match(NP.normalizeText([d, d]), /SW-NORM Gi1\/0\/8: "printer Sales" -> "Printer Sales"/);
  // a group with no clear usual setup is left alone
  const split = NP.ingest('hostname SW-SPLIT\n!\n' + [10, 10, 20, 20, 30].map((v, i) => intf(i + 1, 'PC ' + i, ['switchport mode access', 'switchport access vlan ' + v])).join('') + 'end\n', { devices: [] }).dev;
  assert.deepEqual(NP.normalize([split]), []);
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
  assert.match(r.text, /add name=u1 password=removed group=full/);                                               // key=value keeps its key
  const x = NP.sanitize('<snmpd><rocommunity>s3cr3t</rocommunity><syslocation>x</syslocation></snmpd>\n{"x_authkey":"abc123","name":"sw"}', { vendor: 'auto' });
  assert.equal(x.text, '<snmpd><rocommunity>removed</rocommunity><syslocation>x</syslocation></snmpd>\n{"x_authkey":"removed","name":"sw"}');
});

test('messy paste cleanup', () => {
  const BS = '\b', ESC = '\x1b';
  const cfg = ['hostname SW7', '!', 'interface GigabitEthernet0/1', ' description Till 1', ' switchport mode access', ' switchport access vlan 10', '!',
    'interface GigabitEthernet0/2', ' description Till 2', ' switchport mode trunk', '!', 'interface GigabitEthernet0/3', ' shutdown', '!', 'end'];
  const want = d => [d.hostname, d.ports.length, NP.findPort(d, 'Gi0/1').description, NP.findPort(d, 'Gi0/1').untagged,
    NP.findPort(d, 'Gi0/2').mode, NP.findPort(d, 'Gi0/3').adminUp].join('|');
  const good = 'SW7|3|Till 1|10|trunk|false';
  const run = t => NP.ingest(t, { vendor: 'ios', devices: [] });
  assert.equal(want(run(cfg.join('\n')).dev), good);
  assert.deepEqual(run(cfg.join('\n')).cleaned, []);

  // Cisco pager: " --More-- " erased with backspaces, in the middle of an interface block
  const erase = ' --More-- ' + BS.repeat(9) + ' '.repeat(9) + BS.repeat(9);
  let r = run(cfg.slice(0, 4).join('\r\n') + '\r\n' + erase + cfg.slice(4).join('\r\n' ));
  assert.equal(want(r.dev), good);
  assert.match(r.cleaned.join(), /1 pager prompt/);
  // devices do not always back up exactly as far as the prompt is wide; indentation must survive either way,
  // on sub-lines and on top-level lines, with a logger timestamp in front of everything
  for (const [bs, sp] of [[9, 8], [9, 9], [10, 10], [8, 8]]) {
    const rub = ' --More-- ' + BS.repeat(bs) + ' '.repeat(sp) + BS.repeat(bs);
    const noisy = cfg.map((l, i) => '[2026-11-14 19:18:' + String(10 + i) + '] ' + (i % 2 ? rub : '') + l).join('\r\n');
    const x = run(noisy);
    assert.equal(want(x.dev), good, 'erase ' + bs + '/' + sp);
    assert.match(x.cleaned.join(), /7 pager prompt/);
  }
  // same, using carriage returns and an erase-line code, with colour codes around the prompt line
  r = run(ESC + '[1mSW7#' + ESC + '[0mshow run\n' + cfg.slice(0, 5).join('\n') + '\n --More-- \r' + ESC + '[K' + cfg.slice(5).join('\n'));
  assert.equal(want(r.dev), good);
  assert.match(r.cleaned.join(), /colour\/cursor code/);
  // a log that kept the prompt and the spaces that erased it, plus prompts alone on a line
  r = run(cfg.slice(0, 5).join('\n') + '\n --More--           ' + cfg[5].trim() + '\n--More--\n---- More ----\n' + cfg.slice(6).join('\n'));
  assert.equal(want(r.dev), good);
  assert.match(r.cleaned.join(), /3 pager prompt/);
  // logger timestamps on every line
  r = run(cfg.map((l, i) => '[2026-11-14 19:18:' + String(10 + i) + '] ' + l).join('\n'));
  assert.equal(want(r.dev), good);
  assert.match(r.cleaned.join(), /timestamps removed/);
  // mail quoting and curly quotes
  r = run(cfg.map(l => '> ' + l).join('\n').replace('Till 1', '\u201cTill 1\u201d'));
  assert.equal(want(r.dev), good);
  // indentation lost completely
  r = run(cfg.map(l => l.trim()).join('\n'));
  assert.equal(want(r.dev), good);
  assert.match(r.cleaned.join(), /indentation was missing/);
  // hard wrap at 80 columns
  const long = ' description ' + 'x'.repeat(90);
  const wrapped = cfg.slice(0, 3).concat([long.slice(0, 80), long.slice(80)], ['!', 'interface GigabitEthernet0/9', (' description ' + 'y'.repeat(100)).slice(0, 80),
    (' description ' + 'y'.repeat(100)).slice(80), '!', 'interface GigabitEthernet0/8', (' description ' + 'z'.repeat(70)).slice(0, 80), 'z'.repeat(3), '!']);
  r = run(wrapped.join('\n'));
  assert.equal(NP.findPort(r.dev, 'Gi0/1').description, 'x'.repeat(90));
  assert.match(r.cleaned.join(), /re-joined/);
  // ... but a table whose rows are all exactly 80 wide is left alone
  const table = Array.from({ length: 12 }, (_, i) => ('row' + i + ' ').padEnd(79, '.') + '|').join('\n');
  assert.deepEqual(NP.clean(table), { text: table, notes: [] });
  // nothing is touched in clean input, including the real fixture
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  assert.deepEqual(NP.clean(text), { text: text, notes: [] });
  for (const id of Object.keys(NP.samples)) assert.deepEqual(NP.clean(NP.samples[id].text).notes, [], id);
});

test('problem report bundles the sanitized input with what the parser made of it', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  const r = NP.problemReport(text, { note: 'Gi1/0/14 shows the wrong status', agent: 'TestBrowser/1.0' });
  assert.deepEqual([r.vendor, r.checked, r.same, r.leftovers], ['ios', true, true, []]);
  assert.match(r.text, /^ConfigHelper problem report\nVersion: \d+\.\d+\.\d+ \(/);
  assert.match(r.text, /Platform: Cisco IOS \/ IOS-XE \(auto-detected\)/);
  assert.match(r.text, /What looks wrong: Gi1\/0\/14 shows the wrong status/);
  assert.match(r.text, /Ports: 65 \(62 physical, 6 up, 0 disabled, 10 not present\)/);
  assert.match(r.text, /=== Not parsed ===[\s\S]*negotiation auto/);
  assert.match(r.text, /=== Parse debug ===\nINPUT\n[\s\S]*WORKED OUT\n[\s\S]*OUTPUT\n/);
  assert.match(r.text, /=== Checks ===[\s\S]*err-disabled/);
  assert.match(r.text, /=== Port table ===\nDevice\tPort\t/);
  assert.match(r.text, /=== Sanitized input ===\n/);
  for (const s of ['SW-PATCH-01', 'labadmin', 'example.lab', 'lab-com-mgmt', '10.0.65.169']) assert.ok(!r.text.includes(s), s + ' not in report');
  // an experimental platform says so; unrecognised input is reported rather than hidden
  assert.match(NP.problemReport(NP.samples.comware.text).text, /Platform: HPE Comware \/ H3C \(experimental parser\)/);
  const bad = NP.problemReport('hello password hunter2');
  assert.match(bad.text, /Platform: not recognised/);
  assert.ok(!bad.text.includes('hunter2'));
  // only platforms checked on real hardware count as verified
  assert.deepEqual(Object.keys(NP.verified), ['ios', 'junos', 'icx', 'os6']);
});

const bigStack = require('./stack.js');

test('stack units', () => {
  const unit = n => NP.portUnit(NP.newPort(n));
  assert.deepEqual(['GigabitEthernet2/0/14', 'Te3/1/4', 'ge-1/0/3', '4/1/24', '2/24', 'B12', 'Ethernet1/5', 'port7', '24', 'ether3', 'Vlan10', 'Port-channel2'].map(unit),
    ['2', '3', '1', '4', '2', 'B', '1', '', '', '', '', '']);
  const d = NP.ingest(bigStack(8), { vendor: 'ios', devices: [] }).dev;
  assert.equal(d.ports.length, 8 * 52);
  const us = NP.units(d);
  assert.deepEqual(us.map(u => u.unit), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(us[2], { unit: '3', ports: 52, up: 16, down: 32, disabled: 0, absent: 4, poeWatts: 96 });   // 4 empty uplink slots
  assert.equal(d.other['Stack members'].split(', ').length, 8);
  const lab = NP.labelRows([d], { lines: ['{port}', '{desc}'], physicalOnly: true, unit: '5' });
  assert.equal(lab.length, 1 + 48);
  assert.deepEqual(lab[1], ['Gi5/0/1', 'U5 desk 1']);
  assert.deepEqual(NP.units(NP.ingest(NP.samples.ios.text, { devices: [] }).dev), []);               // single switch: no selector
  assert.equal(NP.columns.find(c => c.id === 'unit').get(NP.findPort(d, 'Gi7/0/3')), '7');
});

test('forcing a vendor and unknown input', () => {
  assert.throws(() => NP.ingest('hello world\nnothing here', { devices: [] }), /vendor/);
  assert.throws(() => NP.ingest('hello world', { vendor: 'ios', devices: [] }), /Nothing recognisable/);
});

test('bundled P-touch templates match templates/ and carry no personal data', () => {
  const fs = require('fs'), path = require('path'), zlib = require('zlib');
  const dir = path.join(__dirname, '..', 'templates');
  const keys = Object.keys(NP.labelTemplates);
  assert.deepEqual(fs.readdirSync(dir).sort(), keys.map(k => NP.labelTemplates[k].file).sort());
  keys.forEach((k) => {
    const t = NP.labelTemplates[k];
    const file = fs.readFileSync(path.join(dir, t.file));
    assert.equal(Buffer.from(NP.b64Bytes(t.b64)).equals(file), true, k);
    assert.equal(file.subarray(0, 2).toString(), 'PK');
    const xml = zlib.inflateRawSync(file.subarray(30 + file.readUInt16LE(26) + file.readUInt16LE(28))).toString();
    const texts = xml.match(/<pt:data>[^<]*<\/pt:data>/g).map(x => x.replace(/<[^>]+>/g, '').split('\n')[0]);
    assert.deepEqual(texts.sort(), ['Line1', 'Line1', 'Line2', 'Line2'], k);       // placeholder text only, each line on both halves
    assert.doesNotMatch(xml, /[A-Z]:\\|Users|Downloads/);
    if (/databasePath/.test(xml)) assert.match(xml, /databasePath="labels\.csv"/);
    // the zipped form for the phone app: one stored entry holding the same bytes
    const zip = Buffer.from(NP.zipStore(t.file, NP.b64Bytes(t.b64)));
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(14), zlib.crc32(file));
    assert.equal(zip.subarray(30, 30 + t.file.length).toString(), t.file);
    assert.equal(zip.subarray(30 + t.file.length, 30 + t.file.length + file.length).equals(file), true);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt32LE(zip.length - 6), 30 + t.file.length + file.length);   // where the central directory starts
  });
});

test('label templates, CSV and backup round-trip', () => {
  const d = run('ios').dev;
  const p = port(d, 'Gi1/0/2');
  assert.equal(NP.fillTemplate('{host} {port}', d, p), 'SW-ACCESS-01 Gi1/0/2');
  assert.equal(NP.fillTemplate('{neighbor|desc}', d, port(d, 'Gi1/0/3')), 'Printer 2nd floor');
  assert.equal(NP.fillTemplate('{num} [VLAN {voice}]', d, p), '2');
  assert.equal(NP.fillTemplate('{num} [VLAN {vlan}]', d, p), '2 VLAN 99');
  assert.equal(NP.fillTemplate(NP.labelPresets.vlans.lines[1], d, p), 'n99 t30,99');
  assert.equal(NP.fillTemplate(NP.labelPresets.wrap.lines[1], d, port(d, 'Gi1/0/3')), '<Printer 2nd floor>');
  assert.equal(NP.fillTemplate(NP.labelPresets.wrap.lines[1], d, NP.newPort('Gi9/0/9')), '');   // no empty <>
  assert.equal(NP.fillTemplate(NP.labelPresets.wrap.lines[2], d, p), 'n99 t30,99');
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

const icxLab = () => require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'ruckus-icx7150-lab.txt'), 'utf8');

test('real ICX7150-48P (FastIron 10.0.10) session', () => {
  const r = NP.ingest(icxLab(), { devices: [] });
  const d = r.dev;
  assert.deepEqual([d.vendor, d.hostname, d.model, d.version, d.serial], ['icx', 'SW-OFFICE-01', 'ICX7150-48P-4X1G', '10.0.10g_cd11T213', 'FEC0000X000']);
  assert.deepEqual([d.mgmtIp, d.gateway], ['10.0.0.7/24 (ve3000)', '10.0.0.1']);
  assert.equal(d.ntp.length, 6);
  assert.deepEqual(d.syslog, ['10.1.254.169']);
  assert.equal(d.vlans.length, 34);
  // 25 "mstp instance 0 vlan ..." lines become one note
  assert.deepEqual([d.stp.mode, d.stp.priority, d.stp.notes], ['mstp', ['MST 0: 61440'], ['MST region LAB-MST', 'MST revision 1',
    'MST 0 = VLAN 1,20,69,300,306,2369,3000,3005-3006,3010-3011,3056,3060-3069,3200,3202,3205,3215,3220,3240,3250,3254,3265,3270,3300,3669']]);
  assert.deepEqual(d.multicast.notes, ['IGMPv3']);
  // "web-management http" then "web-management disable" is off, not plain HTTP
  assert.equal(d.other['Web management'], 'disabled');
  assert.deepEqual([d.other.Stacking, d.other.CDP, d.other.ACLs, d.other.AAA, d.other.RESTCONF],
    ['disabled', 'enabled', 'WAN-ONLY', 'login local, web-server local', 'enabled']);
  assert.deepEqual(d.unparsed, []);
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 54);
  const p1 = port(d, '1/1/1');
  assert.deepEqual([p1.description, p1.mode, p1.untagged, p1.tagged, p1.link, p1.speed, p1.poeStatus],
    ['OPS-ARUBA-WAP', 'trunk', '3065', '3066-3069,3220,3669', 'up', '1G', 'non-pd']);
  const p2 = port(d, '1/1/2');
  assert.deepEqual([p2.description, p2.mode, p2.untagged, p2.voiceVlan, p2.speed, p2.poeWatts, p2.poeClass, p2.notes],
    ['OPS-Aerohive-WAP', 'access', '3240', '3240', '100M', '1.3', '', 'speed-duplex 100-full']);   // config name beats the truncated table copy
  const p48 = port(d, '1/1/48');
  assert.deepEqual([p48.untagged, p48.tagged, p48.poeWatts, p48.poeClass, p48.neighbor, p48.neighborPort, p48.neighborInfo],
    ['3254', '3066-3069,3220,3250,3270', '6.2', '4', 'RuckusAP', 'eth1', '10.2.254.50']);          // port ID is a MAC, so the description is used
  // tagged only: FastIron 10 keeps the port untagged in the default VLAN, with or without the PVID column
  const up = port(d, '1/3/4');
  assert.deepEqual([up.mode, up.untagged, up.neighbor, up.neighborPort, up.neighborInfo], ['trunk', '1', 'SW-PATCH-01.example.lab', 'Te1/0/48', '10.0.249.2']);
  const text = icxLab();
  const cfgOnly = NP.ingest(text.slice(0, text.indexOf('SW-OFFICE-01#show interfaces brief')), { devices: [] }).dev;
  assert.deepEqual([port(cfgOnly, '1/3/4').untagged, port(cfgOnly, '1/2/1').untagged, cfgOnly.model], ['1', '1', 'ICX7150-48P-POE']);
  assert.deepEqual([port(d, '1/3/3').neighbor, port(d, '1/3/3').neighborPort, port(d, '1/3/3').neighborInfo], ['EX-LAB-DESK-01', 'xe-0/1/1', '']);
  // no "router-interface" in FastIron 10: ve N is VLAN N
  assert.deepEqual([port(d, 've3000').description, port(d, 've3000').ip, port(d, 've3065').description, port(d, 'mgmt1').link],
    ['lab-com-mgmt', '10.0.0.7/24', 'lab-test-desk', 'down']);
  const st = NP.portStats(d);
  assert.deepEqual([st.physical, st.up, st.poePorts, st.poeWatts], [54, 8, 2, 7.5]);
  const found = NP.checks(d);
  assert.deepEqual(found.filter(f => f.severity === 'warn').map(f => f.id), []);
  assert.deepEqual(found.find(f => f.id === 'native1').ports.map(p => p.short), ['1/2/1', '1/3/4']);
  assert.ok(!JSON.stringify(d).includes('REDACTED') && !JSON.stringify(d).includes('UkVE'), 'hashes and communities are not stored');
});

test('sanitize: real ICX session', () => {
  const r = NP.sanitize(icxLab());
  assert.deepEqual([r.checked, r.same, r.ports, r.vlans, r.leftovers], [true, true, 57, 34, []]);
  for (const s of ['SW-OFFICE-01', 'labadmin', 'example.lab', 'EX-LAB-DESK', 'Office-Room-B', 'lab-com-mgmt', 'WAN-ONLY', 'HueHub', 'FEC0000X000',
    'REDACTED', 'UkVEQUNURUQ', 'MobaXterm', 'example.org', '10.0.0.7']) assert.ok(!r.text.includes(s), s + ' removed');
  // the trap receiver's community has no keyword in front of it
  assert.match(r.text, /^snmp-server host 10\.\d+\.4\.21 version v1 2 removed$/m);
  assert.match(NP.sanitize('snmp-server host 192.0.2.9 version 2c s3cretRO\nsnmp-server host 192.0.2.9 traps version 3 priv snmpuser').text,
    /version 2c removed\n.* version 3 priv removed$/);
  // a keyword at the end of a line does not swallow the start of the next one
  assert.match(r.text, /duplicated ssh-rsa host key\nX11 forwarding request failed/);
});

// ---- found with real output: Junos 25.2 on an EX2300-C, FastIron 08.0.30 on an ICX6610
// (made-up names and addresses below; the layouts are the real ones)
test('Junos: newer PoE table, LLDP columns pushed right, voice VLAN on access ports, absent ports', () => {
  const text = [
    'admin@sw-a> show configuration | display set',
    'set system host-name sw-a',
    'set interfaces ge-0/0/0 unit 0 family ethernet-switching interface-mode access',
    'set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members USERS',
    'set interfaces ge-0/0/1 native-vlan-id 99',
    'set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk',
    'set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members USERS',
    'set interfaces ge-0/1/0 unit 0 family ethernet-switching storm-control default',
    'set interfaces xe-0/1/0 unit 0 family ethernet-switching interface-mode trunk',
    'set interfaces xe-0/1/0 unit 0 family ethernet-switching vlan members all',
    'set switch-options voip interface access-ports vlan 40',
    'set vlans USERS vlan-id 20',
    'set vlans VOICE vlan-id 40',
    '',
    'admin@sw-a> show interfaces terse',
    'Interface               Admin Link Proto    Local                 Remote',
    'ge-0/0/0                up    up',
    'ge-0/0/0.0              up    up   eth-switch',
    'ge-0/0/1                up    up',
    'xe-0/1/0                up    up',
    '',
    'admin@sw-a> show lldp neighbors',
    'Local Interface    Parent Interface    Chassis Id                               Port info          System Name',
    'ge-0/0/1           -                   00:11:22:33:44:55                        ETH(PoE)            AP-Lobby',
    'xe-0/1/0           -                   00:11:22:33:44:66                        10GigabitEthernet1/3/2 CORE-1',
    'ge-0/0/0           -                   FRONTDESK-PC                             00:11:22:33:44:77',
    '',
    'admin@sw-a> show poe interface',
    'Interface    Admin       Oper    Pair/Mode  Max        Priority       Power          Class',
    '             status      status  status     power                     consumption',
    ' ge-0/0/0    Enabled     OFF     2P/AT      15.4W      Low            0.0W           not-applicable',
    ' ge-0/0/1    Enabled      ON     2P/AT      25.5W(L)   High(L)        6.4W            4',
    '  (L) LLDP-negotiated value on the port.',
    '',
    'admin@sw-a> show chassis hardware',
    'Hardware inventory:',
    'Item             Version  Part number  Serial number     Description',
    'Chassis                                AB0123456789      EX2300-C-12P',
    ''].join('\n');
  const d = NP.ingest(text, { devices: [] }).dev;
  assert.deepEqual([d.serial, d.model], ['AB0123456789', 'EX2300-C-12P']);
  const a = port(d, 'ge-0/0/0'), b = port(d, 'ge-0/0/1'), x = port(d, 'xe-0/1/0');
  assert.deepEqual([a.untagged, a.voiceVlan, a.poeStatus, a.poeWatts, a.poeClass], ['20', '40', 'off', '', '']);
  assert.deepEqual([a.neighbor, a.neighborPort], ['FRONTDESK-PC', '00:11:22:33:44:77']);   // no system name: chassis id stands in
  assert.deepEqual([b.voiceVlan, b.poeStatus, b.poeWatts, b.poeClass], ['', 'on', '6.4', '4']);
  assert.deepEqual([b.neighbor, b.neighborPort], ['AP-Lobby', 'ETH(PoE)']);
  assert.deepEqual([x.neighbor, x.neighborPort], ['CORE-1', '10GigabitEthernet1/3/2']);
  assert.equal(port(d, 'ge-0/1/0').link, 'not present');                                  // same cage as xe-0/1/0
  // the older table, without Pair/Mode, still reads
  const old = NP.ingest('set system host-name sw-b\n\nInterface    Admin       Oper    Max        Priority       Power          Class\n' +
    ' ge-0/0/3    Enabled      ON     15.4W      Low            4.2W            2\n', { vendor: 'junos', devices: [] }).dev;
  assert.deepEqual([port(old, 'ge-0/0/3').poeWatts, port(old, 'ge-0/0/3').poeClass], ['4.2', '2']);
});

test('ICX 08.0.30: LAG members follow the primary port, banner, pt2pt, LLDP-MED voice', () => {
  const text = [
    'SSH@core-1#show running-config',
    'Current configuration:',
    '!',
    'ver 08.0.30uT7f3',
    '!',
    'stack unit 1',
    '  module 1 icx6610-24p-poe-port-management-module',
    '!',
    'lag uplink dynamic id 120',
    ' ports ethernet 1/1/20 to 1/1/22',
    ' primary-port 1/1/20',
    ' deploy',
    ' port-name ==fw-pri== ethernet 1/1/20',
    ' port-name ==fw== ethernet 1/1/21',
    '!',
    'vlan 1 name DEFAULT-VLAN by port',
    '!',
    'vlan 20 name users by port',
    ' tagged ethe 1/1/1 ethe 1/1/20 to 1/1/22',
    ' untagged ethe 1/1/3',
    '!',
    'vlan 40 name VoIP by port',
    ' tagged ethe 1/1/1',
    '!',
    'vlan 665 name transit by port',
    ' tagged ethe 1/1/20 to 1/1/22',
    '!',
    'hostname core-1',
    'jumbo',
    'banner motd ^C',
    '^C',
    '|   *** Unauthorized use prohibited ***   |^C',
    'hostname not-this-one^C',
    '^C',
    '!',
    'interface ethernet 1/1/2',
    ' spanning-tree 802-1w admin-pt2pt-mac',
    '!',
    'interface ethernet 1/1/20',
    ' dual-mode  665',
    ' spanning-tree 802-1w admin-edge-port',
    '!',
    'lldp med network-policy application voice tagged vlan 40 priority 5 dscp 46 ports ethe 1/1/1 to 1/1/12',
    'lldp run',
    '!',
    'end',
    '',
    'SSH@core-1#'].join('\n');
  const d = NP.ingest(text, { devices: [] }).dev;
  assert.equal(d.hostname, 'core-1');
  assert.equal(d.other['Jumbo frames'], 'enabled');
  for (const n of ['1/1/20', '1/1/21', '1/1/22', 'lag 120']) {
    const p = port(d, n);
    assert.deepEqual([p.mode, p.untagged, p.tagged, p.stp], ['trunk', '665', '20', 'edge'], n);
  }
  assert.deepEqual([port(d, '1/1/20').description, port(d, '1/1/21').description], ['==fw-pri==', '==fw==']);
  assert.equal(port(d, '1/1/2').stp, 'p2p');
  assert.equal(port(d, '1/1/1').voiceVlan, '40');
  assert.equal(port(d, '1/1/3').voiceVlan, '');             // in the LLDP-MED range but does not carry VLAN 40
  assert.ok(!d.unparsed.some(u => /Unauthorized|\^C|SSH@|pt2pt|lldp med/.test(u.text)), JSON.stringify(d.unparsed));
});

test('platform picker: brands, platforms, parser behind each', () => {
  for (const p of NP.platforms) {
    assert.ok(NP.vendors[NP.platformParser(p.id)], p.id + ' has a parser');
    assert.ok(NP.commands[p.id] && NP.commands[p.id].cmds.length, p.id + ' has commands');
  }
  for (const id of NP.vendorOrder) assert.ok(NP.platform(id), id + ' can be picked');
  assert.equal(NP.platformParser('fortilink'), 'fortigate');
  assert.equal(NP.platformParser('auto'), 'auto');
  assert.deepEqual(NP.platforms.filter(p => p.brand === 'Dell').map(p => p.id), ['os10', 'os9', 'os6']);
  assert.deepEqual(NP.platforms.filter(p => p.brand === 'Fortinet').map(p => p.id), ['fortigate', 'fortilink', 'fortiswitch']);
});

test('FortiGate: the short command list gives the same device as the whole config', () => {
  const whole = run('fortigate');
  assert.doesNotMatch(NP.commandScript('fortigate'), /^show$/m);
  // rebuild the sample as the answers to "show <section>", one prompt each
  const text = NP.samples.fortigate.text;
  const lines = text.split('\n');
  let out = [], depth = 0, keep = false;
  const wanted = /^config (system (global|interface|zone|dns|ntp|snmp sysinfo|ha)|log syslogd setting|router static|switch-controller (managed-switch|stp-settings))$/;
  for (const l of lines) {
    const t = l.trim();
    if (depth === 0 && /^config /.test(t)) { keep = wanted.test(t); if (keep) out.push('FW # show ' + t.slice(7)); }
    if (/^config /.test(t)) depth++;
    if (keep || depth === 0) out.push(l);
    if (t === 'end') depth--;
  }
  const part = NP.ingest(out.join('\n'), { vendor: 'fortigate', devices: [] });
  const shape = r => r.dev.ports.map(p => [p.name, p.kind, p.mode, p.ip, p.tagged, p.lag].join('|'));
  assert.deepEqual(shape(part), shape(whole));
  assert.deepEqual([part.dev.hostname, part.dev.dns, part.dev.ntp, part.dev.gateway], [whole.dev.hostname, whole.dev.dns, whole.dev.ntp, whole.dev.gateway]);
  assert.deepEqual(part.extra.map(x => x.dev.ports.length), whole.extra.map(x => x.dev.ports.length));
});

test('one paste with two devices is cut at the change of prompt', () => {
  const two = 'sw1#show running-config\nhostname sw1\ninterface GigabitEthernet1/0/1\n switchport mode access\n!\nsw1#show version\nCisco IOS Software\n' +
    '\nadmin@sw-a> show configuration | display set\nset system host-name sw-a\nset vlans USERS vlan-id 20\n';
  const parts = NP.splitDevices(two);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(t => NP.detect(t)), ['ios', 'junos']);
  assert.equal(NP.splitDevices(NP.samples.ios.text).length, 1);
  for (const id of Object.keys(NP.samples)) assert.equal(NP.splitDevices(NP.samples[id].text).length, 1, id);
});

const fixture = name => require('fs').readFileSync(require('path').join(__dirname, 'fixtures', name), 'utf8');

test('real EX2300-C session (Junos 25.2, sanitized)', () => {
  const r = NP.ingest(fixture('juniper-ex2300c.txt'), { devices: [] });
  const d = r.dev;
  assert.equal(r.vendor, 'junos');
  assert.equal(d.version, '25.2R2.12');
  assert.deepEqual(d.vlans.map(v => v.id), [1, 20, 40, 70, 100, 254, 1769]);
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 16);
  assert.deepEqual(d.ports.filter(p => p.link === 'up' && p.kind === 'physical').map(p => p.name),
    ['ge-0/0/0', 'ge-0/0/1', 'ge-0/0/2', 'ge-0/0/8', 'ge-0/0/10', 'ge-0/0/11', 'xe-0/1/0', 'xe-0/1/1']);
  const ap = port(d, 'ge-0/0/11');
  assert.deepEqual([ap.mode, ap.untagged, ap.tagged, ap.poeStatus, ap.poeWatts, ap.poeClass], ['trunk', '254', '20,70,100,254,1769', 'on', '6.4', '4']);
  assert.deepEqual([port(d, 'ge-0/0/3').untagged, port(d, 'ge-0/0/3').voiceVlan, port(d, 'ge-0/0/3').poeStatus], ['20', '40', 'off']);
  const up = port(d, 'xe-0/1/1');
  assert.deepEqual([up.tagged, up.neighborPort], ['all', '10GigabitEthernet1/3/2']);
  assert.ok(up.neighbor && !/\s/.test(up.neighbor));
  assert.ok(port(d, 'xe-0/1/0').neighbor);                    // PC with no system name
  assert.deepEqual([port(d, 'ge-0/1/0').link, port(d, 'ge-0/1/1').link], ['not present', 'not present']);
  assert.ok(d.ports.filter(p => p.poeStatus).length === 12);
  assert.ok(!d.unparsed.some(u => u.ctx === 'command' && /poe|lldp|terse/.test(u.text)));
});

test('real N3024P + N3048P stack session (OS6 6.5.4.10, secrets removed)', () => {
  const r = NP.ingest(fixture('dell-n3048p-stack.txt'), { devices: [] });
  const d = r.dev;
  assert.equal(r.vendor, 'os6');
  assert.deepEqual([d.hostname, d.model, d.version, d.serial, d.mgmtIp, d.gateway],
    ['SW-LAB-RACKB-STACK01', 'N3048P', '6.5.4.10', 'CN0000000000000000000A0', '10.255.255.11/24 (Vlan255)', '10.255.255.1']);
  assert.deepEqual(d.vlans.map(v => v.id), [7, 200, 250, 253, 255, 2500, 3000, 3032, 3240]);
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 76);   // 24 + 2 SFP+ on unit 1, 48 + 2 on unit 2
  assert.equal(d.other['Stack members'], '1: N3024P, 2: N3048P');
  assert.equal(d.other['Voice VLAN'], 'enabled');
  assert.match(d.other.QoS, /trust ip-dscp/);
  // phone ports: general mode, untagged 1, voice VLAN 7
  const ph = port(d, 'Gi1/0/4');
  assert.deepEqual([ph.mode, ph.untagged, ph.tagged, ph.voiceVlan, ph.link, ph.speed, ph.poeStatus, ph.poeWatts, ph.poeClass, ph.neighbor],
    ['general', '1', '7', '7', 'up', '1G', 'on', '3.1', '4', 'DEV-R2-TD']);
  // AP trunks: native 253, every VLAN, LLDP system name
  const ap = port(d, 'Gi2/0/1');
  assert.deepEqual([ap.description, ap.mode, ap.untagged, ap.tagged, ap.poeWatts, ap.neighbor, ap.neighborPort],
    ['AEROHIVE-AP', 'trunk', '253', 'all', '7.5', 'BLDG-B1-WL-1', 'mgt0']);
  assert.deepEqual([port(d, 'Te1/0/2').neighbor, port(d, 'Te1/0/2').neighborPort], ['LAB-CORE-S4148', 'ethernet1/1/24']);
  assert.deepEqual([port(d, 'Gi1/0/23').mode, port(d, 'Gi1/0/23').untagged, port(d, 'Gi1/0/23').voiceVlan], ['access', '2500', '7']);
  assert.equal(port(d, 'Gi1/0/9').poeStatus, 'test-fail');
  assert.deepEqual([port(d, 'Te2/0/2').mode, port(d, 'Te2/0/2').link], ['access', 'down']);   // only in show interfaces status
  assert.equal(d.ports.filter(p => p.poeStatus === 'on').length, 21);
  assert.equal(d.ports.filter(p => p.neighbor).length, 24);
  assert.deepEqual(d.unparsed, []);
  // the FortiGate prompt the session was started from is not a second device
  assert.equal(r.debug.input.sections.filter(s => s.used).length, 5);
});

test('OS6 show interfaces status alone: wrapped VLAN lists, full-range trunks read as all', () => {
  const t = fixture('dell-n3048p-stack.txt');
  const r = NP.ingest(t.slice(t.indexOf('SW-LAB-RACKB-STACK01#show interfaces status'), t.indexOf('SW-LAB-RACKB-STACK01#show power inline')), { devices: [] });
  const d = r.dev;
  assert.equal(r.vendor, 'os6');
  assert.deepEqual([port(d, 'Gi2/0/1').untagged, port(d, 'Gi2/0/1').tagged], ['253', 'all']);
  assert.deepEqual([port(d, 'Te1/0/2').untagged, port(d, 'Te1/0/2').tagged], ['1', 'all']);
  assert.deepEqual([port(d, 'Gi1/0/4').mode, port(d, 'Gi1/0/4').tagged], ['general', '7']);
});

test('real ICX6610 config (FastIron 08.0.30, sanitized)', () => {
  const r = NP.ingest(fixture('ruckus-icx6610.txt'), { devices: [] });
  const d = r.dev;
  assert.equal(r.vendor, 'icx');
  assert.deepEqual([d.model, d.version], ['ICX6610-24P-POE', '08.0.30uT7f3']);
  assert.equal(d.vlans.length, 31);
  assert.equal(d.ports.filter(p => p.kind === 'physical').length, 42);
  assert.equal(d.ports.filter(p => p.kind === 'lag').length, 5);
  for (const n of ['1/1/20', '1/1/21', '1/1/24', 'lag 120']) {
    const p = port(d, n);
    assert.deepEqual([p.mode, p.untagged, p.tagged], ['trunk', '665', '2-3,5,17,40,100,111,230,240-242,667,1769'], n);
  }
  assert.ok(port(d, '1/1/21').description && port(d, '1/3/8').description);
  assert.deepEqual([port(d, '1/1/1').untagged, port(d, '1/1/1').tagged, port(d, '1/1/1').voiceVlan], ['', '20,40', '40']);
  assert.deepEqual([port(d, '1/1/5').mode, port(d, '1/1/5').untagged, port(d, '1/1/5').voiceVlan], ['access', '20', '40']);
  assert.equal(port(d, '1/1/3').voiceVlan, '');
  assert.equal(port(d, '1/3/2').stp, 'p2p');
  assert.deepEqual([port(d, 've20').ip, port(d, 've1').adminUp], ['10.1.20.1/22', false]);
  assert.ok(!d.unparsed.some(u => /\^C|banner|pt2pt|lldp med/.test(u.text)));
});

test('sanitize: FastIron banner lines and chassis name do not survive', () => {
  const raw = 'hostname core-1\nchassis name CORE-SITE-A\nbanner motd ^C\n^C\n|  Property of Example Corp  |^C\n^C\n!\ninterface ethernet 1/1/1\n port-name x\n!\n';
  const out = NP.sanitize(raw, { vendor: 'icx' }).text;
  assert.doesNotMatch(out, /Example Corp|CORE-SITE-A|core-1/);
  assert.match(out, /^banner motd \^C removed \^C\n!\ninterface ethernet 1\/1\/1$/m);
});

test('sanitize: FortiGate interface names, switch serials and named objects', () => {
  const allowed = '                set allowed-vlans "Globex-Guest" "Hooli-Lab" "voice" "video" "Smith-Office"';
  const cut = 80;                                                  // the terminal wrapped inside the quoted name
  assert.equal(allowed.slice(cut - 3, cut + 3), '"Smith-'.slice(0, 3) + 'ith');
  const raw = ['FW-ACME-01 # show system interface', 'config system interface',
    '    edit "port1"', '        set vdom "root"', '        set type physical', '        set alias "Initech-Fiber"', '    next',
    '    edit "x1"', '        set vdom "root"', '        set type physical', '    next',
    '    edit "mgmt"', '        set vdom "root"', '        set ip 192.168.1.99 255.255.255.0', '        set allowaccess ping https ssh', '        set type physical', '    next',
    '    edit "ssl.root"', '        set vdom "root"', '        set type tunnel', '    next',
    '    edit "fortilink"', '        set vdom "root"', '        set fortilink enable', '        set ip 10.255.1.1 255.255.255.0', '        set type aggregate',
    '        set member "x1"', '    next',
    '    edit "Initech-Fiber"', '        set vdom "root"', '        set ip 198.51.100.2 255.255.255.252', '        set type aggregate', '        set member "port1"',
    '        set alias "Initech-Fiber"', '    next',
    '    edit "Vandelay"', '        set vdom "root"', '        set type vlan', '        set interface "Initech-Fiber"', '        set vlanid 300', '    next',
    '    edit "Globex-Guest"', '        set vdom "root"', '        set ip 10.20.10.1 255.255.255.0', '        set alias "Globex-Guest"', '        set interface "fortilink"',
    '        set vlanid 10', '    next',
    '    edit "Hooli-Lab"', '        set vdom "root"', '        set interface "fortilink"', '        set vlanid 20', '    next',
    '    edit "Smith-Office"', '        set vdom "root"', '        set interface "fortilink"', '        set vlanid 30', '    next',
    '    edit "voice"', '        set vdom "root"', '        set interface "fortilink"', '        set vlanid 40', '    next',
    '    edit "physical"', '        set vdom "root"', '        set interface "fortilink"', '        set vlanid 50', '    next',
    '    edit "lag-Pied-Piper"', '        set vdom "root"', '        set type aggregate', '        set member "x2"', '    next',
    '    edit "quarantine"', '        set vdom "root"', '        set interface "fortilink"', '        set vlanid 4093', '    next',
    'end', '',
    'FW-ACME-01 # show switch-controller managed-switch', 'config switch-controller managed-switch',
    '    edit "S248EPTF19004711"', '        set sn "S248EPTF19004711"', '        set fsw-wan1-peer "fortilink"', '        set switch-profile "Initech-Profile"',
    '        config ports',
    '            edit "port1"', '                set vlan "Globex-Guest"', allowed.slice(0, cut), allowed.slice(cut),
    '                set untagged-vlans "Hooli-Lab" "physical"', '                set port-owner "Initech-Fiber"', '            next',
    '            edit "port2"', '                set port-owner "wonka-nas"', '            next',
    '            edit "wonka-nas"', '                set type trunk', '                set members "port2" "port3"', '            next',
    '            edit "_FlInK1_MLAG0_"', '                set type trunk', '                set members "port23"', '            next',
    '        end', '    next',
    '    edit "IDF2-SW1"', '        set sn "S124FPTF20001234"', '        config ports', '            edit "port1"', '                set vlan "Smith-Office"', '            next',
    '        end', '    next',
    'end', '',
    'FW-ACME-01 # show vpn ipsec phase1-interface', 'config vpn ipsec phase1-interface', '    edit "dialup"', '        set interface "Initech-Fiber"',
    '        set ike-saml-server "Acme-Entra"', '    next', 'end', '',
    'FW-ACME-01 # get system status', 'Version: FortiGate-201F v7.4.4,build2662,240514 (GA.F)', 'Serial-Number: FG201FT921900123', 'Hostname: FW-ACME-01', ''].join('\n');
  const r = NP.sanitize(raw);
  assert.equal(r.vendor, 'fortigate');
  assert.deepEqual([r.checked, r.same, r.leftovers], [true, true, []]);
  for (const s of ['Initech', 'Vandelay', 'Globex', 'Hooli', 'Smith', 'Office', 'Pied', 'Piper', 'wonka', 'Acme', 'ACME', 'S248EPTF19004711', 'S124FPTF20001234',
    'FG201FT921900123', 'IDF2']) assert.ok(!r.text.replace(/\n/g, '').includes(s), s + ' removed');
  // built-in names, and a name that is also a keyword, keep working
  for (const s of ['edit "port1"', 'edit "x1"', 'edit "mgmt"', 'edit "ssl.root"', 'edit "fortilink"', 'edit "voice"', 'edit "quarantine"', 'set member "x1"',
    'set type physical', 'set fsw-wan1-peer "fortilink"', 'edit "_FlInK1_MLAG0_"']) assert.ok(r.text.includes(s), s + ' kept');
  assert.ok(!r.text.includes('"physical"'));
  // one placeholder per name, wherever it is used
  const ph = (re) => r.text.match(re)[1];
  const fiber = ph(/set ip 10\.\d+\.100\.2 255\.255\.255\.252\n(?:.*\n){2}\s+set alias "([^"]+)"/);
  assert.equal(fiber.length, 'Initech-Fiber'.length);
  assert.equal(r.text.split('"' + fiber + '"').length - 1, 6);                 // port1 alias, edit, own alias, VLAN parent, port-owner, VPN interface
  const guest = ph(/set vlan "([^"]+)"\n\s+set allowed-vlans/);
  assert.ok(r.text.includes('edit "' + guest + '"') && r.text.includes('set allowed-vlans "' + guest + '" '));
  const office = ph(/edit "([^"]+)"\n.*\n\s+set interface "fortilink"\n\s+set vlanid 30/);
  assert.match(r.text, new RegExp('"video" "' + office.slice(0, 2) + '\\n' + office.slice(2) + '"\\n'));      // the wrapped copy
  assert.ok(r.text.includes('set vlan "' + office + '"'));
  assert.equal(new Set(r.text.match(/^    edit "[^"]+"$/gm)).size, 14 + 2 + 1);                      // no two names share a placeholder
  assert.match(r.text, /edit "lag-[^"]+"/);                                      // still an aggregate to the parser
  // the switches still come out with the same ports and VLANs
  const shape = (text) => NP.ingest(text, { devices: [] }).extra.map(x => x.dev.ports.map(p => [p.name.length, p.mode, p.untagged, p.lag.length].join()).sort().join(';') +
    '|' + x.dev.vlans.map(v => v.id));
  assert.deepEqual(shape(r.text), shape(raw));
  assert.equal(shape(raw).length, 2);
  assert.ok(shape(raw)[0].split(';').includes('5,trunk,10,0') && shape(raw)[0].split(';').includes('5,,,9'));      // port1; port2 in the trunk
  const nas = ph(/set port-owner "([^"]+)"\n\s+next\n\s+edit "port2"/) && ph(/edit "port2"\n\s+set port-owner "([^"]+)"/);
  assert.ok(r.text.includes('edit "' + nas + '"\n                set type trunk') && nas.length === 'wonka-nas'.length);
  // options: names off leaves interfaces alone
  const partial = NP.sanitize(raw, { names: false });
  assert.ok(partial.same && partial.text.includes('edit "Initech-Fiber"') && !partial.text.includes('S248EPTF19004711'));
  // other vendors are untouched by the FortiGate rules
  const cisco = NP.sanitize('hostname SW1\ninterface GigabitEthernet1/0/1\n description Initech-Fiber\n set sn "S248EPTF19004711"\n', { vendor: 'ios' });
  assert.ok(cisco.text.includes('S248EPTF19004711'));
});

test('sanitize: real FortiGate 201F session, interface names replaced everywhere', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'fortigate-201f-fortilink.txt'), 'utf8');
  const r = NP.sanitize(text);
  assert.deepEqual([r.vendor, r.checked, r.same, r.ports, r.vlans], ['fortigate', true, true, 97, 45]);
  for (const s of ['vrtx-lag', 'pve-r730xd-1', '3850-lag', 'WAN1-FIBER', 'WAN2-CABLE', 'LAB-COM-ROUTING', 'Implement Lab', 'VPN-HQ Hub', 'TENANT-LAB-3300', 'LAB-VLAN-3065', 'v.3000', 'v.3051-Lab-DMZ']) {
    assert.ok(!r.text.includes(s), s + ' removed');
  }
  for (const s of ['edit "x1"', 'edit "naf.root"', 'edit "fortilink"', 'edit "_default"', 'edit "nac_segment"']) assert.ok(r.text.includes(s), s + ' kept');
  // the managed switches come out with the same ports and VLANs (in name order, so compared sorted), including the allowed-vlans lists wrapped at 224 columns
  const shape = (t) => NP.ingest(t, { devices: [] }).extra.map(x => x.dev.ports.map(p => [p.name.length, p.mode, p.untagged, p.tagged, p.lag.length].join()).sort().join(';') + '|' + x.dev.vlans.map(v => v.id));
  assert.deepEqual(shape(r.text), shape(text));
  assert.equal(shape(text).length, 3);
});

test('real FortiGate 201F (FortiOS 8.0) FortiLink session, sanitized', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'fortigate-201f-fortilink.txt'), 'utf8');
  const r = NP.ingest(text, { devices: [] });
  const fw = r.dev;
  assert.deepEqual([fw.vendor, fw.hostname, fw.model, fw.version], ['fortigate', 'LAB-FW-1', 'FortiGate-201F', '8.0.2']);   // "(Primary)" is not part of the name
  assert.equal(fw.other.HA, 'a-p, primary');
  assert.equal(fw.other['Managed switches'], 'MDF-SW-2, MDF-SW-1, EDGE-SW-1');
  assert.equal(fw.vlans.find(v => v.id === 1000).name, 'v.1000-Test');          // not the VXLAN sub-interface with the same id
  assert.deepEqual(['lan', 'SiteSSID1', 'vxlan-evpn', 'mgmt'].map(n => port(fw, n).kind), ['svi', 'svi', 'tunnel', 'mgmt']);
  assert.match(port(fw, 'v.3005').notes, /secondary 10\.\d+\.100\.1\/24; secondary .*dhcp relay /);
  assert.match(port(fw, 'VPN-HQ Hub-Back').notes, /on WAN2-CABLE/);
  // only the FortiLink commands were pasted: nothing is known about NTP or syslog, so nothing is claimed
  assert.deepEqual(NP.checks(fw).map(f => f.id).filter(id => /^no(ntp|syslog)$/.test(id)), []);
  assert.ok(!fw.unparsed.some(e => /snmp-index|device-identification|stp-settings/.test(e.text)));

  const [sw2, sw1, edge] = r.extra.map(x => x.dev);
  assert.deepEqual([sw2.hostname, sw2.serial, sw2.ports.length, edge.ports.length], ['MDF-SW-2', 'FS1D24T000000001', 27, 28]);
  // the quarantine VLAN is on every port as an untagged extra: that does not make an access port a trunk
  const p1 = port(sw2, 'port1');
  assert.deepEqual([p1.mode, p1.untagged, p1.tagged, p1.notes], ['access', '3000', '', 'also untagged: 4093']);
  assert.deepEqual([port(sw2, 'port16').mode, port(sw2, 'port16').tagged], ['trunk', '3220']);
  assert.deepEqual([port(sw1, 'port1').mode, port(sw1, 'port1').tagged, port(sw1, 'port1').description], ['trunk', 'all', 'LAB-PATCH-3850']);
  // the 28-name VLAN list was wrapped by the terminal at 224 columns, in the middle of a name
  const lag = port(sw2, 'pve-r730xd-1');
  assert.equal(lag.tagged, '3000,3005,3010-3011,3051,3060,3063,3065-3069,3090,3200-3202,3204,3207,3219-3220,3225,3230,3240,3250,3254,3269-3270');
  assert.equal(lag.untagged, '3205');
  assert.match(lag.notes, /lacp-active; lacp fast; MCLAG; .*dhcp-snooping trust/);
  assert.equal(port(sw2, 'port14').lag, 'pve-r730xd-1');
  assert.deepEqual(sw2.multicast.notes, ['snooping on VLAN 3269', 'snooping on VLAN 3240']);
  assert.ok(sw1.stp.notes.includes('STP settings overridden on this switch'));
  assert.deepEqual(port(edge, 'port1').poeAdmin, 'enabled (default)');
  // one port per switch is how an MCLAG looks: not a "single member" finding
  assert.deepEqual(NP.checks(sw2).map(f => f.id), ['trunkall', 'accessvlan1']);
});

test('FortiGate: a wrapped set line is put back together, a real multi-line value is not split into commands', () => {
  const long = '        set allowed-vlans ' + Array.from({ length: 12 }, (x, i) => '"vlan-' + (100 + i) + '"').join(' ');
  const cut = long.slice(0, 100) + '\n' + long.slice(100);                     // between two names, quotes balanced
  const cfg = v => 'config system interface\n' + Array.from({ length: 12 }, (x, i) => '    edit "vlan-' + (100 + i) + '"\n        set vlanid ' + (100 + i) + '\n    next').join('\n') +
    '\nend\nconfig system replacemsg admin "pre_admin-disclaimer-text"\n    set buffer "line one\nset hostname oops\nend of it"\nend\n' +
    'config switch-controller managed-switch\n    edit "S1"\n        config ports\n            edit "port1"\n' + v + '\n                set vlan "vlan-100"\n            next\n        end\n    next\nend\n';
  [long, cut, long.slice(0, 95) + '\n' + long.slice(95)].forEach(function (v) {
    const r = NP.ingest('FW1 # show\n' + cfg(v), { vendor: 'fortigate', devices: [] });
    assert.equal(r.dev.hostname, 'FW1');
    assert.deepEqual([port(r.extra[0].dev, 'port1').untagged, port(r.extra[0].dev, 'port1').tagged], ['100', '101-111']);
  });
});

test('parse debug records the input, what was worked out and the output of the last paste', () => {
  const text = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'cisco-3850-lab.txt'), 'utf8');
  const r = NP.ingest(text, { vendor: 'auto', devices: [], name: 'SW-PATCH-01.txt' });
  const d = r.dev.debug;
  assert.equal(r.debug, d);
  assert.deepEqual([d.detect.vendor, d.detect.how, d.detect.matches[0].vendor], ['ios', 'auto-detected', 'ios']);
  assert.deepEqual([d.target.isNew, d.output.ports, d.output.portsAdded, d.output.portsChanged], [true, 65, 65, 0]);
  assert.equal(d.output.kinds.physical, 62);
  assert.equal(d.output.physical, 62);
  assert.ok(d.output.filled.link > 0 && d.output.filled.link <= 62);
  assert.ok(d.input.sections.some(s => /^sh\w* run/.test(s.cmd) && s.used && s.ports > 0));
  assert.equal(d.misses.unusedCommands, r.dev.unparsed.filter(e => e.ctx === 'command').length);
  assert.ok(d.ms.total >= 0);
  const out = NP.debugText(r.dev);
  assert.match(out, /^ConfigHelper parse debug: /);
  assert.match(out, /platform: Cisco IOS \/ IOS-XE \[ios\], auto-detected\n {4}detected as ios by \//);
  assert.match(out, /target: new device \(hostname not loaded yet\)/);
  assert.match(out, /ports: 65 \(65 new, 0 changed by this paste\): /);
  // nothing that identifies the device: no hostname, file name, address or community
  for (const s of ['SW-PATCH-01', 'labadmin', 'example.lab', 'lab-com-mgmt', '10.0.65.169']) assert.ok(!out.includes(s), s + ' not in debug');
  // pasting the same thing again merges and changes nothing; a hand-picked platform is said
  const again = NP.ingest(text, { vendor: 'ios', devices: [r.dev] });
  assert.equal(again.dev, r.dev);
  assert.deepEqual([again.debug.target.isNew, again.debug.output.portsAdded, again.debug.output.portsChanged, again.debug.detect.how],
    [false, 0, 0, 'chosen by hand']);
  // a command the parser does not know is listed as not used; the debug is not kept in snapshots
  const d2 = NP.ingest('sw9#show clock\n12:00:00 UTC\nsw9#show vlan brief\nVLAN Name Status Ports\n---- ---- ---- ----\n10 users active Gi1/0/1\n', { vendor: 'ios', devices: [] }).dev;
  assert.match(NP.debugText(d2), /show clock \| 1 lines \| NOT USED/);
  assert.equal(NP.snapshot(d2, 'x').data.debug, undefined);
  assert.equal(NP.debugText(NP.newDevice()), '');
});
