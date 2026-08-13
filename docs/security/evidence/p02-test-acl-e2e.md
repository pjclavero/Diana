# P0-2 · `test-acl.sh` ejecutado de extremo a extremo, y calibrado

**Por qué existe este documento.** Durante cinco rondas de supervisión, la
herramienta con la que se verifica la ACL fue el punto ciego: primero
autenticaba como usuarios inexistentes (sus casos negativos pasaban por fallo
de autenticación), después aprobaba con el broker apagado. Y en todo ese tiempo
**nunca se había ejecutado contra un broker real con las identidades creadas**:
la rama de su clasificador que produce los `[PASS]` —la denegación de ACL— no
la había visto funcionar nadie.

Aquí queda esa ejecución, y la demostración de que su verde sabe ponerse rojo.

## Montaje (2026-08-13, VM109)

Broker efímero, **aislado de producción**:

| | |
|---|---|
| imagen | la misma de producción, por digest: `sha256:d12c8f80dfc65b768bb9acecc7ef182b976f71fb681640b66358e5e0cf94e9e9` |
| configuración | `mosquitto.conf` y `acl` **objetivo** del hotfix |
| red | `p02harness`, exclusiva; sin conexión a `internal` ni a `edge` |
| publicación | `127.0.0.1:18883` únicamente — ni un puerto de producción |
| identidades | creadas con `mosquitto_passwd` en un contenedor `--rm --network none` de la misma imagen |
| resto | sin backend, sin worker, `/mosquitto/data` en tmpfs |

El `test-acl.sh` usado es **byte a byte** el del repositorio:
`sha256 c89a6a23254543c992e4baf3f829ab6cb3581361bcf337430daf9320d60ce022`.

## Resultado: 13 correctos, 0 fallos, 0 errores de arnés

```
=== PREFLIGHT · las tres identidades deben AUTENTICARSE ===
  [ OK  ] module-acltest-a autentica (AUTH_OK_ACL_ALLOWED)
  [ OK  ] module-acltest-b autentica (AUTH_OK_ACL_ALLOWED)
  [ OK  ] module-aclobserver autentica y NO puede publicar (AUTH_OK_ACL_DENIED)
=== 1. Cliente anónimo no debe poder conectar ===
  [PASS]  el cliente anónimo no pudo conectar (AUTH_DENIED, aquí sí es lo correcto)
=== 2. Credencial incorrecta muere en autenticación, y no cuenta como ACL ===
  [PASS]  credencial incorrecta → AUTH_DENIED (el clasificador los separa)
=== 3. Control positivo: cada módulo publica en su propio espacio ===
  [PASS]  module-acltest-a escribe su presence · ACL_ALLOWED y MESSAGE_OBSERVED
  [PASS]  module-acltest-b escribe su presence · ACL_ALLOWED y MESSAGE_OBSERVED
=== 4. Suplantación entre módulos, en ambos sentidos ===
  [PASS]  module-acltest-a escribe el presence de module-acltest-b · ACL_DENIED
  [PASS]  module-acltest-b escribe el presence de module-acltest-a · ACL_DENIED
=== 5. Tópicos de sólo lectura para el módulo ===
  [PASS]  module-acltest-a escribe su config/desired · ACL_DENIED
  [PASS]  module-acltest-a escribe su command · ACL_DENIED
  [PASS]  module-acltest-a escribe su ota · ACL_DENIED
=== 6. El observador VE el mensaje positivo (control causal) ===
  [PASS]  MESSAGE_OBSERVED · el permiso concedido produce un efecto visible
=== 7. El observador NO puede publicar ===
  [PASS]  module-aclobserver publica en el espacio de prueba · ACL_DENIED
=== 8. El observador queda confinado a su propio subárbol inerte ===
  [PASS]  module-aclobserver escribe en SU subárbol · ACL_ALLOWED
  [PASS]  module-aclobserver escribe en el subárbol de module-acltest-b · ACL_DENIED
=== Resumen: 13 correctos, 0 fallos, 0 errores de arnés ===
```

## Calibración: el verde sabe ponerse rojo

Tres mutaciones sobre la configuración del broker, una por ejecución, restaurando
entre cada una. Lo importante no es sólo que falle, sino **qué** falla y que el
contador de errores de arnés siga en cero: eso significa que los fallos son
medidas reales y no fontanería rota.

| mutación | efecto | resultado |
|---|---|---|
| **M-A** · quitar `use_username_as_clientid true` — **reintroduce F-02** | el client_id vuelve a elegirlo el cliente, así que `%c` deja de casar | **4 fallos**: los dos positivos, el control causal y el subárbol del observador |
| **M-B** · añadir `pattern write …/%c/config/desired` — ACL floja | el módulo puede escribir su propia configuración deseada | **1 fallo**, exactamente ese caso: `ACL_ALLOWED — la ACL NO bloquea` |
| **M-C** · quitar la lectura del observador | el efecto deja de ser observable | **3 fallos**, con el matiz correcto: *«publicó sin aviso pero el observador NO lo vio»* |
| restaurado | — | **13 / 0 / 0** |

M-A es la que más importa: es la vulnerabilidad real (F-02, suplantación de un
módulo por otro) reintroducida en el broker, y el arnés la detecta. M-C valida
la distinción que se añadió en la última ronda —«publicó» frente a «se
observó»—, que es justo la que evita dar por bueno un positivo silencioso.

## Lo que esto NO demuestra

- Que la ACL de **producción** se comporte igual: el broker era efímero, con la
  misma configuración pero otro `passwd`. Eso es la Etapa B.
- Nada sobre el backend, la ingesta ni el ciclo de comandos.

## Incidente durante la ejecución, para que no se repita

Encadenar las tres mutaciones con sus reinicios dentro de **una sola** ventana
de `qm guest exec` (550 s) dejó el `guest-exec` huérfano y **atascó el agente
QEMU** de VM109 — el mismo fallo del 2026-08-10. Producción siguió sana en todo
momento (8883 y 8080 respondiendo); lo que se perdió fue el canal de gestión.

Se recuperó reiniciando `qemu-guest-agent` por **Tailscale SSH**
(`diana-admin@diana-server`), que resultó ser un canal administrativo válido y
que la documentación previa daba por inexistente. Lecciones:

1. Una mutación por invocación. Aislamiento y **tiempo** son dos requisitos
   distintos: el primero protege producción, el segundo protege el canal.
2. La pérdida del agente QEMU no debe dejar una instalación sin vía de
   administración — pero Tailscale es una facilidad de **esta** instalación, no
   una dependencia arquitectónica de Diana. Ver la matriz de acceso
   administrativo en `docs/deployment/procedimiento.md`.
