# Riesgos asumidos · Diana

**Revisión independiente (WP-10).** Fecha: 2026-07-21. Rama `develop`, commit `e459f7d`.

Este documento recoge los riesgos que Diana asume **a propósito**, no los defectos que hay
que corregir (ésos están en [`findings.md`](findings.md)). Un riesgo aceptado no es un riesgo
ignorado: es una decisión con nombre, con la condición exacta bajo la que deja de ser
aceptable, y con alguien que la firma.

El equipo de seguridad **propone** estas aceptaciones y documenta su razonamiento. **No las
firma**: la aceptación de un riesgo es una decisión del propietario del sistema, no del
auditor. La columna "Acepta" queda pendiente de firma hasta que la persona indicada lo haga
por escrito. Mientras esa firma no exista, el riesgo está *propuesto para aceptación*, no
aceptado.

| # | Riesgo | Severidad si se materializa | Deja de ser aceptable cuando… | Propone | Firma |
|---|---|---|---|---|---|
| R-01 | La clave SSH privada del operador es el único factor de autenticación de toda la instalación (F-15) | Compromiso total (A7) | la instalación crezca a más de un operador, o la clave viva en un dispositivo compartido, o no tenga frase de paso | WP-10 | *pendiente — propietario del sistema* |
| R-02 | Frontera de confianza en la LAN: se supone que quien está en la red doméstica es de fiar | Depende del vector | Diana deje de ser una instalación doméstica de un solo hogar (evento público, red compartida, invitados con acceso WiFi) | WP-10 | *pendiente — propietario del sistema* |
| R-03 | Firmware sin secure boot ni cifrado de flash; se confía en la custodia física de los módulos (F-14) | Robo de credenciales MQTT (A2) → suplantación (A1, A4) | los módulos se desplieguen fuera de custodia (competición pública, almacenaje sin control) **o** antes de que F-02 esté cerrado | WP-10 | *pendiente — WP-04 + propietario* |
| R-04 | Vulnerabilidades de dependencias de desarrollo/construcción sin resolver (F-17), salvo `effect`/`prisma` | Compromiso de la cadena de build | cualquiera de ellas gane un vector de ejecución en el contenedor de producción, o aparezca un PoC remoto | WP-10 | *pendiente — WP-07* |
| R-05 | Sin salida a Internet por diseño: no hay Let's Encrypt, ni actualizaciones automáticas de imágenes de contenedor, ni telemetría externa | Deriva de versiones, TLS con CA propia | Diana necesite integrarse con un servicio externo (marcador público, federación) | WP-10 | *pendiente — propietario del sistema* |

---

## R-01 · La clave SSH es el único factor de autenticación

**Qué se acepta.** Que el acceso administrativo completo a la VM 109 —y, a través del grupo
`docker` y del `.env`, a todo el sistema y sus secretos— dependa de un solo objeto: la clave
privada SSH del operador. No hay segundo factor, no hay contraseña de sudo que frene el
movimiento lateral (la cuenta la tiene bloqueada y `NOPASSWD:ALL`), y no hay separación entre
autenticarse y ser root.

**Por qué es defendible.** Es una instalación doméstica operada por una sola persona. Añadir
MFA a SSH, bastión o separación de privilegios en un sistema de un usuario introduce más
complejidad operativa que reducción de riesgo real, y la complejidad operativa mal gestionada
es a su vez una fuente de fallos. La superficie de autenticación remota ya está minimizada:
sin root remoto, sin contraseñas, una sola clave, `fail2ban` aparte (F-18). El dictamen de
F-15 es que la configuración es correcta *para este contexto*.

**Condición bajo la que deja de ser aceptable.** Cualquiera de estas tres:
1. La instalación pasa a tener más de un operador. Con dos personas ya hay que poder revocar
   a una sin afectar a la otra, y una única clave compartida lo impide.
2. La clave privada vive en un dispositivo compartido o sin cifrado de disco.
3. **La clave no tiene frase de paso.** Esto no se ha verificado —está fuera del alcance de la
   revisión— y es la condición más urgente. Sin frase de paso, un robo del portátil es un
   robo del sistema, sin ningún paso intermedio.

**Mitigación mínima antes de firmar** (F-15): confirmar frase de paso en la clave; añadir una
segunda clave de recuperación custodiada aparte; activar registro de sudo.

**Quién acepta.** El propietario del sistema (pjclavero). No el equipo de seguridad.

---

