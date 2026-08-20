# Aislamiento de vibraciones entre dianas

> ## ⚠ NOTA PARA EL PROTOTIPO V1 (DO-only)
>
> En V1 **no hay comparación de amplitudes en tiempo de juego**: la única defensa
> contra la vibración transmitida es el aislamiento mecánico que analiza este
> documento más el ajuste del potenciómetro de cada sensor
> (`docs/hardware/calibracion-sensores-do.md`). Esto hace el aislamiento
> **más** crítico en V1, no menos. Las amplitudes citadas aquí se miden con
> instrumentación de banco.

---

> **NADA MEDIDO.** Cálculos sobre modelo de un grado de libertad, con hipótesis
> de masa y rigidez. Dosier §7.2, §7.4 y §34 («Vibración cruzada → Impactos
> falsos → Aislamiento + amplitud + ventana»).

> **«El aislamiento mecánico será la primera barrera contra impactos fantasma.
> El software será la segunda.»** — dosier §7.4.
>
> Ese orden importa: **ningún algoritmo de software puede recuperar información
> que el acoplamiento mecánico ha destruido.** Si la diana vecina recibe el 80 %
> de la amplitud de la golpeada, comparar amplitudes no distingue nada. Este
> documento existe para que eso no ocurra.

## 1. Modelo

Cada diana es una masa suspendida sobre cuatro apoyos elásticos (dosier §7.2:
«tres o cuatro apoyos elásticos»). Modelo de un grado de libertad:

```
f_n = (1 / 2π) · √(k_total / m)
```

- `m` = masa del conjunto móvil (disco + alojamiento + piezo + tornillería)
- `k_total` = rigidez sumada de los 4 apoyos

**Transmisibilidad** para excitación muy por encima de la frecuencia propia
(régimen de aislamiento, f ≫ f_n, amortiguamiento bajo):

```
T ≈ (f_n / f)²
```

## 2. Datos de partida

| Parámetro | Valor | Origen |
|---|---:|---|
| Masa del disco de PC de 3 mm | 0,113 kg | calculado en `policarbonato-ensayos.md` |
| Alojamiento, piezo y tornillería | ≈ 0,147 kg **(H)** | estimación |
| **m adoptada** | **0,26 kg** | |
| Contenido espectral relevante del impacto | 500 Hz – 5 kHz **(H)** | **debe medirse con FFT** |

## 3. Dimensionado de los apoyos

| f_n objetivo | k_total | **k por apoyo (×4)** | Flecha estática | T a 1 kHz | Atenuación |
|---:|---:|---:|---:|---:|---:|
| 25 Hz | 6 415 N/m | **1 604 N/m** | 0,398 mm | 0,00063 | **−64,1 dB** |
| **30 Hz (adoptado)** | **9 238 N/m** | **2 309 N/m** | **0,276 mm** | **0,00090** | **−60,9 dB** |
| 40 Hz | 16 423 N/m | **4 106 N/m** | 0,155 mm | 0,00160 | **−55,9 dB** |

### Elección: f_n = 30 Hz

- Muy por debajo del contenido del impacto (≥ 500 Hz) ⇒ **más de 60 dB de
  atenuación** hacia el bastidor.
- Flecha estática de 0,276 mm: el disco no «cuelga» de forma perceptible ni se
  desalinea con el marco.
- Suficientemente por encima de las vibraciones del suelo y de las pisadas
  (típicamente < 20 Hz).

**Especificación para compra:** silentblocks de M4 con **rigidez axial de
2 300 N/m ± 30 %**. En la práctica se especifica por dureza y geometría: caucho
**Shore A 40–55**, ⌀8–10 mm, altura 8–10 mm. **(V)** La rigidez real debe
medirse: se carga el apoyo con pesos conocidos y se mide la flecha.

## 4. Verificación experimental de la frecuencia propia

No hace falta un excitador de vibraciones. Método del golpe (*bump test*):

1. Montar una diana sobre sus 4 apoyos.
2. Conectar el piezo al osciloscopio (`TP_PZn`, sonda 10:1).
3. Dar un golpe seco y breve.
4. Registrar la señal y hacer la FFT.
5. **El pico de baja frecuencia es f_n.** Debe estar en **30 Hz ± 30 %**.
6. Medir también la decadencia de la envolvente para estimar el amortiguamiento.

