# ADR-0008 · Contrato MQTT del plano DEVICE_MANAGEMENT (provisioning)

**Estado:** ACEPTADO · 2026-09-04
**Bloque:** MP0-F.0 — PROVISIONING CONTRACT GATE
**Cierra:** `CONTRACT_GAP-PROVISION-COMMAND-TOPIC`, `CONTRACT_GAP-PROVISION-STATE-TOPIC`
**Contrato tocado:** `contracts/mqtt/**`, `server/backend/src/contracts/topics.ts`
**Tópicos MQTT:** DOS nuevos (comando y estado). Ver §4.

---

## 1. Contexto

D1b (plano `DEVICE_MANAGEMENT` firmado) está **cerrado y CONFORME** como núcleo
software: parse, canonicalización, ECDSA P-256, raíz y delegación,
direccionamiento, epoch, barrera antirreplay, persistencia y fallo cerrado, todo
compilado con el toolchain xtensa y presente en el ELF (23 símbolos tras
`--gc-sections`). Ver `docs/coordination/CIERRE-D1B-MP0.md`.

Lo que **no** existe es el puente:

```
MQTT   X   D1b
```

Medido, no supuesto: `components/diana_platform_esp/src/mqtt_client.c:116-131`
suscribe exactamente `command`, `config/desired`, `ota` y
`targets/v1/system/+/game/state`. El interceptor `diana_prov_app_handle` empareja
por sufijo `/provision`, que **nunca llega**. Y en el sentido contrario,
`app_provision.c` deja `out.publish` sin consumir: no hay tópico de estado.

De ahí las dos etiquetas que este ADR debe convertir en `CLOSED`:

```
DEVICE_MANAGEMENT_COMMAND_TRANSPORT = NOT_REACHABLE
DEVICE_MANAGEMENT_STATE_PATH        = NOT_IMPLEMENTED
```

---

## 2. Hallazgo previo: el repositorio se contradice sobre su propia regla

Esta decisión **no puede tomarse** sin resolver antes una incoherencia
documentada en dos sitios del árbol:

| Fuente | Regla que enuncia |
|---|---|
| `contracts/mqtt/README.md:4` | *«cualquier modificación **incompatible** exige un `v2` y un ADR. Los cambios **compatibles** (añadir campos opcionales, **o un tópico nuevo que no reescribe ninguno existente**) suben `schema_version` sólo si alteran la semántica de un mensaje ya emitido»* |
| `server/backend/src/contracts/topics.ts:1-4` | *«CONGELADO: **cualquier** cambio exige v2 y ADR»* |

No dicen lo mismo. Bajo el README, añadir un tópico que no reescribe ninguno
existente es **compatible** y no obliga a `v2`; bajo `topics.ts`, sí.

**Y hay precedente, que siguió al README.** `module-maintenance-command` se
incorporó como «ampliación v1.1», está en el `TopicKind` de `topics.ts` y en el
§0 del README, y **no tiene ADR**: `grep -rl maintenance docs/adr/` no devuelve
nada. Es decir, ya se añadió un `TopicKind` a v1 sin abrir v2 y sin ADR.

Consecuencia para este ADR: la opción «ampliar v1» **no es una violación de la
gobernanza**; es lo que la regla escrita del contrato permite explícitamente y lo
que el proyecto ya hizo una vez. Elegir `v2` es defendible, pero hay que
justificarlo por semántica, no presentarlo como obligación.

---

## 3. Opciones

### A · Ampliar v1 (etiqueta documental «v1.2»)

- **A favor.** Es lo que la regla escrita permite; hay precedente exacto (v1.1);
  coste de migración cero; no hay flota desplegada que reescribir; ningún tópico
  existente cambia de forma ni de semántica; el backend y el firmware siguen
  hablando el mismo dialecto para todo lo demás.
- **En contra.** Acumula planos heterogéneos bajo una etiqueta que ya se estiró
  una vez. La segunda ampliación consecutiva convierte «congelado» en una
  formalidad, y el criterio de qué cabe en v1 se vuelve difuso.

### B · Abrir v2

- **A favor.** `DEVICE_MANAGEMENT` no es un tópico suelto: es un plano con
  autoridad criptográfica propia, epoch, secuencia antirreplay y delegación —
  semántica que ningún otro tópico de v1 tiene. Marca un antes y un después
  legible en el árbol de tópicos.
- **En contra, y es serio.** `TOPIC_ROOT = 'targets/v1'` está incrustado en la
  construcción de **los catorce** tópicos. Abrir `targets/v2` obliga a una de
  estas tres cosas, todas caras y ninguna necesaria hoy:
  1. migrar los catorce a `v2` — reescribe firmware, backend, ACL y esquemas de
     todo lo que hoy funciona, para añadir un plano;
  2. hacer convivir `targets/v1/**` y `targets/v2/**` — dos árboles, dos juegos
     de ACL, dos parsers, y una pregunta nueva en cada mensaje;
  3. poner sólo provisioning bajo `v2` — que es (2) con otro nombre.

  Ninguna de las tres mejora la seguridad del plano: la autoridad de D1b la da
  la **firma**, no el prefijo del tópico.

