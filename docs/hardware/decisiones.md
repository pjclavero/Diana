# Decisiones de diseño del WP-06 y su motivo

> **AVISO PROTOTIPO DO-ONLY:** estas decisiones documentan una PCB futura o
> preliminar cuando hablan de AO, ADC, ADS7953, MCP3208, MCP6004 externo, LM339
> externo o `VREF_TH`. El prototipo fisico actual usa DO-only con 2 x SN74HC165;
> ver `docs/hardware/prototipo-do-only.md`.
>
> Detalle por decision (rescatado de `hw/do-only-v1`):
>
> - **D-03 (dos 74HC165 en cascada): VIGENTE en el prototipo fisico.** Es la
>   topologia que se monta hoy.
> - **D-01, D-02, D-04, D-05 y todo lo referido a MCP6004, LM339, ADS7953,
>   MCP3208, CD74HC4067 y `VREF_TH`: NO UTILIZADO EN EL PROTOTIPO**, se
>   conservan como diseno de la PCB integrada futura.

Cada decisión indica **qué se decidió**, **por qué**, **qué se descartó** y **qué
se pierde**. Las que se apartan del dosier están marcadas con ⚠ y **requieren
aprobación del supervisor**.

---

## D-01 · Comparador alimentado desde la envolvente, no desde la señal cruda ⚠

**Decidido:** la señal recortada pasa por un seguidor y un rectificador; la
envolvente resultante alimenta **tanto** el ADC **como** el comparador.

**Motivo:** el pulso de un impacto puede durar menos de 50 µs. Un comparador
sobre la señal cruda produciría un pulso de salida igual de corto, que exigiría
**9 biestables** para no perderlo. Alimentándolo desde la envolvente, la salida
permanece activa milisegundos y el registro de desplazamiento se lee con holgura.

**Se descartó:** comparador sobre la señal cruda + 9 biestables 74HC74.

**Se pierde:** ~10–30 µs de latencia y la capacidad de distinguir dos impactos
separados por menos de ~10 ms en el **mismo** canal. El dosier §9.6 ya impone un
bloqueo de 30–100 ms tras impacto válido, así que no se pierde funcionalidad
exigida.

**Aparta del dosier §9.2**, que dibuja las dos ramas en paralelo.

---

## D-02 · Seguidor de tensión antes del detector de envolvente

**Decidido:** una sección de MCP6004 por canal (3 CI para 9 canales).

**Motivo:** sin él, el condensador de envolvente se carga a través de la
resistencia serie de 68 kΩ:

```
τ_ataque = 68 kΩ × 47 nF = 3,20 ms
```

**3,20 ms para capturar un impacto de menos de 1 ms.** El detector nunca
alcanzaría el pico y mediría una fracción arbitraria de él. La medida de amplitud
—que es la base del rechazo de vibración cruzada del dosier §9.6— sería inútil.

Con el seguidor: τ_ataque = 100 Ω × 47 nF = **4,70 µs**. Relación ataque/caída
**2 200:1**.

**Se descartó:** detector pasivo directo. **Coste:** 3 circuitos integrados.

---

## D-03 · Agregación de 9 interrupciones en 4 GPIO ⚠

**Decidido:** OR cableado por 9 diodos Schottky hacia un único `IRQ_ANY`, más dos
74HC165 en cascada (`SR_LOAD`, `SR_CLK`, `SR_DATA`) para leer qué canal fue.

**Motivo:** el presupuesto de GPIO **no cuadra** con 9 interrupciones directas
(cálculo 03). Faltan 4 pines sin contar reserva, 9 contándola.

**Por qué diodos y no unión directa:** unir las 9 salidas de colector abierto
daría un OR perfecto, pero las 9 entradas del 74HC165 verían la misma señal y se
perdería la identidad del canal. Los diodos aíslan cada salida.

**Verificación de nivel:** V_OL(LM339) + V_f(BAT54) = 0,20 + 0,30 = **0,50 V**,
frente a V_IL máx del ESP32-S3 = **0,825 V**. Margen **0,325 V**.

