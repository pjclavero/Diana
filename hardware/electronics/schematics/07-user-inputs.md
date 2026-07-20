# Hoja 07 — Entradas de usuario: selector, botón de identificación y LED de estado

> **SIN VALIDAR.** ERC no ejecutado. Dosier §6.3, §28.6 y §34 («Dos principales
> → Partida inconsistente → Selector + bloqueo de inicio»).

## 1. Componentes

| Ref. | Valor / tipo | Encapsulado | Función |
|---|---|---|---|
| SW70 | Selector rotativo **1 polo, 3 posiciones**, con tope, montaje en panel | Panel | SATÉLITE / AUTO / PRINCIPAL (dosier §6.3) |
| SW71 | Pulsador momentáneo NA, ⌀12 mm, montaje en panel | Panel | Identificación (dosier §22.5) |
| R70, R71 | 2 × 10 kΩ | 0603 | Pull-up de `SEL_A` y `SEL_B` a `+3V3` |
| R72 | 10 kΩ | 0603 | Pull-up de `BTN_ID` a `+3V3` |
| R73, R74, R75 | 3 × 100 Ω | 0603 | Serie de protección en las tres líneas que salen a la tapa |
| C70, C71, C72 | 3 × 100 nF X7R | 0603 | Antirrebote RC. τ = 10 kΩ × 100 nF = **1,0 ms** |
| D70 | LED **verde** 3 mm, V_f ≈ 2,0 V | THT/panel | Estado del módulo |
| D71 | LED **ámbar** 3 mm, V_f ≈ 2,0 V | THT/panel | Mantenimiento / fallo |
| R76, R77 | 2 × 330 Ω | 0603 | Limitadoras de D70 y D71 |
| D72 | Array TVS 5 canales, ej. SRV05-4 | SOT-23-6 | ESD en las líneas que salen de la PCB |
| J31 | Cabecera 6 vías paso 2,54 mm, polarizada | THT | Mazo a la tapa (hoja 08) |

## 2. Selector de tres posiciones — codificación

El dosier §6.3 define tres modos. Con un selector de 1 polo y 3 posiciones y dos
GPIO con pull-up, cada posición cortocircuita a masa una combinación:

| Posición de SW70 | `SEL_A` (IO15) | `SEL_B` (IO16) | Modo |
|---|:---:|:---:|---|
| 1 | 0 | 1 | **PRINCIPAL** |
| 2 | 1 | 1 | **AUTO** (posición central, ambos en reposo) |
| 3 | 1 | 0 | **SATÉLITE** |
| — | **0** | **0** | **FALLO: cable cortado, selector averiado o mazo mal conectado** |

**El estado (0, 0) es imposible con el selector sano.** Se reserva
deliberadamente para diagnóstico: si el firmware lo lee, debe declarar el
selector no fiable, **entrar en modo SATÉLITE por seguridad** (nunca en
PRINCIPAL) y encender D71 (ámbar). Esto ataca directamente el riesgo del dosier
§34 «Dos principales → Partida inconsistente»: ante duda, el módulo **no**
reclama autoridad.

**Nota importante:** la posición AUTO deja **ambas** entradas en alto, es decir,
en reposo, sin ningún contacto cerrado. Es la posición más robusta ante
suciedad o contacto degradado, y es la que el dosier §6.3 describe como
comportamiento negociado. Coherente.

### 2.1 Conexionado

| Nodo | Conexiones |
|---|---|
| `+3V3` | R70.1, R71.1, R72.1 |
| `SEL_A` | R70.2 ; C70.1 ; D72.canal1 ; R73.1 |
| — | R73.2 → J31.1 → SW70 (contacto de la posición PRINCIPAL) |
| `SEL_B` | R71.2 ; C71.1 ; D72.canal2 ; R74.1 |
| — | R74.2 → J31.2 → SW70 (contacto de la posición SATÉLITE) |
| — | SW70.común → J31.6 → `GND_LOG` |
| — | C70.2, C71.2, C72.2 → `GND_LOG` |
| ESP32-S3 | `SEL_A` → IO15 ; `SEL_B` → IO16 |

Las resistencias serie R73–R75 de 100 Ω limitan la corriente en caso de descarga
electrostática o de cortocircuito accidental del mazo contra un riel, y forman
con la capacidad del cable un filtro adicional.

## 3. Botón de identificación

Función (dosier §22.5): al pulsarlo, el módulo se anuncia en la red y ejecuta el
patrón visual de identificación (cian, barrido — dosier §10.5).

| Nodo | Conexiones |
|---|---|
| `BTN_ID` | R72.2 ; C72.1 ; D72.canal3 ; R75.1 → IO17 |
| — | R75.2 → J31.3 → SW71.1 |
| — | SW71.2 → J31.6 → `GND_LOG` |

