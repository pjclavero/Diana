# Alcance del panel: roles, propiedad de módulos y firmware

> **Origen:** requisitos de producto del responsable, 2026-07-21 (conversación de dirección).
> Fuente normativa de producto para el panel web y su backend. Complementa el dosier y el
> encargo (`docs/coordination/PROGRAM_BRIEF.md`).
>
> **Estado del documento a 2026-07-26:** ya no es un borrador. Las decisiones de §0-§5 están
> confirmadas por la dirección y en su mayoría **implementadas y desplegadas**; §6.8 y §6.9
> describen lo construido. Lo que este documento describa como pendiente hay que contrastarlo
> con `docs/coordination/STATUS.md`, que es el documento vivo de estado.

Este documento fija lo que el usuario debe poder hacer desde el panel de Diana. Nace de
constatar (hallazgos X-21/X-22) que el panel y el backend se construyeron sobre modelos de
datos distintos y que el modelo de roles/propiedad que se necesita no estaba definido.

## 0. Modelo de negocio (2026-07-21)

- **El fabricante (nosotros) es el `admin`** y dueño del sistema.
- **Vender un módulo a una persona = vincularle ese módulo.** Esa vinculación es lo que la
  **convierte en `gestor`**: el rol gestor **deriva de poseer al menos un módulo**, no de una
  solicitud aislada. El «código por correo» es la **activación** de esa venta/vinculación
  (regenerable por el admin).
- **Todo usuario es, en el fondo, un `jugador`.** Las estadísticas se llevan **siempre a nivel
  de jugador**. Un **gestor es un jugador que además posee módulos** y puede gestionar.
- Un jugador juega con **distintos gestores**; un **gestor que juega en la partida de otro
  gestor acumula esas estadísticas como jugador**. La estadística del jugador registrado es
  **global**, independiente de quién posea el módulo donde jugó.

> Implicación de diseño: `gestor` ⟺ posee ≥1 módulo (+ activación). Todo `User` registrado
> tiene una identidad de `Player` para sus estadísticas. Si a un gestor se le desvinculan
> todos sus módulos, deja de ejercer de gestor (sigue siendo jugador).

## 0.b Naturaleza del proyecto y activación de módulos (2026-07-21)

Diana es, de raíz, un proyecto **autoalojado / para compartir** (comunidad), no un negocio de
fabricante. El modelo de roles encaja igual: **gestor = quien posee y monta los módulos**; sus
amigos son jugadores. La capa "fabricante que vende" es una posibilidad **opcional** encima, no
un cimiento.

**Vinculación de módulo (cómo alguien pasa a ser gestor de un módulo):** el usuario introduce un
**código de vinculación** en su apartado del panel → el backend valida el código → **vincula el
módulo a su cuenta de jugador y lo convierte en gestor** de ese módulo. Comprar/añadir otro =
repetir; los módulos se acumulan bajo la cuenta.

**Decisión de diseño (para abaratar el futuro):** el código de vinculación se modela como un
**«token de vinculación» detrás de una interfaz/estrategia**, con dos implementaciones
intercambiables:
- **V1 (ahora, F5):** código **emitido por el admin y guardado en BD** al vincular. Sin
  hardware ni nube. La experiencia del panel es la definitiva.
- **V2 (futuro, F5b):** código **generado y firmado por el propio módulo** (web de gestión del
  módulo para IP/DNS + firma con clave de dispositivo), verificado con clave pública; opcional
  «phone-home» a un mini-servicio del fabricante para conocer activaciones. Demuestra posesión
  física y ayuda a cerrar **F-02**.

El flujo del panel es idéntico en V1 y V2: pivotar es **sustituir el validador del token**, no
rehacer el flujo ni la propiedad de módulos. Depende de piezas que hoy no existen (firmware con
web+cripto, aprovisionamiento en fábrica, almacenamiento seguro **F-14**, mini-servicio phone-home)
y son **aditivas**, no reescrituras.

**Topología (en estudio):** A autoalojado puro · B autoalojado + phone-home · C nube central.
Al ser un proyecto para compartir, el objetivo por defecto es **A/B**; C queda descartada salvo
cambio de criterio.

## 1. Roles (mínimo 3)

| Rol | Quién es | Qué puede hacer |
|---|---|---|
| **Jugador** | Persona que dispara. Registrado o **temporal**. | Iniciar sesión y ver **sus** partidas, estadísticas y logros. Nada de gestión. |
| **Gestor** | Dueño de uno o varios módulos. | Gestiona sus módulos, partidas y topología; acepta actualizaciones de firmware para sus módulos; da de alta jugadores (registrados o temporales); desvincula módulos suyos; diagnostica módulos; resetea estadísticas de un jugador en una partida. |
| **Admin** | Administrador del sistema. | Todo lo del gestor + sube versiones de firmware, vincula/desvincula módulos de cualquier dueño, y aprueba el ascenso de usuario → gestor. |

