# ConfigHelper

Paste a switch, router or firewall config (and optionally show-command output) and get:

- an **overview**: hostname, model, software, management IP, DNS, NTP, syslog, SNMP, spanning tree, multicast, VLANs and other notable settings
- a **port table**: description, admin/link state, speed, mode, untagged/native and tagged VLANs, voice VLAN, LAG, PoE, STP settings, CDP/LLDP neighbor
- **exports**: port CSV, summary CSV, JSON backup (re-importable), and a label CSV for Brother P-touch Editor

Everything runs in the browser. Nothing is uploaded, and secrets (password hashes, SNMP communities, keys) are never stored or exported.

## Use it

Open `dist/confighelper.html` in a browser. That single file is the whole app; copy it anywhere.
(`index.html` also works directly and is the one to use while editing the source.)

1. Optional: choose a platform to see the commands to run on the device, with a **Copy all** button.
2. Paste a config, show output, or a whole terminal session, or drop text files on the box. Press **Parse**.
3. Paste more output for the same device later; it merges by hostname (taken from the config or the CLI prompt). If the paste has no hostname, it goes into the selected device.
4. Use the **Ports** tab to filter, sort, pick columns and export. Use **Labels** to build label rows.

Loaded devices are remembered in the browser's local storage; use **Export backup** for a real copy.

## What it reads

| Platform | Config | Show output |
|---|---|---|
| Cisco IOS / IOS-XE | `show running-config` | `show interfaces status`, `show interfaces`, `show ip interface brief`, `show power inline`, `show cdp neighbors [detail]`, `show lldp neighbors [detail]`, `show vlan brief`, `show spanning-tree`, `show version` |
| Cisco NX-OS | `show running-config` | `show interface status`, `show lldp neighbors`, `show cdp neighbors detail`, `show version` |
| Arista EOS | `show running-config` | `show interfaces status`, `show lldp neighbors`, `show version` |
| Dell OS10 | `show running-configuration` | |
| Aruba AOS-CX | `show running-config` | `show interface brief`, `show lldp neighbor-info` |
| ArubaOS-Switch / HP ProCurve | `show running-config` | `show interfaces brief`, `show power-over-ethernet brief`, `show lldp info remote-device` |
| HPE Comware / H3C | `display current-configuration` | `display interface brief` |
| Juniper Junos | `show configuration` (curly or `display set`) | `show interfaces terse`, `show lldp neighbors`, `show poe interface` |
| Fortinet FortiGate | `show` / backup `.conf` | `get system status` |
| MikroTik RouterOS | `/export` | |

Tested against real output so far: Cisco Catalyst 3850 on IOS-XE 16.12 (`test/fixtures/`). Everything else
was written against the vendors' documented formats and the made-up samples in `js/samples.js`, so expect
gaps on real devices; when you find one, add the output (sanitised) to `test/fixtures/` with a test and fix
the parser.

Not covered yet: Palo Alto, pfSense/OPNsense, UniFi, EdgeOS/VyOS.

## Labels and P-touch Editor

The Labels tab produces a CSV with `Line1`, `Line2`, `Line3` columns built from templates, plus the raw
`Device`, `Port`, `Description`, `VLAN` columns.

- `{host} {port} {portfull} {num} {desc} {vlan} {tagged} {voice} {mode} {neighbor} {nport} {ninfo} {ip} {lag} {speed}`
- `{neighbor|desc}` uses the first field that has a value
- `[VLAN {vlan}]` is dropped when the field inside is empty

In P-touch Editor, connect the CSV as a database (File > Database > Connect), treat the first row as field
names, drag the `Line` fields onto the label layout, and print all records. The label CSV is written without
a byte-order mark; keep label text to plain ASCII if P-touch shows odd characters.

## Development

No dependencies. Node 18+ is only needed for tests and the bundle.

```bash
npm test
```

```bash
npm run build
```

Layout:

- `js/core.js` data model, port-name normalisation, input splitting, ingest/merge
- `js/detect.js` vendor auto-detection
- `js/parsers/*.js` one file per CLI family; each calls `NP.registerVendor(id, label, parse)`
- `js/export.js` summary, CSV, labels, backup
- `js/app.js` the UI
- `js/samples.js` sample inputs (also the test fixtures)

To add a vendor: write `js/parsers/<name>.js` that fills a device via `NP.port(dev, name)` and friends,
add a detection rule in `js/detect.js`, add a `<script>` tag in `index.html` and the file in `test/load.js`,
then add a sample and a test.
