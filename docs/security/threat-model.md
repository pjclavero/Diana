# Modelo de amenazas · Diana

**Revisión independiente.** Redactado por el equipo de seguridad, que no ha escrito
ninguna de las líneas que audita. Fecha: 2026-07-20. Rama `develop` (Ola 1 integrada),
commit `559fd1a`.

Los hallazgos numerados que se citan aquí (`F-01` …) están en
[`findings.md`](findings.md); los riesgos asumidos a propósito, en
[`accepted-risks.md`](accepted-risks.md); la salida real de los comandos, en
[`evidence/`](evidence/).

---

## 1. Sistema bajo análisis

Módulos ESP32-S3 (uno de ellos con rol PRINCIPAL/coordinador) publican eventos de
impacto por MQTT a un backend NestJS con PostgreSQL y panel React, todo en Docker sobre
una VM Debian (`192.168.1.209`) dentro de una LAN doméstica. Sin salida a Internet por
diseño (SECURITY.md, dosier §26.4).

Frontera de confianza principal: **la LAN**. Todo el diseño actual descansa en que quien
está en la LAN es de fiar. Ese supuesto es el que este documento pone a prueba.

## 2. Activos

| # | Activo | Por qué importa | Dónde vive |
|---|---|---|---|
| A1 | Integridad de los eventos de impacto | Es el resultado deportivo: quién ganó. Un impacto falso o suprimido invalida la competición | `hit_events` en PostgreSQL, tópico `…/module/{id}/hit` |
| A2 | Credenciales MQTT de los módulos | Con una sola se entra al bus de control | `infrastructure/mosquitto/passwd`, NVS del ESP32 |
| A3 | Secreto de firma JWT | Con él se forjan sesiones de administrador | `.env` del despliegue |
| A4 | Control de los actuadores del módulo | Diana **dispara proyectiles**: mover objetivos o forzar mantenimiento tiene consecuencias físicas | comandos MQTT `…/command` |
| A5 | Canal OTA / firmware | Ejecución de código persistente en los módulos | `…/ota`, particiones A/B |
| A6 | Datos personales de jugadores y auditoría | Nombres, resultados, registro de acciones administrativas | PostgreSQL |
| A7 | La VM y su acceso SSH | Compromiso total del sistema | `diana-admin@192.168.1.209` |

## 3. Actores

Se descarta explícitamente al atacante remoto de Internet: no hay exposición externa
(cortafuegos verificado, ver `evidence/vm-exposicion.md`). Los cinco actores del encargo:

### T1 · Alguien en la LAN, sin credenciales

**Qué alcanza hoy:** los puertos 22, 80/443 y **1883** desde `192.168.1.0/24` (regla nft
verificada). El broker rechaza el anónimo (`mosquitto.conf:29`), pero **1883 va en claro**:
un CONNECT MQTT lleva usuario y contraseña sin cifrar. En una LAN doméstica con WiFi, la
captura pasiva es realista.

**Qué consigue:** con capturar un solo arranque de módulo obtiene A2 y se convierte en T3.
Además ve todo el tráfico de juego y de control en claro. Puede conectarse al WebSocket
`/live` sin autenticarse (F-05).

**Qué lo impide hoy:** nada más allá de estar dentro de la LAN. → **F-03**, **F-05**.

### T2 · Un módulo comprometido (credenciales legítimas, firmware manipulado)

**Qué consigue:** la ACL está bien pensada tópico a tópico —**no** puede escribir su propio
`config/desired` ni su `ota`, que es justo el fallo que el contrato §8 documenta y evita—.
Puede inyectar impactos falsos en su propio `hit` y falsear su telemetría.

**Qué lo impide hoy:** la ACL enumerada (`infrastructure/mosquitto/acl:51-65`) y el hecho de
que sólo el backend escriba `system/#`, `config/desired` y `ota`. Este control **funciona**
y merece decirse.

**Lo que no impide:** que el módulo se presente con otro `client_id`. → **F-02**.

### T3 · Un módulo suplantado

**Qué consigue:** todo lo de T2, pero **en nombre de otro módulo**. Como la ACL autoriza por
`%c` (el `client_id`, valor que elige libremente el cliente en el CONNECT) y no por `%u`
(el usuario autenticado), unas credenciales cualesquiera de módulo bastan para publicar
`hit`, `status`, `presence`, `telemetry`, `diagnostic` y `config/reported` **de cualquier
otro módulo**. Con eso se manipula A1 sin tocar el hardware ajeno.

Si además el rol de coordinador está activado para ese `module_id`, el suplantador hereda
`module/+/command` y `system/…/game/*`: control de la partida entera y de A4.

**Qué lo impide hoy:** nada. El firmware sí comprueba `module_id` en los comandos que
recibe (`command.c`), pero el broker no comprueba nada al publicar. → **F-02**.

