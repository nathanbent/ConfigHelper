// Loads the browser scripts into Node (they attach to globalThis.NP).
const path = require('path');
['core', 'detect', 'parsers/ioslike', 'parsers/arubaos', 'parsers/comware', 'parsers/icx', 'parsers/junos',
  'parsers/fortigate', 'parsers/fortiswitch', 'parsers/mikrotik', 'samples', 'export', 'checks', 'diff'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
module.exports = globalThis.NP;
