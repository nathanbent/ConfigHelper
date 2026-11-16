/* ConfigHelper page help: the one-line description of each view and its collapsed "How this page works" panel.
 *
 * One entry per view in NP.help, keyed by the id in NP.helpPages:
 *   desc      one sentence shown under the tabs (or the heading), always visible
 *   sections  up to five, in the order of NP.helpLabels; leave out any that would be empty
 * A section is a list of paragraphs. In a paragraph, `backticks` mark code and [text](https://...) is a link.
 *
 * Rules (checked by test/help.test.js):
 *   - every view has an entry with "Use it for" and "Limits", and at most NP.helpMaxWords words
 *   - the panel is reading matter only; controls stay on the page
 *   - anything a user must know to get correct output is ALSO a visible hint on the page: most people never open the panel
 *   - change the help in the same commit as the behavior it describes
 */
(function (root) {
  'use strict';
  const NP = root.NP = root.NP || {};
  const REPO = 'https://github.com/nathanbent/ConfigHelper';

  NP.helpSummary = 'How this page works';
  NP.helpLabels = ['Use it for', 'Give it', 'You get', 'Limits', 'More'];
  NP.helpMaxWords = 200;
  // 'input' is the Add device output panel; the rest are the device tabs and the cable list.
  NP.helpPages = ['input', 'overview', 'ports', 'labels', 'checks', 'normalize', 'compare', 'unparsed', 'cables'];

  NP.help = {
    input: {
      desc: 'Paste device output here to add a device or to add detail to one already loaded.',
      sections: {
        'Use it for': ['Loading a switch, router or firewall, and adding more output for it later.'],
        'Give it': [
          'A config, show-command output, or a whole terminal session, pasted or dropped as text files. Choose a brand and platform to see the commands to run, or leave it on auto-detect.',
          'A config alone gives VLANs, descriptions and settings. Interface status, PoE and neighbor output for the same device add link state, power draw and what is plugged in.'
        ],
        'You get': [
          'A device in the list. Later pastes merge into the device with the same hostname, taken from the config or the CLI prompt; a paste with no hostname goes into the selected device.',
          'The status line says what was added and what was cleaned up first, such as `--More--` prompts and hard line wraps.'
        ],
        'Limits': [
          'Nothing is uploaded. Loaded devices are kept in this browser\'s local storage, without password hashes, SNMP communities or keys. Use Export backup for a real copy.',
          'Platforms marked experimental were written from documentation and have not been checked on real hardware.'
        ],
        'More': ['[What it reads](' + REPO + '#what-it-reads)']
      }
    },
    overview: {
      desc: 'What the device is and how it is set up: identity, management, services, VLANs and stack units.',
      sections: {
        'Use it for': ['Checking a device at a glance, and as the summary for documentation or a handover.'],
        'Give it': ['Nothing here. Sections appear when the loaded output contains them: the software version needs version output, and per-unit tables need ports from more than one stack unit or slot.'],
        'You get': ['Export summary CSV gives these values as a file. Export device report gives the overview, VLANs and port table as one Markdown document.'],
        'Limits': ['A setting missing from this page may be unset on the device, or may be something the parser did not read. The Not parsed tab shows what was skipped.']
      }
    },
    ports: {
      desc: 'One row per port, to filter, sort, edit and export.',
      sections: {
        'Use it for': ['Building a port sheet, and finding ports by description, VLAN, state or neighbor.'],
        'Give it': ['Search text, the filters and the column picker. On a stack or chassis, the unit selector limits the table to one member.'],
        'You get': [
          'The table as CSV, tab-separated text, Markdown or JSON, with the shown or all columns and rows, for this device or every loaded device.',
          'Edit lets you change descriptions, VLANs, neighbors and notes, and untick ports to leave them out of exports and labels. Edits are kept apart from the parsed data, so pasting newer output for the device keeps them. Reset edits returns to what was parsed.'
        ],
        'Limits': [
          'Link state, speed, PoE and neighbors are only as fresh as the show output you pasted. Columns stay empty when that output was not loaded.',
          'Edits change this table only. Nothing is written back to a device.'
        ]
      }
    },
    labels: {
      desc: 'Build label rows from the port table for Brother P-touch Editor.',
      sections: {
        'Use it for': ['Printing port, patch panel, cable or asset labels without retyping the port sheet.'],
        'Give it': [
          'A label type preset, then up to three lines made of text and fields such as `{host}`, `{port}`, `{desc}` and `{vlan}`.',
          '`{neighbor|desc}` uses the first field that has a value. `[VLAN {vlan}]` is dropped when the field inside is empty. Click a field button to add it to the line you last clicked in.',
          'The options choose which ports get a label: physical only, up only, described only, a match filter, this device or all of them.',
          'Print only: ports set up unlike most, ports you edited, or labels changed since a snapshot. Conditions filter on any column (`Tagged VLANs contains 30`).'
        ],
        'You get': ['A preview, and a file with the `Line1`, `Line2` and `Line3` columns you filled in. In P-touch Editor, connect it as a database and drag the Line fields onto the layout.'],
        'Limits': [
          'Ports unticked in Edit on the Ports tab get no label. The character limit cuts a line; it does not shrink the text.',
          'The file has no byte-order mark. Keep label text to plain ASCII if P-touch Editor shows odd characters.'
        ],
        'More': ['[Labels and P-touch Editor](' + REPO + '#labels-and-p-touch-editor)']
      }
    },
    checks: {
      desc: 'Settings and port states worth a second look, worked out from what was loaded.',
      sections: {
        'Use it for': ['A quick review before a change or an audit: err-disabled ports, half duplex, VLANs used but not defined, trunk and spanning-tree settings, missing NTP or syslog, plain HTTP or Telnet management.'],
        'Give it': ['Nothing here. More findings are possible when status output is loaded as well as the config.'],
        'You get': ['Findings marked Fix or Review, each listing its ports. A finding can filter the Ports tab to those ports, and Copy findings gives the list as text.'],
        'Limits': [
          'These are prompts to look, not verdicts: the tool cannot know what is intentional on your network.',
          'An empty list means nothing was flagged in what was loaded. It does not mean the device is configured correctly.'
        ]
      }
    },
    normalize: {
      desc: 'Ports of the same kind that are not written or set up alike, with the correction on offer.',
      sections: {
        'Use it for': ['Making labels and port sheets consistent: twenty AP ports where some say `AP` and some say `Access Point`, or where a few carry fewer tagged VLANs than the rest.'],
        'Give it': ['Port descriptions. Ports are grouped by the kind of thing the description names: known words such as AP, access point and WAP count as one kind; otherwise the first word decides. Choose this device or all loaded devices.'],
        'You get': [
          'Per group, the ports written differently with the description they would get, and the ports whose mode, native or tagged VLANs differ from what most of the group has, with what is missing or extra.',
          'Choose which spelling or VLAN setup to use, then apply it to one port or all. Copy list gives the findings as text, for fixing the switch.'
        ],
        'Limits': [
          'Corrections are manual edits: they change this table, its exports and the labels, never the switch. Edit on the Ports tab shows and undoes them.',
          'A corrected VLAN is what the label says, not what the port carries, until the switch is changed too.',
          'VLANs are compared only in groups of three or more ports where at least 60% agree. A port may differ on purpose.'
        ]
      }
    },
    compare: {
      desc: 'What changed between a saved snapshot and a later state of this device.',
      sections: {
        'Use it for': ['Reviewing a change window, or finding what differs since the last time you looked.'],
        'Give it': [
          'A snapshot to compare from. Save snapshot of current state freezes what is loaded now.',
          'To load a newer state, choose "Selected device, as a new snapshot" under Add to and paste the newer output. The old state is kept as a snapshot and the device starts fresh, so removed VLANs and settings show as removed.'
        ],
        'You get': ['Changed device settings, VLANs added, removed or renamed, and per-port changes, with an export as Markdown. Live state (link, speed, PoE draw, neighbors) is compared only when you tick it.'],
        'Limits': [
          'A field is compared only when both sides have that data loaded; the page lists what was skipped.',
          'Up to 10 snapshots are kept per device, and they count toward browser storage. They are included in backups.'
        ]
      }
    },
    unparsed: {
      desc: 'Input the parser saw but did not use.',
      sections: {
        'Use it for': ['Spotting gaps on a platform or software version the parser has not met, and collecting them for a bug report.'],
        'Give it': ['Nothing here. The list grows with each paste for this device, and Clear empties it.'],
        'You get': [
          'The unused config lines and command output, grouped, with a Copy list button. Passwords and keys are replaced with `***`.',
          'Parse debug, at the bottom: how the last paste was split into commands, which rule picked the platform, timings, and which port columns it filled.'
        ],
        'Limits': [
          'Most of the list is harmless. A line about a port, VLAN or service that matters to you is a gap: the tables do not reflect it.',
          'Known noise such as certificates, banners and console settings is left out, so an empty list does not mean every line was understood in full.',
          'Read the list before sharing it: only passwords and keys are masked. Sanitize for sharing, under the paste box, replaces names and addresses as well.'
        ]
      }
    },
    cables: {
      desc: 'Every link between loaded devices, built from their CDP and LLDP neighbors.',
      sections: {
        'Use it for': ['A cable schedule, and cable labels with one label per end.'],
        'Give it': ['CDP or LLDP neighbor output for each device. The Commands to run list includes it.'],
        'You get': [
          'One row per link. A link reported by both devices appears once, marked "both ends"; the others are marked "one end only", "far end not loaded" or "mismatch".',
          'Export the list in any format, or as a label file.'
        ],
        'Limits': [
          'Links appear only where neighbor output was loaded, so a link between two devices that do not run CDP or LLDP is missing.',
          'Ports you excluded and neighbors you edited on the Ports tab are respected.',
          'Cable IDs are assigned in list order and change when devices are added, so export labels after the last device is loaded.'
        ]
      }
    }
  };

  // Split a paragraph into text, code and link runs: [{kind, text, href?}].
  NP.helpInline = function (text) {
    const out = [];
    const re = /`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
      out.push(m[1] !== undefined ? { kind: 'code', text: m[1] } : { kind: 'link', text: m[2], href: m[3] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
    return out;
  };

  // Problems with one entry, as a list of strings (empty = fine). Used by the tests.
  NP.helpProblems = function (id) {
    const e = NP.help[id], bad = [];
    if (!e) return ['no help for "' + id + '"'];
    if (!e.desc || !/^[^.]+\.$/.test(e.desc)) bad.push('desc must be one sentence ending in a full stop');
    const keys = Object.keys(e.sections || {});
    let last = -1;
    keys.forEach(function (k) {
      const i = NP.helpLabels.indexOf(k);
      if (i === -1) bad.push('unknown section "' + k + '"');
      else if (i <= last) bad.push('section "' + k + '" is out of order');
      last = Math.max(last, i);
      const paras = e.sections[k];
      if (!Array.isArray(paras) || !paras.length || paras.some(function (p) { return typeof p !== 'string' || !p.trim(); })) bad.push('section "' + k + '" is empty');
    });
    ['Use it for', 'Limits'].forEach(function (k) { if (keys.indexOf(k) === -1) bad.push('missing section "' + k + '"'); });
    const words = keys.map(function (k) {
      return (e.sections[k] || []).map(function (p) { return NP.helpInline(String(p)).map(function (r) { return r.text; }).join(' '); }).join(' ');
    }).join(' ').split(/\s+/).filter(Boolean).length;
    if (words > NP.helpMaxWords) bad.push(words + ' words, the limit is ' + NP.helpMaxWords);
    return bad;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
