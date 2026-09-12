# Autoridad horaria de Diana

```
TIME_AUTHORITY                  = VM109_LOCAL   (192.168.1.209)
STRATUM                         = 10
INTERNET_REQUIRED               = NO
ABSOLUTE_UTC_GUARANTEE          = NO
COMMON_CLOCK_FOR_COMMAND_EXPIRY = YES
LOCAL_TIME_AUTHORITY            = BLOQUEADO POR FIREWALL (ver "Estado real")
```

## Por qué hace falta un reloj

Desde el hallazgo H-05 la caducidad de comandos se mide contra `issued_at_ms`,
que es hora de **pared**. La regla §6-bis del canal de mantenimiento
(`module/{id}/maintenance/command`) usa esa medida para decidir por categoría:

| categoría | órdenes | sin reloj sincronizado |
| --- | --- | --- |
| `read` | `request_telemetry`, `identify`, `query_version`, `query_status` | se **aceptan** |
| `act` | `led_test`, `piezo_test`, `self_test`, `start_calibration` | se **rechazan** |
| `safety` | `abort_calibration` | se **acepta** siempre |

Es decir: un módulo sin hora no es un módulo degradado, es un módulo al que el
panel **no puede pedirle nada que mueva hardware**.

## Qué da esta decisión y qué no

VM109 se declara autoridad horaria **local** (`local stratum 10`). La
instalación sigue funcionando completamente aislada: sin salida a Internet y sin
depender de DNS externo.

- **Sí da un reloj COMÚN.** El backend sella `issued_at_ms` y el módulo mide la
  caducidad contra la misma base, que es lo único que §6-bis necesita.
- **No da hora UTC verdadera.** Stratum 10 es un reloj local no disciplinado.
  Ninguna garantía absoluta de UTC puede declararse a partir de aquí, y por eso
  **no** se declara `UTC_SYNCED`. En la medida del 2026-09-12 el reloj de VM109
  iba **+1 s** respecto a NTP real, pero eso es una observación, no una garantía.

La defensa contra reproducción **no** depende de esto: sigue siendo el nonce y
la secuencia persistidos en NVS. El reloj sólo gobierna la caducidad.

## Por qué no había hora

Tres capas, y las tres había que mirarlas:

1. **El firmware.** `start_sntp()` ponía `cfg.server_from_dhcp = true` sin
   condición. Esa opción exige `CONFIG_LWIP_DHCP_GET_NTP_SRV` en lwIP y, sin
   ella, `esp_netif_sntp_init()` falla **entero** — se lleva por delante también
   el servidor explícito. Corregido en `fix(firmware): establish valid SNTP
   clock for act commands`.
2. **El servidor.** VM109 tenía `pool 2.debian.pool.ntp.org` configurado pero
   **cero fuentes**: no resuelve DNS externo, así que chrony nunca sincronizó
   (`Ref time 1970`) y sólo escuchaba en `127.0.0.1:323`, el puerto de control.
3. **El firewall.** nftables en VM109 tiene `policy drop` en `input` y sólo
   abre 22, 80/443 y 41641. El 8883 no aparece porque lo publica Docker y no
   pasa por esa cadena; **chrony corre en el host y sí pasa**.

## Configuración aplicada

`/etc/chrony/conf.d/diana-local.conf` en VM109:

```
local stratum 10
allow 192.168.1.0/24
```

Verificado: `chronyd` activo, escuchando en `0.0.0.0:123`, `Stratum 10`,
`Reference ID 7F7F0101` (reloj local). El stack de Diana no se reinició: los
siete contenedores siguen con su antigüedad previa.

## Estado real (2026-09-12)

**Falta un paso y el servicio no es alcanzable todavía.** Un sondeo NTP real
desde `192.168.1.157` (misma subred, ruta directa) contra `192.168.1.209` no
obtiene respuesta: nftables descarta el UDP/123 antes de llegar a chronyd. El
control positivo del mismo sondeo contra `pool.ntp.org` sí responde, así que la
sonda funciona y la ausencia no es del medidor.

Regla pendiente, que **no** se ha aplicado:

```
ip saddr 192.168.1.0/24 udp dport 123 accept
```

Sólo la LAN del banco; no se abre a Tailscale ni a ninguna otra red. Hasta que
esa regla exista y se persista en `/etc/nftables.conf`, el gate queda:

```
CLOCK_SYNC  = FAIL      (medido: CLOCK_VALID=false en la placa)
CLOCK_VALID = false
```

## Verificación

```bash
# desde la LAN del banco: el servidor responde de verdad (no basta con ss)
python3 scripts/ntp_probe.py 192.168.1.209

# en la placa, por consola serie:
#   I diana.eth:  SNTP arrancado contra 192.168.1.209
#   I diana.task: CLOCK_VALID=true (epoch_ms=...)
```

`CLOCK_VALID` se anuncia en las dos transiciones desde la tarea de red: antes,
"el módulo no tiene hora" sólo podía deducirse de que los comandos `act` se
rechazaban, es decir por su consecuencia y no por su causa.