**Activo a nivel bajo.** Antirrebote:

- Hardware: τ = R72 × C72 = 10 kΩ × 100 nF = **1,0 ms**.
- Firmware: filtro adicional de **20 ms** y detección de flanco, no de nivel.

El dosier §28.6 pide «antirrebote» sin especificar. 1 ms de RC filtra el rebote
mecánico rápido; los 20 ms de firmware cubren el rebote lento de un pulsador
desgastado. Los dos juntos son la práctica recomendada. **(V)** Medir el rebote
real del pulsador que se compre con analizador lógico.

**Pulsación larga:** se recomienda que el firmware distingua pulsación corta
(< 1 s, identificación) de larga (> 5 s, entrar en modo de calibración o de
recuperación). No cuesta hardware. **Decisión de WP-04.**

## 4. LED de estado

| Nodo | Conexiones | Corriente |
|---|---|---|
| `ST_LED_G` | IO18 → R76 (330 Ω) → D70.ánodo ; D70.cátodo → J31.4 → `GND_LOG` | (3,3 − 2,0)/330 = **3,9 mA** |
| `ST_LED_A` | IO39 → R77 (330 Ω) → D71.ánodo ; D71.cátodo → J31.5 → `GND_LOG` | **3,9 mA** |

3,9 mA es suficiente para un LED moderno de 3 mm y está muy por debajo del
límite de 40 mA por GPIO del ESP32-S3. Si en el prototipo resultan poco visibles,
bajar a 220 Ω da 5,9 mA. **(V)**

### 4.1 Semántica propuesta (a fijar por WP-04)

| D70 (verde) | D71 (ámbar) | Significado |
|---|---|---|
| Apagado | Apagado | Sin alimentación o firmware colgado |
| Parpadeo rápido | Apagado | Arrancando / buscando red |
| Fijo | Apagado | Operativo, red y MQTT conectados |
| Parpadeo lento | Apagado | Operativo pero sin servidor (cola local activa) |
| Cualquiera | Fijo | Fallo de calibración o de sensor |
| Cualquiera | Parpadeo | Selector en estado inválido (§2) |
| Alternando | Alternando | Actualización OTA en curso — **no desconectar** |

**No se depende sólo del color** (dosier §10.5): cada estado tiene un patrón
temporal distinto, distinguible por una persona con daltonismo.

## 5. Interruptor general y «posible parada»

El dosier §28.6 menciona «interruptor» y «posible parada».

- **Interruptor general:** es `SW1` de la hoja 01, bipolar, en la entrada de 12 V.
  No está en esta hoja porque corta potencia, no señal.
- **Parada de emergencia:** **no se implementa** y se documenta el motivo. El
  módulo no tiene partes móviles, no genera fuerza y funciona a 12 V de continua;
  una seta de emergencia añadiría un punto de fallo sin reducir ningún riesgo
  identificado. **El corte de riesgo relevante es el de 230 V, que está en la
  fuente externa certificada, fuera de esta PCB.** Si el análisis de seguridad
  del lugar de uso (dosier §35, decisión pendiente n.º 24) exigiera una parada,
  se implementaría como corte del primario de 230 V, no como señal lógica.

**Esta es una decisión que debe ratificar el supervisor.**

## 6. Puntos de prueba

| TP | Red | Criterio |
|---|---|---|
| TP70 | `SEL_A` | 3 combinaciones válidas al girar SW70 ; nunca (0,0) |
| TP71 | `SEL_B` | ídem |
| TP72 | `BTN_ID` | Alto ≥ 3,0 V en reposo ; bajo ≤ 0,3 V pulsado ; rebote extinguido en < 5 ms |
| TP73 | `ST_LED_G` | Conmuta 0 / 3,3 V |
| TP74 | `ST_LED_A` | Conmuta 0 / 3,3 V |

## 7. Riesgos específicos de esta hoja

1. **El mazo a la tapa sale de la caja apantallada** y es la vía de entrada de
   ESD más probable. Mitigado con D72 y R73–R75; **no verificado**.
2. **`ST_LED_A` ocupa IO39 (MTCK de JTAG)**. Si se necesita JTAG, ver la variante
   B′ del cálculo 03 §3.2.
3. **Un selector con contacto sucio** puede producir lecturas intermitentes. El
   estado (0,0) sólo detecta el circuito abierto total, no el contacto
   intermitente. **Se recomienda que el firmware exija que la lectura sea estable
   durante 100 ms antes de cambiar de modo**, y que **nunca** cambie de modo con
   una partida en curso.
4. El estado inválido del selector fuerza SATÉLITE: si **todos** los módulos
   fallaran a la vez no habría PRINCIPAL y no se podría jugar. Es el fallo
   seguro correcto (mejor no jugar que jugar con dos autoridades), pero debe
   estar documentado para el operador.
