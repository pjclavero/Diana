# Evidencia · VM 192.168.1.209 (solo lectura, 2026-07-20T23:34:01+02:00)

## ss -tulpn / nft list ruleset / docker ps
```
$ docker ps
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES

$ ss -tulpn
Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess
udp   UNCONN 0      0         127.0.0.54:53         0.0.0.0:*          
udp   UNCONN 0      0      127.0.0.53%lo:53         0.0.0.0:*          
udp   UNCONN 0      0          127.0.0.1:323        0.0.0.0:*          
udp   UNCONN 0      0            0.0.0.0:41641      0.0.0.0:*          
udp   UNCONN 0      0            0.0.0.0:5355       0.0.0.0:*          
udp   UNCONN 0      0              [::1]:323           [::]:*          
udp   UNCONN 0      0               [::]:41641         [::]:*          
udp   UNCONN 0      0               [::]:5355          [::]:*          
tcp   LISTEN 0      4096      127.0.0.54:53         0.0.0.0:*          
tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*          
tcp   LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*          
tcp   LISTEN 0      4096         0.0.0.0:5355       0.0.0.0:*          
tcp   LISTEN 0      128             [::]:22            [::]:*          
tcp   LISTEN 0      4096            [::]:5355          [::]:*          

$ sudo nft list ruleset
table inet filter {
	chain input {
		type filter hook input priority filter; policy drop;
		iif "lo" accept
		ct state established,related accept
		ct state invalid drop
		icmp type { destination-unreachable, echo-request, time-exceeded } accept
		icmpv6 type { destination-unreachable, time-exceeded, echo-request, nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert } accept
		ip saddr 192.168.1.0/24 tcp dport 22 accept
		ip saddr 100.64.0.0/10 tcp dport 22 accept
		ip saddr 192.168.1.0/24 tcp dport { 80, 443 } accept
		ip saddr 100.64.0.0/10 tcp dport { 80, 443 } accept
		ip saddr 192.168.1.0/24 tcp dport 1883 accept
		udp dport 41641 accept
		counter packets 1500 bytes 298237
	}

	chain forward {
		type filter hook forward priority filter; policy accept;
	}

	chain output {
		type filter hook output priority filter; policy accept;
	}
}
table ip filter {
	chain DOCKER {
# Warning: table ip filter is managed by iptables-nft, do not touch!
		iifname != "docker0" oifname "docker0" counter packets 0 bytes 0 drop
	}

	chain DOCKER-FORWARD {
		counter packets 42116 bytes 69008985 jump DOCKER-CT
		counter packets 14475 bytes 898601 jump DOCKER-INTERNAL
		counter packets 14475 bytes 898601 jump DOCKER-BRIDGE
		iifname "docker0" counter packets 14475 bytes 898601 accept
	}

	chain DOCKER-BRIDGE {
		oifname "docker0" counter packets 0 bytes 0 jump DOCKER
	}

	chain DOCKER-CT {
		oifname "docker0" ct state related,established counter packets 27641 bytes 68110384 accept
	}

	chain DOCKER-INTERNAL {
	}

```

## sudoers / sshd / cuentas
```
$ id
uid=1000(diana-admin) gid=1000(diana-admin) groups=1000(diana-admin),27(sudo),994(docker)
$ sudo cat /etc/sudoers.d/90-diana-admin
diana-admin ALL=(ALL) NOPASSWD:ALL
$ sudo passwd -S diana-admin ; sudo passwd -S root
diana-admin L 2026-07-20 0 99999 7 -1
root L 2026-06-15 0 99999 7 -1
$ sudo sshd -T | grep auth
logingracetime 120
maxauthtries 6
permitrootlogin no
pubkeyauthentication yes
passwordauthentication no
kbdinteractiveauthentication no
permitemptypasswords no
$ wc -l authorized_keys
1 /home/diana-admin/.ssh/authorized_keys
$ systemctl is-active fail2ban unattended-upgrades
inactive
active
```

## /opt/diana/.env — SOLO nombres de variable y longitudes, nunca valores
```
NODE_ENV=production
POSTGRES_PASSWORD len=43
MQTT_BACKEND_PASSWORD len=32
BACKEND_SESSION_SECRET len=43
BACKEND_CORS_ORIGIN=http://192.168.1.209:8080
-- JWT_SECRET presente?
0
```