> **Decidido (2026-07-21):** conviven todos. Se añaden **jugador / gestor / admin** como
> núcleo y se **conservan** operador, árbitro, consulta y mantenimiento aunque de momento no
> se usen todos («están bien pensados»). Ningún rol se retira.

## 2. Matriz de capacidades

| Capacidad | Jugador | Gestor | Admin |
|---|:--:|:--:|:--:|
| Login · ver **sus** partidas/estadísticas/logros | ✅ | ✅ | ✅ |
| Ser registrado o **temporal** | ✅ | — | — |
| Tener **módulos vinculados** (propiedad) | — | ✅ | ✅ (de cualquiera) |
| Gestionar **partidas** y su tipo | — | ✅ | ✅ |
| Gestionar **topología** (colocación de módulos) | — | ✅ | ✅ |
| **Aceptar** actualización de firmware de sus módulos | — | ✅ | ✅ |
| Dar de alta jugadores registrados / crear **temporales** | — | ✅ | ✅ |
| **Desvincular** un módulo suyo (para cederlo a otro gestor) | — | ✅ | ✅ |
| **Diagnóstico** de módulos (recepción de impacto, LEDs) | — | ✅ | ✅ |
| **Resetear** estadísticas de un jugador en una partida | — | ✅ | ✅ |
| **Subir** nuevas versiones de firmware | — | — | ✅ |
| **Vincular/desvincular** módulos de sus dueños | — | — | ✅ |
| **Aprobar** usuario → gestor (envía código) | — | — | ✅ |

## 3. Flujos clave

### 3.1 Alta de gestor por venta de módulo
El gestor no se «solicita» en abstracto: nace de **vender/vincular un módulo** a un usuario.
1. El comprador se **registra como jugador** (correo obligatorio) — o el admin le crea la cuenta.
2. El **admin vincula el módulo** comprado a ese usuario (la «venta»).
3. El sistema **envía un código de activación al correo** del comprador; al introducirlo, su
   acceso de **gestor** queda activo (ya posee un módulo).
4. **Queda registrado** que se generó y envió el código, de modo que el admin lo ve.
5. El admin puede **volver a generarlo** (regenerar/reenviar).
6. Si más adelante se le desvinculan **todos** los módulos, deja de ejercer de gestor (sigue
   siendo jugador con sus estadísticas).

> **Decidido (2026-07-21):** canal = **correo** (obligatorio en el registro); el envío queda
> auditado (el admin ve que se envió) y es **regenerable** por el admin.
>
> **Dependencia de infraestructura (honesta):** la VM 109 **no tiene salida a internet ni
> SMTP configurado**. Se implementará el flujo completo (generar código, registrarlo, marcar
> «enviado», regenerar) con un **mailer conmutable**; el envío real de correo queda **pendiente
> de configurar SMTP** (relay de salida). Mientras tanto el código queda registrado y visible
> para el admin, así que el flujo es operable sin bloqueo. Caducidad propuesta: 24 h.

### 3.2 Propiedad y cesión de módulos
- Cada módulo tiene un **dueño** (gestor) o ninguno (libre / del admin).
- El gestor puede **desvincular** un módulo suyo, que queda libre para vincularse a otro.
- El admin puede **vincular/desvincular** cualquier módulo de cualquier dueño.

### 3.3 Firmware y OTA
1. El **admin sube** una nueva versión de firmware (firmada, sha256) → `FirmwareVersion`.
2. Cuando hay versión disponible para un módulo, su **gestor la acepta** → se crea un
   `Deployment` y se dispara la OTA remota.
3. El panel muestra qué versión corre cada módulo y el estado del despliegue.

### 3.4 Jugadores y estadísticas
- Un jugador **registrado** se enlaza a un `User` (`Player.userId`) y ve sus logros. Sus
  **estadísticas son globales del jugador**: se acumulan aunque juegue en módulos vinculados a
  **gestores distintos** (la propiedad del módulo no fragmenta las estadísticas del jugador).
- Un jugador **temporal**:
  - **No tiene estadísticas acumuladas** ni acceso al panel; no puede consultar nada ni ver
    histórico.
  - **Sólo aparece en esa partida.** Se guarda para no perder la consistencia de las
    estadísticas **de esa partida**, pero no agrega entre partidas.
  - **Dos temporales con el mismo nombre en partidas distintas NO tienen relación** entre sí
    (cada temporal es una identidad aislada, sin `User`).
