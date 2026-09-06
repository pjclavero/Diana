# E2E-3 · DEVICE MANAGEMENT

Escenario extremo a extremo del plano firmado `DEVICE_MANAGEMENT` (ADR-0008,
contrato v1.2 / D1b v1.7.1):

```
backend (ProvisioningCommandService, firma P-256 real)
   → Mosquitto REAL, TLS, ACL del repositorio
   → suscripción REAL del módulo (usuario = module_id exacto)
   → diana_prov_message()  [firmware D1b compilado en HOST]
   → efecto PERSISTIDO en NVS
   → provision/state publicado por el módulo
   → ingesta del backend
   → PostgreSQL (migraciones reales, repositorios Prisma reales)
```

## Cómo se ejecuta

```bash
cd server/backend && npm ci                       # una vez
cd server/backend
npx jest -c ../../tests/e2e/device-management/jest.config.js
```

Necesita `docker` (contenedores **efímeros**: `eclipse-mosquitto:2` y
`postgres:16-alpine`), `gcc`, `openssl` y `npx`. Sin docker el carril **no se
salta en silencio**: declara `NO MEDIDO` en voz alta.

Nada de esto toca producción ni la VM109. Puertos efímeros, contenedores
`--rm`, material criptográfico en directorios temporales.

## Qué es real y qué NO

| Tramo | Estado |
|---|---|
| Emisor de órdenes | REAL — `ProvisioningCommandService` del backend, con `publishNeverRetained()` y su firmante P-256 |
| Firma / canónica | REAL — ECDSA P-256 P1363, canónica con prefijo de longitud |
| Delegación raíz→operativa | REAL — raíz efímera fuera del backend, firma verificada por el firmware |
| Transporte | REAL — TLS 1.2, CA propia, `rejectUnauthorized: true`, broker **sin listener en claro** |
| ACL | REAL — `infrastructure/mosquitto/acl` copiada verbatim, `use_username_as_clientid true` |
| Dispositivo | **FIRMWARE EN HOST** — `diana_core` compilado con gcc, ejercido por `diana_prov_message()`; NVS simulada que sobrevive a mensajes y a reinicios |
| Persistencia del módulo | firmware-en-host (contador `kv_writes` + estado persistido) |
| Ingesta y BD | REAL — `ProvisioningStateService` + Prisma + PostgreSQL con migraciones |

### PENDING_PHYSICAL_VALIDATION

No hay silicio en este carril. Queda **sin medir** todo lo que sólo existe en la
placa:

- el cliente MQTT del propio firmware (`main/mqtt_client.c`, `app_provision.c`)
  y su capacidad de hablar **TLS**: hoy el firmware lleva `mqtt://%s:1883`
  cableado; aquí el transporte lo ejerce el arnés, no el firmware;
- la NVS real de la ESP32 (aquí es la HAL de host);
- arranque, temporización, reintentos y reconexión sobre hardware;
- el enrutado del tópico dentro del firmware (`test_prov_bridge` lo cubre de
  forma estructural, no ejecutada en este carril).

Por eso **NO** se declara `DEVICE_MANAGEMENT_TRANSPORT = REACHABLE` para el
firmware: lo alcanzable y medido es *backend → broker TLS → suscriptor con la
identidad del módulo*; el tramo *ESP32 ↔ broker* sigue sin ejercerse.

## Hallazgo bloqueante: `GAP-D1B-DELEG-ALG`

**Ninguna orden `PROVISION` conforme al contrato puede aprovisionar un módulo
hoy.**

- `conforms()` (`firmware/esp32/components/diana_core/src/provisioning.c`,
  bloque `if (c->has_delegation)`) **exige** `delegation.signature_alg`.
- `contracts/mqtt/module-provision-command.schema.json` **no declara** ese campo
  en el objeto `delegation` y lleva `additionalProperties: false`.
- El backend valida cada publicación contra el esquema, así que **no puede**
  emitirlo.

Resultado medido: el payload tal y como sale del backend muere en el módulo con
`malformed_provisioning_message` y **cero escrituras de NVS**. El mismo payload
con ese único campo añadido se aplica y deja el módulo en `READY`. El
diferencial está en el test `GAP-D1B-DELEG-ALG`.

Ninguna de las cuatro implementaciones del contrato (Python de referencia,
backend, simulador) emite `signature_alg` dentro de la delegación; la suite en C
del firmware nunca lo detectó porque construye la delegación en memoria
(`fill_delegation`) en vez de parsearla de un JSON conforme. Es exactamente el
hueco que sólo un E2E puede ver.

Mientras el hueco exista, el resto del escenario (control positivo y los nueve
negativos) se mide sobre el payload **+ `delegation.signature_alg`**, etiquetado
en el código como *fuera de contrato*. No se ha tocado ni el firmware ni el
contrato: la corrección es decisión del propietario de esos ficheros.

## `set-coordinator.sh`

**El escenario NO lo atraviesa**, y hay un test que lo comprueba. Los tópicos
`provision` y `provision/state` ya están en la ACL estática del repositorio, así
que el rol de coordinador no hace falta. Es importante: ese script deja la ACL
en 0600 y el broker muere con `Exited (13)` (decisión D6); depender de él
convertiría el carril en bloqueante operativo.

## Ficheros

| Fichero | Qué es |
|---|---|
| `device-management.e2e.spec.ts` | el escenario |
| `harness/pki.ts` | TLS efímero + raíz + clave operativa 0600 fuera del repo + delegación firmada |
| `harness/broker.ts` | Mosquitto efímero TLS-only con la ACL real |
| `harness/database.ts` | PostgreSQL efímero + `prisma migrate deploy` |
| `harness/device.ts` | cliente del firmware-en-host |
| `tools/build-runner.sh` | compila `diana_core` + `test_host/e2e/prov_runner.c` |
| `firmware/esp32/test_host/e2e/prov_runner.c` | EL dispositivo: proceso de larga vida sobre `diana_prov_message()` |

## Avisos medidos aquí (para quien venga después)

- **Una identidad, un cliente.** Con `use_username_as_clientid true` dos
  conexiones del mismo usuario se expulsan entre sí. Un segundo cliente
  `backend` tumbaba al backend y sus publicaciones se encolaban.
- **La denegación de ACL al publicar** llega en mqtt.js como un
  `ErrorWithReasonCode` en el callback (`code: 135`), no como un `packet`. El
  `rc` del proceso es 0 en los dos casos.
- **El SUBACK no distingue** una suscripción permitida de una prohibida:
  mosquitto concede QoS 1 y simplemente no entrega nada. La ACL se mide por
  EFECTO (se emite una orden para el otro módulo y se comprueba quién la
  recibe), nunca por el código del SUBACK.
- **Un rechazo puede escribir NVS.** El firmware declara que la delegación
  válida se persiste aunque la orden se rechace. «Cero efecto» significa aquí
  cero cambio de AUTORIDAD (estado, epochs, secuencias) y como mucho esa
  reescritura idempotente.
- **El proxy de docker rootless acepta TCP** antes de que el contenedor escuche:
  sondear el puerto del host no prueba nada. La única prueba honesta de que
  PostgreSQL está listo es que la migración pase.

## Calibración (obligatoria, hecha)

| Mutación | Dónde | Resultado |
|---|---|---|
| M1 · anular el rechazo de retenidos (`if (false && retained)`) | `diana_core/src/provisioning.c` | **N5 ROJO**, resto verde |
| M2 · anular `exactUint64` (`if (false)`) | `provisioning-command.service.ts` | **N9 ROJO**, resto verde |

Ambas verificadas con `grep` antes de medir y **revertidas** después
(`git status` limpio).