---

## 4. Decisión

```
PROVISIONING_CONTRACT_EVOLUTION = V1_COMPATIBLE_EXTENSION
CONTRACT_RELEASE                = v1.2
TOPIC_ROOT                      = targets/v1
ADR_REQUIRED                    = YES
V2_REQUIRED                     = NO
```

**Se elige A: ampliar el contrato v1 con la etiqueta documental «v1.2»**, con las
condiciones de §5, que son las que evitan que «ampliar» degenere en «modificar de
facto».

Dos `TopicKind` nuevos, ninguno reescribe nada existente:

```
module-provision-command   targets/v1/module/{module_id}/provision
                           backend/coordinador -> modulo   QoS 1   retain=false

module-provision-state     targets/v1/module/{module_id}/provision/state
                           modulo -> backend               QoS 1   retain=true
```

**`retain=false` en el comando no es un detalle de configuración: es seguridad.**
Un comando retenido es un replay que el broker sirve a cualquiera que se
suscriba. D1b ya lo rechaza en firmware —comprueba `retained` **antes** que la
firma—, y el contrato debe decir lo mismo para que la defensa esté en los dos
lados. `RETAINED_EXECUTABLE_COMMAND = REJECTED` es una propiedad del sistema, no
sólo del firmware.

El estado **sí** se retiene: es observacional y quien se suscriba debe poder leer
el último estado conocido sin esperar al siguiente cambio. Con un límite que no
admite lectura amable:

> **`module-provision-state` NUNCA constituye autoridad, orden, `desired state`
> ejecutable ni fuente para modificar configuración por sí mismo.** Es *reported
> state*. Ninguna decisión del módulo puede depender de lo que se publique ahí.

La defensa contra el comando retenido es **en cuatro capas**, y sólo cuenta si
las cuatro existen:

| Capa | Qué impone |
|---|---|
| contrato | comando ejecutable retenido PROHIBIDO |
| publicador (backend/coordinador) | nunca publica con `retain` |
| firmware D1b | `retained` → rechazo **antes** de verificar la firma |
| prueba | una orden **criptográficamente válida en todo** salvo `retained=true` → CERO efectos |

La última es la que vale: si el vector de prueba fuese inválido por otro motivo,
pasaría por la razón equivocada y la barrera quedaría sin medir.

### 4.1 Lo que este ADR NO decide

No entra aquí, y no debe colarse por la puerta de atrás: descubrimiento UDP,
asignación de IP, Coordinator/Members, panel web, UX de emparejamiento, alta
automática de los nueve módulos, OTA ni reset de fábrica. `provisioning
transport` ≠ `discovery` ≠ `pairing`.

Tampoco decide la implementación definitiva de `root_key`, que es MP0-F.1.

---

## 5. Condiciones de la ampliación (vinculantes)

1. **Se corrige la contradicción del §2.** `topics.ts` y el README deben enunciar
   la MISMA regla. Un contrato que dice dos cosas no gobierna nada.
2. **La etiqueta v1.2 es documental**, nunca un valor que viaje en el payload —
   igual que v1.1.
3. **Ningún tópico existente cambia** de forma, retención, QoS ni semántica. Si
   alguna vez hiciera falta, eso ya es `v2` y otro ADR.
4. **Esquema formal obligatorio** para los dos mensajes en `contracts/mqtt/`, con
   ejemplos válidos e inválidos y validación en CI. Nada de comentarios dispersos.
5. **El estado no es una segunda autoridad.** `provision/state` es observacional:
   ninguna decisión del módulo puede depender de lo que se publique ahí.
6. **Sin secretos en el estado**: ni `root_key`, ni claves privadas, ni la
   contraseña MQTT, ni material derivado. `NO_SECRET_IN_STATE` se comprueba con
   una prueba, no con una promesa.
7. **Modelo ACL definido en el contrato**, no sólo en la configuración del broker
   (§6).

---

## 5-bis. REGLA CONTRACTUAL ÚNICA (resuelve el §2)

A partir de este ADR, ésta es **la** regla, y `contracts/mqtt/README.md` y
`server/backend/src/contracts/topics.ts` deben enunciarla con las mismas
palabras. No puede volver a haber una «regla canónica» distinta según el fichero
que se lea.

**ADITIVO Y COMPATIBLE** — puede permanecer bajo `targets/v1`:
- añadir un tópico nuevo que no reescribe ninguno existente;
- añadir campos opcionales a un mensaje.

Requiere: revisión contractual, incremento de la **versión documental** del
contrato, y **ADR cuando introduce semántica o un plano nuevos** (como aquí).

