# Hoja 08 — Conectores, distribución por filas, masas y reglas de PCB

> **SIN VALIDAR.** ERC no ejecutado, DRC no ejecutado, **no existe layout**.
> Dosier §28.7 y §7.6.

## 1. Tabla maestra de conectores

| Ref. | Tipo | Vías | Paso | Corriente/vía | Función | Zona de PCB |
|---|---|---:|---|---:|---|---|
| **J1** | Bornero bloqueable (Phoenix MSTB 2,5) o XT30 | 2 | 5,08 mm | ≥ 8 A | Entrada 12 V DC | **POTENCIA** |
| **J2** | RJ45 con magnetismos y LED (HR911105A) | 8 | — | — | Ethernet | **E/S**, borde |
| **J10** | JST VH | 4 | 3,96 mm | 7 A | Fila LED superior (24 LED) | **POTENCIA** |
| **J11** | JST VH | 4 | 3,96 mm | 7 A | Fila LED central | **POTENCIA** |
| **J12** | JST VH | 4 | 3,96 mm | 7 A | Fila LED inferior | **POTENCIA** |
| **J13** | JST VH | 2 | 3,96 mm | 7 A | Reinyección extremo lejano fila 1 | **POTENCIA** |
| **J14** | JST VH | 2 | 3,96 mm | 7 A | Reinyección extremo lejano fila 2 | **POTENCIA** |
| **J15** | JST VH | 2 | 3,96 mm | 7 A | Reinyección extremo lejano fila 3 | **POTENCIA** |
| **J20** | JST XH | 6 | 2,50 mm | 3 A | Piezos CH1–CH3 (fila superior) | **SEÑAL** |
| **J21** | JST XH | 6 | 2,50 mm | 3 A | Piezos CH4–CH6 (fila central) | **SEÑAL** |
| **J22** | JST XH | 6 | 2,50 mm | 3 A | Piezos CH7–CH9 (fila inferior) | **SEÑAL** |
| **J30** | Cabecera macho polarizada | 6 | 2,54 mm | 1 A | Programación UART (servicio) | **SEÑAL**, retranqueado |
| **J31** | Cabecera macho polarizada | 6 | 2,54 mm | 1 A | Mazo a la tapa (selector, botón, LED) | **SEÑAL** |

## 2. Pinout detallado

### 2.1 J1 — Entrada de 12 V

| Pin | Señal | Color de cable | Nota |
|---:|---|---|---|
| 1 | `+12V_IN` | **Rojo** | Serigrafía `+12V` y símbolo `+` en la PCB |
| 2 | `GND_PWR` | **Negro** | Serigrafía `GND` y símbolo `−` |

**Protección contra inversión:** además de la serigrafía, el diseño incorpora la
protección activa Q1 (hoja 01). Con un conector XT30 la inversión es
mecánicamente imposible; con bornero de tornillo, no. **Se recomienda XT30.**

### 2.2 J10 / J11 / J12 — Filas de LED (4 vías)

| Pin | Señal | Color | Corriente | Nota |
|---:|---|---|---:|---|
| 1 | `+5V_ROWn` | Rojo | 0,72 A | |
| 2 | `+5V_ROWn` | Rojo | 0,72 A | **Doblado a propósito**: reparto y detección de contacto degradado |
| 3 | `LED_Dn_5V` | Blanco | < 20 mA | Dato, tras R6x de 470 Ω |
| 4 | `GND_PWR` | Negro | 1,44 A | **Retorno completo de la fila** |

**El pin 4 es el más cargado del conector (1,44 A)** porque el retorno no está
doblado. Está dentro de los 7 A de la vía JST VH con factor 4,9 de margen.
**Alternativa a considerar en revisión:** conector de 5 vías con retorno doblado
también. **(V)**

Orden de pines elegido a propósito: **el dato (pin 3) queda entre los positivos y
la masa**, lo que le da apantallamiento por proximidad y hace que un
desplazamiento de un pin en la conexión ponga el dato en un riel de
alimentación en vez de dejarlo al aire — fallo ruidoso en lugar de silencioso.

### 2.3 J13 / J14 / J15 — Reinyección de 5 V (2 vías)

| Pin | Señal | Color |
|---:|---|---|
| 1 | `+5V_ROWn` | Rojo |
| 2 | `GND_PWR` | Negro |

