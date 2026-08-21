# ADR-0007 · Perfil de detección: discriminador explícito para el hardware DO-only

**Estado:** aceptado · 2026-08-21
**Sustituye de facto:** la relajación tácita de `hit-event.schema.json` introducida en `b883da0`
**Contrato tocado:** `contracts/mqtt/hit-event.schema.json` (mismo `schema_version: 1`)
**Tópicos MQTT:** NINGUNO nuevo. Los 14 `TopicKind` siguen congelados.

## Contexto

> **Nota de procedencia (obligatoria para leer este ADR).** El estado del firmware que se
> describe abajo es el de **`b883da0`**, el FIRMWARE_BASE canónico verificado físicamente.
> La rama `hw/do-only-v1` es una línea **DESCARTADA** por el operador —escrita sin
> hardware, hoy sólo cantera de rescate— y **nada de lo que contiene describe el producto
> vigente**. Toda cita a esa rama en este documento va marcada como tal.

El prototipo V1 no lleva la PCB con ADC que asumía el contrato original. Lleva módulos
piezoeléctricos comerciales con **salida digital (DO)**: la sensibilidad la fija un
potenciómetro físico en la propia placa del sensor y el ESP32 sólo ve un flanco. En ese
hardware **no existe** una amplitud que medir ni un umbral que reportar.

El firmware de `b883da0` ya asume esa realidad **en la serialización**: el evento lleva
banderas `has_amplitude` / `has_threshold` / `has_noise_floor`
(`firmware/esp32/components/diana_core/include/diana/event.h:81-86`) y el serializador
omite cada campo cuando su bandera es falsa —
`if (ev->has_amplitude) diana_json_int(&j, "amplitude", …)`,
`firmware/esp32/components/diana_core/src/event.c:199-201`.

Lo que ese firmware **NO** hace es emitir ningún discriminador: `b883da0` no contiene
`diana_detection_method` ni ningún equivalente (comprobado con
`git grep -n "detection_method" b883da0 -- firmware`, sin resultados). Ése —y no ninguna
otra cosa— es el hecho que motiva este ADR: **el productor omite los campos, pero no dice
por qué los omite**, y el receptor no puede reconstruir esa intención.

El commit `b883da0` resolvió ese bloqueo por el camino corto: quitó `amplitude` y
`threshold` de la lista `required` del esquema y añadió descripciones que dicen «ausente
en perfiles digitales DO-only». Dos problemas:

1. **Se hizo desde un commit de firmware, sin reconciliar a nadie más.** El backend siguió
   tipando `amplitude: number` (no opcional), copiándolo sin comprobar y escribiéndolo en
   una columna `amplitude Int` **NOT NULL**. Un evento DO-only conforme al contrato
   relajado no se persiste: revienta en la ingesta.
2. **La ausencia de un campo no es un discriminador.** Un mensaje sin `amplitude` podía
   significar «módulo DO-only, este hardware no mide» o «productor analógico averiado que
   perdió el campo». El contrato dejaba de poder distinguirlos, y el segundo caso pasaba a
   ser silenciosamente válido. Está demostrado: con el esquema de `b883da0`, el ejemplo
   `invalid/hit-event/analog-without-amplitude.json` **valida** cuando no debería.

El punto del operador — *«no quiero que el firmware gane simplemente porque cambió primero
el JSON»* — es exactamente el punto 2: la relajación era necesaria para el hardware pero
insuficiente como contrato.

## Alternativas consideradas

| Opción | Por qué no / por qué sí |
|---|---|
| **A. Dejarlo como está** (ausencia = perfil digital) | Rechazada. Confunde «no hay ADC» con «productor defectuoso»; pierde la capacidad de detectar un firmware analógico roto, que es un fallo real y silencioso. |
| **B. Rellenar `amplitude: 0` en DO-only** | Rechazada por ADR-0006: no se inventa un número donde no se conoce. Un 0 es un dato: dice «midió cero», no «no mide». (El firmware de `b883da0` no prohíbe esto de forma explícita; el veto es de este ADR y de ADR-0006. El firmware de rescate sí lo escribió después — ver «Estado del firmware».) |
| **C. Tópico nuevo `.../hit/digital`** | Rechazada. Los 14 `TopicKind` están CONGELADOS y su cabecera exige v2 + ADR para tocarlos. Además, duplicar el canal por perfil de hardware obligaría a duplicar ACL, ingesta y consultas para el mismo evento de dominio. |
| **D. `schema_version: 2`** | Rechazada. El cambio es *aditivo* y compatible: todo payload analógico v1 previo sigue validando sin tocar nada. Quemar una versión de esquema para un campo opcional encarece el despliegue mixto (módulos viejos y nuevos a la vez) sin ganar nada. |
| **E. Discriminador explícito `detection_method`** | **ELEGIDA.** Ver abajo. |

## Decisión

Se añade al payload `hit-event` un campo **opcional** `detection_method`. El vocabulario
se tomó de la rama descartada `hw/do-only-v1` (que había explorado el problema sin
hardware) por ser un nombre ya pensado, **no porque el firmware vigente lo usara**: en
`b883da0` no existía. Desde entonces el carril de firmware lo ha adoptado en
`mp0s/do-only-salvage`, así que hoy productor y contrato comparten vocabulario de verdad:

```jsonc
"detection_method": "analog_envelope" | "digital_threshold"
```

y tres reglas condicionales en el esquema:

