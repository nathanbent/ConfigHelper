// Test data: a generated Catalyst stack session (config, interface status, PoE).
// an eight-member Catalyst stack: 48 access ports and 4 uplinks per member
function bigStack(members) {
  const cfg = ['hostname BIG-STACK', '!'], st = ['', 'Port      Name               Status       Vlan       Duplex  Speed Type'], poe = ['Interface Admin  Oper       Power   Device              Class Max', '--------- ------ ---------- ------- ------------------- ----- ----'];
  for (let m = 1; m <= members; m++) {
    cfg.push('switch ' + m + ' provision ws-c3850-48p');
    for (let i = 1; i <= 48; i++) {
      cfg.push('interface GigabitEthernet' + m + '/0/' + i, ' description U' + m + ' desk ' + i, ' switchport access vlan ' + (10 + m), ' switchport mode access', ' spanning-tree portfast', '!');
      const up = i % 3 === 0;
      st.push(('Gi' + m + '/0/' + i).padEnd(10) + ('U' + m + ' desk ' + i).padEnd(19) + (up ? 'connected' : 'notconnect').padEnd(13) + String(10 + m).padEnd(11) + (up ? 'a-full a-1000 ' : '  auto   auto ') + '10/100/1000BaseTX');
      poe.push(('Gi' + m + '/0/' + i).padEnd(10) + 'auto   ' + (up ? 'on         6.0     Ieee PD             2     30.0' : 'off        0.0     n/a                 n/a   30.0'));
    }
    for (let i = 1; i <= 4; i++) cfg.push('interface TenGigabitEthernet' + m + '/1/' + i, ' switchport mode trunk', '!');
  }
  return 'BIG-STACK#show running-config\n' + cfg.join('\n') + '\nend\nBIG-STACK#show interfaces status\n' + st.join('\n') + '\nBIG-STACK#show power inline\n' + poe.join('\n') + '\n';
}
module.exports = bigStack;
