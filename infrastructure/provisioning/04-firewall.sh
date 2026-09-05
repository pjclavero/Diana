#!/bin/bash
# Firewall nftables para VM 109 (diana-server). Idempotente (flush + reaplica).
# Filtra sólo INPUT del host; no toca FORWARD/NAT, que gestiona Docker vía
# iptables-nft y no se debe interferir para no romper las redes de contenedores.
#
# Reglas:
#   - SSH (22): sólo LAN (192.168.1.0/24) y Tailscale (100.64.0.0/10).
#   - HTTP/HTTPS (80/443): LAN y Tailscale.
#   - MQTT sobre TLS (8883): sólo LAN. Camino recomendado.
#   - MQTT en claro (1883): sólo LAN, PERFIL DE TRANSICIÓN. Sigue abierto
#     únicamente porque el firmware vigente lo lleva cableado; se retira con el
#     paso 16 del porte P0-2, atado a la decisión D1 del operador.
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

        # MQTT sobre TLS: solo LAN. Es el camino recomendado y el que usa el
        # backend.
        #
        # NOTA IMPORTANTE, y contraintuitiva: los puertos que publica Docker NO
        # pasan por esta cadena input --- van por la cadena forward de Docker ---
        # asi que estas reglas NO son las que permiten hoy llegar al broker.
        # Se mantienen coherentes con la realidad para que el fichero no mienta
        # y para no dejar un agujero latente el dia que algo se ate al puerto
        # del host directamente.
        ip saddr 192.168.1.0/24 tcp dport 8883 accept
        # MQTT EN CLARO: PERFIL DE TRANSICION. Se retira junto con el listener
        # 1883 de mosquitto.conf y su publicacion en compose.yml (paso 16 del
        # porte, decision D1). No retirar esta linea por separado: dejaria a los
        # modulos fisicos fuera sin cerrar nada, porque el puerto seguiria
        # publicado por Docker.
        ip saddr 192.168.1.0/24 tcp dport 1883 accept

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
