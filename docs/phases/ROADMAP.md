# Hoja de ruta y estado por fases

Las fases son las del dosier §32. Aquí se registra qué se ha hecho realmente en cada una
y qué falta, con la puerta que el dosier exige para pasar a la siguiente.

**Regla:** una fase no se marca superada sin la evidencia que pide su puerta. Nada de lo
que dependa del hardware físico está marcado como superado, porque no hay hardware.

Leyenda: ✅ completada · 🟡 parcial · ⬜ no iniciada · 🔬 bloqueada por hardware

**Última revisión: 2026-08-04** (`develop` @ `1aa1fbc`; **desplegado en la VM 109 @ `133d760`**,
seis commits por detrás). Nada de X-06, F4, F5 ni F6 está desplegado, y quedan **dos migraciones
sin aplicar** en producción (`20260726200000_manager_activation`, `20260726210000_hit_stats_reset`).

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

- 23 entidades iniciales, migración versionada, ingesta MQTT idempotente con validación
  estricta, motor de partidas extensible, WebSocket, OpenAPI, exportación CSV, 5 roles.
  Después: F1-F3, el lote G-A…G-I y las deudas, con 8 migraciones aditivas más.
- **A `1aa1fbc` (reejecutado el 2026-08-04): 584 pruebas pasan, 8 FALLAN y 7 se saltan** (599
  en total). Las 7 saltadas exigen `DATABASE_URL`. **Las 8 que fallan son un defecto de la
  propia suite, no del producto:** `test/invitations/manager-activation.spec.ts` fija fechas
  absolutas (`MANANA = 2026-07-27`) sin congelar el reloj, así que hoy el servicio considera
  caducados unos códigos que la prueba da por vigentes. El commit `1aa1fbc` declara «592 pasan»;
  esa cifra **no se reproduce hoy**. Ver riesgo P-10.
- Stack Compose completo con perfiles, healthchecks, ACL de Mosquitto y copias. **Aviso: el
  verde del stack no es evidencia de funcionamiento** — en producción `diana-worker-1` figura
  `healthy` mientras todas sus tareas fallan en bucle por desajuste del motor de Prisma
  (riesgo P-09).

**Riesgo cerrado (2026-07-21):** la migración se generó con `prisma migrate diff` y no se
había ejecutado nunca contra una base viva. **Ya se ejecuta contra la base viva de la VM**
(`prisma migrate deploy`), y las cuatro migraciones del lote G se aplicaron el 2026-07-26.
Los tests que en su día se saltaban por falta de base **se han ejecutado**: 5/5 en 2026-07-21
y **7/7 en 2026-07-26**, incluida la concurrencia del cerrojo de panel, que demuestra lo que
la memoria no puede — idempotencia garantizada por las restricciones de la base bajo
inserciones concurrentes, y microsegundos que sobreviven en `BIGINT`.

**Puerta pendiente:** el despliegue con healthchecks está demostrado (8/8 `healthy`), pero
**la copia y la restauración no**: la copia se toma, la **restauración en base aislada nunca
se ha probado**, ni el `reboot` con retorno automático. Hasta eso, la puerta no está superada.

## Fase 6 — Panel web 🟡

- 19 pantallas iniciales; hoy más de 30 rutas tras F1-F3 y el lote G (login, módulos,
  propiedad, firmware, jugadores, equipos, participantes, presets, vistas, matrices,
  marcador, duelo, demo, invitaciones, unirse por QR, resiliencia).
- Editor de matriz 3×3 con rotación e identificación, **trabajando ya con datos reales del
  panel** (G-H), y vista en directo.
- Ningún estado se comunica sólo por color: color + patrón + símbolo + etiqueta, con test
  que lo impide.
- La regla de precisión no calculable está implementada y probada.
- **178/178 unitarias**, `tsc -b` limpio y `oxlint` sin avisos nuevos a `1aa1fbc`
  (reejecutado el 2026-08-04; eran 131/131 a `133d760`).

**Corregido respecto a la versión anterior de este documento:** los E2E de Playwright del
frontend **sí se ejecutaron**, con navegador real: **18/18** tras corregir 4 bugs reales
(X-07 cerrado). Corren contra el adaptador **mock**.

**Pendiente:** (a) los 16 escenarios E2E obligatorios del §19 (`tests/e2e/scenarios.spec.ts`)
siguen como `test.fixme`, 0 aserciones; (b) la vista en directo **nunca pudo funcionar contra
el backend real** —el panel abría un WebSocket crudo y el backend sirve socket.io (X-06)—:
**corregido en código (`5c3b7ac` + `eb42324`), sin desplegar y sin probar con navegador real
contra el backend desplegado.** La falta de autenticación del canal, que esta línea declaraba
abierta el 2026-07-26, **ya no lo está**: la supervisión de X-06 la dictaminó `NO CONFORME` y
`eb42324` la cerró —el saludo exige ahora un JWT válido y el canal de diagnóstico, que seguía
difundiendo la manguera MQTT completa a cualquier cliente sin token, va a una sala que hay que
pedir expresamente; (c) las pantallas heredadas siguen mostrando datos de demostración (X-21
parcial). **Matiz importante sobre el diagnóstico de sensores y LED:** ya **no** es cierto que
le falte el backend —F6 lo implementó y las rutas existen—, pero la imagen de producción se
compila con `VITE_API_MODE=mock` (`server/frontend/Dockerfile:19`), así que lo que se despliegue
seguiría enseñando datos de demostración hasta que se pase a `real`.

## Fase 7 — Integración de un módulo completo ⬜ 🔬

