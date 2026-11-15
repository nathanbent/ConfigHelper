# ConfigHelper

Paste a switch, router or firewall config (and optionally show-command output) and get:

- an **overview**: hostname, model, software, management IP, DNS, NTP, syslog, SNMP, spanning tree, multicast, VLANs and other notable settings
- a **port table**: description, admin/link state, speed, mode, untagged/native and tagged VLANs, voice VLAN, LAG, PoE, STP settings, CDP/LLDP neighbor
- **exports**: port table as CSV, tab-separated text, Markdown or JSON (shown or all columns and rows, one or all devices); a per-device Markdown report; summary CSV; JSON backup (re-importable); and a label file for Brother P-touch Editor

Everything runs in the browser. Nothing is uploaded, and secrets (password hashes, SNMP communities, keys) are never stored or exported.

## Use it

Online: https://nathanbent.github.io/ConfigHelper/ (deployed from `main` by GitHub Actions; it is the same single file, and pasted configs still never leave your browser).

Offline: Open `dist/confighelper.html` in a browser. That single file is the whole app; copy it anywhere.
(`index.html` also works directly and is the one to use while editing the source.)

1. Optional: choose a platform to see the commands to run on the device, with a **Copy all** button.
2. Paste a config, show output, or a whole terminal session, or drop text files on the box. Press **Parse**.
3. Paste more output for the same device later; it merges by hostname (taken from the config or the CLI prompt). If the paste has no hostname, it goes into the selected device.
4. Use the **Ports** tab to filter, sort, pick columns and export. Use **Labels** to build label rows.

**Edit** on the Ports tab lets you change descriptions, neighbors and notes, and untick ports to leave them out
of exports and labels. Edits are stored separately from the parsed data, so pasting newer output for the same
device keeps them, and **Reset edits** returns to what was parsed.

The **Checks** tab flags things worth a second look, worked out from what was loaded: err-disabled ports,
half duplex, VLANs used but not defined, PortFast on trunks, access ports without edge/BPDU guard, trunks
carrying every VLAN or using native VLAN 1, missing NTP or syslog, plain HTTP or Telnet management, SNMP
without v3, DHCP snooping with no trusted port, and more. Each finding lists its ports and can filter the
Ports tab to them. They are prompts to review, not verdicts.

The **Compare** tab shows what changed between two states of a device. Save a snapshot, or choose "Selected
device, as a new snapshot" under Add to and paste newer output: the old state is kept as a snapshot and the
device starts fresh. The comparison lists changed device settings, VLANs added, removed or renamed, and
per-port changes, with live state (link, PoE draw, neighbors) optional, and exports as Markdown.

**Cable list** (under the device list) combines the CDP/LLDP neighbors of every loaded device into one list
of links. A link reported by both switches appears once and is marked "both ends"; others are marked "one end
only", "far end not loaded" or "mismatch". Export it in any format, or as cable labels with one label per end.

**Sanitize for sharing** (under the paste box) rewrites raw output so it can go in a bug report: secrets,
certificates and banners are removed, and hostnames, usernames, descriptions, VLAN names, IP and MAC addresses
and serials are replaced consistently with same-length placeholders, so tables still line up. It then checks
that the result parses to the same ports and VLANs as the original. Always read it through before sharing.

Pasted text is cleaned up before parsing: `--More--` prompts, backspace and carriage-return overwrites,
colour codes, logger timestamps, mail quote marks, curly quotes, hard line wraps and lost indentation. The
status line says what was fixed.

**Build problem report** (in the same panel) makes one text file for a bug report: app version, platform, what
was cleaned and sanitized, what the parser made of it (port table, Not parsed list, checks) and the sanitized
input. Platforms not yet checked on real hardware are marked "experimental" in the app.

Stacks and chassis: when ports belong to more than one unit (`Gi2/0/14`, `3/1/24`, `ge-1/0/3`), the Ports and
Labels tabs get a **unit selector**, the Overview shows a per-unit table (ports, up, down, PoE draw), and a
Unit column is available. Removing a device or clearing everything can be undone, and the Devices panel says
whether your work has changed since the last backup.

