# Ramas canónicas de Diana — qué manda y qué no

**Léeme antes de fusionar nada.** Este fichero existe porque el repositorio ha
tenido varias ramas que parecían decir «yo soy el firmware oficial», y una de
ellas habría revertido cinco semanas de trabajo si alguien la hubiera fusionado
sin mirar.

Actualizado: **2026-09-05**.

> **La fuente canónica de ESTADO es [`docs/STATE.md`](docs/STATE.md).** Este
> fichero sólo gobierna **ramas y fusiones**. Si algo aquí contradice a STATE,
> manda STATE.

## LA LÍNEA A SEGUIR

```
mp0/integration @ ae69357      <-- TRABAJA AQUÍ
```

> **Corrección 2026-09-05.** Aquí ponía `9b5e161`, y más abajo `3711632`. Ambos
> quedaron atrás. El SHA real se comprueba con
> `git rev-parse origin/mp0/integration`, nunca leyéndolo de un documento.

**Todo desarrollo nuevo se hace sobre `mp0/integration`.** Es la única rama que
reúne las tres cosas a la vez:

```
firmware verificado en banco  +  contratos e identidad  +  D1b (DEVICE_MANAGEMENT)
```

Cualquier otra rama tiene **una parte** del producto, no el conjunto. Si trabajas
sobre otra, tu trabajo habrá que reconciliarlo después — que es exactamente lo
que ya nos ha costado dos rondas de arqueología.

### Cómo empezar

```bash
git fetch origin
git checkout mp0/integration
git pull --ff-only origin mp0/integration
```

### Si has trabajado en otra rama

No la fusiones. Avisa y se porta el delta, que es lo que se ha hecho con el
trabajo de banco: **por fichero y con justificación**, nunca con `git merge`.

### Lo único que aún NO está en esta línea

| falta | dónde está | cuándo entra |
|---|---|---|
| ~~Arreglo de `RSTn` del W5500~~ | `fix/w5500-reset-hardware@f52d013` | **CADUCADO: el código ya está portado** (2026-09-05). `net_w5500.c:119-135` conduce y pulsa RSTn y `tools/check_w5500_reset.py` está verde en la suite. Falta sólo su parte documental |
| TLS 8883 de P0-2 | `hotfix/p02-tls-6da16d4@ad2d166` | tras MP0-F |

---

## Estado actual

| ref | commit | estatus |
|---|---|---|
| `mp0/integration` | `ae69357` | **LÍNEA DE TRABAJO VIGENTE** (era `3711632`; verificado con `git branch -r -v` el 2026-09-05) |
| `codex/proto-do-w5500` | `b883da0` | `PHYSICAL_FIRMWARE_BASE_PREVIOUS`, evidencia histórica |
| `codex/hardware-prototipo-v1` | `3a1d180` | **FIRMWARE Y HARDWARE CANÓNICOS** (banco) |
| `develop` | `21c09db` | tronco; absorbió el hardware por PR #1 |
| `main` | `3414f1b` | intacto; destino de la convergencia futura |
| `feat/wp04-firmware` | `73f5f93` | `VALIDATED_FIRMWARE_SNAPSHOT` + `SUPERSEDED_AS_INTEGRATION_BASE` |
| `archive/mp0-integration-27652ed` | `27652ed` | preservación; última cabeza sobre la base física anterior |
| `hotfix/p02-tls-6da16d4` | `ad2d166` | TLS de P0-2, desplegado en producción, **sin fusionar** |
| `fix/w5500-reset-hardware` | `f52d013` | **MUST_RECONCILE** · arreglo de `RSTn`, causa raíz de `VERSIONR=0x00` |

## `feat/wp04-firmware@73f5f93` — leer esto antes de fusionarla

**NO la fusiones. NO la uses como base de integración.**

Contiene el snapshot de firmware correspondiente al prototipo DO-only **validado
físicamente**. Su subárbol `firmware/` es **equivalente** al de
`codex/hardware-prototipo-v1@3a1d180` salvo un enlace del README:

```
git diff --stat 73f5f93 3a1d180 -- firmware
  →  1 file changed, 2 insertions(+), 2 deletions(-)
```

Su contenido de firmware, por tanto, **conserva valor como evidencia física**. Lo
que está mal no es el firmware: es la **base**.

```
CONTENIDO DE FIRMWARE     VALIDADO
BASE DEL REPOSITORIO      OBSOLETA
```

`merge-base(73f5f93, develop) = 3dcbc6b`, del **20 de julio**. Le faltan unas cinco
semanas de evolución del tronco: **603 ficheros y ~98 000 líneas** —simuladores,
tests e2e, contratos, seguridad— y **no contiene `docs/hardware/` en absoluto**,
así que pierde toda la documentación del prototipo físico.

Un `git merge feat/wp04-firmware` sobre una rama moderna revertiría ese trabajo.

**Los cambios posteriores de firmware se hacen sobre la línea integrada vigente**,
no sobre esta rama.

## Regla de desarrollo vigente

