// Loads the browser scripts into Node (they attach to globalThis.NP).
const path = require('path');
['core', 'clean', 'detect', 'parsers/ioslike', 'parsers/os6', 'parsers/arubaos', 'parsers/comware', 'parsers/icx', 'parsers/junos',
  'parsers/fortigate', 'parsers/fortiswitch', 'parsers/paloalto', 'parsers/pfsense', 'parsers/mikrotik', 'samples', 'export', 'checks', 'diff', 'cables', 'sanitize'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
module.exports = globalThis.NP;
