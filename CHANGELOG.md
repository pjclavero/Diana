# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado semántico.

## [No publicado]

> Este registro se había quedado en la Ola 0. Entradas siguientes reconstruidas el 2026-07-26 a
> partir del historial de git; el detalle por bloque, con dictámenes de supervisión, está en
> `docs/coordination/STATUS.md`.

### Añadido (2026-07-21 → 2026-07-26)

- **Servidor desplegado en la VM 109** con stack Compose completo (8 servicios), migraciones
  aplicadas contra la base viva y pruebas de integración contra PostgreSQL real (7/7).
- **Panel usable (F1-F3):** login real con JWT y sesión por rol, roles jugador/gestor/admin
  conviviendo con los técnicos, **propiedad de módulos** (vincular/desvincular) y ciclo de
  **firmware/OTA** del lado del servidor (subida del binario con sha256 calculado por el
  servidor, descarga por el módulo, aceptación por el gestor, compatibilidad de placa y un
  único despliegue en vuelo garantizado por la base).
- **Lote G-A…G-I:** quick wins de UX; dashboard de módulos paginado; jugadores, equipos,
  temporales, invitación por correo con panel SMTP y unión por QR; modos **duelo** y **demo**;
  presets por gestor; **marcador estilo máquina de dardos**; matrices favoritas, vistas
  multipanel y guardarraíl «una partida activa por panel»; y **detección real de caída de
  módulo** con auto-pausa, pausa dura si cae el coordinador y decisión del operador.
- **Contrato MQTT ampliado (aditivo):** `coordinator_module_id` en `module-config`.

### Corregido

- Seis defectos que impedían arrancar el stack (`listen_addresses` de Postgres, permisos y
  orden de `mosquitto.conf`, healthcheck del broker, prefijo `/api` del proxy, Dockerfile de
  backend y worker).
- La presencia MQTT se validaba y **se descartaba**: ninguna caída de módulo se detectaba.
- El marcador multijugador mostraba «0 aciertos» para todos porque nadie escribía la
  atribución del impacto al jugador.

### Conocido y sin resolver

- **F-02:** la ACL de MQTT autoriza por `client_id`; suplantación de un módulo por otro
  **confirmada en vivo**. **F-07:** sin TLS en ninguna capa. **F-17:** 23 vulnerabilidades npm
  en el backend.
- **X-06:** el panel abría un WebSocket crudo contra un backend que sirve socket.io, así que la
  vista en directo nunca pudo funcionar. Corregido en código (panel a `socket.io-client`,
  gateway con salas reales por partida), **sin desplegar y sin probar con navegador real**; y
  el canal en directo **todavía no exige autenticación**.
- El firmware **nunca se ha compilado con ESP-IDF**; no hay PCB, ni ERC/DRC ejecutados.
- Ingesta extremo a extremo sin verificar; restauración de copia y `reboot` sin ejecutar.

### Añadido (Ola 0)

- Estructura profesional del repositorio con separación firmware / servidor / contratos.
- Contratos MQTT v1 congelados: 12 esquemas JSON Schema 2020-12, definiciones comunes,
  16 ejemplos válidos y 12 inválidos, y validador ejecutable (`contracts/validate.py`).
- Modelo temporal de cuatro marcas (dispositivo, coordinador, recepción, persistencia),
  con el tiempo del servidor excluido del payload por contrato.
- ADR 0001-0006: stack del servidor, modelo temporal, idempotencia, estructura del
  repositorio, identidad de la VM y precisión no calculable.
- Documentos de coordinación: plan maestro, paquetes de trabajo, propiedad de rutas,
  dependencias, decisiones, riesgos, matriz de pruebas y estado.
- `CONTRIBUTING.md`, `SECURITY.md` y `.gitignore` con exclusión de secretos.

## [0.1.0] — punto de partida

- Dosier técnico del sistema modular de dianas 3×3 (v0.1).