- Gestor/admin pueden **resetear** las estadísticas de un jugador **en una partida** concreta.
  Implementado en F4 (§4). Alcance exacto del reinicio, para que nadie tenga que adivinarlo:
  se borran los `Result`, `Penalty` y `ShotCount` de ese jugador **en esa partida** (todos sus
  puestos, incluido el de ronda) y se **desatribuyen** sus `HitEvent` (`participantId = NULL`)
  **sin borrarlos**, porque son telemetría del firmware y no del backend. El participante sigue
  en la partida. Se rechaza con la partida en curso (`running`/`paused`), porque el motor
  recalcularía lo borrado.
  ⚠️ **Corregido el 2026-08-04:** este párrafo decía «el acumulado global se corrige solo: hoy
  **se deriva** de los `Result`, no hay ningún total escrito que restar». **Era falso.** La tabla
  `Statistic` **sí** se escribe, desde `server/worker/src/tasks.ts` (`recomputePlayerStatistics`,
  cada 5 minutos). La supervisión de F4 lo tumbó como bloqueante: el reinicio dejaba intactos los
  totales globales y, al reiniciar la única partida de un jugador, el worker le congelaba los
  totales para siempre. El reinicio **borra ahora también el acumulado global** (ausencia = no hay
  dato) y el worker borra las filas de un jugador que se queda sin resultados en vez de
  saltárselas. Un impacto apartado se distingue de uno que nunca se pudo atribuir mediante
  `HitEvent.statsResetAt`, para que el ranking no se lo readjudique en las partidas de un solo
  jugador.

> **Decidido (2026-07-21):** el temporal es una identidad **por partida**, sin `User`, sin
> `Statistic` acumulada, sin acceso; sus números viven sólo en el `Result`/`Participant` de esa
> partida. El registrado acumula `Statistic` de forma **global**, transversal a los gestores.

## 4. Qué existe ya y qué es nuevo

Primera columna de estado: **inventario original, verificado en el código el 2026-07-21**, que
es el que justificó el plan. Segunda columna: **dónde está cada cosa hoy, 2026-08-04**,
verificado en el código de `develop` @ `1aa1fbc`.

> **Leer esta columna con cuidado: «hecho» significa «está en el repositorio».** La VM 109 sigue
> en `133d760`, así que **F4, F5 y F6 no están desplegadas** y faltan dos migraciones por
> aplicar. Además, las tres salieron `NO CONFORME` en su primera supervisión y **las
> correcciones no han pasado revisión independiente** al escribir esto. Lo desplegado se marca
> explícitamente como «desplegado».

