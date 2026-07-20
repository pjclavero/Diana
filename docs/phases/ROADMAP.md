# Hoja de ruta y estado por fases

Las fases son las del dosier §32. Aquí se registra qué se ha hecho realmente en cada una
y qué falta, con la puerta que el dosier exige para pasar a la siguiente.

**Regla:** una fase no se marca superada sin la evidencia que pide su puerta. Nada de lo
que dependa del hardware físico está marcado como superado, porque no hay hardware.

Leyenda: ✅ completada · 🟡 parcial · ⬜ no iniciada · 🔬 bloqueada por hardware

---

## Fase 0 — Definición y contratos ✅

| Entregable del dosier | Estado |
|---|---|
| Congelar requisitos | ✅ Dosier leído íntegro; requisitos de programa en `PROGRAM_BRIEF.md` |
| Crear repositorio | ✅ Estructura profesional con separación firmware/servidor/contratos |
| Definir contratos | ✅ MQTT v1: 12 esquemas, 28 ejemplos, validador ejecutable |
| Crear ADR | ✅ ADR-0001 a 0006 |
| Fijar pinout preliminar | 🟡 Fijado, pero **el presupuesto de GPIO no cuadra** (ver X-01) |
| Fijar modelo de eventos | ✅ Modelo temporal de cuatro marcas, idempotencia por `event_id` |
| Fijar criterios de éxito | ✅ `TEST_MATRIX.md` |

**Puerta `ARQUITECTURA BASE CONFORME`:** el supervisor dictaminó `NO CONFORME` en la
primera vuelta, con dos bloqueantes reales (ACL que dejaba inejecutable la consolidación
temporal; `$ref` que sólo resolvían con el validador propio). Corregidos ambos.
Pendiente el dictamen de la segunda vuelta.

## Fase 1 — Prototipo de una diana 🔬

Toda la fase depende de hardware que no existe. Lo que sí está hecho:

- Cadena piezo diseñada y calculada (protección, comparador con histéresis 33 mV,
  envolvente). Se corrigió un defecto del propio dosier: el detector pasivo del §9.2 tiene
  τ_ataque de 3,20 ms para impactos de menos de 1 ms, es decir, **no serviría**.
- Firmware con la lógica de captura, antirrebote y amplitud, probada en host.
- Protocolo de ensayo escrito con criterios numéricos.

**Puerta pendiente:** impacto detectado de forma repetible, sin daño al ESP32, sin conteos
múltiples, material seleccionado. Exige banco. Las medidas que deciden son D1 y D4 del
listado de validación física (pico real del piezo y que el punto de clamp nunca salga de
−0,4/+3,7 V, medido **sin el ESP32 conectado**).

## Fase 2 — Tres dianas y vibración cruzada 🟡

- Algoritmo de clasificación implementado y probado en host: ventana de agrupación,
  comparación de amplitudes con vecinos, coeficiente configurable, motivo declarado.
- El simulador reproduce vibración cruzada de forma determinista.
- El evento `crosstalk_rejected` se transmite en vez de descartarse en silencio, para poder
  auditar la decisión y afinar umbrales.

**Puerta pendiente:** tasa de detección y de falso positivo medidas en banco. El ensayo G5
(matriz 9×9 de acoplamiento, criterio < 0,25) **puede invalidar la arquitectura mecánica**
si el aislamiento entre dianas resulta insuficiente.

## Fase 3 — Electrónica de módulo 3×3 🟡

- 8 hojas de esquemático, 74 redes nodo a nodo, 140 componentes, BOM de 58 líneas.
- Cálculos completos: potencia (4,87 A, convertidor de 6 A al 81 %), bulk 2000 µF con
  ESR ≤ 26,2 mΩ como requisito de compra, caída total 0,173 V.
- **Dos hallazgos que cambian el diseño:** el presupuesto de GPIO del dosier §8.4 no cuadra
  (29 pines necesarios frente a 25 disponibles), y la térmica del convertidor da Tj = 137 °C
  a brillo máximo, por encima del límite de 125 °C.

**Puerta pendiente:** ERC y DRC **no ejecutados** (no hay KiCad instalado). Sin PCB
fabricada no hay estabilidad eléctrica que declarar. No se envía nada a fabricar.

## Fase 4 — Firmware base 🟡

