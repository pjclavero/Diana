# Evidencia de compilación ESP-IDF — MP0, antes de D1b

## `ESP_IDF_BUILD_PRE_D1B`

```
HEAD      = 44b9d03f18d12a3d0b89f1805c78358ec6978184
WORKTREE  = CLEAN            (worktree recién creado desde el commit publicado)
ESP-IDF   = v5.5
BUILD     = PASS             (1105/1105 pasos, enlazado y binario generado)
fecha     = 2026-08-23
```

Compilado en la imagen oficial `espressif/idf:v5.5`
(`sha256:00e94c6ff8bc1f7bd22b234ff43db3f3056cb33dedac6819df9fbedbcb5c6ebb`),
bajo Docker **rootless**, en un worktree separado para que ningún artefacto de
compilación tocara la rama candidata.

| artefacto | bytes | SHA-256 |
|---|---:|---|
| `diana_firmware.bin` | 639 904 | `368235838f62c99431ac2de780750aefc59210250912fa842095bbb0874cabec` |
| `bootloader/bootloader.bin` | 21 184 | `a4ac632a64d6886aa411eba9c970ed4958bf89e792567bdf820044966711e7de` |
| `partition_table/partition-table.bin` | 3 072 | `552bb58f7ba97390bcac984a9d7e698accac3d3d76cdad4c5166591ee2d18a1c` |
| `ota_data_initial.bin` | 8 192 | `7d2c7ac4888bfd75cd5f56e8d61f69595121183afc81556c876732fd3782c62f` |

Ocupación: `0x9c3a0` de una partición de aplicación de `0x300000` — **80 % libre**.

## Alcance y límite de esta evidencia

Demuestra que el árbol compila y enlaza con ESP-IDF 5.5 para `esp32s3`. Es
reproducible por cualquiera: la versión está fijada por la imagen, no por la
máquina.

**NO sustituye la trazabilidad de origen del firmware físico.** El binario que se
flasheó y observó sobre hardware salió de la máquina del operador; ésta es una
compilación independiente del árbol integrado, no la reconstrucción de aquel
binario.

**NO se ha flasheado ni monitorizado nada.** `HW_GAP-74HC165` sigue vigente: el
prototipo no se energiza hasta medir el nivel de `DO` y resolver la adaptación.

## Nota de método

El primer intento de este build devolvió `exit code 0` **sin compilar una sola
línea**: ejecutó un script residual de otra tarea, y el cero venía del entorno de
ESP-IDF, no de una compilación. Por eso el procedimiento imprime ahora la versión
de ESP-IDF y la tabla de artefactos: **el propio log debe demostrar que midió**,
en vez de confiar en el código de salida.