| Elemento | Estado 2026-07-21 | Estado 2026-08-04 |
|---|---|---|
| `FirmwareVersion` (versión, sha256, firma) + `Deployment` por módulo | 🟢 modelo existe; faltan endpoints y UI | ✅ **hecho y desplegado** (F3 + G-B): subida del binario con sha256 y tamaño calculados por el servidor, descarga pública para el módulo, aceptación por el gestor → `Deployment` + OTA por MQTT, compatibilidad de placa y un despliegue en vuelo garantizado por índice único. **Nunca ha terminado en un dispositivo real** |
| `ModulePosition` (topología) | 🟢 modelo existe; falta endpoint | ✅ **hecho** (G-H): `GET/PUT /api/topology/panels[/:idOrSlug]` con la matriz real, selector de panel y matrices favoritas por slug |
| `Player.userId` (jugador↔usuario) + `Statistic` | 🟢 modelo existe; falta vista con auth de jugador | ✅ **hecho** (G-D + G-G): ficha e histórico del jugador en el marcador; el temporal se declara **sin histórico** |
| `GameMode` / `GamePreset` (tipos de partida) | 🟢 existe | ✅ + **presets por gestor** (G-F, 5 por gestor). Aviso operativo: `game_modes` hay que **sembrarlo** en cada entorno nuevo (`procedimiento.md` §8) |
| Diagnóstico self-test | 🟡 parcial; faltan test-sensor y test-led | 🟡 **hecho en el repositorio (F6), sin desplegar y sin ejercer nunca.** *(La casilla anterior decía «el backend no expone `test-led`, `test-sensor`, `calibrate` ni `commands/identify`»: era cierto el 2026-07-26 y hoy es FALSO.)* `module-diagnostics.controller.ts` expone las seis rutas —`identify`, `test-led`, `test-sensor`, `calibrate`, `abort-calibration` y `GET diagnostics`—, acotadas por propiedad (módulo ajeno → **404, no 403**). **Dos decisiones de honestidad:** ordenar una prueba **no es** conocer su resultado (la llamada devuelve el comando y si el broker lo aceptó; el resultado se lee luego en `GET diagnostics`), y **no existe prueba de sensor por diana en el contrato v1**, así que se pide `self_test` y la respuesta declara que el alcance es el módulo entero. Corregido además que los diagnósticos que llegaban por MQTT **se validaban y se tiraban**: ahora se persisten. **Sin cerrar:** supervisión 1ª `NO CONFORME` (3 bloqueantes, entre ellos que `led_test` y `start_calibration` llevaban parámetros que el esquema no admite, así que **la prueba de LED y la calibración no salían nunca**), correcciones sin revisión independiente; **el bucle completo no se ha ejercido en ninguna capa**, ni siquiera contra el simulador; y la imagen del panel se compila en modo `mock`, así que desplegarlo no bastaría |
| Roles **jugador/gestor/admin** | 🔴 hoy 5 roles técnicos distintos, sin rol jugador | ✅ **hecho y desplegado** (F1), conservando los roles técnicos |
| **Propiedad de módulo** (`owner`) + vincular/desvincular | 🔴 nuevo: `Module` no tiene dueño | ✅ **hecho y desplegado** (F2): `Module.ownerId`, `link`/`unlink`, y el acotado por dueño llega ya hasta paneles y matrices |
| **Aprobación usuario→gestor + código** | 🔴 nuevo | 🟡 **hecho en el repositorio (F5), sin desplegar y con las correcciones sin revisar.** `ManagerActivation`. **Hallazgo al abrirlo:** vincular un módulo ascendía a gestor EN EL ACTO, así que los pasos 3-5 del §3.1 no es que estuvieran incompletos — no existían, y el comprador se encontraba con permisos que nunca había aceptado. Ahora vender abre un código con caducidad de 24 h que sólo puede activar su destinatario; el admin lo ve, lo regenera y lo revoca; quedarse sin módulos revoca los pendientes. **El envío real de correo sigue pendiente de SMTP** y no se afirma lo contrario: sin relay, la nota dice que NO se ha enviado nada y el código se muestra al admin para dictarlo. **Supervisión 1ª `NO CONFORME`, 4 bloqueantes corregidos y pendientes de revisión independiente**, el más serio de seguridad: el rol y los permisos salían del **token**, congelados hasta 8 h, así que un ex-gestor degradado conservaba sus permisos toda la vida del token —revocarle los códigos no servía de nada— y un recién ascendido veía menús de gestor mientras el backend le respondía 403; ahora el rol se lee **de la base en cada petición**. Otro bloqueante: la pantalla de activación **no era alcanzable desde el menú**, o sea el paso 3 del §3.1 no se podía ejercer desde el panel. **Migración `20260726200000_manager_activation` sin aplicar en producción** |
| **Usuarios temporales** | 🔴 nuevo | ✅ **hecho y desplegado** (G-D.2): identidad por partida (XOR `playerId`/`guestName`), sin `User` y **sin estadística acumulada por construcción**, no por convención |
| **Reset de estadísticas por partida** | 🔴 nuevo | 🟡 **hecho en el repositorio (F4), sin desplegar y con las correcciones sin revisar.** `POST /api/statistics/games/:gameId/participants/:participantId/reset` con permiso `stats:reset` (gestor de sus paneles + admin), auditado e idempotente. Borra `Result`, `Penalty` y `ShotCount` de ese jugador **en esa partida** —las entradas con las que se recalcula, no sólo el resultado— y **desatribuye** sus `HitEvent` sin borrarlos (telemetría inmutable). ⚠️ **La frase anterior de esta casilla, «la estadística global no se corrompe porque se deriva de los `Result`: nadie escribe la tabla `Statistic`», ERA FALSA** y sostenía todo el diseño: el escritor existe y está en `server/worker/src/tasks.ts` (`recomputePlayerStatistics`, cada 5 min); el grep que fundamentó la afirmación sólo miró `backend/src`. La supervisión lo tumbó (1ª `NO CONFORME`, 3 bloqueantes, corregidos y **pendientes de revisión independiente**): el reinicio dejaba intactos los totales globales y, peor, al reiniciar la **única** partida de un jugador el `if (results.length === 0) continue` del worker le congelaba los totales **para siempre**. Otro bloqueante: en una partida de **un solo jugador** —el modo normal del producto— el reinicio **no se veía**, porque el ranking le readjudicaba los impactos desatribuidos. **Migración `20260726210000_hit_stats_reset` sin aplicar en producción. No verificado contra el backend desplegado ni contra PostgreSQL real** |
| **Login en el panel** (JWT) + rutas reales panel↔backend | 🔴 nuevo (X-21/X-22) | ✅ login **hecho y desplegado** (F1; cierra X-22). Rutas reales: 🟡 **las pantallas nuevas sí**, las heredadas siguen en datos de demostración (X-21 parcial) |

## 5. Decisiones (2026-07-21)

1. **Roles:** ✅ conviven todos; se añaden jugador/gestor/admin y se conservan los técnicos.
2. **Código de ascenso a gestor:** ✅ por correo (obligatorio en registro), auditado y
   regenerable por el admin; caducidad 24 h. Envío real de correo pendiente de SMTP.
3. **Usuarios temporales:** ✅ identidad por partida, sin `User`, sin estadística acumulada,
   sin acceso; aislados entre partidas.
4. **Estadísticas del registrado:** ✅ globales del jugador, transversales a los gestores.
5. **Logros:** ⏳ **pendiente de concretar** qué cuenta como logro. Hasta definirlo, el panel
   del jugador muestra histórico de partidas + precisión; los «logros» (hitos calculados) se
   dejan como fase posterior.

## 6. Mejoras del panel — lote del responsable (2026-07-22)

Recogidas de la conversación de dirección del 2026-07-22. Se agrupan en bloques (G-\*)
para ejecutarse con el método de siempre (tests + supervisor por bloque). Muchas
**conectan/mejoran** lo ya existente; sólo unas pocas son construcción nueva.