**Se descartó:** expansor de GPIO I²C (latencia y 2 GPIO), 9 interrupciones
directas (no caben).

**Se pierde:** el orden temporal entre canales dentro de la ventana de lectura
(decenas de µs). El algoritmo del dosier §9.6 decide por amplitud, no por orden.
**Debe confirmarlo WP-04.**

**Aparta del dosier §8.4**, que presupone 9 GPIO de interrupción.

---

## D-04 · ADC SPI externo en lugar de multiplexor CD74HC4067

**Decidido:** ADS7953 (16 canales, 12 bit) sobre el bus SPI del W5500.
Alternativa documentada: 2 × MCP3208.

**Motivo (por orden de peso):**

1. **GPIO:** 1 pin frente a 5. Es lo que permite cerrar el presupuesto con
   reserva.
2. Linealidad superior al ADC integrado del ESP32-S3.
3. Sin conflicto ADC2/RF.
4. Canales sobrantes para autocomprobación (masa y realimentación del umbral) a
   coste cero.

**Se descartó:** CD74HC4067 + ADC del ESP32-S3, que se conserva **(DNP)** en la
misma PCB como opción A. Con ella, la reserva de GPIO cae a **cero**.

**Se pierde:** disponibilidad (el ADS7953 es menos común) y una transacción SPI
compartida con Ethernet. Mitigado con la alternativa MCP3208.

Resuelve la **decisión pendiente n.º 11** del dosier §35.

---

## D-05 · Divisor 2:1 en las entradas del ADC

**Decidido:** cada entrada del ADC lleva un divisor de 1 kΩ / 1 kΩ.

**Motivo:** la referencia interna del ADS7953 es de **2,5 V**, pero la envolvente
puede llegar a **3,65 V**. Sin divisor, cualquier impacto fuerte se leería
saturado y se perdería justo la información de amplitud que necesita el
algoritmo de vibración cruzada.

Con divisor: fondo de escala equivalente 5,00 V, resolución **1,221 mV/LSB**,
umbral del comparador (120,7 mV) = 99 LSB.

**Se descartó:** referencia externa de 3,3 V (depende del modelo de ADC),
limitar la envolvente (perdería dinámica igualmente).

---

## D-06 · Resistencia serie del piezo partida en dos de 0805

**Decidido:** 2 × 33 kΩ en **0805**, no 1 × 68 kΩ en 0603.

**Motivo:** la resistencia serie ve la tensión completa del piezo, hasta **150 V
(H)**. Un 0603 típico está calificado a **50 V**. Dos 0805 (150 V cada uno) en
serie soportan 300 V.

**Se pierde:** área de PCB. **Se gana:** que la protección no falle abriendo o,
peor, cortocircuitando y llevando 150 V al microcontrolador.

---

## D-07 · Buck de 3,3 V en lugar de LDO

**Decidido:** convertidor conmutado 5 → 3,3 V, con f_sw ≥ 1 MHz.

**Motivo:** con 0,45 A de carga, un LDO disipa **0,765 W** (ΔT = 46 °C); un buck
disipa **0,165 W**. **4,6 veces menos calor** dentro de una caja cerrada que ya
tiene que evacuar 2,8 W.

**Se pierde:** ruido de conmutación en el riel del que cuelga la cadena
analógica. Mitigado con ferrita + 10 µF + 100 nF hacia `+3V3A` y f_sw > 1 MHz,
muy lejos del contenido espectral del impacto. **Si el ruido resultara
inaceptable, la alternativa es un LDO sólo para `+3V3A`.**

---

## D-08 · Protección de polaridad con PMOS, no con diodo

**Decidido:** MOSFET de canal P, R_DS(on) ≤ 30 mΩ.

**Motivo:**

```
PMOS:     2,26 A × 0,030 Ω = 68 mV de caída, 0,15 W
Schottky: 2,26 A × 0,40 V  = 0,90 V de caída, 0,90 W
```

Seis veces menos disipación y 0,83 V más de margen en la entrada del convertidor.

**Se pierde:** un componente más (Zener de protección de puerta) y que un PMOS en
cortocircuito **deja de proteger sin aviso**. Registrado como riesgo.

