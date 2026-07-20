# Política de seguridad · Diana

## Alcance

Diana opera en red local, sin salida a Internet por diseño (dosier §26.4). El panel, la
API, el broker MQTT y la base de datos no se publican a Internet en esta fase. Cualquier
exposición exterior exige una instrucción explícita y una revisión de seguridad previa.

## Reportar un fallo

Los fallos de seguridad **no** se abren como issue público. Se comunican en privado al
responsable del repositorio. Se agradece incluir: versión, impacto, pasos de reproducción
y, si existe, mitigación temporal.

## Secretos

- Ningún secreto entra en git. `.env` está ignorado; sólo se versiona `.env.example` con
  valores de ejemplo evidentes.
- No hay contraseñas por defecto embebidas. Las cuentas iniciales se crean con
  credenciales generadas en el despliegue, no con valores fijos en el código.
- Las claves privadas de firmware y los certificados no se versionan.
- Los logs no registran credenciales, tokens ni payloads de autenticación.

## MQTT

- Acceso anónimo deshabilitado.
- Una credencial por módulo (`module-{module_id}`).
- ACL por tópico: un módulo escribe sólo bajo `targets/v1/module/{su_id}/#` y lee sólo sus
  comandos, su configuración deseada, su canal OTA y el estado de partida.
- El backend es el único autorizado a escribir en `targets/v1/system/#` y en
  `…/config/desired`.
- TLS preparado en la configuración; su activación depende de la infraestructura de
  certificados de la instalación.

## Firmware y OTA

- El binario OTA va firmado y con `sha256`. El módulo verifica antes de activar.
- Particiones A/B con rollback automático.
- Un módulo rechaza una OTA durante una partida activa.
- Protección frente a reenvío: los comandos llevan `nonce` monotónico y caducidad; un
  comando antiguo o repetido se descarta.

## Aplicación

Roles: administrador, operador, árbitro, consulta y mantenimiento. Validación estricta de
entrada, limitación de tasa, cabeceras HTTP seguras, auditoría de acciones
administrativas, contenedores con usuario no root e imágenes con versión fijada.

## Seguridad física

Diana dispara proyectiles. El uso exige protección ocular, fondo de captura, control de
rebotes, distancia definida y señalización de la zona de tiro (dosier §23.4). La parte de
230 V, si se integra en el módulo, debe revisarla personal competente; para prototipos se
usa fuente externa certificada de 12 V.

## Estado

Los hallazgos, su severidad y los riesgos aceptados están en
[`docs/security/`](docs/security/).
