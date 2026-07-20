# Cálculo 04 — Térmica del convertidor 12 V → 5 V y del regulador de 3,3 V

> **Estado: cálculo con θ_JA de catálogo. NADA medido, ninguna cámara térmica,
> ningún prototipo.** El resultado depende críticamente del rendimiento real y
> del cobre real de la PCB, ninguno de los cuales existe todavía.

Fuente normativa: dosier §11.3 («protección térmica») y §28.8 («revisión de
térmica» obligatoria antes de fabricar).

---

## 1. Datos de partida

Del cálculo 01:

```
P_salida (blanco máximo) = 4,870 A × 5 V = 24,35 W
```

Temperatura ambiente de diseño: **T_a = 40 °C** (electrónica dentro de una caja
cerrada, dosier §11.3, sin ventilación forzada). **(H)**

```
P_disipada = P_salida × (1/η − 1)
ΔT = P_disipada × θ_JA
T_j = T_a + ΔT
```

## 2. Resultado — el margen es estrecho y depende del rendimiento

Blanco máximo (4,87 A), T_a = 40 °C, límite T_j = 125 °C:

| η | P_dis | θ_JA=20 °C/W | θ_JA=25 °C/W | θ_JA=36 °C/W | θ_JA=45 °C/W |
|---:|---:|---|---|---|---|
| **0,90** | 2,71 W | 94 °C ✔ | 108 °C ✔ | **137 °C ✘ EXCEDE** | **162 °C ✘ EXCEDE** |
| **0,93** | 1,83 W | 77 °C ✔ | 86 °C ✔ | 106 °C ✔ | 122 °C ✔ (al límite) |
| **0,94** | 1,55 W | 71 °C ✔ | 79 °C ✔ | 96 °C ✔ | 110 °C ✔ |

(las celdas son T_j resultante)

### Lectura del resultado

**Un convertidor con η = 0,90 montado en un encapsulado corriente
(θ_JA ≈ 36 °C/W, típico de un QFN sobre 1 pulgada² de cobre de 1 oz) SUPERA la
temperatura de unión máxima en blanco al 100 %.** Éste es un hallazgo real, no
un matiz.

## 3. Requisitos que se derivan

Para que el diseño sea térmicamente sano en el peor caso hay que cumplir **al
menos dos** de estas tres condiciones:

1. **η ≥ 0,93 a 4,87 A**, verificado en la hoja de datos a 12 V de entrada
   (no a 5 V ni a media carga: los fabricantes publican la curva más favorable).
2. **θ_JA ≤ 25 °C/W**, lo que exige:
   - polígono de cobre de **≥ 2 pulgadas² (≈ 1 300 mm²)** en la capa superior
     conectado al pad térmico,
   - matriz de **vías térmicas de 0,3 mm a paso de 1,0 mm** bajo el pad
     (mínimo 16 vías),
   - cobre en la capa inferior de área equivalente.
3. **Tope global de brillo aplicado en firmware** (ver §4).

## 4. Punto de trabajo normal con el tope de brillo al 60 %

```
I_LED  = 4,320 × 0,60 = 2,592 A
I_total = 2,592 + 0,550 = 3,142 A
P_salida = 15,71 W
P_dis (η = 0,93) = 1,18 W
ΔT (θ_JA = 36 °C/W) = 43 °C  →  T_j = 83 °C   ✔ cómodo
```

**Conclusión operativa:** el módulo es térmicamente cómodo en uso normal y
marginal en el modo de diagnóstico de blanco máximo. Por tanto:

- El tope global de brillo **no es una recomendación, es un requisito térmico**.
- El modo «blanco máximo» del dosier §10.4 debe estar **limitado en el tiempo**
  por firmware. Duración propuesta a validar: **≤ 60 s**, con enfriamiento
  posterior obligatorio.
- Debe existir supervisión: si el ADC lee que `VSENSE_5V` cae por debajo de
  4,75 V, el firmware reduce el brillo automáticamente.

## 5. Regulador de 3,3 V — decisión LDO vs. conmutado

Carga del riel de 3,3 V: ESP32-S3 (240 mA) + W5500 (183 mA) + analógica (25 mA)
≈ **0,45 A**.

### Opción LDO (AMS1117-3.3 o similar, SOT-223)

```
P_dis = (5,0 − 3,3) × 0,45 = 0,765 W
ΔT (θ_JA ≈ 60 °C/W en SOT-223 con cobre modesto) = 46 °C
T_j = 40 + 46 = 86 °C     ✔ dentro de límites, pero caliente
```

Cabe, pero 0,765 W dentro de la caja es calor gratuito que hay que evacuar y que
se suma a todo lo demás.

### Opción conmutada (buck síncrono 5 V → 3,3 V, 1 A)

```
P_dis = 3,3 × 0,45 × (1/0,90 − 1) = 0,165 W
```

**4,6 veces menos calor.**

**Decisión adoptada: buck síncrono.** El LDO queda documentado como alternativa
de montaje (mismo pie de PCB no es posible; se documenta como variante de
placa) para el caso de que haya problemas de ruido en el riel analógico.

**Contrapartida honesta:** un conmutador introduce rizado en el riel del que
cuelga la cadena analógica del piezo. Por eso el riel `+3V3A` se deriva de
`+3V3` a través de una **ferrita (600 Ω a 100 MHz) + 10 µF + 100 nF**, y la
frecuencia de conmutación debe estar **por encima de 1 MHz** para quedar muy
lejos del contenido espectral del impacto. Si en banco el ruido resultara
inaceptable, la alternativa es el LDO alimentando exclusivamente `+3V3A`.

## 6. Otros focos de calor en la caja

| Fuente | Potencia disipada | Nota |
|---|---:|---|
| Convertidor 12→5 V (uso normal) | 1,18 W | §4 |
| Regulador 3,3 V (buck) | 0,17 W | §5 |
| 72 LED al 60 % | ≈ 7,8 W | disipada en las tiras, fuera de la caja de electrónica |
| ESP32-S3 + W5500 | ≈ 1,4 W | |
| Resistencias serie de piezo | < 10 mW | despreciable (cálculo 02 §3.2) |
| **Total dentro de la caja de electrónica** | **≈ 2,8 W** | |

2,8 W en una caja cerrada de electrónica requiere, como mínimo, rejillas de
convección natural arriba y abajo. **Cantidad y superficie por determinar con un
ensayo real** — no se calcula aquí porque la geometría de la caja no está
definida (dosier §35, decisión pendiente n.º 17).

## 7. Lo que hay que medir antes de creerse esto

1. Rendimiento real del convertidor elegido a 12 V de entrada y 4,87 A de salida.
2. Temperatura de la cápsula del convertidor con cámara térmica o termopar, tras
   30 min a blanco máximo y con la caja cerrada.
3. Temperatura ambiente real dentro de la caja tras 1 h de funcionamiento normal.
4. Rizado del riel `+3V3A` con el convertidor de 3,3 V conmutando, medido en la
   entrada del comparador con la sonda en AC y ancho de banda limitado a 20 MHz.
5. Comprobar que la protección térmica del convertidor actúa antes de daño
   (ensayo de bloqueo de ventilación, si lo hubiera).
6. Verificar que el disparo del tope de brillo por baja tensión funciona.
