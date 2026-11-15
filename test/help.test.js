// Guards the page help content (js/help.js): every view has help, and each entry keeps to the shared shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const NP = require('./load.js');

test('every view has help that keeps to the shape', () => {
  assert.ok(NP.helpPages.length >= 8);
  for (const id of NP.helpPages) assert.deepEqual(NP.helpProblems(id), [], id);
});

test('there is no help without a view', () => {
  assert.deepEqual(Object.keys(NP.help).sort(), NP.helpPages.slice().sort());
});

test('every device tab in the app has help', () => {
  // the tab ids are the first element of each pair in render()'s tabs list
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const list = /const tabs = \[([\s\S]*?)\];/.exec(app);
  assert.ok(list, 'tabs list not found in js/app.js');
  const ids = [...list[1].matchAll(/\['([a-z]+)',/g)].map(m => m[1]);
  assert.ok(ids.length >= 6);
  for (const id of ids) assert.ok(NP.help[id], 'tab "' + id + '" has no entry in js/help.js');
});

test('helpProblems catches a malformed entry', () => {
  NP.help._bad = { desc: 'Two. Sentences.', sections: { 'Limits': ['x'], 'Give it': [''], 'Tips': ['x'] } };
  const bad = NP.helpProblems('_bad').join('; ');
  delete NP.help._bad;
  for (const want of ['one sentence', 'out of order', 'is empty', 'unknown section "Tips"', 'missing section "Use it for"']) {
    assert.ok(bad.includes(want), want + ' not in: ' + bad);
  }
  NP.help._long = { desc: 'Long.', sections: { 'Use it for': [Array(201).fill('word').join(' ')], 'Limits': ['x'] } };
  assert.match(NP.helpProblems('_long').join('; '), /the limit is 200/);
  delete NP.help._long;
  assert.deepEqual(NP.helpProblems('nope'), ['no help for "nope"']);
});

test('helpInline splits code and links, and only links to https', () => {
  assert.deepEqual(NP.helpInline('a `b` [c](https://example.com/x) d'), [
    { kind: 'text', text: 'a ' }, { kind: 'code', text: 'b' }, { kind: 'text', text: ' ' },
    { kind: 'link', text: 'c', href: 'https://example.com/x' }, { kind: 'text', text: ' d' }]);
  assert.deepEqual(NP.helpInline('[c](javascript:alert(1))'), [{ kind: 'text', text: '[c](javascript:alert(1))' }]);
});
