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

1. Optional: choose a brand, then a platform (Dell > OS10, Fortinet > FortiSwitch FortiLink-managed ...) to see the commands to run on the device, with a **Copy all** button. Nothing is shown until you choose, so the list for the wrong platform cannot be copied by accident.
2. Paste a config, show output, or a whole terminal session, or drop text files on the box. Press **Parse**.
3. Paste more output for the same device later; it merges by hostname (taken from the config or the CLI prompt). If the paste has no hostname, it goes into the selected device. One paste holding sessions from several devices is cut where the prompt's hostname changes, and each device is added on its own.
4. Use the **Ports** tab to filter, sort, pick columns and export. Use **Labels** to build label rows.

**Edit** on the Ports tab lets you change descriptions, VLANs, neighbors and notes, and untick ports to leave them out
of exports and labels. Edits are stored separately from the parsed data, so pasting newer output for the same
device keeps them, and **Reset edits** returns to what was parsed.

The **Checks** tab flags things worth a second look, worked out from what was loaded: err-disabled ports,
half duplex, VLANs used but not defined, PortFast on trunks, access ports without edge/BPDU guard, trunks
carrying every VLAN or using native VLAN 1, missing NTP or syslog, plain HTTP or Telnet management, SNMP
without v3, DHCP snooping with no trusted port, and more. Each finding lists its ports and can filter the
Ports tab to them. They are prompts to review, not verdicts.

The **Normalize** tab finds ports of the same kind that are not written or set up alike, on one device or across
all of them. Ports are grouped by what the description names (AP, access point and WAP count as one kind;
otherwise the first word decides). It lists the ports spelled differently (`Access Point Lobby` among twenty
`AP ...` ports) with the description they would get, and the ports whose mode, native or tagged VLANs differ
from what most of the group has (`missing tagged 30`). Pick the spelling or VLAN setup to use and apply it to one
port or all. Corrections are manual edits, so they reach exports and labels but never the parsed data or the
switch: a corrected VLAN is what the label says until the switch is changed too.

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

At the bottom of that tab, **Parse debug (last paste)** shows how the last paste for the device was handled:
the commands it was split into and whether each one's output was used, which detection rule picked the
platform (and which other platforms also matched), timings, and how many ports each column was filled on.
It holds counts, commands and pattern names, never config values, and is included in the problem report.

With eight or more devices loaded (a FortiGate brings every managed switch with it), the Devices panel gets a
search box. Type any part of a name, platform, model, serial number, management IP or description; several
words must all match. Enter opens the first match and the down arrow moves into the list.

Loaded devices are remembered in the browser's local storage; use **Export backup** for a real copy.

Every tab, the cable list and the paste panel have a one-line description and a collapsed **How this page
works** panel: what the view is for, what it needs, what you get and its limits.

## What it reads

| Platform | Config | Show output |
|---|---|---|
| Cisco IOS / IOS-XE | `show running-config` | `show interfaces status`, `show interfaces`, `show ip interface brief`, `show power inline`, `show cdp neighbors [detail]`, `show lldp neighbors [detail]`, `show vlan brief`, `show spanning-tree`, `show version` |
| Cisco NX-OS | `show running-config` | `show interface status`, `show lldp neighbors`, `show cdp neighbors detail`, `show version` |
| Arista EOS | `show running-config` | `show interfaces status`, `show lldp neighbors`, `show version` |
| Dell OS6 (N-series) | `show running-config` | `show interfaces status`, `show power inline`, `show lldp remote-device all`, `show version` |
| Dell OS9 (S/Z-series, FTOS) | `show running-config` | `show interfaces status`, `show lldp neighbors`, `show version` |
| Dell OS10 | `show running-configuration` | `show interface status`, `show lldp neighbors`, `show version` |
| Aruba AOS-CX | `show running-config` | `show interface brief`, `show lldp neighbor-info` |
| ArubaOS-Switch / HP ProCurve | `show running-config` | `show interfaces brief`, `show power-over-ethernet brief`, `show lldp info remote-device` |
| Ruckus ICX (FastIron) | `show running-config` | `show interfaces brief`, `show inline power`, `show lldp neighbors [detail]`, `show version` |
| HPE Comware / H3C | `display current-configuration` | `display interface brief` |
| Juniper Junos | `show configuration` (curly or `display set`) | `show interfaces terse`, `show lldp neighbors`, `show poe interface`, `show version`, `show chassis hardware` |
| Fortinet FortiGate | backup `.conf` / `show`, or only the sections that are read (`show system interface`, `show system zone`, `show system dns`, `show system ntp`, `show log syslogd setting`, `show system snmp sysinfo`, `show router static`, `show system ha`) | `get system status` |
| Fortinet FortiSwitch, FortiLink-managed | on the FortiGate: `show switch-controller managed-switch`, `show system interface`, `show switch-controller stp-settings` (each switch becomes its own device; config only, no link state) | |
| Fortinet FortiSwitch, on the switch itself (standalone, or logged in to a managed one) | `show` | `get system status`, `diagnose switch physical-ports summary`, `get switch poe inline`, `get switch lldp neighbors-summary` |
| Palo Alto PAN-OS | exported `running-config.xml`, `set` format, or the default brace format | `show system info`, `show interface all` |
| pfSense / OPNsense | exported `config.xml` | |
| Ubiquiti UniFi | controller JSON: device list (`stat/device`), ideally with the network list (`rest/networkconf`) | `mca-dump` on the switch |
| MikroTik RouterOS | `/export` | |