- Lógica separada del hardware por una tabla de punteros a función, con implementación real
  (ESP-IDF) y de host. **389 comprobaciones en host, todas correctas.**
- Máquinas de estado, cola persistente con reenvío, idempotencia, clasificación de
  crosstalk, validación de comandos con caducidad y nonce persistido, LED con patrón además
  de color, OTA A/B con verificación previa y rollback.
- Los mensajes que genera se validan contra los esquemas congelados en cada ejecución.

**Laguna importante:** el firmware **nunca se ha compilado con ESP-IDF**. Está escrito y
probado en host, pero jamás construido para su destino. El workflow `firmware-idf.yml`
existe para cerrar esa laguna.

**Puerta pendiente:** compilación reproducible para ESP32-S3, y OTA y rollback probados
sobre hardware.

## Fase 5 — Backend Docker 🟡

- 23 entidades, migración versionada, ingesta MQTT idempotente con validación estricta,
  motor de partidas extensible, WebSocket, OpenAPI, exportación CSV, 5 roles.
- **157 pruebas pasadas**, 5 saltadas.
- Stack Compose completo con perfiles, healthchecks, ACL de Mosquitto y copias.

**Riesgo abierto:** la migración se generó con `prisma migrate diff` y **nunca se ha
ejecutado contra una base viva**. Los 5 tests saltados son justo los que demuestran lo que
no puede demostrarse en memoria: idempotencia garantizada por las restricciones de la base
bajo inserciones concurrentes, y microsegundos que sobreviven en BIGINT.

**Puerta pendiente:** despliegue reproducible con healthchecks, y copia y restauración
demostradas.

## Fase 6 — Panel web 🟡

- 19 pantallas, editor de matriz 3×3 con rotación e identificación, vista en directo.
- Ningún estado se comunica sólo por color: color + patrón + símbolo + etiqueta, con test
  que lo impide.
- La regla de precisión no calculable está implementada y probada.

**Pendiente:** los E2E de Playwright están escritos pero **no se han ejecutado** (sin
navegador instalable en el entorno de desarrollo).

## Fase 7 — Integración de un módulo completo ⬜ 🔬

Exige módulo real. La cadena equivalente con simulador está preparada.

## Fase 8 — Coordinación de dos módulos 🟡

- El simulador provoca de forma determinista el conflicto de dos módulos PRINCIPAL.
- El contrato define `conflicts: ["dual_principal"]` y el bloqueo del inicio.
- El firmware impide en código que un módulo que no es coordinador produzca T2.

**Pendiente:** medición real del desfase entre módulos y del presupuesto de error temporal
del dosier §29.7.

## Fase 9 — Modos de juego y estadísticas 🟡

- Cuatro modos implementados con registro de estrategias: añadir uno no toca el núcleo.
- Semilla explícita: los modos aleatorios son reproducibles.
- Faltan `memory` y `no_shoot`: están en el contrato, sin implementar.

## Fase 10 — Seguridad y endurecimiento 🟡

- ACL de MQTT tópico a tópico, sin anónimo, credencial por módulo.
- OTA firmada, comandos con caducidad y nonce persistido.
- Revisión de seguridad independiente en curso.
- TLS preparado en configuración, **sin activar**.

## Fase 11 — Matriz de hasta nueve módulos ⬜

Pruebas de carga con 9 módulos y 81 dianas simulados, preparadas y sin ejecutar.

## Fase 12 — Preparación de producción ⬜ 🔬

No procede: exige PCB final, carcasa y pruebas de recepción.

---

## Lo siguiente, por orden de valor

1. **Ejecutar la migración contra PostgreSQL real** y los 5 tests de integración. Es lo que
   más incertidumbre elimina por unidad de esfuerzo.
2. **Probar la ACL de MQTT contra Mosquitto real.** Nunca se ha verificado de verdad.
3. **Compilar el firmware con ESP-IDF.** Cierra la laguna mayor del proyecto.
4. Ejecutar los E2E y la carga con 9 módulos simulados.
5. Resolver el déficit de GPIO: es una decisión de arquitectura de hardware, no un ajuste.
6. Montar el banco de una diana y ejecutar D1, D4 y G5. Hasta entonces, el sensado piezo
   es un diseño razonado, no un diseño validado.
