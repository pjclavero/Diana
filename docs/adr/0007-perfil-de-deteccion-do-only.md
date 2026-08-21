# ADR-0007 · Perfil de detección: discriminador explícito para el hardware DO-only

**Estado:** aceptado · 2026-08-21
**Sustituye de facto:** la relajación tácita de `hit-event.schema.json` introducida en `b883da0`
**Contrato tocado:** `contracts/mqtt/hit-event.schema.json` (mismo `schema_version: 1`)
**Tópicos MQTT:** NINGUNO nuevo. Los 14 `TopicKind` siguen congelados.

## Contexto

El prototipo V1 no lleva la PCB con ADC que asumía el contrato original. Lleva módulos
piezoeléctricos comerciales con **salida digital (DO)**: la sensibilidad la fija un
potenciómetro físico en la propia placa del sensor y el ESP32 sólo ve un flanco. En ese
hardware **no existe** una amplitud que medir ni un umbral que reportar: el firmware lo
declara sin ambigüedad en `diana_detection_method` (`ANALOG_ENVELOPE` /
`DIGITAL_THRESHOLD`) y llega a definir un código de error propio,
`DIANA_ERR_CONTRACT_NO_AMPLITUDE`, con esta nota: rellenar `amplitude` con 0, 1, −1 o el
umbral nominal para pasar la validación está PROHIBIDO, porque sería un dato falso
poniendo verde una comprobación.

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
| **B. Rellenar `amplitude: 0` en DO-only** | Rechazada, y prohibida explícitamente por el firmware. Un 0 es un dato: dice «midió cero», no «no mide». Contradice ADR-0006, cuya regla es no inventar un número donde no se conoce. |
| **C. Tópico nuevo `.../hit/digital`** | Rechazada. Los 14 `TopicKind` están CONGELADOS y su cabecera exige v2 + ADR para tocarlos. Además, duplicar el canal por perfil de hardware obligaría a duplicar ACL, ingesta y consultas para el mismo evento de dominio. |
| **D. `schema_version: 2`** | Rechazada. El cambio es *aditivo* y compatible: todo payload analógico v1 previo sigue validando sin tocar nada. Quemar una versión de esquema para un campo opcional encarece el despliegue mixto (módulos viejos y nuevos a la vez) sin ganar nada. |
| **E. Discriminador explícito `detection_method`** | **ELEGIDA.** Ver abajo. |

## Decisión

Se añade al payload `hit-event` un campo **opcional** `detection_method`, con el mismo
vocabulario que ya usa el firmware:

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

**Firmware** (NO se toca en este carril; es propiedad de otro carril activo)
- Queda pendiente que el productor emita `detection_method: "digital_threshold"` en el
  perfil DO-only. Registrado como `CONTRACT_GAP-FW-DETECTION-METHOD`. Hasta que lo haga,
  un módulo DO-only real seguirá siendo rechazado por la ingesta — y eso es lo correcto:
  con este ADR, un hit sin `amplitude` y sin discriminador es indistinguible de un
  productor averiado, y el contrato no debe adivinar.

## Lo que este ADR NO hace

- No abre MQTT v2 ni añade ningún tópico.
- No cambia `schema_version`.
- No toca `firmware/**`.
- No decide cómo se audita el crosstalk en DO-only más allá de dejar viajar el desfase
  temporal: sin amplitudes no hay comparación de intensidad, sólo de tiempo. Es una
  pérdida real de capacidad de auditoría del hardware V1, no del contrato.