## R-02 · La frontera de confianza es la LAN

**Qué se acepta.** Que todo el modelo de seguridad de Diana descanse en el supuesto de que
quien está dentro de la LAN doméstica es de fiar. De ese supuesto dependen, de forma directa,
la severidad efectiva de F-03 (MQTT en claro), F-05 (WebSocket sin autenticar), F-07 (HTTP sin
TLS) y F-16 (SNTP sin autenticar). Todos ellos son explotables *desde la LAN* y sólo desde la
LAN, porque no hay exposición externa —cortafuegos verificado, `evidence/vm-exposicion.md`—.

**Por qué es defendible.** El dosier lo declara como decisión de diseño (SECURITY.md, §26.4):
sin salida a Internet, sin exposición de puertos al exterior. En una red doméstica de un solo
hogar, el conjunto de personas con acceso a la LAN es pequeño y conocido, y el coste de cifrar
y autenticar cada canal interno —TLS en MQTT con CA propia distribuida a cada módulo, HTTPS,
NTP autenticado— es real y recae sobre WP-01, WP-04 y WP-05.

**Matiz importante.** Aceptar R-02 **no** vacía de contenido F-02. F-02 es crítico
*precisamente dentro* de la frontera de confianza aceptada: no requiere romper la LAN, sino
que un módulo o un cliente ya presente en ella suplante a otro. R-02 acepta confiar en las
*personas* de la LAN; no obliga a confiar en que cada *módulo* es quien dice ser. Esa segunda
confianza es la que F-02 rompe y hay que corregir aparte.

**Condición bajo la que deja de ser aceptable.** Que la LAN deje de ser doméstica y cerrada:
un evento con público, una red compartida con invitados, WiFi accesible desde fuera del
hogar, o la integración de un dispositivo no controlado en la red. En cualquiera de esos
casos, la lista F-03/F-05/F-07/F-16 sube de "aceptado por contexto" a "hay que cerrar antes
de operar".

**Quién acepta.** El propietario del sistema.

---

## R-03 · Custodia física en lugar de secure boot

**Qué se acepta.** Que los módulos ESP32-S3 se protejan por custodia física en lugar de por
secure boot y cifrado de flash (F-14). Quien tenga un módulo en la mano puede leer sus
credenciales MQTT.

**Por qué se propone como aceptable, con reserva.** Activar secure boot v2 y cifrado de flash
es **irreversible** —quema eFuses—, complica todo el ciclo de desarrollo y depuración, y exige
custodia rigurosa de la clave privada de firma, cuya pérdida deja los módulos inservibles y
cuya fuga anula la protección. Para un proyecto que todavía **no ha compilado el firmware ni
tiene hardware**, quemar eFuses es prematuro. Es razonable diferir la decisión.

**La reserva es dura y condiciona la firma.** Este riesgo **sólo es aceptable si F-02 se
cierra primero**. El razonamiento es en cadena: sin secure boot, robar un módulo entrega sus
credenciales (F-14); con F-02 abierto, esas credenciales sirven para suplantar a *todos* los
demás módulos (F-02); luego, mientras F-02 esté abierto, el compromiso físico de *un* módulo
es el compromiso de *todo* el sistema. Cerrar F-02 (una línea en `mosquitto.conf`) rompe esa
cadena y convierte el robo de un módulo en la pérdida de *ese* módulo, que es un riesgo
acotado y asumible. Aceptar R-03 con F-02 abierto no lo es.

**Actualización (2026-08-05, carril ACL/F-02): F-02 se ha cerrado** —
`use_username_as_clientid true` en `mosquitto.conf` + usuario mosquitto de módulo igual a su
`module_id`, verificado contra un broker real (12/12 pruebas de `test-acl.sh`, incluida la
reproducción exacta del ataque del 2026-07-21, que ahora falla — ver
`evidence/mqtt-acl.md`, apartado "2026-08-05"). Se levanta la condición 1 de abajo. La
condición 2 y la decisión de firma siguen siendo de WP-04 y el propietario; este carril no
la toma por ellos.

**Condición bajo la que deja de ser aceptable.**
1. ~~F-02 sigue abierto (bloqueante para la firma de R-03).~~ Cerrado el 2026-08-05 (ver arriba).
2. Los módulos se despliegan fuera de custodia: competición pública, transporte por terceros,
   almacenaje sin control de acceso.

