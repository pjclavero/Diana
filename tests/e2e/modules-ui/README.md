# BROWSER-E2E-REAL · gestión de módulos desde un navegador de verdad

Un escenario de **10 pasos** ejecutado en Chromium real contra el **panel real**
(el `dist` compilado en modo `real` y servido por el mismo nginx no privilegiado
de producción), el **backend real** (`NODE_ENV=production`), **PostgreSQL real**
y **Mosquitto real** (TLS 8883, `allow_anonymous false`, la ACL del repositorio
montada en solo lectura).

Rama `lane/e2e-modules-ui`, base `integration/real` @ `c1d051e`.

## Lo que este carril NO hace

- **Ni un `page.route()`.** Ni interceptación HTTP, ni mock, ni backend falso, ni
  fixtures de respuesta. El panel se construye con `VITE_API_MODE=real` y el
  guardián de `vite.config.ts` queda **intacto**.
- **Ni un heartbeat fabricado.** No se publica `provision/state`, ni
  `config/reported`, ni un `hit`. En el broker sólo existe el usuario `backend`:
  **no hay ninguna credencial de módulo**, así que la ausencia de dispositivos es
  estructural y no una promesa. Con cero dispositivos el panel tiene que enseñar
  **0 módulos ONLINE**, y eso es lo que se comprueba (paso 7).
- **Ningún HTTP 200 cuenta como evidencia.** Cada efecto se lee en PostgreSQL con
  `psql` dentro del contenedor, y el `rc` del `psql` se comprueba siempre: una
  salida vacía de un `psql` que reventó se leería como «cero filas».
- **Producción y VM109: intactas.** Todo son contenedores efímeros con nombres
  propios (`diana-e2emodui-*`), puertos altos propios y `--tmpfs` para los datos.

## Orden exacto, reproducible

Desde la raíz del repositorio:

```bash
# 1. Imagen del BACKEND (contexto = raíz; necesita contracts/)
docker build -f tests/e2e/game/harness/Dockerfile.e2e -t diana/backend:e2emodules .

# 2. Imagen del PANEL en modo real (hornea la URL del backend en el bundle)
./tests/e2e/modules-ui/harness/build-frontend.sh

# 3. Imagen del NAVEGADOR (ver §Navegador en contenedor)
docker pull mcr.microsoft.com/playwright:v1.48.2-jammy

# 4. Dependencias de la suite (no toca package-lock.json)
cd tests/e2e && npm install --no-save --no-package-lock && cd ../..

# 5. Levantar el escenario (red, postgres, mosquitto, migraciones, semilla de
#    referencia, backend, primer acceso del admin, usuario de menor privilegio
#    y panel). Idempotente: derriba lo anterior primero.
./tests/e2e/modules-ui/harness/up.sh

# 6. Arrancar el servidor de navegador. SIEMPRE DESPUÉS de up.sh: up.sh borra
#    .tmp/, y ahí es donde vive el `wsEndpoint`.
./tests/e2e/modules-ui/harness/browser-up.sh

# 7. Ejecutar
cd tests/e2e && npm run test:modules-ui

# 8. Derribar
cd ../.. && ./tests/e2e/modules-ui/harness/browser-down.sh
./tests/e2e/modules-ui/harness/down.sh
```

Resultado medido en esta máquina: **10 passed (21,5 s)**, `rc=0` del `playwright
test` (no de un `tail` ni de un wrapper).

## Qué se hace por NAVEGADOR y qué por API

La pantalla de módulos del panel es **de sólo lectura**: no tiene formulario de
alta ni de edición (`server/frontend/src/pages/modules/ModulesPage.tsx`). Así que
el reparto es:

