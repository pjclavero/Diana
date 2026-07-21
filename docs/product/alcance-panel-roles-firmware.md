# Alcance del panel: roles, propiedad de módulos y firmware

> **Origen:** requisitos de producto del responsable, 2026-07-21 (conversación de dirección).
> Fuente normativa de producto para el panel web y su backend. Complementa el dosier y el
> encargo (`docs/coordination/PROGRAM_BRIEF.md`). Estado: **borrador para confirmar**.

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

> **Decidido (2026-07-21):** el temporal es una identidad **por partida**, sin `User`, sin
> `Statistic` acumulada, sin acceso; sus números viven sólo en el `Result`/`Participant` de esa
> partida. El registrado acumula `Statistic` de forma **global**, transversal a los gestores.

## 4. Qué existe ya y qué es nuevo (verificado en el código, 2026-07-21)

| Elemento | Estado |
|---|---|
| `FirmwareVersion` (versión, sha256, firma) + `Deployment` por módulo | 🟢 modelo existe; faltan endpoints y UI |
| `ModulePosition` (topología) | 🟢 modelo existe; falta endpoint |
| `Player.userId` (jugador↔usuario) + `Statistic` | 🟢 modelo existe; falta vista con auth de jugador |
| `GameMode` / `GamePreset` (tipos de partida) | 🟢 existe |
| Diagnóstico self-test | 🟡 parcial; faltan test-sensor y test-led |
| Roles **jugador/gestor/admin** | 🔴 hoy 5 roles técnicos distintos, sin rol jugador |
| **Propiedad de módulo** (`owner`) + vincular/desvincular | 🔴 nuevo: `Module` no tiene dueño |
| **Aprobación usuario→gestor + código** | 🔴 nuevo |
| **Usuarios temporales** | 🔴 nuevo |
| **Reset de estadísticas por partida** | 🔴 nuevo |
| **Login en el panel** (JWT) + rutas reales panel↔backend | 🔴 nuevo (X-21/X-22) |

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
- **Juntos** (2+ paneles en **una misma** partida): **NO soportado hoy** (un `Game` está
  atado a un solo `TargetSystem`). **DECISIÓN DE DISEÑO ABIERTA:** (a) que un juego abarque
  varios paneles, o (b) una entidad «vista/supergrupo» por encima del panel. Pendiente de
  elegir con el responsable.

### 6.3 Resiliencia y reconexión (bloque G-I) — **defaults FIJADOS**
Cimientos ya contratados: presencia `module/{id}/presence` retenida + Last Will; `boot_id`
por arranque (ADR-0003) + idempotencia evitan duplicar impactos al reconectar. **Huecos
reales hoy:** el `ingest` aún no consume la presencia para actualizar `online/bootId/
lastSeenAt`, y el motor **no** reacciona a caídas (control manual). Ligado a X-06/X-18.
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
- **G-I** Resiliencia y reconexión (§6.3); cierra X-06/X-18.

_Actualizado con el lote de mejoras · 2026-07-22_
