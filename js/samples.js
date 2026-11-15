/* Made-up sample inputs: used by the "Load sample" menu and by the tests. */
(function (root) {
  'use strict';
  const NP = root.NP;
  const S = NP.samples = {};

  S.ios = { label: 'Cisco IOS switch (config + show commands)', text: String.raw`SW-ACCESS-01#show running-config
Building configuration...

Current configuration : 5120 bytes
!
version 15.2
service timestamps log datetime msec
!
hostname SW-ACCESS-01
!
aaa new-model
username admin privilege 15 secret 9 $9$abcdefghijkl
!
ip domain-name corp.example.com
ip name-server 10.10.0.53 10.10.0.54
!
spanning-tree mode rapid-pvst
spanning-tree portfast bpduguard default
spanning-tree extend system-id
spanning-tree vlan 1-4094 priority 32768
!
vlan 10
 name USERS
!
vlan 20
 name VOICE
!
vlan 30
 name WIFI
!
vlan 99
 name MGMT
!
interface Port-channel1
 description Uplink to CORE-01
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,30,99
 switchport mode trunk
!
interface GigabitEthernet1/0/1
 description Reception PC + phone
 switchport access vlan 10
 switchport mode access
 switchport voice vlan 20
 spanning-tree portfast
!
interface GigabitEthernet1/0/2
 description AP-Lobby
 switchport trunk native vlan 99
 switchport trunk allowed vlan 30,99
 switchport mode trunk
 spanning-tree portfast trunk
!
interface GigabitEthernet1/0/3
 description Printer 2nd floor
 switchport access vlan 10
 switchport mode access
 power inline never
 spanning-tree portfast
 spanning-tree bpduguard enable
!
interface GigabitEthernet1/0/4
 description SPARE
 switchport access vlan 10
 switchport mode access
 shutdown
!
interface TenGigabitEthernet1/1/1
 description CORE-01 Te1/0/1
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,30,99
 switchport mode trunk
 channel-group 1 mode active
!
interface TenGigabitEthernet1/1/2
 description CORE-01 Te2/0/1
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,30,99
 switchport mode trunk
 channel-group 1 mode active
!
interface Vlan1
 no ip address
 shutdown
!
interface Vlan99
 description Management
 ip address 10.10.99.11 255.255.255.0
!
ip default-gateway 10.10.99.1
no ip http server
ip http secure-server
ip ssh version 2
!
logging host 10.10.0.60
snmp-server community s3cret RO
snmp-server location Building A / IDF 2
snmp-server contact netops@example.com
!
ntp server 10.10.0.1 prefer
ntp server 10.10.0.2
!
end

SW-ACCESS-01#show interfaces status

Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   Reception PC + pho connected    10         a-full a-1000 10/100/1000BaseTX
Gi1/0/2   AP-Lobby           connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/3   Printer 2nd floor  notconnect   10           auto   auto 10/100/1000BaseTX
Gi1/0/4   SPARE              disabled     10           auto   auto 10/100/1000BaseTX
Te1/1/1   CORE-01 Te1/0/1    connected    trunk        full    10G SFP-10GBase-SR
Te1/1/2   CORE-01 Te2/0/1    connected    trunk        full    10G SFP-10GBase-SR
Po1       Uplink to CORE-01  connected    trunk      a-full    10G

SW-ACCESS-01#show power inline

Module   Available     Used     Remaining
          (Watts)     (Watts)    (Watts)
------   ---------   --------   ---------
1           740.0       21.9       718.1
Interface Admin  Oper       Power   Device              Class Max
                            (Watts)
--------- ------ ---------- ------- ------------------- ----- ----
Gi1/0/1   auto   on         6.5     IP Phone 8841       2     30.0
Gi1/0/2   auto   on         15.4    AIR-AP2802I-B-K9    4     30.0
Gi1/0/3   off    off        0.0     n/a                 n/a   30.0
Gi1/0/4   auto   off        0.0     n/a                 n/a   30.0

SW-ACCESS-01#show cdp neighbors
Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge
                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone

Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID
CORE-01.corp.example.com
                 Ten 1/1/1         156             R S I  C9500-24Y Ten 1/0/1
CORE-01.corp.example.com
                 Ten 1/1/2         171             R S I  C9500-24Y Ten 2/0/1
AP-Lobby         Gig 1/0/2         134              R T   AIR-AP280 Gig 0

Total cdp entries displayed : 3
SW-ACCESS-01#show version
Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E7, RELEASE SOFTWARE (fc2)
SW-ACCESS-01 uptime is 41 weeks, 2 days, 3 hours, 12 minutes
cisco WS-C2960X-48FPD-L (APM86XXX) processor (revision A0) with 524288K bytes of memory.
Model number                    : WS-C2960X-48FPD-L
System serial number            : FOC1234X5YZ
`};

  S.nxos = { label: 'Cisco NX-OS', text: String.raw`!Command: show running-config
version 9.3(8) Bios:version 05.45
switchname DC-LEAF-01
feature lacp
feature interface-vlan
feature lldp
feature vpc
ip domain-name dc.example.com
ip name-server 10.20.0.53 use-vrf management
ntp server 10.20.0.1 use-vrf management
logging server 10.20.0.60
snmp-server location DC1 Row 4
spanning-tree mode mst
spanning-tree port type edge bpduguard default
vlan 1,100,200
vlan 100
  name SERVERS
vlan 200
  name STORAGE

interface Vlan100
  no shutdown
  ip address 10.100.0.2/24

interface port-channel10
  description vPC to ESX-01
  switchport mode trunk
  switchport trunk allowed vlan 100,200
  spanning-tree port type edge trunk
  vpc 10

interface Ethernet1/1
  description ESX-01 vmnic0
  switchport mode trunk
  switchport trunk allowed vlan 100,200
  channel-group 10 mode active

interface Ethernet1/2
  description Backup server
  switchport access vlan 100
  spanning-tree port type edge

interface Ethernet1/49
  description SPINE-01 Eth1/1
  no switchport
  ip address 10.255.0.1/31
  no shutdown

interface mgmt0
  vrf member management
  ip address 10.20.99.21/24
`};

  S.os9 = { label: 'Dell OS9 (S-series)', text: String.raw`S4048-TOR1#show running-config
Current Configuration ...
! Version 9.14(2.4)
! Last configuration change at Tue Mar  4 09:12:44 2025 by admin
!
hostname S4048-TOR1
!
protocol spanning-tree rstp
 no disable
 bridge-priority 8192
!
vlt domain 1
 peer-link port-channel 100
 back-up destination 10.70.99.12
!
stack-unit 1 provision S4048-ON
!
interface TenGigabitEthernet 1/1
 description ESX-01 vmnic0
 no ip address
 mtu 9216
 portmode hybrid
 switchport
 spanning-tree rstp edge-port bpduguard shutdown-on-violation
 no shutdown
!
interface TenGigabitEthernet 1/2
 description ESX-02 vmnic0
 no ip address
 switchport
 spanning-tree rstp edge-port
 no shutdown
!
interface TenGigabitEthernet 1/3
 description Backup NAS
 no ip address
 switchport
 no shutdown
!
interface TenGigabitEthernet 1/4
 no ip address
 shutdown
!
interface TenGigabitEthernet 1/47
 description to CORE-1
 no ip address
!
 port-channel-protocol LACP
  port-channel 10 mode active
 no shutdown
!
interface TenGigabitEthernet 1/48
 description to CORE-2
 no ip address
!
 port-channel-protocol LACP
  port-channel 10 mode active
 no shutdown
!
interface fortyGigE 1/49
 description VLTi
 no ip address
 no shutdown
!
interface fortyGigE 1/50
 description VLTi
 no ip address
 no shutdown
!
interface ManagementEthernet 1/1
 ip address 10.70.99.11/24
 no shutdown
!
interface Port-channel 10
 description Uplink to core
 no ip address
 switchport
 vlt-peer-lag port-channel 10
 no shutdown
!
interface Port-channel 100
 description VLTi
 no ip address
 channel-member fortyGigE 1/49-1/50
 no shutdown
!
interface Vlan 1
!
interface Vlan 10
 description Servers
 name Servers
 no ip address
 tagged TenGigabitEthernet 1/1
 tagged Port-channel 10
 untagged TenGigabitEthernet 1/2
 no shutdown
!
interface Vlan 20
 name vMotion
 no ip address
 tagged TenGigabitEthernet 1/1
 tagged Port-channel 10
 no shutdown
!
interface Vlan 30
 name Backup
 ip address 10.70.30.2/24
 tagged Port-channel 10
 untagged TenGigabitEthernet 1/3
 no shutdown
!
management route 0.0.0.0/0 10.70.99.1
!
ip domain-name dc.example.org
ip name-server 10.70.0.53
!
logging 10.70.0.60
!
snmp-server community removed ro
snmp-server contact noc@example.org
snmp-server location DC1 row B rack 4
!
ntp server 10.70.0.1
!
ip ssh server enable
!
protocol lldp
 advertise management-tlv system-name
!
line console 0
line vty 0
!
end
S4048-TOR1#show interfaces status
Port                 Description  Status Speed        Duplex Vlan
Te 1/1               ESX-01 vmnic Up     10000 Mbit   Full   1,10,20
Te 1/2               ESX-02 vmnic Up     10000 Mbit   Full   10
Te 1/3               Backup NAS   Up     1000 Mbit    Full   30
Te 1/4                            Down   Auto         Auto   --
Te 1/47              to CORE-1    Up     10000 Mbit   Full   --
Te 1/48              to CORE-2    Up     10000 Mbit   Full   --
Fo 1/49              VLTi         Up     40000 Mbit   Full   --
Fo 1/50              VLTi         Up     40000 Mbit   Full   --
S4048-TOR1#show lldp neighbors
 Loc PortID   Rem Host Name     Rem Port Id                  Rem Chassis Id
 -------------------------------------------------------------------------
 Te 1/1       esx-01            00:50:56:00:53:01            00:50:56:00:53:01
 Te 1/47      CORE-1            TenGigabitEthernet 1/10      00:00:5e:00:53:a1
 Te 1/48      CORE-2            TenGigabitEthernet 1/10      00:00:5e:00:53:a2
 Fo 1/49      S4048-TOR2        fortyGigE 1/49               00:00:5e:00:53:b1
S4048-TOR1#show version
Dell Real Time Operating System Software
Dell Operating System Version:  2.0
Dell Application Software Version:  9.14(2.4)
Copyright (c) 1999-2019 by Dell Inc. All Rights Reserved.
System image file is "system://A"
System Type: S4048-ON
`};

  S.os6 = { label: 'Dell OS6 (N-series)', text: String.raw`N2048-IDF1#show running-config
!Current Configuration:
!System Description "Dell Networking N2048P, 6.3.3.10, Linux 3.6.5-9c1bfc79"
!System Software Version 6.3.3.10
!
configure
vlan 10,20,30,99
exit
vlan 10
name "Staff"
exit
vlan 20
name "Phones"
exit
vlan 99
name "Mgmt"
exit
hostname "N2048-IDF1"
slot 1/0 6    ! Dell Networking N2048P
stack
member 1 7    ! N2048P
exit
ip default-gateway 10.95.99.1
ip domain-name "site.example.org"
ip name-server "10.95.0.53"
sntp unicast client enable
sntp server "10.95.0.1"
logging 10.95.0.60
interface vlan 99
ip address 10.95.99.14 255.255.255.0
exit
username "netadmin" password 0123456789abcdef0123456789abcdef privilege 15 encrypted
spanning-tree mode rapid-pvst
spanning-tree priority 8192
ip ssh server
!
interface Gi1/0/1
description "AP east wing"
switchport mode trunk
switchport trunk native vlan 99
switchport trunk allowed vlan 10,30,99
exit
!
interface Gi1/0/2
description "Desk 14"
spanning-tree portfast
switchport mode general
switchport general pvid 10
switchport general allowed vlan add 10
switchport general allowed vlan add 20 tagged
exit
!
interface Gi1/0/3
description "Printer"
spanning-tree portfast
switchport access vlan 10
power inline never
exit
!
interface Gi1/0/4
shutdown
exit
!
interface Te1/0/1
description "Core A"
channel-group 1 mode active
exit
!
interface Te1/0/2
description "Core B"
channel-group 1 mode active
exit
!
interface port-channel 1
description "Uplink to core"
switchport mode trunk
exit
snmp-server location "IDF 1"
snmp-server community "monitor" ro
exit

N2048-IDF1#show interfaces status

Port      Description               Duplex Speed   Neg  Link   Flow Ctrl
                                                        State  Status
--------- ------------------------- ------ ------- ---- ------ ---------
Gi1/0/1   AP east wing              Full   1000    Auto Up     Off
Gi1/0/2   Desk 14                   Full   100     Auto Up     Off
Gi1/0/3   Printer                   N/A    Unknown Auto Down   Off
Gi1/0/4                             N/A    Unknown Auto Down   Off
Te1/0/1   Core A                    Full   10000   Off  Up     Off
Te1/0/2   Core B                    Full   10000   Off  Up     Off

Port    Description                    Link    
Channel                                State   
------- ------------------------------ ------- 
Po1     Uplink to core                 Up      

N2048-IDF1#show power inline

Port      Powered Device       State    Priority Status          Class    Power[mW]
--------- -------------------- -------- -------- --------------- -------- ---------
Gi1/0/1                        Auto     Low      On              Class4   9200
Gi1/0/2                        Auto     Low      On              Class2   3100
Gi1/0/3                        Never    Low      Off             Unknown  0
Gi1/0/4                        Auto     Low      Searching       Unknown  0

N2048-IDF1#show lldp remote-device all

LLDP Remote Device Summary

Local
Interface RemID   Chassis ID          Port ID           System Name
--------- ------- ------------------- ----------------- -----------------
Gi1/0/1   3       00:00:5E:00:53:21   eth0              AP-EastWing
Gi1/0/2
Te1/0/1   1       00:00:5E:00:53:01   Te1/0/45          CORE-01

N2048-IDF1#show version

Machine Description............... Dell Networking Switch
System Model ID................... N2048P
Machine Type...................... Dell Networking N2048P
Serial Number..................... CN0000000000000001
Manufacturer...................... 0xbc00

unit active      backup      current-active next-active
---- ----------- ----------- -------------- --------------
1    6.3.3.10    6.3.2.3     6.3.3.10       6.3.3.10
`};

  S.aoscx = { label: 'Aruba AOS-CX', text: String.raw`!Version ArubaOS-CX FL.10.10.1020
hostname CX-IDF-3
ntp server 10.30.0.1 iburst
ip dns domain-name campus.example.com
ip dns server-address 10.30.0.53
logging 10.30.0.60
vlan 1
vlan 10
    name STAFF
vlan 20
    name VOICE
    voice
vlan 40
    name CCTV
spanning-tree
spanning-tree priority 8
interface mgmt
    no shutdown
    ip static 10.30.99.13/24
interface lag 1
    description Uplink to core
    no shutdown
    no routing
    vlan trunk native 1
    vlan trunk allowed 10,20,40
    lacp mode active
interface 1/1/1
    description Desk 3-101
    no shutdown
    no routing
    vlan access 10
    spanning-tree port-type admin-edge
    spanning-tree bpdu-guard
interface 1/1/2
    description Camera east door
    no shutdown
    no routing
    vlan access 40
interface 1/1/3
    no routing
    vlan access 10
interface 1/1/49
    description Core 1/1/5
    no shutdown
    lag 1
interface vlan 10
    ip address 10.30.10.3/24
ip route 0.0.0.0/0 10.30.10.1
CX-IDF-3# show interface brief
--------------------------------------------------------------------------------------------------------
Port      Native  Mode   Type           Enabled Status  Reason                  Speed    Description
          VLAN                                                                  (Mb/s)
--------------------------------------------------------------------------------------------------------
1/1/1     10      access 1GbT           yes     up                              1000     Desk 3-101
1/1/2     40      access 1GbT           yes     up                              100      Camera east door
1/1/3     10      access 1GbT           no      down    Administratively down   --       --
1/1/49    1       trunk  SFP+DA3        yes     up                              10000    Core 1/1/5
`};

  S.arubaos = { label: 'ArubaOS-Switch / HP ProCurve', text: String.raw`HP-2530-IDF1# show running-config

Running configuration:

; J9772A Configuration Editor; Created on release #YA.16.10.0012
; Ver #14:41.44.00.04.19.02.13.98.82.34.61.18.28.f3.84.9c.63.ff.37.27:05
hostname "HP-2530-IDF1"
trunk 49-50 trk1 lacp
timesync ntp
ntp unicast
ntp server 10.40.0.1 iburst
ntp enable
ip default-gateway 10.40.99.1
ip dns domain-name "office.example.com"
ip dns server-address priority 1 10.40.0.53
logging 10.40.0.60
interface 1
   name "AP Front Office"
   exit
interface 2
   name "Door controller"
   exit
interface 3
   name "Unused"
   disable
   no power-over-ethernet
   exit
snmp-server community "public" unrestricted
snmp-server location "IDF1 rack 2"
vlan 1
   name "DEFAULT_VLAN"
   no untagged 1-48
   untagged Trk1
   no ip address
   exit
vlan 10
   name "DATA"
   untagged 3-48
   tagged 1,Trk1
   ip igmp
   exit
vlan 20
   name "VOICE"
   tagged 3-24,Trk1
   voice
   exit
vlan 99
   name "MGMT"
   untagged 1-2
   tagged Trk1
   ip address 10.40.99.21 255.255.255.0
   exit
spanning-tree
spanning-tree 1-48 admin-edge-port bpdu-protection
spanning-tree Trk1 priority 4
spanning-tree priority 8
HP-2530-IDF1# show interfaces brief

 Status and Counters - Port Status

                          | Intrusion                           MDI   Flow  Bcast
  Port         Type       | Alert     Enabled Status Mode       Mode  Ctrl  Limit
  ------------ ---------- + --------- ------- ------ ---------- ----- ----- ------
  1            100/1000T  | No        Yes     Up     1000FDx    MDIX  off   0
  2            100/1000T  | No        Yes     Up     100FDx     MDI   off   0
  3            100/1000T  | No        No      Down   1000FDx    Auto  off   0
  4            100/1000T  | No        Yes     Down   1000FDx    Auto  off   0
  49-Trk1      SFP+SR     | No        Yes     Up     10GigFD    NA    off   0

HP-2530-IDF1# show power-over-ethernet brief

 Status and Counters - Port Power Status

  Available: 370 W  Used: 12 W  Remaining: 358 W

  PoE    | Power  Power    Alloc Alloc Actual Configured  Detection   Power Pre-std
  Port   | Enable Priority By    Power Power  Type        Status      Class Detect
  ------ + ------ -------- ----- ----- ------ ----------- ----------- ----- ------
  1      | Yes    low      usage 17 W  9.8 W              Delivering  4     off
  2      | Yes    low      usage 17 W  2.1 W              Delivering  2     off
  3      | No     low      usage 17 W  0.0 W              Disabled    0     off
  4      | Yes    low      usage 17 W  0.0 W              Searching   0     off
`};

  S.icx = { label: 'Ruckus ICX (FastIron)', text: String.raw`SSH@ICX-OFFICE-1#show running-config
Current configuration:
!
ver 08.0.95hT213
!
stack unit 1
  module 1 icx7150-48p-poe-port-management-module
  module 2 icx7150-2-copper-port-2g-module
  module 3 icx7150-4-sfp-plus-port-40g-module
!
lag UPLINK dynamic id 1
 ports ethe 1/3/1 to 1/3/2
!
vlan 1 name DEFAULT-VLAN by port
 spanning-tree 802-1w
!
vlan 10 name DATA by port
 tagged ethe 1/1/1 lag 1
 untagged ethe 1/1/2 to 1/1/24
 router-interface ve 10
 spanning-tree 802-1w
 spanning-tree 802-1w priority 4096
 multicast passive
!
vlan 20 name VOICE by port
 tagged ethe 1/1/2 to 1/1/12 lag 1
 spanning-tree 802-1w
!
vlan 99 name MGMT by port
 tagged lag 1
 untagged ethe 1/1/1
 spanning-tree 802-1w
!
aaa authentication login default local
hostname ICX-OFFICE-1
ip dns domain-list office.example.com
ip dns server-address 10.80.0.53 10.80.0.54
ip route 0.0.0.0/0 10.80.10.1
logging host 10.80.0.60
no telnet server
username admin password .....
snmp-server community ..... ro
snmp-server location Office comms cupboard
!
ntp
 server 10.80.0.1
!
web-management https
!
interface ethernet 1/1/1
 port-name AP Reception
 inline power
!
interface ethernet 1/1/2
 port-name Desk 12 phone+PC
 voice-vlan 20
 inline power
 spanning-tree 802-1w admin-edge-port
 stp-bpdu-guard
!
interface ethernet 1/1/3
 port-name Spare
 disable
!
interface ethernet 1/3/1
 port-name Core uplink A
!
interface lag 1
 port-name Uplink to core
!
interface ve 10
 ip address 10.80.10.2 255.255.255.0
!
end

SSH@ICX-OFFICE-1#show interfaces brief

Port       Link    State   Dupl Speed Trunk Tag Pvid Pri MAC             Name
1/1/1      Up      Forward Full 1G    None  Yes 99   0   0000.5e00.5301  AP Reception
1/1/2      Up      Forward Full 1G    None  Yes 10   0   0000.5e00.5302  Desk 12 phone+
1/1/3      Disable None    None None  None  No  10   0   0000.5e00.5303  Spare
1/1/4      Down    None    None None  None  No  10   0   0000.5e00.5304
1/3/1      Up      Forward Full 10G   1     Yes N/A  0   0000.5e00.5331  Core uplink A
1/3/2      Up      Forward Full 10G   1     Yes N/A  0   0000.5e00.5331
mgmt1      Down    None    None None  None  No  None 0   0000.5e00.5300
ve10       Up      N/A     N/A  N/A   None  N/A N/A  N/A 0000.5e00.5300
lg1        Up      Forward Full 20G   1     Yes N/A  0   0000.5e00.5331  Uplink to core

SSH@ICX-OFFICE-1#show inline power

Power Capacity:         Total is 370000 mWatts. Current Free is 345000 mWatts.

Power Allocations:      Requests Honored 4 times

 Port   Admin   Oper    ---Power(mWatts)---  PD Type  PD Class  Pri  Fault/
        State   State   Consumed  Allocated                           Error
--------------------------------------------------------------------------
 1/1/1  On      On          9800      25500  802.3at  Class 4     3  n/a
 1/1/2  On      On          3400      15400  802.3af  Class 2     3  n/a
 1/1/3  Off     Off            0          0  n/a      n/a         3  n/a
 1/1/4  Off     Off            0          0  n/a      n/a         3  n/a

SSH@ICX-OFFICE-1#show lldp neighbors detail
Local port: 1/1/1
  Neighbor: 0000.5e00.53aa, TTL 101 seconds
    + Chassis ID (MAC address): 0000.5e00.53aa
    + Port ID (MAC address): 0000.5e00.53ab
    + Time to live: 120 seconds
    + System name         : "AP-Reception"
    + Port description    : "eth0"
    + Management address (IPv4): 10.80.99.21

Local port: 1/3/1
  Neighbor: 0000.5e00.53c0, TTL 115 seconds
    + Chassis ID (MAC address): 0000.5e00.53c0
    + Port ID (interface name): TenGigabitEthernet1/0/47
    + Time to live: 120 seconds
    + System name         : "CORE-01"
    + Port description    : "ICX-OFFICE-1 uplink A"
    + Management address (IPv4): 10.80.0.2
`};

  S.comware = { label: 'HPE Comware / H3C', text: String.raw`<CW-STACK-1>display current-configuration
#
 version 7.1.070, Release 6126P20
#
 sysname CW-STACK-1
#
 igmp-snooping
#
 dns server 10.50.0.53
 dns domain branch.example.com
#
 stp mode rstp
 stp instance 0 priority 4096
 stp bpdu-protection
 stp global enable
#
vlan 1
#
vlan 10
 name OFFICE
 igmp-snooping enable
#
vlan 20
 name PHONES
#
vlan 99
 name MGMT
#
interface Bridge-Aggregation1
 description To-Core
 port link-type trunk
 port trunk permit vlan 1 10 20 99
#
interface Vlan-interface99
 ip address 10.50.99.5 255.255.255.0
#
interface GigabitEthernet1/0/1
 description Desk-A1
 port access vlan 10
 stp edged-port
 poe enable
#
interface GigabitEthernet1/0/2
 description Phone+PC
 port link-type hybrid
 port hybrid vlan 20 tagged
 port hybrid vlan 10 untagged
 port hybrid pvid vlan 10
 voice-vlan 20 enable
 stp edged-port
 poe enable
#
interface GigabitEthernet1/0/3
 shutdown
#
interface Ten-GigabitEthernet1/0/49
 description Core-Te1
 port link-type trunk
 port trunk permit vlan 1 10 20 99
 port link-aggregation group 1
#
 ip route-static 0.0.0.0 0 10.50.99.1
#
 info-center loghost 10.50.0.60
#
 snmp-agent sys-info location Branch comms room
 snmp-agent sys-info version v2c v3
#
 ntp-service unicast-server 10.50.0.1
#
return
<CW-STACK-1>display interface brief
Brief information on interfaces in bridge mode:
Link: ADM - administratively down; Stby - standby
Speed: (a) - auto
Duplex: (a)/A - auto; H - half; F - full
Type: A - access; T - trunk; H - hybrid
Interface            Link Speed   Duplex Type PVID Description
BAGG1                UP   10G(a)  F(a)   T    1    To-Core
GE1/0/1              UP   1G(a)   F(a)   A    10   Desk-A1
GE1/0/2              DOWN auto    A      H    10   Phone+PC
GE1/0/3              ADM  auto    A      A    1
XGE1/0/49            UP   10G     F      T    1    Core-Te1
`};

  S.junos = { label: 'Juniper Junos (display set)', text: String.raw`admin@EX-FLOOR2> show configuration | display set
set version 21.4R3-S5.4
set system host-name EX-FLOOR2
set system domain-name campus.example.org
set system name-server 10.60.0.53
set system name-server 10.60.0.54
set system ntp server 10.60.0.1 prefer
set system syslog host 10.60.0.60 any notice
set system services ssh
set snmp location "Floor 2 IDF"
set snmp community monitor authorization read-only
set interfaces interface-range DESKS member-range ge-0/0/2 to ge-0/0/5
set interfaces interface-range DESKS unit 0 family ethernet-switching interface-mode access
set interfaces interface-range DESKS unit 0 family ethernet-switching vlan members STAFF
set interfaces ge-0/0/0 description "AP-F2-North"
set interfaces ge-0/0/0 native-vlan-id 99
set interfaces ge-0/0/0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members WIFI
set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members MGMT
set interfaces ge-0/0/1 description "Meeting room panel"
set interfaces ge-0/0/1 disable
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode access
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members STAFF
set interfaces xe-0/1/0 description "DIST-1 xe-0/0/10"
set interfaces xe-0/1/0 ether-options 802.3ad ae0
set interfaces ae0 description "Uplink to DIST"
set interfaces ae0 aggregated-ether-options lacp active
set interfaces ae0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ae0 unit 0 family ethernet-switching vlan members all
set interfaces irb unit 99 family inet address 10.60.99.12/24
set vlans STAFF vlan-id 10
set vlans VOICE vlan-id 20
set vlans WIFI vlan-id 30
set vlans MGMT vlan-id 99
set vlans MGMT l3-interface irb.99
set switch-options voip interface ge-0/0/2.0 vlan VOICE
set routing-options static route 0.0.0.0/0 next-hop 10.60.99.1
set protocols rstp bridge-priority 32k
set protocols rstp interface ge-0/0/1 edge
set protocols rstp interface ge-0/0/2 edge
set protocols rstp bpdu-block-on-edge
set protocols igmp-snooping vlan STAFF
set protocols lldp interface all
set poe interface all

admin@EX-FLOOR2> show interfaces terse
Interface               Admin Link Proto    Local                 Remote
ge-0/0/0                up    up
ge-0/0/0.0              up    up   eth-switch
ge-0/0/1                down  down
ge-0/0/2                up    up
ge-0/0/3                up    down
xe-0/1/0                up    up
ae0                     up    up
irb.99                  up    up   inet     10.60.99.12/24

admin@EX-FLOOR2> show lldp neighbors
Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/0/0           -                   a8:bd:27:11:22:33   eth0               AP-F2-North
xe-0/1/0           ae0                 44:f4:77:aa:bb:cc   xe-0/0/10          DIST-1
`};

  S.fortigate = { label: 'Fortinet FortiGate', text: String.raw`#config-version=FGT60F-7.2.8-FW-build1639-240313:opmode=0:vdom=0:user=admin
config system global
    set hostname "FW-BRANCH-01"
    set timezone 12
    set admin-sport 8443
end
config system interface
    edit "wan1"
        set vdom "root"
        set mode dhcp
        set allowaccess ping
        set type physical
        set alias "ISP fibre"
        set role wan
    next
    edit "wan2"
        set vdom "root"
        set status down
        set type physical
        set role wan
    next
    edit "internal1"
        set vdom "root"
        set ip 192.168.10.1 255.255.255.0
        set allowaccess ping https ssh
        set type physical
        set alias "LAN switch"
        set role lan
    next
    edit "guest"
        set vdom "root"
        set ip 192.168.50.1 255.255.255.0
        set allowaccess ping
        set alias "Guest WiFi"
        set role lan
        set interface "internal1"
        set vlanid 50
    next
end
config system dns
    set primary 1.1.1.1
    set secondary 9.9.9.9
    set domain "branch.example.net"
end
config system ntp
    set ntpsync enable
    set type custom
    config ntpserver
        edit 1
            set server "time.example.net"
        next
    end
end
config log syslogd setting
    set status enable
    set server "192.168.10.60"
end
config system zone
    edit "LAN"
        set interface "internal1" "guest"
    next
end
config router static
    edit 1
        set gateway 203.0.113.1
        set device "wan1"
    next
end
config system interface
    edit "fortilink"
        set vdom "root"
        set fortilink enable
        set ip 10.255.1.1 255.255.255.0
        set type aggregate
        set member "a" "b"
    next
    edit "staff"
        set vdom "root"
        set ip 10.20.10.1 255.255.255.0
        set interface "fortilink"
        set vlanid 10
    next
    edit "voice"
        set vdom "root"
        set ip 10.20.20.1 255.255.255.0
        set interface "fortilink"
        set vlanid 20
    next
    edit "cameras"
        set vdom "root"
        set ip 10.20.40.1 255.255.255.0
        set interface "fortilink"
        set vlanid 40
    next
end
config switch-controller managed-switch
    edit "S124FPTF00000001"
        set name "IDF1-SW1"
        set sn "S124FPTF00000001"
        set fsw-wan1-peer "fortilink"
        set fsw-wan1-admin enable
        set switch-profile "default"
        config ports
            edit "port1"
                set description "Front desk phone+PC"
                set poe-capable 1
                set vlan "staff"
                set allowed-vlans "voice"
                set stp-bpdu-guard enabled
            next
            edit "port2"
                set description "Camera car park"
                set poe-capable 1
                set vlan "cameras"
            next
            edit "port3"
                set poe-capable 1
                set vlan "staff"
                set status down
                set poe-status disable
            next
            edit "port4"
                set description "AP hallway"
                set poe-capable 1
                set vlan "staff"
                set allowed-vlans-all enable
            next
            edit "port23"
                set fortilink-port 1
            next
            edit "port24"
                set fortilink-port 1
            next
            edit "_FlInK1_MLAG0_"
                set type trunk
                set mode lacp-active
                set members "port23" "port24"
                set isl-peer-device-name "FW-BRANCH-01"
            next
        end
    next
    edit "S108EF0000000002"
        set name "IDF1-SW2"
        config ports
            edit "port1"
                set vlan "cameras"
            next
        end
    next
end
`};

  S.fortiswitch = { label: 'Fortinet FortiSwitch', text: String.raw`FS-IDF-2 # show
#config-version=FS124F-7.4.3-FW-build0830-240314:opmode=0:vdom=0:user=admin
config system global
    set hostname "FS-IDF-2"
    set timezone 12
end
config system interface
    edit "mgmt"
        set ip 10.90.99.22 255.255.255.0
        set allowaccess ping https ssh
        set type physical
    next
    edit "internal"
        set ip 10.90.10.22 255.255.255.0
        set allowaccess ping https ssh
        set type physical
    next
end
config system dns
    set primary 10.90.0.53
    set secondary 10.90.0.54
    set domain "site.example.net"
end
config system ntp
    config ntpserver
        edit 1
            set server "10.90.0.1"
        next
    end
    set ntpsync enable
end
config log syslogd setting
    set status enable
    set server "10.90.0.60"
end
config router static
    edit 1
        set device "mgmt"
        set gateway 10.90.99.1
    next
end
config switch vlan
    edit 10
        set description "STAFF"
        set igmp-snooping enable
    next
    edit 20
        set description "VOICE"
    next
    edit 99
        set description "MGMT"
    next
end
config switch physical-port
    edit "port1"
        set description "AP corridor"
        set poe-status enable
    next
    edit "port2"
        set description "Unused"
        set status down
    next
    edit "port23"
        set description "Core A"
    next
    edit "port24"
        set description "Core B"
    next
end
config switch trunk
    edit "uplink"
        set mode lacp-active
        set members "port23" "port24"
    next
end
config switch interface
    edit "port1"
        set native-vlan 99
        set allowed-vlans 10,20
        set snmp-index 1
    next
    edit "port2"
        set native-vlan 10
        set stp-bpdu-guard enabled
        set snmp-index 2
    next
    edit "port3"
        set native-vlan 10
        set allowed-vlans 20
        set edge-port enabled
        set snmp-index 3
    next
    edit "port23"
        set snmp-index 23
    next
    edit "port24"
        set snmp-index 24
    next
    edit "uplink"
        set native-vlan 99
        set allowed-vlans 1-4094
        set snmp-index 30
    next
    edit "internal"
        set native-vlan 10
        set stp-state disabled
        set snmp-index 29
    next
end
config switch stp settings
    set name "CAMPUS"
    set revision 2
end
config switch stp instance
    edit "0"
        set priority 24576
    next
end

FS-IDF-2 # get system status
Version: FortiSwitch-124F v7.4.3,build0830,240314 (GA)
Serial-Number: S124FT0000000000
Hostname: FS-IDF-2

FS-IDF-2 # diagnose switch physical-ports summary

  Portname    Status  Tpid  Vlan  Duplex  Speed  Flags         Discard
  __________  ______  ____  ____  ______  _____  ____________  _________

  port1       up      8100  99    full    1G      QS,  ,       none
  port2       down    8100  10    full    1G      QS,  ,       none
  port3       up      8100  10    full    100M    QS,  ,       none
  port23      up      8100  1     full    10G     QS,TS,       none
  port24      up      8100  1     full    10G     QS,TS,       none
  internal    up      8100  10    full    1G        ,  ,       none

FS-IDF-2 # get switch lldp neighbors-summary

Capability codes:
        R:Router, B:Bridge, T:Telephone, C:DOCSIS Cable Device
        W:WLAN Access Point, P:Repeater, S:Station, O:Other
MED type codes:
        Generic:Generic Endpoint (Class 1), Media:Media Endpoint (Class 2)

  Portname    Status  Device-name          TTL   Capability  MED-type  Port-ID
  __________  _______  ___________________  ____  __________  ________  __________
  port1       Up      AP-Corridor          120   BW          -         eth0
  port2       Down    -                    -     -           -         -
  port23      Up      CORE-01              120   BR          -         Te1/0/45
`};

  S.mikrotik = { label: 'MikroTik RouterOS (/export)', text: String.raw`# 2025-03-02 10:11:12 by RouterOS 7.14.2
# software id = ABCD-1234
#
# model = CRS328-24P-4S+
# serial number = HF1234ABCDE
/interface bridge
add igmp-snooping=yes name=bridge1 priority=0x4000 protocol-mode=rstp \
    vlan-filtering=yes
/interface ethernet
set [ find default-name=ether1 ] comment="AP workshop" poe-out=auto-on
set [ find default-name=ether2 ] comment="Spare" disabled=yes poe-out=off
set [ find default-name=sfp-sfpplus1 ] comment="Uplink core"
/interface vlan
add interface=bridge1 name=vlan99-mgmt vlan-id=99
/interface bridge port
add bridge=bridge1 interface=ether1 pvid=99
add bridge=bridge1 edge=yes frame-types=admit-only-untagged-and-priority-tagged \
    interface=ether2 pvid=10
add bridge=bridge1 edge=yes interface=ether3 pvid=10
add bridge=bridge1 interface=sfp-sfpplus1
/interface bridge vlan
add bridge=bridge1 tagged=bridge1,sfp-sfpplus1 untagged=ether2,ether3 vlan-ids=10
add bridge=bridge1 tagged=sfp-sfpplus1,ether1 vlan-ids=30
add bridge=bridge1 tagged=bridge1,sfp-sfpplus1 untagged=ether1 vlan-ids=99
/ip address
add address=10.70.99.5/24 interface=vlan99-mgmt network=10.70.99.0
/ip dns
set servers=10.70.0.53,1.1.1.1
/ip route
add gateway=10.70.99.1
/system identity
set name=MT-WORKSHOP
/system ntp client
set enabled=yes
/system ntp client servers
add address=10.70.0.1
/snmp
set enabled=yes location="Workshop cabinet"
`};
})(typeof globalThis !== 'undefined' ? globalThis : this);
