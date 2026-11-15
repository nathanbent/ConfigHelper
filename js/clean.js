/* Clean up messy pastes before parsing: session logs and terminal captures are full of
 * pager prompts, control characters, colour codes, timestamps and broken indentation.
 * NP.clean(text) -> {text, notes:[...]}; notes say what was done, for the status line. */
(function (root) {
  'use strict';
  const NP = root.NP;

  // pager prompts of the common platforms
  const MARK = '(?:<?-{2,} ?\\(?[Mm][Oo][Rr][Ee](?: \\d+%)?\\)? ?-{2,}>?(?:, next page: Space, next line: Enter, quit: Control-C)?(?: \\(q to quit\\))?' +
    '|-- \\[Q quit\\|D dump[^\\]\\n]*\\])';
  const MARK_LINE = new RegExp('^([ \\t]*)(' + MARK + ')([ \\t]*)(.*)$');
  // lines that open an indented block in "industry standard" configs
  const OPENER = /^(interface |vlan [\d,\-]+\s*$|vlan \d+ (name|by port)|line |router |spanning-tree mst configuration|vrf (definition|context) |class-map |policy-map |ip dhcp pool |ip access-list |route-map |crypto |aaa group |ntp\s*$|stack unit |lag \S+ (dynamic|static)|trunk |control-plane|redundancy|call-home|key chain )/;
  const CLOSER = /^(!|#|end|exit|return|quit)\s*$/;

  // replay \r and \b the way a terminal would; \u0001 = erase to end of line, \u0002 = erase line
  function replay(line) {
    const buf = [];
    let col = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\b') { if (col > 0) col--; }
      else if (ch === '\r') col = 0;
      else if (ch === '\u0001') buf.length = Math.min(buf.length, col);
      else if (ch === '\u0002') { buf.length = 0; col = 0; }
      else { while (buf.length < col) buf.push(' '); buf[col++] = ch; }
    }
    return buf.join('');
  }

  NP.clean = function (input) {
    const notes = [];
    const note = function (n, what) { if (n) notes.push(n + ' ' + what); };
    let text = String(input == null ? '' : input);

    // ---- invisible and control characters
    let n = 0;
    text = text.replace(/^\ufeff/, '').replace(/[\u0000\u200b\u200c\u200d\u2060]/g, function () { n++; return ''; });
    text = text.replace(/\u00a0/g, ' ');
    let ansi = 0;
    text = text.replace(/\x1b\[0?K/g, '\u0001').replace(/\x1b\[2K/g, '\u0002')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[@-Z\\^_=>]/g, function () { ansi++; return ''; });
    note(ansi, 'colour/cursor code(s) removed');
    text = text.replace(/\r\n/g, '\n').replace(/\r+\n/g, '\n');
    let replayed = 0;
    if (/[\b\r\u0001\u0002]/.test(text)) {
      text = text.split('\n').map(function (l) {
        if (!/[\b\r\u0001\u0002]/.test(l)) return l;
        replayed++;
        return replay(l);
      }).join('\n');
    }
    note(replayed, 'line(s) with backspace/carriage-return overwrites replayed');
    text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

    // ---- smart quotes from Word / Outlook
    let q = 0;
    text = text.replace(/[\u201c\u201d\u201e]/g, function () { q++; return '"'; }).replace(/[\u2018\u2019]/g, function () { q++; return "'"; });
    note(q, 'curly quote(s) straightened');

    let lines = text.split('\n');
    const filled = function () { return lines.filter(function (l) { return l.trim(); }); };

    // ---- a prefix on (nearly) every line: logger timestamps, or "> " mail quoting
    const stripPrefix = function (re, what) {
      const f = filled();
      if (f.length < 5) return;
      const hits = f.filter(function (l) { return re.test(l); }).length;
      if (hits < f.length * 0.8) return;
      lines = lines.map(function (l) { return l.replace(re, ''); });
      notes.push(what + ' removed from ' + hits + ' lines');
    };
    stripPrefix(/^\[?\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+\-]\d\d:?\d\d)?\]? ?/, 'timestamps');
    stripPrefix(/^\[?\d\d:\d\d:\d\d(?:[.,]\d+)?\]? /, 'timestamps');
    stripPrefix(/^> ?/, 'quote marks');

    // ---- pager prompts
    let more = 0;
    const out = [];
    lines.forEach(function (l) {
      const m = l.match(MARK_LINE);
      if (!m) { out.push(l); return; }
      more++;
      if (!m[4]) return;                                       // the prompt was alone on its line
      // a log that kept the spaces which erased the prompt: drop as many spaces as the prompt was wide
      const width = m[1].length + m[2].length + 1;
      out.push((m[3].length >= width ? m[3].slice(width) : '') + m[4]);
    });
    lines = out;
    note(more, 'pager prompt(s) removed');

    // ---- hard line wrapping at the terminal width
    const maxLen = lines.reduce(function (mx, l) { return Math.max(mx, l.length); }, 0);
    const atMax = lines.filter(function (l) { return l.length === maxLen; }).length;
    // (only when few lines hit the limit: a table whose rows are all padded to 80 columns is not wrapping)
    const wrappable = function (l) { return l.length === maxLen && !/\s$/.test(l) && !/^[\s\-=+|_*#]+$/.test(l); };
    if (maxLen >= 79 && maxLen <= 512 && atMax >= 3 && atMax <= Math.max(3, lines.length * 0.1) &&
        /^(79|80|100|120|132|160|200|255|256|511|512)$/.test(String(maxLen))) {
      const joined = [];
      let wraps = 0;
      for (let i = 0; i < lines.length; i++) {
        let l = lines[i];
        while (wrappable(lines[i]) && lines[i + 1] !== undefined && lines[i + 1].trim() && !/^\s/.test(lines[i + 1])) { l += lines[++i]; wraps++; }
        joined.push(l);
      }
      lines = joined;
      note(wraps, 'line(s) re-joined that were wrapped at ' + maxLen + ' columns');
    }

    // ---- indentation lost entirely (pasted through mail or a web form): rebuild it for block-style configs
    const f = filled();
    const blocks = f.filter(function (l) { return /^interface \S/.test(l); }).length;
    if (blocks >= 3 && !f.some(function (l) { return /^\s/.test(l); }) && !/^\s*(set |config |edit |\/interface )/m.test(f.join('\n'))) {
      let inside = false, fixed = 0;
      lines = lines.map(function (l) {
        if (!l.trim() || CLOSER.test(l)) { inside = false; return l; }
        if (/^\S+[#>]/.test(l)) { inside = false; return l; }                // a prompt line
        if (OPENER.test(l)) { inside = true; return l; }
        if (inside) { fixed++; return ' ' + l; }
        return l;
      });
      if (fixed) notes.push('indentation was missing; rebuilt for ' + fixed + ' lines (a guess: check the result)');
    }

    return { text: lines.join('\n'), notes: notes };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
