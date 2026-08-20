# BOM preliminar — módulo 3×3

> ## ⚠ NO UTILIZADO EN PROTOTIPO V1 — las partidas de MCP6004, LM339, ADS7953/MCP3208 y CD74HC4067
>
> El prototipo físico V1 detecta **exclusivamente** por la salida digital `DO` de
> nueve módulos comerciales de sensor piezoeléctrico, con umbral ajustado por
> potenciómetro. **No monta** ADS7953, ADS1115, MCP3208, CD74HC4067, MCP6004,
> LM339 externo ni `VREF_TH` por PWM, y **no mide amplitud**.
>
> Este documento se conserva como **DISEÑO FUTURO** (PCB integrada). Sigue siendo
> válido como tal; **no describe el prototipo que se monta hoy**.
> Prototipo V1: `docs/hardware/prototipo-do-only.md` ·
> pinout normativo: `firmware/esp32/boards/esp32s3_proto_do_w5500.h`.

---

Fichero: [`bom-modulo-3x3-preliminar.csv`](bom-modulo-3x3-preliminar.csv) — 58 líneas.

## Por qué NO hay precios

**No se ha consultado ningún distribuidor.** Este entorno no tiene acceso a
catálogos ni forma de verificar existencias, plazos ni precios en la fecha de
redacción. Poner cifras inventadas en un documento que alguien va a usar para
pedir presupuesto sería peor que no ponerlas.

La columna `notas_disponibilidad` contiene **criterios técnicos de selección y
sustitución**, no afirmaciones sobre stock. Antes de comprar hay que:

1. Verificar existencias reales en al menos dos distribuidores.
2. Comprobar que la alternativa elegida cumple el criterio técnico anotado.
3. Descargar y leer la hoja de datos de cada componente marcado como `critico=si`.

## Estructura del fichero

| Columna | Contenido |
|---|---|
| `item` | Número de línea del BOM |
| `categoria` | Semiconductor / Pasivo / Electromecánico / Conector / Cable / Transductor / Optoelectrónica / Alimentación / PCB / Mecánica |
| `referencias` | Referencias del esquema |
| `cantidad` | Unidades por módulo |
| `valor` | Valor o modelo |
| `encapsulado` | |
| `alternativa_1`, `alternativa_2` | Sustitutos, con su contrapartida indicada |
| `critico` | `si` = una sustitución mal hecha rompe una función o pone en riesgo el hardware |
| `notas_disponibilidad` | Criterio técnico de compra y sustitución |

## Los 8 componentes donde una sustitución «equivalente» rompe el diseño

| Ítem | Componente | Qué pasa si se sustituye mal |
|---:|---|---|
| 6 | **74AHCT125** | Una familia **HC** en lugar de **HCT** tiene V_IH = 3,5 V y **no acepta 3,3 V**. Los LED harán cosas aleatorias. |
| 9 | **LM339** | Un comparador de **salida push-pull** (TLV3502, TLV3201…) **impide el OR cableado** de la hoja 04 y provoca cortocircuitos entre salidas. |
| 12 | **BAT54S** | Un diodo de **silicio** (V_f 0,7 V) recorta a 4,0 V en vez de 3,65 V — por encima del máximo absoluto del ESP32-S3. |
| 21 | **Bulk 1000 µF low-ESR** | Un electrolítico genérico de 0,15 Ω da 0,57 V de caída en el escalón: **reinicios en partida**. El requisito es ESR ≤ 26,2 mΩ combinada. |
| 24 | **Resistencias serie 33 kΩ en 0805** | Un **0603** está calificado a 50 V y ve hasta 150 V. Falla, y al fallar en cortocircuito el piezo llega al ESP32-S3. |
| 30 | **C23 de 10 nF / 2 kV** | Un condensador de 50 V no aísla el puerto Ethernet. |
| 50 | **Cable de piezo apantallado** | Sin apantallar se acopla ruido de red entre canales: **impactos fantasma de origen eléctrico**, indistinguibles de los mecánicos. |
| 55 | **Fuente de 12 V certificada** | Dosier §11.3 y §34 («Fuente no segura → Riesgo eléctrico»). |

## Recuento aproximado

| Categoría | Líneas | Unidades aprox. |
|---|---:|---:|
| Semiconductores | 21 | ~60 |
| Pasivos | 17 | ~180 |
| Electromecánicos | 6 | 9 |
| Conectores | 6 | 14 |
| Cable | 3 | — |
| Transductores y LED | 2 | 81 |
| Alimentación, PCB, mecánica | 4 | ~120 |
| **Total de líneas** | **58** | |

## Simplificación recomendada para el primer prototipo

Para el **primer** prototipo, el riesgo de layout se reduce mucho usando módulos
preensamblados en lugar de circuitos integrados desnudos:

| En vez de | Usar en el prototipo 1 | Riesgo que elimina |
|---|---|---|
| U11 (W5500 LQFP-48) + Y1 + magnetismos + terminación | Módulo W5500 preensamblado con RJ45 | Layout de PHY con impedancia controlada |
| U1 (buck 6 A) + L2 + realimentación | Módulo DC-DC 12→5 V de 6 A | Layout del lazo de conmutación |
| U10 (WROOM-1 SMD) | Placa de desarrollo ESP32-S3 | Soldadura del módulo y errores de arranque |

El dosier §8.2 ya prevé esto: «Desarrollo inicial sobre placa de desarrollo. PCB
portadora propia en versiones posteriores». **La cadena piezo, en cambio, hay que
construirla tal cual desde el principio**, porque es lo que hay que validar.

## Repuestos (dosier §27.3)

Recomendación mínima por instalación: 2 discos piezo, 1 tira de 24 LED, 1 disco
de policarbonato, 4 silentblocks, 1 fuente de 12 V.
