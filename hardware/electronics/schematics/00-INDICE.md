# Esquemas eléctricos del módulo 3×3 — índice y convenciones

> **ESTADO GLOBAL: DISEÑO DOCUMENTADO. VALIDACIÓN PENDIENTE.**
> No se ha ejecutado ERC. No se ha ejecutado DRC. No se ha construido ni medido
> nada. **Estos documentos no autorizan la fabricación de ninguna PCB**
> (dosier §28.8 exige revisión eléctrica, de seguridad, de fabricación, ERC, DRC,
> de corrientes, térmica, de BOM, de disponibilidad y aprobación del supervisor).

Estos ficheros son la **fuente normativa del conexionado**. Los ficheros de
`../kicad/` reproducen la jerarquía pero **no contienen instancias de símbolos**
(ver `../kicad/README.md` para el motivo). Ante cualquier discrepancia, **manda
lo escrito aquí**.

## Las 8 hojas (dosier §28)

| Hoja | Fichero | Corresponde a |
|---|---|---|
| 01 | [01-power.md](01-power.md) | §28.1 Alimentación |
| 02 | [02-esp32-w5500.md](02-esp32-w5500.md) | §28.2 ESP32 y W5500 |
| 03 | [03-piezo-channel.md](03-piezo-channel.md) | §28.3 Canal piezo |
| 04 | [04-piezo-array-9ch.md](04-piezo-array-9ch.md) | §28.3 ×9 + agregación |
| 05 | [05-analog-mux-or-adc.md](05-analog-mux-or-adc.md) | §28.4 Multiplexor o ADC |
| 06 | [06-led-level-shifting.md](06-led-level-shifting.md) | §28.5 LED |
| 07 | [07-user-inputs.md](07-user-inputs.md) | §28.6 Entradas de usuario |
| 08 | [08-connectors.md](08-connectors.md) | §28.7 PCB y conectores |

Complemento: [09-puntos-de-prueba.md](09-puntos-de-prueba.md) — todos los puntos
de prueba en una sola tabla.

## Convenciones

### Rieles de alimentación

| Nombre de red | Tensión | Alcance |
|---|---|---|
| `+12V_IN` | 12 V | antes del fusible |
| `+12V_F` | 12 V | tras fusible y protección de polaridad |
| `+5V_LED` | 5 V | **exclusivamente** las 3 filas de LED |
| `+5V_LOG` | 5 V | 74AHCT125 y entrada del regulador de 3,3 V |
| `+3V3` | 3,3 V | ESP32-S3, W5500, lógica digital |
| `+3V3A` | 3,3 V | cadena analógica del piezo (tras ferrita) |

### Masas

| Nombre de red | Alcance |
|---|---|
| `GND_PWR` | retorno de los LED y del primario del convertidor. Alta corriente. |
| `GND_LOG` | retorno digital |
| `GND_ANA` | retorno analógico del piezo y del ADC |
| `CHASSIS` | masa de chasis del RJ45, aislada, unida por 10 nF/2 kV |

**Regla de unión de masas:** `GND_PWR`, `GND_LOG` y `GND_ANA` se unen en **un
único punto**, el pin de masa del convertidor U1. En ningún otro sitio.
`CHASSIS` **no** se une galvánicamente.

### Nomenclatura de referencias

| Rango | Bloque |
|---|---|
| 1–9 | Hoja 01 — alimentación |
| 10–29 | Hoja 02 — ESP32 y W5500 |
| 100–199 | Hoja 03/04 — canales piezo (`Rn01`..`Rn09` donde `n` = canal) |
| 40–49 | Hoja 04 — agregación (74HC165, diodos de OR) |
| 50–59 | Hoja 05 — ADC / multiplexor |
| 60–69 | Hoja 06 — LED |
| 70–79 | Hoja 07 — entradas de usuario |
| J1–J31 | Hoja 08 — conectores |
| TP1–TP99 | puntos de prueba |

### Marcas de fiabilidad

| Marca | Significado |
|---|---|
| **(H)** | Hipótesis: valor de catálogo o suposición razonada, **no medido** |
| **(V)** | Requiere validación física antes de fabricar (ver `docs/hardware/VALIDACION-FISICA-PENDIENTE.md`) |
| **(DNP)** | No poblar: alternativa de montaje |

## Cálculos que sostienen estos esquemas

- [`../calculations/01-presupuesto-potencia-led.md`](../calculations/01-presupuesto-potencia-led.md)
- [`../calculations/02-cadena-piezo.md`](../calculations/02-cadena-piezo.md)
- [`../calculations/03-presupuesto-gpio.md`](../calculations/03-presupuesto-gpio.md)
- [`../calculations/04-termica-convertidor.md`](../calculations/04-termica-convertidor.md)
