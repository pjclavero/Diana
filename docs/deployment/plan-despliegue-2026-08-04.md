# Plan de despliegue — 2026-08-04

> Preparado por el organizador. **No ejecutado.** Requiere autorización del operador.
> Máquina destino: VM 109 `diana-server`, 192.168.1.209, `/opt/diana`.
> Acceso verificado hoy: `ssh diana-admin@192.168.1.209` (usuario `diana-admin`, **no** `diana`).

## 1. Qué se despliega

De `133d760` (lo que corre hoy) a `434cc58`: **14 commits**.

| Bloque | Qué entrega |
|---|---|
| X-06 (`5c3b7ac`, `eb42324`) | La vista en directo puede funcionar por primera vez: panel y backend hablaban protocolos distintos (WebSocket crudo contra socket.io). Además el canal exige credenciales y dejó de mandar todo el tráfico MQTT a cualquiera |
| D9 (`70b2590`, `9c2fda5`) | Observaciones de la 4ª supervisión del barrido de obsolescencia |
| F4 (`85403db`, `4ff69ec`) | Reinicio de la estadística de un jugador en una partida, sin corromper su acumulado |
| F5 (`afe3e82`, `1aa1fbc`) | Ascenso a gestor por código de activación: **vender deja de ser ascender**. Incluye el arreglo de seguridad: el rol se lee de la base en cada petición, no del token |
| F6 (`d42f474`, `1aa1fbc`) | Diagnóstico real de módulo y diana contra el contrato congelado |
| Bloqueantes (`0343a76`) | Ocho bloqueantes de las tres re-supervisiones |
| Worker (`36f8e14`) | El worker vuelve a ejecutar sus tareas, y su healthcheck deja de mentir |
| Documentación (`8220cb0`, `0f426e3`, `434cc58`) | Sin efecto en ejecución |

**Migraciones pendientes: 3.** Comprobado hoy contra la base viva; la última aplicada es
`20260726140000_module_offline_since`.

1. `20260726200000_manager_activation`
2. `20260726210000_hit_stats_reset`
3. `20260804230000_incident_module_identity_and_time`

Las tres son **aditivas** (columnas y tabla nuevas, con guardas `IF NOT EXISTS`). Ninguna borra
ni transforma datos existentes.

## 2. Estado de la máquina, medido hoy (sólo lectura)

| Comprobación | Valor | Consecuencia |
|---|---|---|
| Memoria | 3.927 MB totales, **3.227 MB disponibles** | El globo está inflado: hoy **sí** hay margen para compilar. En julio bajó a ~1 GB y BuildKit murió por OOM dejando la imagen anterior en su sitio. **Hay que volver a medirlo justo antes de compilar** |
| Disco | 24 GB libres de 50 (51 % usado) | Suficiente |
| DNS | Único resolver `100.100.100.100` (MagicDNS) | **Sigue roto para salir a la red.** `npm ci` y `docker pull` fallarán. Hace falta el apaño temporal de siempre |
| Git en la VM | `133d760`, limpio salvo `backups/` y `infrastructure/mosquitto/passwd` sin seguimiento | **`passwd` de Mosquitto NO está en git: no debe perderse** |
| Contenedores | 7, todos `healthy` | El del worker miente: sus tareas fallan en bucle |

## 3. Lo que este despliegue **no** arregla

**F6 seguirá sin verse en el panel.** La imagen del frontend se compila con
`VITE_API_MODE=mock` (`server/frontend/Dockerfile:19`, `compose.yml:83`), y las dos pantallas de
diagnóstico —`TestLedsPage` y `TestSensorsPage`— pasan por el adaptador, así que en producción
seguirán mostrando **datos de demostración**. El backend de F6 quedará desplegado y correcto,
pero el operador no lo alcanzará desde la interfaz.

F4 y F5 **no** tienen este problema: sus pantallas (marcador, ascenso a gestor) usan clientes
propios contra `/api` real con JWT, como todas las pantallas nuevas.

Son 14 las pantallas que aún dependen del adaptador: `backups`, `calibration`, `countdown`,
`home`, `incidents`, `module-detail`, `new-game`, `results`, `stats`, `system`, `test-leds`,
`test-sensors`, `topology`, `users`.

### Las tres salidas posibles

| Opción | Qué pasa | Coste |
|---|---|---|
| **A. Desplegar en `mock`** (lo que hay) | F4, F5, X-06 y el worker funcionan de verdad. F6 queda desplegado pero **invisible** | Ninguno |
| **B. Compilar en `real`** | F6 se ve… y **se rompen** las pantallas que llaman a rutas que el backend no expone: `/modules/:id/telemetry`, `/systems/:id/topology`, `/game-presets` (la real es `/presets`), `/incidents`, `/diagnostics` sin módulo | Regresión visible en 5 pantallas heredadas. Es el resto vivo de X-21 |
| **C. Cablear sólo las dos pantallas de F6** a un cliente propio contra `/api`, como se hizo con todas las demás pantallas nuevas | F6 se ve, nada se rompe, y X-21 encoge en vez de estallar | Trabajo previo al despliegue: un cliente nuevo + sus pruebas |

**Recomendación: C**, y desplegar después. Es el mismo camino que ya siguieron módulos,
topología por panel, jugadores, equipos, presets, vistas, participantes, marcador, resiliencia,
firmware e invitaciones. B convierte un despliegue de mejoras en una regresión.

## 4. Procedimiento

### 4.0 Antes de tocar nada
```bash
ssh diana-admin@192.168.1.209 'free -m'          # si «disponible» < 1500 MB, parar y liberar
ssh diana-admin@192.168.1.209 'cd /opt/diana && git log --oneline -1'   # debe decir 133d760
```