### 6.1 Jerarquía de topología (diana → módulo → panel → vista)
Terminología fijada y su correspondencia con el modelo actual:
- **Diana** = 1 blanco físico = `Target`.
- **Módulo** = 3×3 dianas (9) = `Module` (+ sus `Target`). *(existe)*
- **Panel** = 3×3 módulos (9) = **`TargetSystem`** (ya agrupa módulos, tiene coordinador
  `coordinatorModuleId` y posiciones 3×3 vía `ModulePosition`). *(existe como agrupación)*
- **Vista** = hasta 3×3 paneles. *(no existe; sobre todo UI)*

Decisiones:
- La vista **no** amontona todo en una rejilla: al pasar de 9 módulos se **pagina por
  panel** (página nueva por cada 3×3). Nada de scroll infinito con 30 módulos.
- Se añade el nivel **panel** a la gestión (como el módulo agrupa dianas, el panel agrupa
  módulos), reutilizando `TargetSystem`.

### 6.2 Concurrencia de partidas («juntos o separados»)
- **Separados** (varias partidas simultáneas, cada una en su panel): **soportado de base**
  — `Game`→un `TargetSystem` y **no hay** tope de «un único juego activo» (verificado en
  `games.service`). Falta: UI para gestionar varias a la vez + **guardarraíl «un juego en
  curso por panel»**. Caso límite deseado: 4 paneles con 1 módulo cada uno en **demo
  independiente**.
- **Juntos** (2+ paneles en **una misma** partida): *(**este párrafo quedó superado el
  2026-07-26**: la Opción B **se construyó** en G-H.1 —entidad `View`, `Game.viewId`, migración
  `20260722210000_views`, `/api/views` y `ViewsPage`— en vez de diferirse, y el guardarraíl «un
  juego por panel» cubre ya las partidas sobre vistas multipanel. Se conserva el texto original
  porque explica **por qué** el motor no hubo que tocarlo. La **consolidación de tiempos T2 con
  dos coordinadores sigue SIN resolver**, como anticipaba el último punto.)* **NO soportado
  hoy** (un `Game` está atado a un solo `TargetSystem`). **DECIDIDO (2026-07-22): destino =
  Opción B** — una entidad
  **`View`** (agrupa paneles) por encima del panel; **tope en ese nivel** (2 paneles completos
  ya son un conjunto enorme de dianas; no habrá agrupaciones superiores). **NO se construye
  ahora:** se difiere a una actualización posterior y hoy sólo se dejan las **costuras** para
  que sea **aditivo**:
  - **El motor ya es agnóstico al panel:** planifica sobre `RoundConfig.targets: TargetRef[]`
    (lista plana de dianas), no sobre un sistema. B sólo tendrá que **calcular el conjunto de
    dianas de varios paneles y pasárselo al mismo motor**; el núcleo no se toca.
  - **Costura de destino de partida:** cuando llegue B, se añade la tabla `View` (paneles↔vista)
    y el `Game` podrá apuntar a **un panel o a una vista** (campo nuevo nullable + join),
    **cambio aditivo** sin migración destructiva. Hoy la atadura sigue siendo `Game→1 panel`.
  - **Nomenclatura reservada:** `panel = TargetSystem` en UI/datos ya; `vista` reservado para
    el nivel futuro. Prohibido código/copys que asuman «1 partida = 1 panel para siempre».
  - **Guardarraíl reutilizable:** el «un juego en curso por panel» (§6.2 separados) es la pieza
    que B reutilizará.
  - **Punto de diseño futuro (anotado, no bloquea):** al abarcar 2 paneles hay que decidir la
    **consolidación de tiempos T2** (cada panel tiene su coordinador → quién manda). Como B se
    difiere y hoy no se cruzan paneles, no hace falta resolverlo aún.

### 6.3 Resiliencia y reconexión (bloque G-I) — **defaults FIJADOS**

> **DESACTUALIZADO desde el 2026-07-26: los «huecos» que describe este apartado están
> implementados.** Lo que sigue se conserva como la **decisión de producto original** del
> 2026-07-22, porque es lo que fijó los defaults. **El estado real está en §6.9.** Dos
> precisiones que este texto ya no acierta: (a) el `ingest` **sí** consume y persiste la
> presencia, y el motor **sí** reacciona a las caídas; (b) decir que G-I «cierra X-06/X-18» era
> optimista — **X-06 (contrato WebSocket) sigue abierto** y la ingesta e2e tampoco se ha
> vuelto a verificar.

