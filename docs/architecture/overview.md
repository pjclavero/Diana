# Arquitectura de Diana

Documento del organizador. Consolida lo que el dosier fija y lo que los ADR deciden.
Detalle por área en `docs/firmware/`, `docs/api/`, `docs/mqtt/`, `docs/hardware/`.

## 1. Vista general

```
  ┌─────────┐  ┌─────────┐        ┌─────────┐
  │ Módulo 1│  │ Módulo 2│  ...   │ Módulo 9│   ESP32-S3 + W5500
  │PRINCIPAL│  │SATÉLITE │        │SATÉLITE │   9 dianas · 216 LED/módulo
  └────┬────┘  └────┬────┘        └────┬────┘
       └────────────┴──────┬───────────┘
                    Switch Ethernet (estrella)
                           │
                  ┌────────▼────────┐
                  │  VM 109 Debian  │  192.168.1.209
                  │  Docker Compose │
                  └────────┬────────┘
       ┌─────────┬─────────┼─────────┬──────────┐
    proxy     frontend  backend   worker    mosquitto
                           │                    │
                      postgres ◄────────────────┘
```

## 2. Tres autoridades separadas

Es la decisión estructural del proyecto y de ella dependen casi todas las demás.

| Autoridad | Quién | Sobre qué |
|---|---|---|
| Temporal | ESP32 que detecta | Instante del impacto (T1) |
| De partida | Módulo principal | Inicio, secuencia, validación, tiempo de juego (T2), duplicados |
| Administrativa | Servidor | Crear partidas, usuarios, reglas, persistencia, visualización |

El servidor **no** es la fuente temporal. Latencia de red, MQTT, Docker o base de datos no
pueden alterar un resultado. Ver [ADR-0002](../adr/0002-modelo-temporal.md).

## 3. Flujo de un impacto

```
proyectil → superficie aislada → piezo → protección → comparador
   → interrupción en el ESP32     (T1: device.event_us)
   → antirrebote + ventana de agrupación + comparación con vecinos
   → clasificación (valid_hit | crosstalk_rejected | …)
   → cambio de LED local (respuesta inmediata, no espera al servidor)
   → evento con event_id, boot_id, local_sequence → cola local
   → MQTT QoS 1 → coordinador  (T2: coordinator.elapsed_us)
   → MQTT → backend: valida esquema, deduplica por event_id  (T3: received_at)
   → PostgreSQL  (T4: persisted_at)
   → WebSocket → panel
```

Si falla la red, el evento espera en la cola local del módulo y se reenvía con
`replay: true`. El tiempo capturado no se pierde ni se recalcula.

## 4. Degradación

| Falla | Comportamiento |
|---|---|
| Backend | Los módulos terminan la ronda si conservan coordinación; encolan y reenvían |
| MQTT | Cola local, reintento exponencial, estado de degradación visible; no se inicia partida nueva sin canal |
| PostgreSQL | Backend en modo degradado, no se inician partidas, se alerta; no se acumulan eventos en memoria sin límite |
| Un satélite | Señaliza el error, no inventa órdenes, reintenta |
| El principal | La ronda se pausa o termina de forma segura; **no** se elige otro principal en silencio a mitad de ronda |
| Reinicio del servidor | Healthchecks, políticas de reinicio, migraciones idempotentes |

## 5. Topología

Cada módulo tiene coordenada `(x, y)` en la matriz 3×3 y rotación de 0/90/180/270°. El
servidor traduce (coordenada local 1..9 + posición + rotación) a coordenada global de la
matriz 9×9. Un módulo se sustituye conservando la posición. Dos módulos en la misma
posición, o dos con el selector en PRINCIPAL, son conflictos que bloquean el inicio de
partida (`system-status.conflicts`).

## 6. Frontera entre firmware y servidor

Lo que decide el **módulo**, en tiempo real y sin red: detección, antirrebote,
clasificación de crosstalk, cambio de LED, marca temporal, encolado.

Lo que decide el **coordinador**: cuándo empieza y termina la ronda, qué diana se activa,
si un impacto cuenta, el tiempo de juego, y la resolución de duplicados entre módulos.

Lo que decide el **servidor**: quién juega, con qué reglas, qué se guarda, qué se muestra,
qué se exporta y quién tiene permiso.

La frontera es `contracts/`. Firmware, backend y simulador derivan de ahí; ninguno copia
definiciones a mano. Un cambio incompatible exige `v2` y un ADR.

## 7. Seguridad estructural

- MQTT sin anónimo, una credencial por módulo, ACL por tópico.
- El backend es el único que escribe en `system/#` y en `…/config/desired`.
- PostgreSQL nunca se publica fuera del stack.
- OTA firmada, con verificación previa a la activación y rollback A/B.
- Comandos con caducidad y `nonce` monotónico: un comando antiguo capturado no se puede
  reproducir.
- Nada expuesto a Internet en esta fase.
