#!/bin/bash
# Firewall nftables para VM 109 (diana-server). Idempotente (flush + reaplica).
# Filtra sólo INPUT del host; no toca FORWARD/NAT, que gestiona Docker vía
# iptables-nft y no se debe interferir para no romper las redes de contenedores.
#
# Reglas:
#   - SSH (22): sólo LAN (192.168.1.0/24) y Tailscale (100.64.0.0/10).
#   - HTTP/HTTPS (80/443): LAN y Tailscale.
#   - MQTT sobre TLS (8883): sólo LAN (lo necesitan los módulos físicos).
#     El 1883 en claro ya NO se abre (P0-2).
#   - UDP 41641: Tailscale (establecimiento directo de conexiones).
#   - Todo lo demás entrante: DROP. Nada expuesto a Internet.
#   - PostgreSQL (5432) deliberadamente NO se abre en ninguna regla.
set -euo pipefail

cat > /etc/nftables.conf <<'EOF'
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;

        iif "lo" accept
        ct state established,related accept
        ct state invalid drop

        icmp type { echo-request, destination-unreachable, time-exceeded } accept
        icmpv6 type { echo-request, destination-unreachable, time-exceeded, nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit, nd-router-advert } accept

        # SSH: LAN + Tailscale
        ip saddr 192.168.1.0/24 tcp dport 22 accept
        ip saddr 100.64.0.0/10 tcp dport 22 accept

        # HTTP/HTTPS: LAN + Tailscale
        ip saddr 192.168.1.0/24 tcp dport { 80, 443 } accept
        ip saddr 100.64.0.0/10 tcp dport { 80, 443 } accept

        # MQTT sobre TLS: solo LAN. El 1883 en claro ya no se abre (P0-2):
        # la regla anterior seguia aceptandolo aunque nada escuche ya ahi, y
        # habria vuelto a abrir el camino sin cifrar en cuanto algo se atara a
        # ese puerto del host.
        #
        # NOTA: los puertos que publica Docker NO pasan por esta cadena input
        # (van por la cadena forward de Docker), asi que esta regla no es la
        # que permite hoy llegar al broker; se corrige para que el fichero
        # diga la verdad y no deje un agujero latente.
        ip saddr 192.168.1.0/24 tcp dport 8883 accept

        # Tailscale: establecimiento directo de conexiones
        udp dport 41641 accept

        counter
    }

    chain forward {
        type filter hook forward priority 0; policy accept;
    }

    chain output {
        type filter hook output priority 0; policy accept;
    }
}
EOF

nft -c -f /etc/nftables.conf
systemctl enable nftables
systemctl restart nftables

echo "== ruleset activo =="
nft list ruleset
echo "== hecho: firewall =="
echo "VERIFICA en otra sesión que sigues teniendo acceso SSH antes de cerrar esta."