Cimientos ya contratados: presencia `module/{id}/presence` retenida + Last Will; `boot_id`
por arranque (ADR-0003) + idempotencia evitan duplicar impactos al reconectar. **Huecos
reales al escribir esto (2026-07-22):** el `ingest` aún no consume la presencia para
actualizar `online/bootId/lastSeenAt`, y el motor **no** reacciona a caídas (control manual).
Comportamiento por defecto **decidido (2026-07-22):**
- **Cae un módulo implicado en la ronda** → **auto-pausa** de la ronda + aviso en panel +
  cuenta atrás de reconexión; si no vuelve en X s, el **operador** decide *reanudar-sin-él*
  o *abortar*. Aplica igual con 1 solo módulo o con varios.
- **Cae el coordinador** → **pausa dura** (sin él no hay tiempos T2 fiables).

### 6.4 Modo demo — **FIJADO**
Sin jugadores (ni registrados ni temporales). Saca N dianas aleatorias (p. ej. 12), marca el
tiempo y **repite** al relanzar. **Efímero:** dura hasta salir del demo, cerrar la partida,
cambiar de modo o apagar los módulos implicados. Guarda los **10 últimos tiempos SÓLO en la
sesión** (no toca la BD de partidas/jugadores); se pierden al apagar.

### 6.5 Correo / SMTP — **FIJADO**
Dejar el flujo de invitación/activación **preparado a falta de configurar un servidor de
correo**, con un **panel de administración de SMTP** (host, puerto, credenciales, remitente,
prueba de envío). Hasta configurarlo, el código/enlace se muestra en el panel (auditado),
como en F5 (§3.1).

### 6.6 Bloques de trabajo (backlog priorizable)
- **G-A** Quick wins UX: botón apagar/toggle LED (`Prueba LED`); botón **volver** global;
  arreglar **drag de la celda central** del editor de matriz.
- **G-B** Firmware completo: **subir el binario** al backend y servirlo por HTTP local
  (para que el módulo lo descargue en la OTA); cierra de verdad el ciclo de F3.
- **G-C** Dashboard de módulos: resumen paginado (§6.1) + al pinchar, panel del módulo con
  *Ver 9 dianas · Calibración · Prueba sensores · Prueba LED · Actualizar* (integra la OTA).
- **G-D** Jugadores y equipos (F4/F5): buscar por usuario; **invitación por correo** (§6.5)
  → aceptar guarda histórico; **QR** para unirse a partida; **temporales**; crear/cambiar de
  equipo (elegible al entrar y desde el perfil); el gestor reasigna equipos a la partida.
- **G-E** Modos nuevos: **duelo** (mismas dianas a la vez a 2+ jugadores; gana más aciertos
  en menos tiempo) y **demo** (§6.4). Ambos como estrategias (`GameModeStrategy`).
- **G-F** Presets por gestor: **5 presets custom por gestor** (`GamePreset` ya existe).
- **G-G** Dashboard resultados/estadísticas estilo «máquina de dardos»: resultado de partida
  + stats del jugador actual + estado visual de las dianas + acierto/fallo.
- **G-H** Matriz avanzada: **favoritas**, nivel **panel**/paginación (§6.1) y **concurrencia**
  (§6.2, con la decisión «juntos» pendiente).
- **G-I** Resiliencia y reconexión (§6.3). *(Se anotó «cierra X-06/X-18»; **no fue así**: lo
  que cerró es la detección de caída de módulo —§6.9—, no el contrato WebSocket ni la ingesta
  extremo a extremo.)*

> **Estado de los bloques a 2026-07-26** (fuente: `docs/coordination/STATUS.md`, que es el
> documento vivo): G-A…G-H **cerrados con supervisor independiente y desplegados** en la VM
> 109; G-I **desplegado salvo D9** (el barrido de obsolescencia, `133d760`), que está en
> `develop` con tres supervisiones `NO CONFORME` ya corregidas y **la cuarta en curso**, sin
> desplegar. **Nadie ha verificado el lote con credenciales reales jugando una partida.**

### 6.7 Coordinador, emparejamiento y red (2026-07-22) — decisiones

Contexto verificado en contrato/código: el rol de coordinador es **por panel** (selector
físico `PRINCIPAL/SATELITE/AUTO`; `TargetSystem.coordinatorModuleId`). La config remota de
módulo (`module-config`, retenida) ya permite `system_id`, `network` (**dhcp/static**),
`position`, brillo y calibración. **Huecos reales:** (a) la **autoelección AUTO no está
implementada** (el selector se lee/reporta, la negociación "es de otro paquete", firmware sin
compilar); (b) **no existe campo para atar un satélite a un principal concreto** → con 2
principales en la misma red nada le dice al satélite a cuál seguir más allá del `system_id`.

Decisiones:
- **TAREA (firmware): resolver la elección de coordinador en modo AUTO.** Necesaria aunque
  luego se pueda sobrescribir por web/config. Bloqueada de facto hasta retomar el firmware
  (ESP-IDF). Anotada como pendiente de firmware.
- **DECISIÓN 1 — `coordinator_module_id` en `module-config` (aditivo).** Permite **fijar en
  remoto** a qué principal sigue cada satélite; resuelve el caso de 2 principales y reduce la
  dependencia de AUTO. Cambio de contrato aditivo. La UI (dashboard de módulos, G-C) debe
  **mostrar** rol/panel/coordinador de cada módulo (el dato ya es derivable).