---

## D-09 · `+5V_LED` y `+5V_LOG` separados topológicamente, no galvánicamente ⚠

> **Aviso 2026-08-20:** esta decision fue escrita con la hipotesis antigua de
> 72 LED totales. El banco real usa 216 LED (`9 x 24`), por lo que las cifras
> de corriente de esta seccion deben revisarse antes de fabricar o dimensionar
> fuente/cobre.

**Decidido:** un solo convertidor de 6 A cuya salida se reparte desde un único
polígono en dos caminos de cobre distintos.

**Motivo:** el encargo pide «separación de la alimentación de lógica y de LED».
Una separación **galvánica** real exigiría dos convertidores, más coste, más
calor y más área. La separación **topológica** consigue lo esencial: los
transitorios de 4,32 A de los LED no circulan por el cobre que alimenta la
lógica.

**Se pierde:** si el riel se hunde, se hunde para todos. Mitigado con 2 000 µF de
bulk (ESR ≤ 26,2 mΩ) y tope de brillo.

**(V) Es una de las decisiones que más claramente puede tener que revisarse tras
la medida B4 (transitorio negro → blanco).**

---

## D-10 · El 74AHCT125 se alimenta de `+5V_LOG`, no de `+5V_LED`

> **Aviso 2026-08-20:** revisar con el nuevo consumo teorico de 216 LED. La
> prueba parcial confirmo que 2 aros encienden, pero no valida transitorios ni
> caidas de tension de una fila completa.

**Decidido:** V_CC del conversor de nivel desde el riel de lógica.

**Motivo:** si el riel de LED cae durante un transitorio de 4,32 A, la salida del
buffer caería con él y los datos se corromperían justo cuando más se necesitan.

**(V) Contrapartida:** el V_IH del primer LED se referencia a **su** V_DD (el de
`+5V_LED`). Si la diferencia entre ambos rieles superara 0,3 V, el margen se
degradaría. **Debe medirse.**

---

## D-11 · Inyección de 5 V por **ambos** extremos de cada fila

**Decidido:** conectores adicionales J13–J15 al extremo final de cada tira.

**Motivo:** el dosier §10.4 pide «inyección de 5 V en cada fila». Con inyección
doble, cada extremo aporta ≤ 0,72 A en lugar de 1,44 A y la caída se reduce
aproximadamente a la cuarta parte.

**Se pierde:** 3 conectores y 3 mazos más. **Se gana:** margen de tensión en el
extremo lejano, que es donde el color empieza a degradarse.

---

## D-12 · Estado (0,0) del selector reservado para «fallo» ⚠

**Decidido:** codificación de 3 posiciones con 2 GPIO en la que la combinación
(0,0) es **imposible** con el selector sano.

**Motivo:** ataca directamente el riesgo del dosier §34 «Dos principales →
Partida inconsistente». Si el mazo se desconecta o el selector se avería, el
firmware lo detecta y **entra en SATÉLITE, nunca en PRINCIPAL**: ante duda, el
módulo no reclama autoridad.

Además, la posición AUTO deja ambas entradas **en reposo** (sin ningún contacto
cerrado), que es la posición más robusta ante contactos sucios.

**Se pierde:** nada. Es un uso gratuito de una combinación que sobraba.

---

## D-13 · No se implementa parada de emergencia ⚠

**Decidido:** no hay seta de emergencia en el módulo.

**Motivo:** el módulo no tiene partes móviles, no genera fuerza y funciona a 12 V
de continua. Una parada añadiría un punto de fallo sin reducir ningún riesgo
identificado. **El corte de riesgo relevante es el de 230 V, y está en la fuente
externa certificada, fuera de esta PCB.**

**Si el análisis de seguridad del lugar de uso (dosier §35, decisión pendiente
n.º 24) lo exigiera**, se implementaría como corte del primario de 230 V, no como
señal lógica.

**Requiere ratificación explícita del supervisor.**

---

## D-14 · MAC derivada del eFuse del ESP32-S3

**Decidido:** derivar la MAC del W5500 del MAC base de fábrica del ESP32-S3.