Van al **extremo final** de cada tira (dosier §10.4, «inyección de 5 V en cada
fila»; aquí se refuerza con inyección en ambos extremos, ver cálculo 01 §6).

### 2.4 J20 / J21 / J22 — Piezos (6 vías)

| Pin | Señal | Nota |
|---:|---|---|
| 1 | `PZ1_P` (J20) / `PZ4_P` (J21) / `PZ7_P` (J22) | Conductor central del cable apantallado |
| 2 | `GND_ANA` | Malla del cable del piezo anterior |
| 3 | `PZ2_P` / `PZ5_P` / `PZ8_P` | |
| 4 | `GND_ANA` | |
| 5 | `PZ3_P` / `PZ6_P` / `PZ9_P` | |
| 6 | `GND_ANA` | |

**Cable obligatorio: apantallado individual por canal** (coaxial fino tipo RG-174
o cable de micrófono de 2 conductores + malla). La señal del piezo antes del
recorte puede alcanzar **150 V (H)** y es de alta impedancia: sin apantallar,
capta ruido de red y acopla entre canales, lo que produciría exactamente los
«impactos fantasma» que el dosier §7.4 quiere evitar.

**Numeración visible:** cada conector lleva serigrafiado el rango de canales
(`CH1-3`, `CH4-6`, `CH7-9`) y cada diana lleva su identificador en el interior
(dosier §7.2).

### 2.5 J30 — Programación (6 vías)

| Pin | Señal | Nota |
|---:|---|---|
| 1 | `GND_LOG` | |
| 2 | `+3V3` | **Salida solamente.** No alimentar la placa desde aquí |
| 3 | `U0TXD` (IO43) | Salida del ESP32-S3 |
| 4 | `U0RXD` (IO44) | Entrada del ESP32-S3 |
| 5 | `IO0` | Descarga de firmware |
| 6 | `EN` | Reset |

Conector **polarizado** y **retranqueado** respecto al borde, con serigrafía
`SERVICE — 3V3 ONLY`. Conectar un adaptador USB-serie de 5 V aquí destruiría el
ESP32-S3: la polarización mecánica y la serigrafía son la única barrera.
**(V)** Considerar añadir resistencias serie de 100 Ω en los pines 3, 4, 5 y 6.

### 2.6 J31 — Mazo a la tapa (6 vías)

| Pin | Señal |
|---:|---|
| 1 | `SEL_A` (tras R73) |
| 2 | `SEL_B` (tras R74) |
| 3 | `BTN_ID` (tras R75) |
| 4 | `ST_LED_G` cátodo |
| 5 | `ST_LED_A` cátodo |
| 6 | `GND_LOG` (común de SW70, SW71 y ambos LED) |

## 3. Reglas de disposición en PCB (dosier §28.7)

> No existe layout. Estas son **reglas de diseño para quien lo haga**, no una
> descripción de algo construido.

### 3.1 Zonificación obligatoria

```
┌───────────────────────────────────────────────────────────────┐
│  ZONA POTENCIA                        │   ZONA SEÑAL          │
│  J1, SW1, F1, Q1, D1, U1, U2,         │   J20, J21, J22       │
│  C4, C5, F60-F62, J10-J15             │   9 canales piezo     │
│                                       │   U50 (ADC)           │
│  ─── separación ≥ 15 mm ───────────────────────────────────   │
│                                       │                       │
│  ZONA DIGITAL                         │   ZONA E/S            │
│  U10 (ESP32-S3), U40/U41, U60         │   J2 (RJ45), J30, J31 │
└───────────────────────────────────────────────────────────────┘
```

1. Conectores de **potencia** en un borde de la PCB; conectores de **señal** en
   el borde opuesto. **Separación mínima 15 mm.**
2. La zona de la cadena piezo **no** debe ser atravesada por ninguna pista de
   potencia ni por el nodo de conmutación de U1.
3. Los magnetismos del RJ45 y su zona sin cobre quedan aislados en una esquina.

### 3.2 Planos de masa

| Plano | Alcance | Anchura mínima |
|---|---|---|
| `GND_PWR` | Retorno de LED y de U1 | Polígono, ≥ 2,0 mm en cualquier estrechamiento |
| `GND_LOG` | Digital | Plano continuo en capa interna o inferior |
| `GND_ANA` | Cadena piezo y ADC | Plano continuo, **separado** de `GND_LOG` |
| `CHASSIS` | Sólo bajo el RJ45 | Aislado, acoplado por C23 (10 nF / 2 kV) |