La instrucción antigua —`git switch feat/wp04-firmware && git pull`— **ya no
aplica** para desarrollo nuevo.

Hasta cerrar D1b, la línea de trabajo es:

```
mp0/integration@ae69357  +  rescate selectivo de los deltas comprobados del prototipo
```

Tras la convergencia, `main` será la fuente canónica también de
`main:firmware/esp32/`.

## Por qué `3a1d180` es el firmware canónico y no `3c51847`

`3a1d180` **contiene** `3c51847` y es puramente aditivo respecto a él: `+350/−70`
en `firmware/`, **cero regresiones de banco**. `DIANA_DO_ACTIVE_HIGH`,
`DIANA_ETH_SPI_HZ = 5 MHz` y `diana_sens = 16384` son idénticos.

`3c51847` sigue siendo `INTEGRATION_BASE`: la base sobre la que se rebasó MP0.

## Identificadores en vigor

```
FIRMWARE_CANONICAL_BRANCH = codex/hardware-prototipo-v1
FIRMWARE_CANONICAL_COMMIT = 3a1d1802b68d3ba0c3ac7d394550b8ce99ad3682
HARDWARE_CURRENT_BRANCH   = codex/hardware-prototipo-v1
HARDWARE_CURRENT_COMMIT   = 3a1d1802b68d3ba0c3ac7d394550b8ce99ad3682
INTEGRATION_BASE          = 3c51847f3f29ba9371e3956668289a32110b7ae2
INTEGRATION_HEAD          = ae6935746cdaf5c57bf70b9a9264757c34efe4f1
RECONCILIATION_BASE       = 37116323fbfa908cc4b3fba2956d6f4e8f72c443
                            (histórico: la base sobre la que se reconcilió, no la cabeza)
MP0_INTEGRATION_PREVIOUS  = 27652ed6cd7ea20989180e1da8165381cf166f6a
```

## Lo que este árbol NO tiene, y conviene no olvidar

- **No lleva el TLS de P0-2.** `infrastructure/mosquitto/mosquitto.conf` declara
  `listener 1883` con el `8883` comentado. El endurecimiento vive en
  `hotfix/p02-tls-6da16d4`, desplegado en producción pero sin fusionar. El
  provisioning V1 presupone MQTTS/8883, así que **P0-2 debe reconciliarse antes de
  crear `PROVISIONING_BASE`**.
- ~~**D1b no está en el build de firmware.**~~ **CADUCADO — ya no es cierto.**
  Este punto describía el árbol en `9b5e161` (2026-08-25). Desde entonces las seis
  fuentes de D1b están en `SRCS` de `diana_core/CMakeLists.txt`, compilan con el
  toolchain xtensa y **23 símbolos D1b sobreviven a `--gc-sections`** en el ELF
  final (medido con `xtensa-esp32s3-elf-nm`, imagen `espressif/idf:v5.5`).

  Estado vigente, con las propiedades separadas porque no son la misma:

  ```
  D1B_CORE_IMPLEMENTED                        = YES
  D1B_RUNTIME_DISPATCH_WIRED                  = YES
  D1B_SYMBOLS_IN_ELF                          = YES
  DEVICE_MANAGEMENT_COMMAND_PATH_CURRENT_TREE = UNIQUE
  DEVICE_MANAGEMENT_COMMAND_TRANSPORT         = NOT_REACHABLE
  ```

  Ver `docs/firmware/MAPA-FIRMWARE.md` para el detalle. Se corrige aquí porque
  este fichero abre con «Léeme antes de fusionar nada»: una subafirmación caducada
  no engaña sobre garantías, pero desinforma igual a quien llegue hoy.

## Cifras de test: sólo las reproducibles

`CONTRACT_GAP-TEST-COUNT`. Circula un «43/43» reportado desde el portátil que
**no se ha podido reproducir aquí**. Medido en este servidor:

**Cifra vigente (2026-09-05, `ae69357`, medida en este servidor):**

```
make -C firmware test  →  TOTAL: 853 comprobaciones, 853 correctas, 0 fallidas
                          CONTRATO: conforme
```

Se lee de la línea `TOTAL:`. Contar líneas `ok` da otra cifra —incluyen ~48 que
no pasan por el arnés `CHECK`— y **ésa no es la buena**.

Las cifras de abajo son **medidas anteriores, correctas en su momento y hoy
caducadas**. Se conservan fechadas, no se borran.

```
make -C firmware test @ mp0/integration  →  748 comprobaciones · CONTRATO: conforme   [CADUCADO, árbol anterior]
                                            (18 mensajes + 14 enumerados = 32 validaciones)
make -C firmware test @ 3a1d180          →  468 comprobaciones · CONTRATO: 1 FALLOS
                                            (19 validaciones)
```

No se asume que el 43/43 fuera falso: pudo ser otra suite u otra combinación. Pero
**hasta localizar de dónde salió, no vuelve a usarse como cifra de estado**. A
`main` sólo entran cifras reproducibles desde un comando documentado.