**ROMPE O REINTERPRETA ALGO EXISTENTE** — exige `v2` y ADR obligatorio:
- renombrar un tópico;
- cambiar un comodín;
- cambiar la dirección publicador/suscriptor;
- cambiar `retain`;
- cambiar el payload de forma incompatible;
- cambiar el significado de un `TopicKind`;
- cambiar la seguridad o la autoridad de algo existente.

### Qué significa realmente «congelado»

> `targets/v1` **no** significa «inmutable para siempre». Significa que cualquier
> extensión debe seguir siendo **compatible con todos los consumidores v1
> existentes**. En cuanto deje de serlo, toca `v2`.

### El precedente no es autorización

`module-maintenance-command` entró en v1.1 **sin ADR**. Este ADR lo usa como
evidencia de **compatibilidad técnica** — demuestra que añadir un `TopicKind`
aditivo no rompió nada — y **NO** como autorización para seguir cambiando
contratos sin decisión formal. Desde aquí, un plano o semántica nuevos exigen ADR
aunque el cambio sea aditivo.

---

## 6. Modelo ACL

Autoridad por dominio, no por disponibilidad — la misma doctrina que ya separa
`command` de `maintenance/command` en la ampliación v1.1:

| Identidad | `…/{id}/provision` | `…/{id}/provision/state` |
|---|---|---|
| backend / coordinador | **publica** | suscribe |
| módulo `{id}` | suscribe **sólo el suyo** | **publica sólo el suyo** |
| cualquier otro módulo | — | — |

Invariante, y es el que importa: **ningún módulo puede publicar en el tópico de
provisioning de otro módulo, ni suscribirse a él.** Nada de comodines que
permitan a un módulo mandar órdenes a un vecino. Se apoya en
`use_username_as_clientid` y en que el `username` del módulo es su `module_id`,
que es la invariante F-02 ya vigente en producción.

La reconciliación con TLS/8883 (P0-2) es posterior y no bloquea este ADR, pero la
**semántica** ACL queda fijada aquí.

**Y se prueba contra Mosquitto real, no leyendo el fichero ACL.** Un fichero que
«parece correcto» no es evidencia; la matriz mínima a ejecutar es:

```
modulo A -> publica command A      DENIED
modulo A -> publica command B      DENIED
modulo A -> publica state  A       ALLOWED
modulo A -> publica state  B       DENIED
modulo A <- suscribe command A     ALLOWED
modulo A <- suscribe command B     DENIED
```

Recordatorio medido en P0-2 y que aquí importa: en MQTT 5 un fallo de
autenticación da `rc=135`, pero **una denegación de ACL en publicación devuelve
`rc=0`** con un `Warning: Publish failed: Not authorized`. El código de salida no
distingue ambos casos, así que la prueba debe observar el mensaje o la ausencia
de efecto, nunca el `rc`.

---

## 7. Consecuencias

- `DEVICE_MANAGEMENT_COMMAND_TRANSPORT` pasa de `NOT_REACHABLE` a `REACHABLE`
  cuando el firmware suscriba y exista E2E real, no antes.
- `DEVICE_MANAGEMENT_STATE_PATH` pasa a `IMPLEMENTED` cuando `out.publish` se
  consuma de verdad contra un esquema.
- El firmware gana una suscripción y un publicador; D1b **no cambia**. Es
  deliberado: el núcleo está cerrado y auditado, y este bloque construye el
  puente, no toca el motor.
- La contradicción del §2 queda resuelta en el árbol, que es una deuda que
  llevaba abierta desde la ampliación v1.1 sin que nadie la viera.

---

## 8. Criterio de aceptación

```
ADR_PROVISIONING_CONTRACT             = ACCEPTED
CONTRACT_VERSION                      = v1.2
TOPIC_ROOT                            = targets/v1

PROVISION_COMMAND_SCHEMA              = PASS
PROVISION_STATE_SCHEMA                = PASS
TOPICKIND_GOVERNANCE                  = CONSISTENT

PROVISION_COMMAND_RETAINED            = FORBIDDEN
PROVISION_STATE_RETAINED              = ALLOWED_OBSERVATIONAL_ONLY

DEVICE_MANAGEMENT_COMMAND_TRANSPORT   = REACHABLE
DEVICE_MANAGEMENT_STATE_PATH          = IMPLEMENTED

MQTT_TO_D1B_E2E                       = PASS
D1B_TO_STATE_E2E                      = PASS

ACL_CROSS_MODULE_ISOLATION            = PASS
NO_SECRET_IN_STATE                    = PASS

CONTRACT_GAP-PROVISION-COMMAND-TOPIC  = CLOSED
CONTRACT_GAP-PROVISION-STATE-TOPIC    = CLOSED
```

El E2E se ejecuta contra **Mosquitto real**, con control positivo (una orden
válida produce exactamente un efecto; repetida, cero adicionales) y negativos:
tópico incorrecto, firma inválida, device ajeno, system ajeno, replay, retenido y
sin identidad de raíz → cero efectos en todos.