**Quién acepta.** WP-04 y el propietario, conjuntamente. La precondición de F-02 ya está
satisfecha; queda su firma sobre la condición 2 y el resto de matices de este documento.

---

## R-04 · Vulnerabilidades de dependencias de desarrollo sin resolver

**Qué se acepta.** Que el grueso de las 31 vulnerabilidades de `npm audit` (F-17) —las que
están en `picomatch`, `webpack`, `esbuild` y su cadena de `vite`/`vitest`— se difieran, por
estar en dependencias de desarrollo y construcción y no en el camino de ejecución del
contenedor de producción.

**Por qué es defendible.** Explotar `webpack buildHttp` o el servidor de desarrollo de
`esbuild` exige control sobre el proceso de build o sobre la máquina de desarrollo, no sobre la
API desplegada. En una instalación sin CI/CD expuesto y sin build en producción, el vector
está fuera del alcance de los actores del modelo (T1–T6).

**Qué NO se acepta y por tanto no entra en R-04.**
- `effect`/`prisma` en el worker: es dependencia transitiva de ejecución, no de desarrollo, y
  la contaminación de `AsyncLocalStorage` puede darse en producción. Va a corrección, no a
  aceptación.
- **La vulnerabilidad crítica de `simulators`**, porque **está sin identificar**: el resumen la
  cuenta pero el cuerpo del informe no la nombra, y no se ejecutó `npm audit --json`. No se
  puede aceptar lo que no se ha identificado. Hasta que se ejecute el `--json` y se sepa qué
  es, queda como acción abierta en F-17, no como riesgo aceptado.

**Condición bajo la que deja de ser aceptable.** Que cualquiera de las dependencias diferidas
gane un vector de ejecución en producción, que aparezca un PoC de explotación remota, o que se
monte CI/CD que ejecute el build en una máquina con acceso a secretos.

**Quién acepta.** WP-07, tras ejecutar `npm audit --json` y decidir dependencia a dependencia.
No antes: aceptar en bloque sin la lista detallada sería aceptar a ciegas.

---

## R-05 · Aislamiento de Internet y sus consecuencias

**Qué se acepta.** Que Diana no tenga salida a Internet por diseño, con las tres
consecuencias que se derivan: no hay certificados Let's Encrypt (el TLS de F-07 será con CA
propia), no hay actualización automática de las imágenes de contenedor (la gestión de
versiones es manual), y no hay telemetría ni copia externa.

**Por qué es defendible.** Es la decisión de diseño que *sostiene* buena parte del modelo de
amenazas: al no haber exposición externa, se descarta explícitamente al atacante remoto de
Internet (threat-model §3), que es la clase de atacante más numerosa y automatizada. El
aislamiento compra más seguridad de la que cuesta.

**Qué obliga a compensar.** El aislamiento no es gratis: al no haber actualización automática
de imágenes, la deriva de versiones —y con ella el crecimiento de F-17— hay que gestionarla a
mano. `unattended-upgrades` cubre el sistema operativo de la VM (verificado activo, F-18),
pero **no** las imágenes de contenedor. Eso es una tarea recurrente que alguien debe asumir.

**Condición bajo la que deja de ser aceptable.** Que Diana necesite integrarse con un
servicio externo: un marcador público, federación entre instalaciones, notificaciones. En ese
momento aparece una superficie externa y hay que rehacer el modelo de amenazas desde §3.

**Quién acepta.** El propietario del sistema.

---

## Lo que este documento NO acepta

Para que no haya confusión entre "aceptado" y "pendiente de corregir", se deja constancia
expresa de que **ninguno** de los siguientes está aceptado; todos van a corrección:

- **F-01** (`.gitignore`): el arreglo es una línea; no hay nada que aceptar.
- **F-02** (ACL por `client_id`): crítico, y además bloqueante para R-03. **Cerrado el
  2026-08-05** (ver actualización en R-03 más arriba y `evidence/mqtt-acl.md`).
- **F-04** (`JWT_SECRET` y contrato de entorno roto): rompe el arranque hoy y esconde una
  puerta trasera para mañana. Corrección obligatoria.
- **F-05** (WebSocket sin autenticar): corrección.
- **F-13** (`Dockerfile` ausentes): ya en curso en WP-08.
- La reserva `'desarrollo-inseguro-cambiar'` del código: debe desaparecer, no aceptarse.

Aceptar un riesgo es una decisión que se toma con la información completa y con la firma de
quien responde por el sistema. Este documento deja la información completa y las firmas
pendientes.