The **Not parsed** tab on each device lists the config lines and command output the parser saw but did not use
(with known noise left out and passwords and keys replaced by `***`). Use it to spot gaps on a new device; the
**Copy list** button gives you something to paste into a bug report.

Loaded devices are remembered in the browser's local storage; use **Export backup** for a real copy.

## What it reads

| Platform | Config | Show output |
|---|---|---|
| Cisco IOS / IOS-XE | `show running-config` | `show interfaces status`, `show interfaces`, `show ip interface brief`, `show power inline`, `show cdp neighbors [detail]`, `show lldp neighbors [detail]`, `show vlan brief`, `show spanning-tree`, `show version` |
| Cisco NX-OS | `show running-config` | `show interface status`, `show lldp neighbors`, `show cdp neighbors detail`, `show version` |
| Arista EOS | `show running-config` | `show interfaces status`, `show lldp neighbors`, `show version` |
| Dell OS6 (N-series) | `show running-config` | `show interfaces status`, `show power inline`, `show lldp remote-device all`, `show version` |
| Dell OS10 | `show running-configuration` | |
| Aruba AOS-CX | `show running-config` | `show interface brief`, `show lldp neighbor-info` |
| ArubaOS-Switch / HP ProCurve | `show running-config` | `show interfaces brief`, `show power-over-ethernet brief`, `show lldp info remote-device` |
| Ruckus ICX (FastIron) | `show running-config` | `show interfaces brief`, `show inline power`, `show lldp neighbors [detail]`, `show version` |
| HPE Comware / H3C | `display current-configuration` | `display interface brief` |
| Juniper Junos | `show configuration` (curly or `display set`) | `show interfaces terse`, `show lldp neighbors`, `show poe interface` |
| Fortinet FortiGate | `show` / backup `.conf`, including FortiLink-managed switches (each becomes its own device) | `get system status` |
| Fortinet FortiSwitch (standalone) | `show` | `get system status`, `diagnose switch physical-ports summary`, `get switch poe inline`, `get switch lldp neighbors-summary` |
| Palo Alto PAN-OS | exported `running-config.xml`, `set` format, or the default brace format | `show system info`, `show interface all` |
| pfSense / OPNsense | exported `config.xml` | |
| Ubiquiti UniFi | controller JSON: device list (`stat/device`), ideally with the network list (`rest/networkconf`) | `mca-dump` on the switch |
| MikroTik RouterOS | `/export` | |

Tested against real output so far: Cisco Catalyst 3850 on IOS-XE 16.12 and Ruckus ICX7150-48P on FastIron 10.0.10
(`test/fixtures/`). Everything else
was written against the vendors' documented formats and the made-up samples in `js/samples.js`, so expect
gaps on real devices; when you find one, add the output (sanitised) to `test/fixtures/` with a test and fix
the parser.

Not covered yet: EdgeOS/VyOS.

## Labels and P-touch Editor

The Labels tab produces a file with only the `Line1`, `Line2`, `Line3` columns you fill in (empty lines are
left out). Options: label type presets (port, patch panel, port + VLAN, cable, one-per-device asset label),
a port match filter, a per-line character limit, duplicate removal, comma/semicolon/tab output, and optional
reference columns (`Device`, `Port`, `Description`, `VLAN`).

- `{host} {port} {portfull} {num} {desc} {vlan} {tagged} {voice} {mode} {neighbor} {nport} {ninfo} {ip} {lag} {speed}`, and per device `{mgmtip} {model} {serial} {version} {location}`
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

Browser tests drive the bundled file in headless Chromium. They need Playwright, which is not a dependency of
the app itself; they are skipped if it is not installed, and they run in CI before every deploy:

```bash
npm install --no-save playwright
```

```bash
npm run test:ui
```

The bundled file carries a Content Security Policy generated by `build.js` (script and style hashes, no
`unsafe-inline`, `connect-src 'none'`), so the browser itself refuses any network request the page might make.

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

## Licence

MIT. See `LICENSE`.