Tested against real output so far (`test/fixtures/`): Cisco Catalyst 3850 on IOS-XE 16.12, Juniper EX2300-C on Junos 25.2, Ruckus ICX7150-48P on FastIron 10.0.10, Ruckus ICX6610 on FastIron 08.0.30 (config only), a Dell N3024P + N3048P stack on OS6 6.5.4.10, FortiGate 201F on FortiOS 8.0 with three FortiLink-managed FortiSwitches (the three FortiLink commands only), Dell S4148 on OS10 10.5.0.4 (config only; the OS10 show commands are still unchecked). Everything else
was written against the vendors' documented formats and the made-up samples in `js/samples.js`, so expect
gaps on real devices; when you find one, add the output (sanitised) to `test/fixtures/` with a test and fix
the parser.

Dell OS9 was written from memory of the format and has not seen real output yet.

Not covered yet: EdgeOS/VyOS.

## Labels and P-touch Editor

The Labels tab produces a file with only the `Line1`, `Line2`, `Line3` columns you fill in (empty lines are
left out). Options: label type presets (port, patch panel, port + VLAN, port + native/tagged VLAN, cable wrap, cable, one-per-device asset label),
a port match filter, a "print only" choice with custom conditions (below), a per-line character limit, duplicate removal, comma/semicolon/tab output, and optional
reference columns (`Device`, `Port`, `Description`, `VLAN`).

`P-touch template (.lbx)` downloads the ready-made P-touch Editor layout chosen in the list beside it (kept in
`templates/`, all for the PT-E550W and using `Line1` and `Line2`): a 2-line cable wrap on 24 mm tape, the same wrap
with a taller second line, and a 2-line fiber flag on 18 mm tape. Open it, connect the exported file as its database
and link the `Line1`/`Line2` text to the matching fields (the fiber flag already has one side linked).
`Zipped (.zip, phone app)` gives the same template inside a `.zip`, the form Brother's Pro Label Tool app imports.

- `{host} {port} {portfull} {portid} {num} {desc} {vlan} {tagged} {voice} {mode} {neighbor} {nport} {ninfo} {ip} {lag} {speed}`, and per device `{mgmtip} {model} {serial} {version} {location}`
- `{neighbor|desc}` uses the first field that has a value
- `[VLAN {vlan}]` is dropped when the field inside is empty; `[n{vlan}] [t{tagged}]` gives `n10 t20,30`
- Click a field button to add it to the line you last clicked in, at the cursor; hover a field for what it holds
- `{portid}` is the port without its type: `Eth1/1/1` gives `1/1/1`, `Gi1/0/12` gives `1/0/12`
- **+ Add replacement** edits the finished text of every line, in order, before the character limit: plain text
  matched in any case (`Eth` replaced with nothing turns `Eth1/1/1` into `1/1/1`), or `/pattern/` for a regular
  expression, with `$1` for its groups (`/^Eth(\d+)\/\d+\/(\d+)$/` to `U$1-$2` gives `U1-1`)
  Each replacement has a tick box to switch it off without deleting it, and a ⠿ handle to drag it up or down
  (or focus the handle and use the arrow keys); order matters. The cable labels (under Cable list) use
  the same list and can edit it too.

**Print only** narrows the labels to the ports you actually need to (re)print:

- *Ports set up differently from most*: the ports whose mode, native, tagged or voice VLAN is not the setup most
  of the selected ports share (the note under it says which setup that is). With 48 access ports on VLAN 10 and a
  handful of trunks and odd VLANs, only the handful get labels.
- *Ports I edited*: ports changed with Edit on the Ports tab or by a Normalize correction.
- *Labels changed since a snapshot*: ports whose label text, as the lines are set now, differs from what it would
  have said in a snapshot (saved on the Compare tab), plus ports that are new since. Reprint only what changed.
- *Conditions* (`+ Add condition`): any port column with `is`, `is not`, `contains`, `does not contain`,
  `is empty` or `is not empty`, e.g. `Tagged VLANs contains 30` and `Mode is trunk`. All conditions must match.
  VLAN columns compare as VLAN lists (`contains 30` matches `10,20-40` but not `130`); in other columns a comma
  means any of (`Description contains AP, printer`).

These combine with the options above: "set up differently from most" is worked out among the ports that pass
them, so `Description contains AP` plus that choice finds the APs that are not set up like the other APs.

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
- `js/normalize.js` the Normalize tab's grouping and corrections
- `js/export.js` summary, CSV, labels, backup
- `js/app.js` the UI
- `js/samples.js` sample inputs (also the test fixtures)
- `js/help.js` the description and "How this page works" text for each view

To add a vendor: write `js/parsers/<name>.js` that fills a device via `NP.port(dev, name)` and friends,
add a detection rule in `js/detect.js`, add a `<script>` tag in `index.html` and the file in `test/load.js`,
then add a sample and a test.

### Page help

Each view has an entry in `NP.help` in `js/help.js`: a one-sentence `desc`, shown under the tabs, and up to
five sections in a fixed order (Use it for, Give it, You get, Limits, More), shown in the collapsed panel.
A section is a list of paragraphs; backticks mark code and `[text](https://...)` is a link.

- the limit is 200 words per view: anything longer belongs in this README, linked under More
- the panel is reading matter only. Controls stay on the page, and anything a user must know to get correct
  output is a visible hint as well, because most people never open the panel
- change the help in the same commit as the behavior it describes

`test/help.test.js` fails when a tab has no entry or an entry breaks the shape. A new view needs its id in
`NP.helpPages`, an entry in `NP.help`, and a `pageHead('<id>')` call where it renders. Whether a panel is
open is remembered per view in local storage, under its own key.

## Licence

MIT. See `LICENSE`.
