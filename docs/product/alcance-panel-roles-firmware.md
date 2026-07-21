# Alcance del panel: roles, propiedad de módulos y firmware

> **Origen:** requisitos de producto del responsable, 2026-07-21 (conversación de dirección).
> Fuente normativa de producto para el panel web y su backend. Complementa el dosier y el
> encargo (`docs/coordination/PROGRAM_BRIEF.md`). Estado: **borrador para confirmar**.

Este documento fija lo que el usuario debe poder hacer desde el panel de Diana. Nace de
constatar (hallazgos X-21/X-22) que el panel y el backend se construyeron sobre modelos de
datos distintos y que el modelo de roles/propiedad que se necesita no estaba definido.

## 1. Roles (mínimo 3)

| Rol | Quién es | Qué puede hacer |
|---|---|---|
| **Jugador** | Persona que dispara. Registrado o **temporal**. | Iniciar sesión y ver **sus** partidas, estadísticas y logros. Nada de gestión. |
| **Gestor** | Dueño de uno o varios módulos. | Gestiona sus módulos, partidas y topología; acepta actualizaciones de firmware para sus módulos; da de alta jugadores (registrados o temporales); desvincula módulos suyos; diagnostica módulos; resetea estadísticas de un jugador en una partida. |
| **Admin** | Administrador del sistema. | Todo lo del gestor + sube versiones de firmware, vincula/desvincula módulos de cualquier dueño, y aprueba el ascenso de usuario → gestor. |

> Decisión pendiente: si los roles actuales del backend (operador, árbitro, consulta,
> mantenimiento) se retiran, se renombran o conviven como variantes. Propuesta: el núcleo es
> **jugador / gestor / admin**; árbitro y consulta pueden modelarse como permisos acotados
> dentro de una partida, no como roles de primer nivel.

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

### 3.1 Ascenso a gestor
1. Un usuario (jugador) solicita el rol de gestor desde el panel.
2. Un admin ve la solicitud y la **aprueba**.
3. El sistema **envía un código** al solicitante; al introducirlo, queda activado como gestor.

> Decisión pendiente: **canal del código** (correo — el usuario ya tiene `email`—, o mostrado
> en pantalla al admin para entrega manual) y **caducidad** del código.

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
- Un jugador **registrado** se enlaza a un `User` (`Player.userId`) y ve sus logros.
- Un jugador **temporal** existe para una partida sin cuenta permanente.
- Gestor/admin pueden **resetear** las estadísticas de un jugador **en una partida** concreta.

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

## 5. Preguntas abiertas antes de construir

1. **Roles:** ¿núcleo jugador/gestor/admin y se retiran operador/árbitro/consulta/mantenimiento,
   o conviven?
2. **Código de ascenso a gestor:** ¿canal (correo / pantalla) y caducidad?
3. **Usuarios temporales:** ¿caducan solos (p. ej. al terminar la partida / a las 24 h) o los
   borra un gestor?
4. **Logros:** ¿qué cuenta como «logro» (hitos calculados de estadísticas) o es sólo el
   histórico de partidas y precisión?

_Borrador · 2026-07-21 · pendiente de confirmación del responsable_