### 4.1 Copia de seguridad de la base (obligatorio, antes que nada)
```bash
ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose exec -T postgres sh -c \
  "pg_dump -U \$POSTGRES_USER \$POSTGRES_DB" | gzip > ~/diana-$(date +%F-%H%M).sql.gz && ls -lh ~/diana-*.sql.gz'
```
Sin copia verificada (tamaño > 0), **no se sigue**.

### 4.2 Llevar el código (bundle, porque el DNS no resuelve)
```bash
cd /home/ia02/Diana && git bundle create /tmp/diana-0804.bundle 133d760..HEAD
scp /tmp/diana-0804.bundle diana-admin@192.168.1.209:/tmp/
ssh diana-admin@192.168.1.209 'cd /opt/diana && \
  git fetch /tmp/diana-0804.bundle develop:refs/remotes/bundle/develop && \
  git merge --ff-only refs/remotes/bundle/develop && git log --oneline -1'
```

### 4.3 DNS temporal para compilar (npm necesita salir)
```bash
ssh diana-admin@192.168.1.209 'sudo cp /etc/resolv.conf /etc/resolv.conf.prediana-0804 && \
  echo "nameserver 192.168.1.1" | sudo tee /etc/resolv.conf'
```
**Se restaura en el paso 4.8.** No es la solución de fondo: eso exige decisión del operador
(`tailscale set --accept-dns=false` o revisar los nameservers de la tailnet).

### 4.4 Compilar, con la máquina despejada
```bash
ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose stop worker backup postgres-test mosquitto frontend backend'
ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose build backend worker frontend'
```
Compilar con los contenedores parados es el procedimiento fiable desde los OOM de julio
(`procedimiento.md` §8). Implica **corte de servicio** durante el despliegue.

### 4.5 VERIFICAR EL ARTEFACTO ANTES DE LEVANTAR

Este paso no es opcional: en julio un `build` «terminó» dejando la imagen vieja en su sitio.

```bash
# (a) El worker DEBE llevar ahora el motor 3.0.x. Es la avería que veníamos a arreglar.
ssh diana-admin@192.168.1.209 'docker run --rm --entrypoint sh diana/worker:local \
  -c "ls /app/node_modules/.prisma/client/ | grep libquery"'
#     esperado: libquery_engine-debian-openssl-3.0.x.so.node   (si sale 1.1.x, ABORTAR)

# (b) El backend debe contener el código nuevo.
ssh diana-admin@192.168.1.209 'docker run --rm --entrypoint sh diana/backend:local \
  -c "grep -rl statsResetAt /app/dist | head -3; grep -rl ManagerActivation /app/dist | head -3"'
```

### 4.6 Migraciones
```bash
ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose run --rm --no-deps backend npx prisma migrate deploy'
ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose exec -T postgres sh -c \
  "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"select migration_name from _prisma_migrations order by started_at desc limit 3;\""'
#     esperado: las tres nuevas, con finished_at
```

### 4.7 Levantar
```bash
ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose up -d --force-recreate backend worker frontend && sleep 30 && docker compose ps'
```
`--force-recreate`: sin él, `up -d` ya dejó una vez el código viejo corriendo.

### 4.8 Restaurar el DNS y comprobarlo
```bash
ssh diana-admin@192.168.1.209 'sudo cp /etc/resolv.conf.prediana-0804 /etc/resolv.conf && cat /etc/resolv.conf'
```

## 5. Verificación posterior (lo que de verdad demuestra que sirvió)

1. **El worker ejecuta sus tareas.** Es la prueba de fuego de esta entrega:
   ```bash
   ssh diana-admin@192.168.1.209 'cd /opt/diana && docker compose logs --tail 40 worker'
   ```
   Debe verse `statistics: N métricas` y **no** `ERROR en statistics`.
2. **El healthcheck ya no miente:** `docker inspect --format '{{.State.Health.Status}}' diana-worker-1`
   coherente con lo anterior.
3. Rutas nuevas responden (401 sin token = existen; 404 sería que no):
   `/api/manager-activations/mine`, `/api/modules/<slug>/diagnostics`.
4. Esquema: columnas `stats_reset_at` en `hit_events` y la tabla `manager_activations`.
5. Panel a 200 y sesión real.

**Lo que NO se puede verificar en el despliegue** y hay que decir en voz alta: el diagnóstico de
F6 de extremo a extremo con hardware real (no hay módulos físicos), y el canal en directo contra
un navegador real.

## 6. Vuelta atrás

- **Código e imágenes:** `git reset --hard 133d760` + reconstruir. Las imágenes anteriores siguen
  en el disco mientras no se purguen.
- **Base:** las tres migraciones son aditivas, así que el esquema nuevo **es compatible** con el
  código viejo (columnas de más que nadie lee). No hace falta restaurar la copia para volver
  atrás, y por eso se despliegan juntas sin riesgo de ida y vuelta.
- La copia del paso 4.1 es la red por si algo sale mal de verdad.

## 7. Riesgos asumidos

| Riesgo | Mitigación |
|---|---|
| BuildKit muere por OOM y deja la imagen vieja | Medir memoria antes; compilar con los contenedores parados; **verificar el artefacto** (4.5) |
| Corte de servicio durante la compilación | Asumido: es el procedimiento fiable en esta máquina |
| El DNS temporal se queda puesto | Paso 4.8 explícito, con copia previa |
| F6 desplegado pero invisible | Decisión del §3 (recomendado: opción C antes de desplegar) |
| Se pierde `infrastructure/mosquitto/passwd` (sin seguimiento en git) | No se ejecuta `git clean`; el `merge --ff-only` no lo toca |