> **Nota (2026-08-05, carril ACL/F-02):** F-02 se ha cerrado —
> `use_username_as_clientid true` + usuario mosquitto igual al `module_id` (sin prefijo),
> verificado contra un broker real (`docs/security/evidence/mqtt-acl.md`, apartado
> "2026-08-05"). T3 tal como se describe arriba ya no es posible: la reproducción exacta del
> ataque (credenciales de un módulo, `client_id` de otro) se repitió contra el broker de
> prueba y el broker la rechazó. Este documento no se reescribe por respeto a la foto fija
> del 2026-07-21; queda esta nota como referencia de vigencia.

### T4 · Un operador malicioso (usuario legítimo del panel)

**Qué consigue:** lo que su rol permita. El RBAC por permisos es real y se aplica como guard
global (`app.module.ts:77-80`); los CRUD genéricos filtran los campos escribibles con una
lista blanca (`crud.service.ts:45-56`), así que **no hay escalada por asignación masiva**;
`UsersService` nunca devuelve el hash y la auditoría redacta credenciales a cualquier
profundidad (`audit.service.ts:17-46`). Todo esto está bien hecho.

**Lo que sí puede:** exportar CSV con celdas que ejecutan fórmulas en el Excel de otro
(F-09); seguir operando 8 h con un token ya emitido después de que se le retire el rol o se
le desactive, porque los permisos viajan dentro del JWT y no hay revocación (F-12); y, si
sabe leer `docker logs`, recuperar la contraseña inicial del administrador (F-11).

**Diana no modela propiedad de recursos:** partidas, rondas y jugadores son datos de la
instalación, no de un usuario. Se ha buscado IDOR explícitamente y **no aplica**: no hay
endpoint que deba comprobar propiedad además de rol. Se documenta para que no se confunda
"no encontrado" con "no buscado".

### T5 · Acceso físico a un módulo

**Qué consigue:** el firmware se compila con `CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT`
(sólo verificación de firma), **sin secure boot ni cifrado de flash**. Quien tenga el módulo
en la mano puede reflashearlo por USB/UART saltándose toda la cadena, y leer la partición
`nvs_key` y la NVS en claro: se lleva A2 y se convierte en T3 con credenciales auténticas.

**Qué lo impide hoy:** nada técnico; sólo la custodia física. → **F-14**.

### T6 · Quien obtenga la clave SSH privada del operador

Actor que el encargo pide dictaminar. `diana-admin` tiene `NOPASSWD:ALL` y pertenece al
grupo `docker`; la clave es el **único** factor. Ver el dictamen completo en **F-15**.

## 4. Superficie de ataque

| Superficie | Estado verificado | Hallazgo |
|---|---|---|
| SSH 22/tcp (LAN + Tailscale) | root deshabilitado, sin contraseñas, 1 clave autorizada, `fail2ban` inactivo | F-15, F-18 |
| HTTP 80/443 → nginx → panel y API | cabeceras de seguridad completas, `limit_req`, CSP con `frame-ancestors 'none'` | F-07, F-08 |
| API REST `/api/**` | JWT + permisos como guards globales, `ValidationPipe` estricto, `helmet` | F-04, F-06, F-12 |
| WebSocket `/live` | **sin autenticación y con CORS reflejado** | F-05 |
| MQTT 1883/tcp (toda la LAN) | sin anónimo, con ACL, **sin TLS**, autorización por `client_id` | F-02, F-03 |
| Canal de comandos → módulo | `nonce` persistido en NVS + `command_id` + caducidad; techo de 30 s para acciones críticas | F-16 |
| Canal OTA → módulo | sha256 + tamaño + placa + versión + firma delegada a ESP-IDF; prohibida en partida; rollback A/B | F-14 |
| PostgreSQL | **no publicado al host** en `compose.yml` (sí en `compose.dev.yml`, documentado) | — |
| Repositorio git | sin secretos en árbol ni en historial; `.gitignore` con un agujero real | F-01 |

## 5. Lo que este modelo NO cubre

- No se ha ejecutado el stack: en la VM **no hay ningún contenedor en marcha** (`docker ps`
  vacío) y faltan los `Dockerfile` de backend y worker (F-13). Todo lo relativo al
  comportamiento en ejecución de la API está deducido del código, no observado, y así se
  marca en `findings.md`.
- No se ha probado el firmware sobre hardware real: no existe. El propio
  `sdkconfig.defaults` avisa de que nunca se compiló con ESP-IDF.
- No se ha atacado el broker en la VM: había otro agente desplegando y la instrucción era no
  tocar nada. F-02 y F-03 se entregan con procedimiento de reproducción exacto para que se
  confirmen en un entorno desechable.