- **DECISIÓN 2 — DHCP por defecto en el primer arranque**; IP fija opcional por config remota
  o por la web del propio módulo (idea V2). Ya soportado por el contrato (`network.mode`).

> Implementación real de estas tres depende de **retomar el firmware** (hoy el gran pendiente:
> nunca compilado con ESP-IDF; AUTO, aplicación de config, descarga OTA `esp_https_ota` y
> sincronización de reloj están sin terminar). El **contrato** sí se puede ampliar ya (DECISIÓN 1).
>
> **Hecho el 2026-07-26 (`ade9a21`):** DECISIÓN 1 aplicada — `coordinator_module_id` está en el
> esquema `module-config` (aditivo, con ejemplo validado), y el backend compone y publica la
> configuración deseada real (`GET /api/modules/:id/config/desired`,
> `POST /api/modules/:id/config/push`), subiendo `config_version`. La respuesta **dice
> explícitamente que publicar el deseo NO es aplicarlo**: eso sólo lo confirma el módulo en
> `config/reported`, y hoy **no hay ningún módulo que pueda confirmarlo**. La autoelección AUTO
> sigue **bloqueada** por el firmware.

### 6.8 Concurrencia, matrices favoritas y marcador (2026-07-26) — implementado

Cierre de los bloques **G-H** y **G-G** del lote. Decisiones que quedan fijadas:

- **Un panel, una partida activa.** Un panel (`TargetSystem`) sólo puede estar en UNA partida
  en estado `armed | running | paused`; `draft`, `finished` y `aborted` no ocupan hardware. Se
  comprueba al autorizar el comienzo (`GamesService.start`) y cubre las partidas que se juegan
  sobre una **vista** de varios paneles, incluidas las de otra vista que compartan panel. Dos
  partidas sobre el mismo hardware darían órdenes contradictorias al coordinador y tiempos no
  fiables, así que se rechaza con 409 nombrando la partida que ocupa el panel.
  `GET /api/games/panel-occupancy` expone qué paneles están ocupados y por qué partida.
- **Matrices favoritas guardadas por SLUG, no por id de módulo.** Una matriz favorita es una
  instantánea con nombre de la colocación de un panel. Guardarla por slug permite aplicarla a
  **otro panel** o después de **sustituir hardware**. Al aplicarla se colocan sólo los módulos
  que están en ese panel y se **informa de los que faltan** (nunca se inventa una colocación).
  Máximo 20 matrices por dueño; el gestor ve las suyas y las públicas, el admin todas.
- **El editor de matrices trabaja con datos reales** (`GET/PUT /api/topology/panels/:idOrSlug`),
  con **selector de panel** — la "paginación" de §6.1: con más de 9 módulos se edita un panel
  cada vez y los paneles se agrupan en **Vistas** para jugar sobre varios a la vez. El bloqueo
  de celda es una ayuda local del editor y **no se guarda** (se dice en pantalla).
- **Marcador estilo máquina de dardos** (`/marcador/:gameId`): resultado de la partida +
  estadística del jugador + estado visual de cada diana (acertada / impacto no válido /
  pendiente). Mientras la ronda está viva no hay `Result`, así que las filas se derivan de los
  impactos y se marcan **`provisional`**. Invariantes de honestidad: la precisión sólo se
  muestra cuando `accuracy_status === 'computed'` (si no, «no calculable», nunca 0 %), y un
  **jugador temporal** aparece explícitamente **sin histórico** en lugar de con ceros.

### 6.9 Detección de caída de módulo (2026-07-26) — implementado

> **Qué de esto corre hoy en la VM 109.** Todo lo de este apartado **salvo el barrido de
> obsolescencia** (los puntos «No todo se sabe por el Last Will», «Callar no es lo mismo que no
> ser oído» y «Un módulo dado por muerto puede volver»): ese trabajo es D9 (`133d760`), es
> **posterior al despliegue**, tiene **tres supervisiones `NO CONFORME` ya corregidas y la
> cuarta en curso**, y **no está desplegado**. Mientras no se redespliegue, en producción la
> detección de caída depende por completo del Last Will, con el agujero que aquí se describe.

Cierre del bloque **G-I**. Lo que §6.3 daba por «hueco» era peor de lo descrito: la presencia
MQTT **se validaba y se descartaba**, así que `Module.online` no lo escribía nadie y **ninguna
caída se detectaba jamás**. Estado real ahora:

- **La presencia se persiste** (`module/+/presence` y su Last Will): `online`, `lastSeenAt`,
  `offlineSince`, `boot_id`, firmware, IP y MAC. Cuentan como señal de vida también el estado,
  la telemetría y los impactos.
