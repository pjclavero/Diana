# P0-2 · Igualdad byte a byte entre el hotfix y lo que VM109 ejecuta hoy

> **AVISO DE PROCEDENCIA (porte D1, 2026-09-05).** Este documento se tomó tal
> cual de la rama `hotfix/p02-tls-6da16d4` y describe mediciones hechas sobre
> **el árbol de esa rama y la VM de producción de agosto de 2026**, donde el
> listener MQTT en claro (1883) ya se había retirado. En `mp0/integration` ese
> listener **sigue existiendo** como perfil de transición, porque el firmware
> físico lo lleva cableado (decisión D1 del operador, pendiente). Léelo como
> historia medida, no como descripción del árbol actual. El estado vigente de
> esta rama es `TLS_WIRED_NOT_EXCLUSIVE` y está en
> `docs/coordination/D1-PORTE-P02.md`.

**Por qué existe este documento.** El commit `2586dbc` afirma traer, tal cual,
el árbol de trabajo no versionado de producción. Esa afirmación no es cosmética:
de ella depende que la ACL de este hotfix —que contiene contrato v1.5
(`provision`, `maintenance/command`) y reglas de autoridad— NO sea alcance
colado en un retroporte que sólo puede endurecer el transporte. Si la igualdad
es cierta, el hotfix fotografía producción y retirar esas líneas sería la
regresión. Si fuese falsa, el hotfix violaría el camino A.

Un supervisor independiente marcó la afirmación como **no auditable**: él no
tiene acceso a VM109, y ni un solo hash aparecía escrito en ninguna parte. Con
razón. Aquí quedan, para que cualquiera pueda rehacer la comprobación sin
fiarse de quien la hizo.

## Comprobación (2026-08-13)

En VM109 (`/opt/diana`, rama `develop` en `6da16d4` con árbol modificado):

```sh
cd /opt/diana && sha256sum \
  compose.yml \
  infrastructure/mosquitto/mosquitto.conf \
  infrastructure/mosquitto/acl \
  infrastructure/mosquitto/generate-certs.sh \
  infrastructure/backups/backup.sh \
  infrastructure/backups/restore.sh \
  infrastructure/backups/verify-restore.sh
```

En el repositorio, contra el commit que dice fotografiarlo:

```sh
for f in <los mismos 7 ficheros>; do
  echo "$(git show 2586dbc:$f | sha256sum | cut -d' ' -f1)  $f"
done
```

## Resultado: 7/7 idénticos

| sha256 | fichero |
|---|---|
| `e13116048096a0586c1d0148fe14455f9c7aadd5ffe6d3d10a924d5acb5750d4` | `compose.yml` |
| `8148fd60c788dd9373692abdbead852afbcdac68d8de54c1f8bbe83f9a310258` | `infrastructure/mosquitto/mosquitto.conf` |
| `d7aac889f69cab8f1e63bab05e5d5ce1144cd0476db3a846ff6981d7613e6e04` | `infrastructure/mosquitto/acl` |
| `5fd8fa33af183f7192f3f29b2d4d43cea91d7aaf199366cd6bfb979e9994eb00` | `infrastructure/mosquitto/generate-certs.sh` |
| `8605be98165275f99dbd9f971b0b88873a450f0a3717f449179beb08aa4d277a` | `infrastructure/backups/backup.sh` |
| `31bc861ab0f7286efd84557607bdd29f62e4c4a458ae86e6301c927457a675dc` | `infrastructure/backups/restore.sh` |
| `61639d6ee7d2f866e12d028084e0111cb7bd00cd78537190250b49690c6f64c6` | `infrastructure/backups/verify-restore.sh` |

**Los hashes valen para `2586dbc`, no para HEAD.** Los commits posteriores del
hotfix modifican a propósito `compose.yml`, `mosquitto.conf` y `acl`; ahí está
el delta real del hotfix, y es lo que debe revisarse como cambio. Para repetir
la comprobación de la línea base hay que usar `2586dbc` explícitamente.

## Lo que esto NO demuestra

Que el contenido sea correcto o deseable. Sólo que **ya está en producción**, y
que por tanto su discusión pertenece al carril `PROD-DRIFT-6da16d4` y no a
P0-2. En particular siguen abiertos, ahí y no aquí:

- la ACL referencia `set-coordinator.sh` y una sección de
  `docs/deployment/procedimiento.md` que **no existen** (avisado en el propio
  fichero, no corregido: crearlos sería funcionalidad nueva);
- `test-acl.sh` no soporta TLS, y es la única razón real por la que sobrevive
  el `listener 1883` interno.