| Paso | Navegador | API real | Veredicto |
|---|---|---|---|
| 1 · estado vacío | iniciar sesión, abrir «Módulos», leer el vacío | — | `select count(*) from modules` = 0 |
| 2 · alta | ver aparecer la fila y el resumen | `POST /api/modules` | fila en `modules`: `online=false`, `last_seen_at IS NULL`, `desired_config_version=0` |
| 3 · recargar | `page.reload()` | — | mismo `id` en la BD |
| 4 · reiniciar backend | volver a abrir la pantalla | — | mismo `id`, mismo nombre, misma versión tras `docker restart` |
| 5 · configuración | — | `POST /:id/config/push`, `PATCH /:id`, `POST /api/targets`, `POST /api/calibration` | `desired_config_version` sube **exactamente 1** por empujón; `config_state='pending'`; `reported_config_version` sigue NULL |
| 6 · persistencia | recargar y desplegar la ficha | — | el veredicto de configuración **no** es «aplicada»; `config_state='pending'` |
| 7 · **no ONLINE** | leer el resumen y la insignia | — | `online=false`, `last_seen_at IS NULL`, 0 filas en línea en toda la tabla |
| 8 · revocar/deshabilitar | ver «en mantenimiento» | `POST`/`DELETE /:id/mqtt-identity`, `PATCH /:id` | 0 filas en `module_mqtt_credentials`; `maintenance` a true y de vuelta a false |
| 9 · permisos | — | login `consulta_e2e` + 6 llamadas | los 403 no dejan rastro: la fila es idéntica campo a campo |
| 10 · identidad | — | 8 `PATCH` prohibidos | los 8 dan 400 y la fila es idéntica campo a campo |

El paso 7 se comprueba **tres veces y por tres caminos**: la bandera y la marca
de tiempo en la BD, el recuento global de la tabla, y lo que el navegador pinta
(resumen «0 en línea» / «1 pendientes de primera conexión», insignia
«pendiente» con clase `badge--muted` y **sin** `badge--ok`, y «Última señal: —»).
Además, un `afterAll` recorre la tabla entera y exige que ninguna fila haya
acabado en línea.

## Divergencias declaradas

1. **Imagen del backend**: se reutiliza `tests/e2e/game/harness/Dockerfile.e2e`,
   que ya declara su única diferencia con producción (el `chown -R diana:diana
   /app` acotado, porque con docker rootless sobre fuse-overlayfs no termina).
   No se añade ninguna diferencia nueva.
2. **Imagen del panel**: `harness/Dockerfile.frontend.e2e` es
   `server/frontend/Dockerfile` **sin ninguna diferencia de sustancia**. El
   `chown -R` problemático **no existe** en el Dockerfile del frontend (sólo hay
   `COPY --chown` de `nginx.conf` y del `dist` ya construido), así que este
   carril **no necesita** la divergencia del backend y no la introduce.
3. **Navegador en contenedor** (ver abajo).
4. **El arnés no siembra topología**, al revés que el del carril GAME: el paso 1
   mide el vacío real. `up.sh` verifica en la BD que empieza con 0 módulos y
   aborta si no.

## Navegador en contenedor

Esta máquina **no puede ejecutar Chromium**: le faltan 13 bibliotecas del
sistema y no hay `sudo` para instalarlas. Medido:

```
ldd ~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome | grep 'not found'
→ libnss3, libnspr4, libnssutil3, libsmime3, libatk-1.0, libatk-bridge-2.0,
  libatspi, libcups, libcairo, libpango-1.0, libasound, libXdamage, libxkbcommon
```

Por eso el navegador corre en `mcr.microsoft.com/playwright:v1.48.2-jammy` —
**exactamente** la versión que fija `tests/e2e/package.json` — arrancado con el
`playwright` **del repositorio** montado en solo lectura. Usar `npx playwright`
dentro de la imagen **no** vale: se descarga la última versión de la red
(medido: arrancó un servidor 1.63 y el cliente 1.48 lo rechazó con «Playwright
version mismatch»), y entonces el navegador no sería el que la suite declara.

`--network host` mantiene válidas las URL **horneadas** en el bundle
(`http://127.0.0.1:13087`): Vite sustituye `import.meta.env.*` en tiempo de
compilación, así que reescribirlas para el contenedor significaría probar un
artefacto distinto del que se despliega. Que ese modo alcanza los puertos
publicados se comprobó **por efecto** antes de adoptarlo:
`docker run --rm --network host alpine wget -qO- http://127.0.0.1:13087/api/health`
→ `{"status":"ok"}`.

