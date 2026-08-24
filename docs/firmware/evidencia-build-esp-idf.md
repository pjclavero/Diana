# Evidencia de compilación ESP-IDF — MP0

## Base física vigente

```
PHYSICAL_FIRMWARE_BASE_PREVIOUS = b883da0    (evidencia histórica, NO se borra)
PHYSICAL_FIRMWARE_BASE_CURRENT  = 3c51847
FIRMWARE_BASE                   = 3c51847

DO_POLARITY = ACTIVE_HIGH
DO_IDLE     = 0 V  /  bus 0x0000
DO_HIT      = ~5 V antes de adaptación  /  1 lógico después
HC165_SPI   = 5 MHz
```

`b883da0` conserva valor como evidencia histórica de la primera prueba física y,
sobre todo, documenta el fallo de montaje que permitió descubrir el problema de
nivel lógico. Deja de ser la base canónica, no pasa a ser «incorrecta».

**Por qué cambia la polaridad:** la lectura del 2026-08-20 («reposo alto, activo
bajo») se tomó sobre un 74HC165 averiado y **sin adaptación de nivel**; ese
«reposo alto» era el síntoma de la avería. La medida vigente se hizo con
registros nuevos y divisor resistivo en D1-D3, confirmada por dos vías
independientes: voltímetro (0 V en reposo, ~5 V al impacto) y monitor serie
(`D1=0x0001`, `D2=0x0002`, `D3=0x0004`, reposo `0x0000`).

## `ESP_IDF_BUILD` sobre el árbol recompuesto

```
HEAD      = 745523e   (mp0/integration-v2, rebasada sobre 3c51847)
WORKTREE  = CLEAN
ESP-IDF   = v5.5
BUILD     = PASS
fecha     = 2026-08-24
```

| artefacto | bytes | SHA-256 |
|---|---:|---|
| `diana_firmware.bin` | 639 216 | `3df25068301f7f0f40452182d652d9532d1ce39698967f78e0482f0520a62b4c` |
| `bootloader/bootloader.bin` | 21 184 | `72bef9f0b1e9221470926f85a33acdf916164525177635ca3186ab1b683172f8` |
| `partition_table/partition-table.bin` | 3 072 | `552bb58f7ba97390bcac984a9d7e698accac3d3d76cdad4c5166591ee2d18a1c` |
| `ota_data_initial.bin` | 8 192 | `7d2c7ac4888bfd75cd5f56e8d61f69595121183afc81556c876732fd3782c62f` |

Compilado en la imagen oficial `espressif/idf:v5.5` bajo Docker rootless.

### Comparación con el build anterior (`44b9d03`, sobre `b883da0`)

`diana_firmware.bin` y `bootloader.bin` cambian de huella, como debe ser: el
árbol lleva ahora la polaridad corregida, el bring-up del W5500, la pila ampliada
de `diana_sens` y el código de D1b. `partition-table.bin` y `ota_data_initial.bin`
son **idénticos**: la tabla de particiones no se ha tocado.

### Límite de esta evidencia

Demuestra que el árbol compila y enlaza con ESP-IDF 5.5 para `esp32s3`, de forma
reproducible por estar la versión fijada en la imagen. **No reconstruye el
binario que se flasheó físicamente** ni sustituye a la validación de banco.

**No se ha flasheado ni monitorizado nada** desde este entorno.

## Huecos abiertos en la evidencia física — SEIS, clasificados

Una versión anterior de este documento decía «cinco» y enumeraba seis: uno de los
puntos empaquetaba tres cosas distintas. Son seis, cada una con su gate.

| # | hallazgo | gate | tratamiento |
|---|---|---|---|
| 1 | Valores reales del divisor **desconocidos** — `current/bom-prototipo.csv` los declara `UNKNOWN` con «10k/18k recomendado; confirmar lo montado» | `HW-GAP` | **bloquea el diseño definitivo de PCB** |
| 2 | D4-D9 no probados con sensores reales | `PHYSICAL-VALIDATION-GAP` | banco posterior |
| 3 | Prueba de 1 h con 9 sensores y 216 LED sin reinicios, y registros fríos con todos los canales | `ENDURANCE-GAP` | antes de declarar el firmware físico estable |
| 4 | `StoreProhibited` en el timer de FreeRTOS, ~2 s tras arrancar el driver de red, **sin causa determinada** | `FIRMWARE-GAP` **importante** | investigar antes del producto físico |
| 5 | `VERSIONR=0x00` intermitente tras reflasheos con el módulo alimentado | `NETWORK/HW-GAP` **importante** | investigar antes de despliegue real |
| 6 | La adaptación de nivel **no está reflejada en KiCad** | `HW-GAP` **bloqueante para PCB** | corregir esquema y BOM antes de fabricar |

### Los dos que no deben enterrarse

**#4 y #5 no son pruebas físicas pendientes: son defectos sin explicar.** Un
crash no diagnosticado reaparece en operación real, y un `VERSIONR=0x00`
intermitente puede ser alimentación, reset, SPI, temporización, CS, cableado o
inicialización. Hace falta llegar a una causa o, como mínimo, a una recuperación
determinista.

Ninguno bloquea la integración de MP0, pero **ambos bloquean cualquier futuro
dictamen `FIRMWARE_PHYSICAL = PRODUCTION_READY`**.

### #6 tiene que pasar a diseño, no quedarse en el banco

«Funcionó en el prototipo» **no equivale a** «está resuelto para hardware». Si el
divisor está montado físicamente fuera de KiCad, **el repositorio todavía no
describe el dispositivo que funcionó**. El carril de hardware debe reconciliar
prototipo físico ↔ KiCad ↔ BOM ↔ documentación de conexionado hasta que
coincidan. **No se vuelve a fabricar PCB sobre el esquema actual sin cerrar esto.**

## Nota de método

Al rebasar, la polaridad pasó de `ACTIVE_LOW` a `ACTIVE_HIGH` y **la suite siguió
en 740/740**: ninguna prueba comprobaba la polaridad declarada por la placa. Se
añadió una que ancla la medida de banco y se calibró — invertir el header produce
4 rojas, y el bus en reposo pasa de 0 impactos a **9**, que es exactamente el
síntoma del montaje averiado.