**Punto de unión único:** los tres primeros se unen exclusivamente en el pad de
masa de U1. Ese punto se marca en la serigrafía como `★GND`.

**Regla de retorno:** ninguna pista de señal debe cruzar una separación entre
planos. Toda señal debe tener su plano de retorno contiguo y continuo.

### 3.3 Anchuras de pista mínimas (cálculo 01 §7)

| Red | Corriente | Anchura mínima a 1 oz | Clase de red en `.kicad_pro` |
|---|---:|---:|---|
| `+5V_LED`, `GND_PWR` | 4,87 A | **2,0 mm** | `POWER_LED` |
| `+5V_ROWn` | 1,44 A | 0,8 mm | `POWER_LED` |
| `+12V_F` | 2,26 A | **1,2 mm** | `POWER_12V` |
| Señales del piezo antes del clamp | < 3 mA | 0,3 mm con **aislamiento 0,8 mm** | `PIEZO_HV` |
| Pares Ethernet | — | 100 Ω diferencial | `ETHERNET` |
| Resto | — | 0,25 mm | `Default` |

### 3.4 Fijaciones y accesibilidad

- **4 taladros de M3** en las esquinas, con anillo de masa conectado a
  `GND_LOG` mediante 0 Ω poblable **(DNP por defecto)**: permite decidir en
  banco si conectar la PCB al bastidor metálico o dejarla flotante, sin
  rediseñar.
- Todos los conectores accesibles **sin desmontar la PCB**.
- Serigrafía con la referencia y la función junto a cada conector.
- Marca de orientación del pin 1 en todos los conectores.
- Espacio libre de **≥ 20 mm** frente a los borneros para el radio de curvatura
  de los cables.

### 3.5 Separación de potencia y señal — resumen del requisito

| Requisito del dosier §28.7 | Implementación |
|---|---|
| Conectores por fila | J10–J12 (LED), J20–J22 (piezos) |
| Numeración | Serigrafía `ROW1..3`, `CH1-3`, `CH4-6`, `CH7-9` |
| Polaridad | Conectores polarizados con enclavamiento; XT30 recomendado en J1 |
| Pinout | §2 de este documento |
| Capacidad de corriente | Tabla §1, con margen ≥ 4,9× en el caso peor |
| Fijaciones | 4 × M3, §3.4 |
| Separación de potencia y señal | §3.1, ≥ 15 mm |
| Planos de masa | §3.2 |
| Retorno de LED | `GND_PWR` dedicado, polígono ≥ 2,0 mm |
| Accesibilidad | §3.4 |

## 4. Cableado interno del módulo — resumen

| Mazo | Desde | Hasta | Sección | Longitud est. |
|---|---|---|---|---|
| Alimentación | Fuente externa | J1 | 0,75 mm² | 1,5 m (externo) |
| Fila LED (ida) | J10/J11/J12 | Inicio de tira | **0,75 mm²** (potencia), 0,25 mm² (dato) | ≤ 0,6 m |
| Fila LED (reinyección) | J13/J14/J15 | Fin de tira | **0,75 mm²** | ≤ 1,2 m |
| Piezos | J20/J21/J22 | 9 discos | Coaxial fino apantallado | ≤ 0,5 m c/u |
| Tapa | J31 | SW70, SW71, D70, D71 | 0,25 mm² | ≤ 0,4 m |

**Todos los mazos etiquetados en ambos extremos** (dosier §7.6: «con conectores
internos etiquetados»).

## 5. Riesgos específicos de esta hoja

1. **No hay layout.** Todo lo anterior son reglas, no hechos. El DRC no se ha
   ejecutado y no puede ejecutarse en este entorno.
2. **J30 con adaptador de 5 V** destruye el ESP32-S3. Barrera actual: sólo
   mecánica y serigráfica.
3. **Cable de piezo sin apantallar** es la causa más probable de impactos
   fantasma de origen eléctrico.
4. **Retorno de 1,44 A en una sola vía** de J10–J12: con margen, pero es el pin
   más cargado del sistema.
5. **La correspondencia canal ↔ posición física** no está fijada en un ADR
   (ver hoja 04 §1). Un error aquí es silencioso y falsea toda la puntuación.