- **La caída se decide con una regla pura** (`decidePresenceChange`): módulo implicado en la
  ronda → auto-pausa; **coordinador de la partida** → pausa dura; módulo ajeno → sólo se
  registra. **El backend nunca reanuda solo:** volver a estar en línea no reanuda la ronda,
  porque reanudar sin un módulo cambia las condiciones de la prueba y eso lo decide una
  persona.
- **La orden de pausa se verifica.** El cliente MQTT **encola** en vez de fallar cuando no hay
  conexión, así que «he publicado» no significa «ha llegado»: se informa de `delivered` y la
  pantalla avisa de que el hardware puede seguir en marcha aunque aquí figure pausada.
- **No todo se sabe por el Last Will.** Ese mensaje puede no llegar nunca (broker reiniciado
  sin persistencia, sesión caída sucia), y entonces `online` se queda pegado a `true`. Un
  **barrido** cada 15 s (`RESILIENCE_SWEEP_MS`; sólo un `0` explícito lo desactiva, una errata
  no) da por caído a todo módulo que lleve más de **90 s** callado (`STALE_AFTER_MS`: uno vivo
  habla cada segundo). Entra por el mismo camino que un LWT, así que auto-pausa, incidencias y
  decisión del operador se comportan igual. La incidencia `module_stale` deja escrito que se
  **dedujo del silencio**: es una afirmación más débil que un LWT y hay que poder distinguirla.
- **Callar no es lo mismo que no ser oído.** El silencio sólo acusa al módulo si el backend
  estaba escuchando: con el broker desconectado —o reconectado hace menos de lo que dura el
  plazo— el barrido **no declara nada**, porque el silencio es sordera propia. Y si callan
  **todos** los módulos a la vez, se trata como fallo del camino común (incidencia
  `presence_blackout`, severidad crítica, **una por apagón y no una por barrido**) y no se
  declara ninguna caída de inmediato: lo contrario pausaría una ronda real, y la orden de
  pausa ni siquiera podría salir. Los módulos que **nunca** han dado señal no cuentan como
  prueba de apagón; si no, uno mal dado de alta taparía la caída real de otro.
  **El precio, dicho claro:** durante ese rato un fallo total y simultáneo de verdad —se va la
  luz de la sala, con un panel de dos módulos— no se distingue de un fallo del broker. Por eso
  el silencio general **sólo se tolera 4 minutos**: pasados, se declaran las caídas igualmente
  y la ronda se pausa. El motivo es que una ronda que sigue con las dianas muertas produce
  resultados basura sin que nadie se entere, y eso es peor que una pausa de más. **Matiz
  honesto:** «se reanuda con un botón» sólo vale una vez que los módulos vuelven; si entre los
  declarados está el coordinador, la pausa es dura y mientras dure el silencio la única salida
  es **abortar**. Mientras el guardarraíl está activo, la pantalla **lo dice** en lugar de
  prometer una pausa automática, igual que cuando el barrido está desactivado por
  configuración o cuando no llevamos suficiente tiempo oyendo al broker: no se anuncia lo que
  el barrido no va a hacer.
  El plazo mide silencio **oyendo**: si el broker se cae, el plazo se reinicia, porque el rato
  que estuvimos sordos no es silencio de los módulos. Un reinicio del backend también lo
  reinicia (el estado del apagón vive en memoria).
- **El aviso previo cubre también al coordinador**, aunque no aporte dianas al plan de la
  ronda: su caída provoca *pausa dura*, que es el caso más grave, y era justo el único del que
  no había aviso.
- **La caída se declara AHORA, aunque el módulo callara antes.** `offlineSince` marca el
  instante de la declaración, no el de la última señal: como el silencio tolerado (90 s) es
  mayor que la ventana de reconexión (60 s), fecharla atrás la haría nacer agotada y dejaría al
  operador sin margen justo en el caso peor sustentado. Cuánto llevaba callado no se pierde:
  sigue en `lastSeenAt` y se muestra en pantalla módulo a módulo.
- **Un módulo dado por muerto puede volver.** Si el barrido lo declaró caído pero sigue
  enviando **telemetría o impactos**, esa es prueba de que está vivo y se deshace la
  declaración; si no, no volvería nunca, porque la presencia sólo se publica al (re)conectar el
  MQTT y en este caso el MQTT no se ha caído. Los mensajes **retenidos** (`status`) no
  resucitan a nadie: se reentregan al reconectar el backend y revivirían a un módulo muerto.
- **En pantalla se dice desde cuándo**, módulo a módulo, y se avisa de «Módulo sin señal»
  antes incluso de que el barrido lo declare caído.

_Actualizado con el lote de mejoras · 2026-07-22; G-H y G-G · 2026-07-26; G-I y D9 · 2026-07-26;
barrido de documentación (§4, §6.2, §6.3, §6.6, §6.7, §6.9 y cabecera) · 2026-07-26;
**barrido de obsolescencia de §4 (F4, F5, F6) · 2026-08-04** — las tres casillas se habían
quedado en el estado del 26 de julio y dos de ellas afirmaban lo contrario de lo que hoy hay en
el repositorio_
