/* Vendor auto-detection from the pasted text. First match wins; most specific first. */
(function (root) {
  'use strict';
  const NP = root.NP;

  const RULES = [
    ['fortiswitch', /^#config-version=FS/m, /^\s*config switch (interface|physical-port|vlan|trunk)\b/m,
      /^Version:\s*FortiSwitch/m, /Portname\s+Status\s+(Tpid|Device-name)/],
    ['fortigate', /^\s*config system (global|interface)\b/m, /^#config-version=F/m],
    ['mikrotik', /by RouterOS/, /^\/(interface|ip|system) [a-z]/m],
    ['icx', /^ver \d+\.\d+\.\S+\s*$/m, /^stack unit \d+\s*$/m, /^vlan \d+ (name \S+ )?by port\s*$/m,
      /^interface ethernet \d+\/\d+\/\d+/m, /^Port\s+Link\s+State\s+Dupl\s+Speed/m, /^Lcl Port\s+Chassis ID/m],
    ['junos', /^set (system|interfaces|vlans|protocols|version) /m, /^\s*host-name \S+;/m,
      /^Interface\s+Admin\s+Link\s+Proto/m, /^## Last commit/m],
    ['comware', /^\s*sysname \S/m, /^\s*port link-type /m, /^interface (Bridge-Aggregation|Vlan-interface)\d/m,
      /^Interface\s+Link\s+Speed\s+Duplex\s+Type\s+PVID/m],
    ['arubaos', /^; \S+ Configuration Editor/m, /^\s+(untagged|tagged) [\w,\-\/]+\s*$/m,
      /Port\s+Type\s+\|\s+(Intrusion\s+)?Alert/, /PoE\s+\|\s+Power/],
    ['aoscx', /^!Version ArubaOS-CX/m, /^interface \d+\/\d+\/\d+\s*$/m, /^\s+vlan (access|trunk) /m],
    ['os10', /^! Version 10\.\d/m, /\bOS10\b/, /^interface ethernet\s?\d+\/\d+\/\d+/m],
    ['nxos', /^feature \S+/m, /^vdc \S+/m, /\bNX-?OS\b/, /^switchname \S+/m, /^interface Ethernet\d+\/\d+\s*$/m],
    ['eos', /^! device: .*EOS/m, /\bArista\b/, /^interface Ethernet\d+\s*$/m, /^interface Port-Channel\d+/m],
    ['ios', /^interface (Fast|Gigabit|TwoGigabit|FiveGigabit|TenGigabit|TwentyFiveGig|FortyGigabit|HundredGig)E/m,
      /Cisco IOS/, /^Current configuration\s*:/m, /^\s*switchport /m,
      /^Port\s+Name\s+Status\s+Vlan/m, /^Interface\s+Admin\s+Oper\s+Power/m, /^Device ID\s+Local Intrfce/m,
      /^hostname \S+/m]
  ];

  NP.detect = function (text) {
    for (const rule of RULES) {
      for (let i = 1; i < rule.length; i++) if (rule[i].test(text)) return rule[0];
    }
    return '';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