Si f_n sale muy por encima (p. ej. 80 Hz), los apoyos son demasiado rígidos y la
atenuación cae de −60,9 dB a −41,9 dB: **19 dB peor**, factor 9 en amplitud. Ésa
es la diferencia entre un sistema que funciona y uno que produce impactos
fantasma constantes.

## 5. Los cuatro caminos de acoplamiento (y qué hace cada barrera)

```
       Diana golpeada
             │
   ┌─────────┼──────────┬────────────────┐
   │         │          │                │
 (1) Apoyos  (2) Marco  (3) Aire         (4) Cable
   │         │          │                │
   ▼         ▼          ▼                ▼
Bastidor  Bastidor   Diana vecina    Electrónica
   │                                     │
   ▼                                     ▼
Diana vecina                       Canal vecino
```

| Camino | Barrera | Estado |
|---|---|---|
| **(1) Apoyos elásticos** | f_n = 30 Hz ⇒ −60,9 dB | Dimensionado, **no medido** |
| **(2) Marco compartido** | «Refuerzos que no unan rígidamente las caras activas» (dosier §7.4). Alojamientos independientes, separación entre marcos | Requisito de diseño, **sin diseño mecánico aún** |
| **(3) Acoplamiento por aire** | Junta de goma perimetral entre disco y marco, sin contacto rígido | Requisito, **no ensayado** |
| **(4) Diafonía eléctrica** | Cable apantallado individual por canal (hoja 08 §2.4), masa analógica separada | En el diseño electrónico, **no medido** |

**El camino (4) es el que un equipo de mecánica pasa por alto y un equipo de
electrónica también.** Un acoplamiento capacitivo de 10 pF entre dos cables de
piezo sin apantallar, con señales de 150 V, produce una señal en el vecino
indistinguible de un impacto real. Por eso el apantallamiento individual está
marcado como **crítico** en el BOM (ítem 50).

## 6. Criterio numérico de aceptación

Ensayo M8 de `policarbonato-ensayos.md`: golpear la diana 5 y medir la amplitud
de pico en las 9.

```
Relación de acoplamiento = A_vecina / A_golpeada
```

| Relación medida | Dictamen |
|---:|---|
| **< 0,10** | Excelente. El software tiene margen amplio |
| **< 0,25** | **Aceptable. CRITERIO DE ACEPTACIÓN** |
| 0,25 – 0,50 | Marginal. Exige un umbral de amplitud muy ajustado y calibración individual |
| **> 0,50** | **RECHAZO. El aislamiento mecánico es insuficiente y hay que rediseñarlo** |

El coeficiente de vibración vecina que el dosier §9.7 guarda en la calibración se
deriva de esta medida. **Sin la matriz 9×9 medida, WP-04 no puede configurar el
algoritmo del dosier §9.6 con ningún valor justificado.**

## 7. Componentes de aislamiento

| Elemento | Especificación | Cantidad por módulo |
|---|---|---|
| Silentblock M4 | Caucho Shore A 40–55, k ≈ 2 300 N/m axial | **36** (4 por diana × 9) |
| Arandela elastomérica | Bajo cada tornillo, evita puente rígido | 36 |
| Junta perimetral | Goma esponjosa, 5 × 5 mm, entre disco y marco | 9 × 630 mm |
| Casquillo separador | Impide apretar el silentblock hasta anularlo | 36 |

**El casquillo separador es imprescindible.** Sin él, apretar el tornillo
comprime el caucho hasta que se comporta como un sólido rígido, la frecuencia
propia se dispara y el aislamiento desaparece — sin que nada lo delate
visualmente. Es el error de montaje más frecuente en aislamiento de vibraciones.

## 8. Lo que hay que medir antes de creerse esto

1. **Masa real** del conjunto móvil montado.
2. **Rigidez real** de los silentblocks comprados (carga conocida, flecha medida).
3. **f_n real** por *bump test* con FFT (§4). Objetivo: 30 Hz ± 30 %.
4. **FFT del impacto real** para confirmar la hipótesis de 500 Hz – 5 kHz.
5. **Matriz 9×9 de acoplamiento** (§6). Criterio: < 0,25.
6. Repetir 5 con y sin la junta perimetral, para cuantificar el camino (3).
7. Repetir 5 con los cables apantallados y sin apantallar, para separar el
   acoplamiento mecánico del eléctrico (camino 4).
8. Verificar que el par de apriete de los tornillos no anula el aislamiento (§7).