**Motivo:** el W5500 no trae MAC. Una EEPROM 24AA02E48 costaría **2 GPIO de I²C**
que no existen sin restricciones (cálculo 03 §3.2). El MAC base del ESP32-S3 está
en eFuse, es único y lo garantiza Espressif.

**Se descartó:** EEPROM de MAC (no hay GPIO), grabación en producción (requiere
proceso de fabricación).

---

## D-15 · Umbral común por PWM filtrado, no DAC

**Decidido:** un GPIO en PWM + filtro RC (47 kΩ / 1 µF, τ = 47 ms) + seguidor
genera `VREF_TH` común a los 9 canales.

**Motivo:** **el ESP32-S3 no tiene DAC** (a diferencia del ESP32 original). Un
DAC I²C costaría 2 GPIO. El dosier §9.3 pide umbral «ajustable por banco o por
canal»: esto cubre «por banco», y el ajuste fino por canal se hace en firmware
comparando la amplitud del ADC contra el umbral individual de NVS (dosier §9.7).

**Se pierde:** resolución de 12,9 mV/paso con PWM de 8 bits, sobre un umbral de
120,7 mV (10,7 %). **(V)** Si es insuficiente, PWM de 10 bits da 3,2 mV/paso.

**Riesgo asociado:** al arrancar, `VREF_TH` = 0 V ⇒ **los 9 comparadores
disparados**. El firmware **debe** fijar el umbral antes de habilitar la
interrupción. Requisito para WP-04.

---

## D-16 · Ficheros KiCad sin instancias de símbolos ⚠

**Decidido:** los `.kicad_sch` contienen la jerarquía, las 8 hojas, los pines
jerárquicos y la documentación del conexionado, **pero no símbolos**. El
conexionado normativo va en Markdown y CSV.

**Motivo:** sin KiCad instalado no se puede validar el bloque `lib_symbols`.
Escribir a mano ~90 componentes tiene alta probabilidad de producir un fichero
que KiCad rechace o —peor— que abra con conexiones silenciosamente equivocadas.

> **Un esquemático que parece correcto y no lo es es más peligroso que la
> ausencia de esquemático.**

**Se entrega a cambio:** `netlist/netlist.csv` (74 redes nodo a nodo),
`netlist/components.csv` (140 componentes) y 9 documentos de esquema, con los que
un ingeniero transcribe el diseño sin interpretar nada.

---

## D-17 · PCB de 4 capas

**Decidido:** 4 capas, cobre de 1 oz mínimo.

**Motivo:** se necesita plano de retorno continuo bajo los pares diferenciales de
Ethernet, y separación de `GND_PWR`, `GND_LOG` y `GND_ANA`. Con 2 capas no es
posible hacer ambas cosas.

**Alternativa considerada y rechazada:** 2 capas con módulo W5500 preensamblado
(que resolvería Ethernet), pero seguiría sin resolver la separación de masas con
4,87 A circulando.

---

## Decisiones del dosier §35 que este WP resuelve o acota

| # dosier | Decisión pendiente | Estado tras WP-06 |
|---:|---|---|
| 1 | Modelo exacto de ESP32-S3 | **Acotada:** ESP32-S3-WROOM-1-N16R8, con `R2` como alternativa que da +3 GPIO |
| 2 | Modelo exacto de W5500 | **Acotada:** W5500 LQFP-48, o módulo preensamblado para el prototipo 1 |
| 3 | Material y grosor definitivo | **No resuelta.** Requiere los ensayos M1–M10 |
| 9 | Modelo exacto de LED | **Acotada:** WS2812B o SK6812, 60 mA de hipótesis a medir |
| 10 | Comparador | **RESUELTA:** LM339 (colector abierto obligatorio) |
| 11 | Multiplexor o ADC externo | **RESUELTA:** ADC SPI externo (D-04) |
| 12 | Umbral común o individual | **RESUELTA:** común en hardware, individual en firmware (D-15) |
| 8 | Fuente externa o integrada | **Acotada:** externa certificada para prototipos (dosier §11.3) |