Sigue siendo un navegador real: mismo Chromium, mismo protocolo, mismo bundle,
mismo nginx.

## Calibración

Ver [CALIBRACION.md](CALIBRACION.md). Dos mutaciones, las dos **verificadas con
`grep` dentro de la imagen efectivamente desplegada** antes de medir, y las dos
revertidas después con verde comprobado.

## Hallazgos

Ninguno se ha disfrazado para que la prueba pase; todos se miden tal cual.

1. **`POST /modules/:id/config/push` devuelve 500 en un módulo recién dado de
   alta.** El contrato congelado `contracts/mqtt/module-config.schema.json` exige
   `calibration` con 9 elementos y un módulo virgen no tiene dianas: el backend
   se niega —correctamente— a publicar un mensaje inválido, pero lo hace con
   *Internal Server Error*. Una precondición del recurso es un 4xx. Además, la
   versión deseada **avanza igualmente** (la reserva es atómica y va antes de
   publicar): está documentado como deliberado en `ModuleConfigService.push` («un
   hueco en la secuencia no rompe nada, un número repetido sí») y la prueba
   comprueba ese invariante, no lo cómodo.
2. **El estado de configuración llega al panel como «desconocida».** El backend
   emite `desiredConfigVersion` / `reportedConfigVersion` / `configState`
   (`modules-overview.service.ts`) y el panel lee `configVersionDesired` /
   `configVersionReported` / `configStatus` (`api/modulesApi.ts`): los nombres no
   casan. El panel hace **lo correcto** ante el dato ausente —dice «desconocida»,
   no «aplicada»—, así que el fallo es visible, no silencioso. La prueba acepta
   «pendiente» o «desconocida» y prohíbe «aplicada», para no bloquear al carril
   que está arreglando el nombre.
3. **La emisión de credencial MQTT no es ejecutable en el despliegue tal y como
   se entrega.** Le faltan tres piezas, las tres medidas:
   `infrastructure/mosquitto/generate-identities.mjs` no está en la imagen del
   backend; `DIANA_MOSQUITTO_PASSWD_FILE` no está configurado (el backend lo
   avisa al arrancar: «Autoridad de credenciales MQTT INACTIVA»); y el binario
   `mosquitto_passwd` no existe en `node:20.19-bookworm-slim`. `compose.yml`
   tampoco monta las dos primeras al servicio `backend` (monta ACL y `passwd`
   **al broker**, líneas 342-344; al backend sólo el `ca.crt`, línea 177). El
   comportamiento observado es **fallar cerrado** —400 con el motivo escrito y
   **cero** filas en `module_mqtt_credentials`—, que es el lado correcto del
   error. **No se ha parcheado la imagen para poner esto en verde.**
4. **`GET /api/systems/system-a/status` devuelve 500** con
   `Inconsistent column data: Error creating UUID … found 's' at 1`: el panel de
   inicio pide el sistema por el slug `system-a` y el backend lo busca por UUID.
   Se ve en la pantalla de inicio como «Internal server error». Fuera del alcance
   de este carril; anotado porque salió en el camino.

## NO MEDIDO

- **El ciclo completo emitir → revocar credencial MQTT** (`revoked_at` con
  fecha). Bloqueado por el hallazgo 3; lo que sí se mide es que falla cerrado y
  no deja rastro.
- **Ningún camino que requiera un dispositivo**: `config/reported`, la
  transición a `applied`, `last_seen_at`, `online=true`, `boot_id`. A propósito:
  no hay hardware y fabricarlo sería exactamente lo que este carril prohíbe.
- **El alta y la edición POR NAVEGADOR**: el panel no las ofrece en esta
  pantalla. Se hacen por API y el navegador comprueba que las refleja.
- **Otros navegadores** (Firefox, WebKit) y otros anchos: sólo Chromium a
  1280×800.
- **El paso 4 reinicia el backend, no PostgreSQL.** Los datos viven en un
  `--tmpfs`: reiniciar el contenedor de la base los perdería y eso mediría el
  arnés, no el producto.
