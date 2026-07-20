# Materiales de la superficie de impacto y ensayos previstos

> **NADA ENSAYADO.** No hay material, no hay utillaje, no hay medidas. Este
> documento define **qué hay que ensayar y con qué criterio**, no resultados.
> Dosier §7.3 y §35 (decisión pendiente n.º 3: «material y grosor definitivo»).

## 1. Materiales candidatos

| Material | Grosores a ensayar | Papel |
|---|---|---|
| **Policarbonato (PC)** | **2 mm, 3 mm, 4 mm** | **Prioritario** (dosier §7.3: «por su resistencia al impacto») |
| Metacrilato (PMMA) | 3 mm | **Sólo prototipos visuales.** Frágil: se astilla al impacto |

### 1.1 Por qué policarbonato y no metacrilato

| Propiedad **(H, valores de catálogo genéricos)** | PC | PMMA |
|---|---:|---:|
| Resistencia al impacto Izod con entalla | ~600–900 J/m | ~16–21 J/m |
| Módulo de elasticidad | ~2,3 GPa | ~3,0 GPa |
| Densidad | 1 200 kg/m³ | 1 180 kg/m³ |
| Modo de rotura | Dúctil | **Frágil, con astillado** |

El modo de rotura es lo decisivo: un disco de PMMA que se rompe proyecta
esquirlas hacia el tirador. **El PMMA queda prohibido en cualquier configuración
que reciba impactos reales.**

## 2. Masa de los discos (calculada)

Disco de ⌀200 mm, ρ_PC = 1 200 kg/m³:

```
Área = π × (0,100 m)² = 0,03142 m²
m = ρ × Área × espesor
```

| Espesor | Masa calculada |
|---:|---:|
| 2 mm | **0,075 kg** |
| 3 mm | **0,113 kg** |
| 4 mm | **0,151 kg** |

Masa del conjunto móvil (disco + alojamiento + piezo + tornillería), estimada
**(H)**: **0,26 kg** para el disco de 3 mm. Este valor alimenta el cálculo de
aislamiento de vibraciones (ver `aislamiento-vibracion.md`).

## 3. Compromiso de diseño: espesor vs. sensibilidad

Existe una tensión directa entre dos requisitos del proyecto:

```
Más espesor  →  más rígido  →  MENOS deformación por impacto  →  MENOS señal del piezo
             →  más masa    →  más resistente y más duradero
             →  más masa    →  frecuencia propia MENOR  →  MEJOR aislamiento
```

**No hay un espesor obviamente correcto.** Ésa es exactamente la razón por la que
el dosier §7.3 exige ensayar los tres. El objetivo del ensayo es encontrar el
espesor mínimo que aún sobreviva a 1 000 impactos, porque será el que dé más
señal.

## 4. Ensayos previstos (dosier §7.3)

| # | Ensayo | Método | Criterio de aceptación |
|---:|---|---|---|
| M1 | **Sensibilidad** | 30 impactos calibrados en el centro. Medir el pico en `TP_PZn` | Pico ≥ 5× el ruido de fondo. **Registrar el valor absoluto** |
| M2 | **Sensibilidad periférica** | 30 impactos a 80 mm del centro | Pico ≥ 3× ruido. Relación centro/periferia **< 4:1** |
| M3 | **Resistencia** | Impacto único de energía 3× la nominal | Sin fisura ni deformación permanente |
| M4 | **Deformación** | Carga estática de 50 N en el centro, comparador de reloj | Flecha < 2 mm ; recuperación total al retirar |
| M5 | **Fatiga** | **1 000 impactos** a energía nominal (dosier §29.1) | Sin fisura ; caída del pico medido < 10 % entre el impacto 1 y el 1 000 |
| M6 | **Rebote** | Cámara lenta o medida de la altura de rebote | Rebote < 30 % de la altura de caída (evita reimpactos y proyecciones) |
| M7 | **Ruido mecánico** | Medir el nivel sonoro a 1 m | Registrar en dB(A). Comparativo entre espesores |
| M8 | **Vibración cruzada** | Impacto en la diana 5, medir amplitud en las 9 | **Relación vecino/principal < 0,25** (ver `aislamiento-vibracion.md`) |
| M9 | **Facilidad de sustitución** | Cronometrar el cambio de un disco | < 3 min con herramienta común |
| M10 | **Temperatura** | Repetir M1 a 5 °C y a 40 °C | Variación del pico < 25 % |

**M8 es el ensayo que decide el proyecto.** Es la primera barrera contra los
impactos fantasma (dosier §7.4: «el aislamiento mecánico será la primera barrera
contra impactos fantasma; el software será la segunda»).

## 5. Matriz de ensayo

Cada uno de los 3 espesores × cada uno de los 10 ensayos = **30 combinaciones**.
Para acotar el esfuerzo:

| Fase | Alcance | Ensayos |
|---|---|---|
| **Cribado** | 3 espesores, 1 disco cada uno | M1, M2, M3, M8 |
| **Selección** | 2 espesores supervivientes | + M4, M6, M7 |
| **Confirmación** | 1 espesor elegido, 3 discos | + M5 (1 000 impactos), M9, M10 |

## 6. Montaje del piezo — el factor que domina la sensibilidad

**La amplitud de la señal depende más de cómo esté pegado el piezo que de toda la
electrónica de la hoja 03.** Variables a ensayar en paralelo:

| Variable | Opciones a comparar |
|---|---|
| Adhesivo | Cianoacrilato / epoxi rígido / cinta de doble cara rígida |
| Posición | Centro geométrico / a 50 mm del centro / a 80 mm |
| Cara | Posterior (dosier §7.2) — **fijado, no se ensaya** |
| Presión de curado | Con peso / sin peso |
| Espesor de la capa de adhesivo | La menor posible |

**Hipótesis a verificar (H):** un adhesivo rígido y una capa fina transmiten
mejor la onda; un adhesivo elástico la amortigua. El montaje **central** da
respuesta más uniforme; el **descentrado** puede dar más señal en una zona y
menos en la opuesta.

**Criterio:** elegir la combinación con mejor relación M1/M8, es decir, más señal
propia por unidad de acoplamiento al vecino.

## 7. Aspectos que no se han considerado y deberían

1. **Amarillamiento por UV** del policarbonato si el uso es exterior (dosier §35,
   decisión pendiente n.º 7: «uso interior o exterior»).
2. **Rayado** por impactos repetidos y su efecto en la visibilidad del difusor.
3. **Electricidad estática** acumulada en el plástico y su acoplamiento al piezo.
4. **Compatibilidad química** del adhesivo con el policarbonato: algunos
   disolventes producen *crazing* (microfisuras) que arruinan el disco.
5. **Tolerancia dimensional** de los discos comerciales cortados con láser
   (el corte láser en PC genera tensiones y gases; el fresado es preferible).

## 8. Lo que hay que ensayar antes de elegir material

1. Los 10 ensayos M1–M10 sobre los 3 espesores.
2. La matriz de acoplamiento 9×9 (M8) para cada espesor.
3. El ensayo de adhesivo del §6.
4. Compatibilidad química adhesivo–policarbonato (§7.4).
5. Ensayo de 1 000 impactos (M5) sobre el espesor finalista.
