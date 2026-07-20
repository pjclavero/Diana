# Monitorización (opcional)

Ligera y **opcional**: sólo se levanta bajo el perfil `monitoring`
(`docker compose --profile monitoring up -d`). El stack funciona
perfectamente sin ella; es una capa de observabilidad añadida, no un
requisito duro (dosier §25.1).

## Qué incluye

Un único contenedor `cadvisor` (imagen oficial fijada,
`gcr.io/cadvisor/cadvisor:v0.49.1`), que expone métricas de uso de
CPU/RAM/red por contenedor en `http://localhost:${MONITORING_HTTP_PORT}/`
(por defecto 9090). No requiere configuración ni credenciales adicionales.

No se incluye Prometheus/Grafana en esta primera versión para no añadir
carga a una VM de 4 GB de RAM: cadvisor solo ya cubre "¿algún contenedor se
está comiendo la RAM/CPU?", que es la pregunta operativa más común. Si en el
futuro se necesita retención histórica o alertas, se puede añadir un
Prometheus + Grafana como extensión de este mismo perfil, en un ADR aparte.

## Cómo usarlo

```bash
docker compose --profile monitoring up -d cadvisor
# abrir http://<host>:9090/
docker compose --profile monitoring stop cadvisor
```

## Seguridad

- cadvisor expone métricas de todos los contenedores del host Docker, no
  sólo de Diana. Si la VM ejecuta otras cargas, no lo expongas fuera de la
  red interna sin autenticación adicional (proxy con Basic Auth, por
  ejemplo) — no está pensado para exposición directa a Internet.
- Este contenedor necesita acceso de solo lectura a `/var/run/docker.sock`
  y `/sys`, `/var/lib/docker` del host: es un privilegio mayor que el resto
  del stack. Por eso vive detrás de un perfil explícito y no se activa por
  defecto.