1. **Perfil analógico** — `detection_method` **ausente o** `analog_envelope`:
   `amplitude` y `threshold` son **obligatorios**, y cada entrada de `neighbours` debe
   traer su `amplitude` (es lo que sostiene la decisión de crosstalk).
2. **Perfil digital** — `detection_method: "digital_threshold"`:
   `amplitude`, `threshold` y `noise_floor` quedan **prohibidos** (`false` en el esquema),
   igual que la `amplitude` de cada vecino.
3. Cualquier otro valor de `detection_method` se rechaza (enum cerrado): un método de
   detección desconocido no se interpreta «por parecido».

**Ausencia ⇒ analógico, nunca digital.** Es la parte que reconcilia sin romper: los
productores v1 anteriores a este ADR no declaran nada y siguen sujetos a la exigencia
original, así que un analógico averiado vuelve a ser detectable. Un módulo DO-only tiene
que **declararse**; el silencio ya no le sirve de excusa.

`schema_version` se mantiene en **1**: el campo es aditivo y ningún payload previamente
válido deja de serlo.

## Consecuencias

**Backend**
- `HitEventPayload.amplitude`/`threshold` pasan a opcionales y aparece `detection_method`.
- `HitRecord` gana `detectionMethod` (nunca nulo: se resuelve a `analog_envelope` si el
  payload calla) y `amplitude`/`threshold` pasan a `number | null`.
- Prisma: `amplitude`/`threshold` a NULLable, nueva columna `detection_method` con enum y
  `DEFAULT 'analog_envelope'` — que describe con exactitud las filas ya existentes, todas
  escritas cuando el contrato exigía la medida. La migración añade además un `CHECK` de
  coherencia, para que la ambigüedad tampoco entre por escritura directa a la base.
- Se expone `hasAnalogMeasurement(record)`: la única pregunta que un consumidor debe
  hacerse antes de leer `amplitude`, y se responde con el discriminador, no con un
  `!= null`.
- Exportación CSV: nueva columna `detection_method`, **delante** de `amplitude`. El
  serializador ya escribe `null` como celda vacía y nunca como 0 (ADR-0006), así que quien
  audite el fichero puede distinguir «este hardware no mide» de «dato perdido».

**Simulador**
- `ModuleSimulator` acepta `detectionMethod`. En `digital_threshold` NO emite
  `amplitude`, `threshold`, `noise_floor` ni amplitud de vecino. El simulador puede por
  tanto producir el evento DO-only de verdad, en lugar de aproximarlo con ceros.

**Frontend**
- `HitEvent` gana `detection_method` y sus medidas pasan a opcionales/anulables. La UI
  debe consultar el perfil antes de pintar una amplitud; pintar `0` o un `—` mudo sería
  reintroducir la ambigüedad en la última capa.

**Firmware** (NO se toca desde este carril; `firmware/**` es propiedad del carril MP0-S)

Estado por rama, que es la distinción que importa:

| Rama | ¿Emite discriminador? | Nota |
|---|---|---|
| **`b883da0`** · FIRMWARE_BASE canónico, verificado físicamente | **NO.** Omite los campos con `has_amplitude`/`has_threshold` pero no declara el perfil | Es el hueco que motiva este ADR |
| **`hw/do-only-v1`** · **DESCARTADA** por el operador, escrita sin hardware | Definió `diana_detection_method` y `DIANA_ERR_CONTRACT_NO_AMPLITUDE (-20)`, pero **el enum nunca viajaba en el JSON** | **No es el producto.** Cantera de rescate; no citar como capacidad vigente |
| **`mp0s/do-only-salvage` @ `15f5622`** · carril MP0-S | **SÍ** | Cierra el hueco: ver abajo |

El carril MP0-S ya implementa la emisión del discriminador en `mp0s/do-only-salvage`
(`15f5622`): `diana_hit_event` gana un campo `detection_method` heredado del grupo
detector (`.../include/diana/event.h:85`) y el guardián de contrato pasa a llamarse
**`DIANA_ERR_CONTRACT_PROFILE_MISMATCH (-20)`** (`:110`).

El cambio de nombre es deliberado y merece constar aquí, porque la semántica es distinta
de la del código de la rama descartada. `DIANA_ERR_CONTRACT_NO_AMPLITUDE` significaba
«falta la amplitud» — una carencia, y en una sola dirección. `PROFILE_MISMATCH` significa
**«el productor se contradice»** y cubre las **dos** direcciones: un evento digital que
trae medidas analógicas (amplitud, umbral, suelo de ruido o amplitud de vecino) y un
evento analógico que no las trae. Es exactamente la simetría de las dos ramas
condicionales del esquema, así que productor y contrato rechazan lo mismo por el mismo
motivo, en vez de que el firmware detecte la mitad del problema.

`CONTRACT_GAP-FW-DETECTION-METHOD` queda por tanto **CERRADO** por MP0-S, no pendiente. Lo
que sigue siendo cierto es la regla de transición: un módulo cuyo firmware aún no emita el
discriminador y omita `amplitude` será rechazado por la ingesta, y eso es lo correcto —
ese mensaje es indistinguible del de un productor averiado, y el contrato no debe
adivinar.

## Lo que este ADR NO hace

- No abre MQTT v2 ni añade ningún tópico.
- No cambia `schema_version`.
- No toca `firmware/**`.
- No decide cómo se audita el crosstalk en DO-only más allá de dejar viajar el desfase
  temporal: sin amplitudes no hay comparación de intensidad, sólo de tiempo. Es una
  pérdida real de capacidad de auditoría del hardware V1, no del contrato.