Exige módulo real. La cadena equivalente con simulador está preparada.

## Fase 8 — Coordinación de dos módulos 🟡

- El simulador provoca de forma determinista el conflicto de dos módulos PRINCIPAL.
- El contrato define `conflicts: ["dual_principal"]` y el bloqueo del inicio.
- El firmware impide en código que un módulo que no es coordinador produzca T2.

**Pendiente:** medición real del desfase entre módulos y del presupuesto de error temporal
del dosier §29.7.

## Fase 9 — Modos de juego y estadísticas 🟡

- **Cinco** modos implementados con registro de estrategias (`random`, `sequence`,
  `reaction`, `all_against_clock` y **`duelo`**, añadido en G-E): añadir uno no toca el núcleo.
- Semilla explícita: los modos aleatorios son reproducibles. En el duelo, la misma semilla da
  el **mismo patrón a cada jugador** sobre sus propios módulos.
- **Modo demo** (§6.4 de producto): efímero, sin jugadores ni escritura en BD.
- **Marcador estilo máquina de dardos** (G-G) y **atribución de impacto a jugador** sólo
  cuando la respuesta es forzosa; si no, se declara «sin atribuir» en vez de adivinarse.
- Faltan `memory` y `no_shoot`: están en el contrato, sin implementar (comprobado 2026-07-26).
- **Sin verificar:** ninguna partida se ha jugado de principio a fin con datos reales.

## Fase 10 — Seguridad y endurecimiento 🟡

- ACL de MQTT tópico a tópico, sin anónimo, credencial por módulo.
- OTA firmada, comandos con caducidad y nonce persistido.
- Revisión de seguridad independiente **entregada** (WP-10, 2026-07-21): modelo de amenazas +
  18 hallazgos F-01…F-18 con evidencia ejecutada. Ya no está «en curso».
- Autenticación real del panel (JWT) y RBAC con guards globales: F1, desplegada (cierra X-22).
- **Hallazgos que siguen abiertos y pesan:** **F-02/X-08**, la ACL autoriza por `client_id`, y
  la suplantación de un módulo por otro está **CONFIRMADA EN VIVO**; **F-07/X-11**, sin TLS en
  ninguna capa (JWT, contraseñas y credenciales MQTT viajan en claro por la LAN); **F-17/X-15**,
  23 vulnerabilidades de npm en el backend, medidas el 2026-07-20 y **sin volver a medir ni
  remediar**.
- TLS preparado en configuración, **sin activar**.

## Fase 11 — Matriz de hasta nueve módulos ⬜

Pruebas de carga con 9 módulos y 81 dianas simulados, preparadas y sin ejecutar.

## Fase 12 — Preparación de producción ⬜ 🔬

No procede: exige PCB final, carcasa y pruebas de recepción.

---

## Lo siguiente, por orden de valor (revisado 2026-08-04)

> **Añadido el 2026-08-04, por delante de todo lo demás:** (i) **completar la revisión
> independiente de las correcciones de F4, F5 y F6** — las tres salieron `NO CONFORME` en su
> primera supervisión, con diez bloqueantes entre las tres y uno de seguridad (el rol salía del
> token y quedaba obsoleto hasta 8 h), y las correcciones aún no se han revisado; (ii) **devolver
> la suite del backend al verde** (8 fallas por fechas fijas en las pruebas de F5, riesgo P-10:
> una suite en rojo por causa espuria esconde las regresiones de verdad); (iii) **arreglar el
> worker de producción**, que se declara `healthy` mientras todas sus tareas fallan en bucle
> (riesgo P-09); y (iv) **desplegar**, teniendo en cuenta que la VM está seis commits por detrás
> y le faltan **dos migraciones**.

Los dos primeros puntos de la lista anterior **ya están hechos** y se dejan anotados para que
se vea el avance: la migración corre contra PostgreSQL real (7/7 de integración) y la ACL se
probó contra Mosquitto real — y esa prueba fue la que **confirmó F-02 en vivo**.

1. **Verificación funcional con credenciales reales:** entrar al panel, crear una partida y
   recorrerla. Es lo que más incertidumbre elimina hoy, porque todo el lote G se desplegó con
   verificación de superficie (códigos HTTP y esquema), no de uso.
2. **Investigar la ingesta e2e** (X-18-INGESTA): el simulador publica y no se persistieron
   impactos. Sin eso, el sistema no ha demostrado nunca su función principal.
3. **Arreglar el DNS y la memoria de la VM 109.** Hoy no se puede compilar sin parar
   contenedores, y sin DNS no hay `git pull` ni `docker pull`: cualquier despliegue es frágil.
4. **Redesplegar**: el HEAD de `develop` (`1aa1fbc`) no está en la VM, que sigue en `133d760`.
   D9 ya está cerrado (4ª supervisión: `CONFORME CON OBSERVACIONES`) y desplegado; lo que hoy
   falta por desplegar es X-06, F4, F5 y F6, con sus dos migraciones.
5. **Compilar el firmware con ESP-IDF.** Sigue siendo la laguna mayor del proyecto.
6. **Cerrar F-02** (usuario = client_id = module_id + `use_username_as_clientid`) y **activar
   TLS** (F-07). F-02 está confirmado explotable en vivo.
7. Implementar los 16 escenarios E2E del §19 y ejecutar la carga con 9 módulos simulados.
8. Resolver el déficit de GPIO: es una decisión de arquitectura de hardware, no un ajuste.
9. Montar el banco de una diana y ejecutar D1, D4 y G5. Hasta entonces, el sensado piezo
   es un diseño razonado, no un diseño validado.
