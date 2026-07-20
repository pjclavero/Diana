# Protocolo de ensayo de impacto

> **NO EJECUTADO.** No hay material ni utillaje. Dosier §29.1, §29.2 y §7.3.

## 1. El problema: repetibilidad

Golpear a mano no sirve. Para comparar tres espesores de policarbonato o dos
adhesivos hace falta que **la energía del impacto sea conocida y repetible**.
Si la dispersión del utillaje es mayor que la diferencia entre materiales, el
ensayo no mide nada.

**Criterio de utillaje: dispersión de la energía < 5 % entre golpes.**

## 2. Energías de referencia (calculadas)

```
E = ½ · m · v²
```

| Proyectil / método | m | v | **E** |
|---|---:|---:|---:|
| Bola airsoft 6 mm | 0,20 g | 100 m/s | **1,00 J** |
| Bola airsoft 6 mm (límite habitual de campo) | 0,20 g | 140 m/s | **1,96 J** |
| Bola de paintball | 3,00 g | 90 m/s | **12,15 J** |
| Bola de acero ⌀16 mm en caída libre desde 0,5 m | 16,7 g | 3,13 m/s | **0,082 J** |

**Observación importante:** la caída libre de una bola de acero pequeña da una
energía **24 veces menor** que un impacto de airsoft. **No es representativa.**
Para reproducir energías del orden del julio con un método mecánico repetible hay
que usar un péndulo con masa mayor.

## 3. Utillaje A — Péndulo calibrado (recomendado para M1–M8)

```
E = m · g · h        con  h = L · (1 − cos θ)
```

Con una masa pendular de **0,50 kg** y brazo `L`:

| Altura de caída `h` | Energía |
|---:|---:|
| 50 mm | **0,245 J** |
| 100 mm | **0,491 J** |
| 200 mm | **0,981 J** |
| 400 mm | **1,962 J** |

**Ventajas:** energía exactamente calculable, repetible al 1 %, punto de impacto
fijo, sin proyectil que recuperar, sin riesgo balístico.

### Construcción

| Elemento | Especificación |
|---|---|
| Brazo | Varilla rígida de 400 mm, articulación de rodamiento (no de tornillo) |
| Masa | 0,50 kg con punta intercambiable: acero ⌀16 mm / caucho ⌀16 mm |
| Escala angular | Graduada cada 1°, con tope de suelta magnética |
| Bastidor | Independiente del bastidor de la diana. **No deben tocarse** |
| Repetición | Suelta por electroimán, no a mano |

**El bastidor del péndulo debe estar mecánicamente separado del de la diana.** Si
comparten suelo o estructura, se inyecta vibración por un camino que no existe en
el uso real y toda la matriz de acoplamiento queda contaminada.

### Punto de impacto

| Posición | Distancia al centro | Ensayo |
|---|---:|---|
| P1 Centro | 0 mm | M1, M5 |
| P2 Intermedio | 50 mm | M2 |
| P3 Periférico | 80 mm | M2, peor caso de sensibilidad |
| P4 Borde | 95 mm | M3, peor caso de resistencia |

## 4. Utillaje B — Proyectil real (para M3, M6 y validación final)

Necesario porque el péndulo no reproduce la **velocidad** ni la presión de
contacto del proyectil real, y ambas afectan al contenido espectral del impacto.

| Elemento | Especificación |
|---|---|
| Lanzador | Fijo en soporte, no sostenido a mano |
| Cronógrafo | **Obligatorio**: mide la velocidad de cada disparo |
| Distancia | Fija y registrada (dosier §35, decisión pendiente n.º 6) |
| Recogida | Fondo absorbente y red (dosier §7.5) |
| Protección | Pantalla entre operador y diana ; protección ocular obligatoria |

**Sin cronógrafo no hay ensayo:** la velocidad de un lanzador varía con la
temperatura y con la carga, y sin medirla la energía es desconocida.

## 5. Procedimiento de ensayo

### 5.1 Preparación

1. Montar la diana bajo ensayo sobre sus 4 silentblocks, con el par de apriete
   especificado y sus casquillos separadores.
2. Conectar los 9 piezos a la placa (o al osciloscopio directamente en `TP_PZn`
   con sonda 10:1, para los ensayos sin electrónica).
3. Registrar: espesor, adhesivo, posición del piezo, temperatura ambiente,
   número de serie de la diana.
4. **Medir el ruido de fondo durante 60 s sin golpear.** Anotar el valor
   pico-a-pico. Todos los criterios se expresan como múltiplos de este valor.

### 5.2 Serie de medida (por cada combinación)

| # | Paso |
|---:|---|
| 1 | 3 golpes de calentamiento en P1 (se descartan) |
| 2 | **30 golpes en P1**, registrando el pico de cada uno |
| 3 | Calcular media, desviación típica y coeficiente de variación |
| 4 | Repetir en P2 y P3 |
| 5 | Para cada golpe, registrar **simultáneamente la amplitud en las 9 dianas** |
| 6 | Construir la fila correspondiente de la matriz 9×9 de acoplamiento |
| 7 | Repetir golpeando cada una de las 9 dianas ⇒ matriz completa |

### 5.3 Ensayo de fatiga (M5, dosier §29.1)

| # | Paso |
|---:|---|
| 1 | 1 000 golpes en P1 a energía nominal, con suelta automática |
| 2 | Medir el pico cada 100 golpes |
| 3 | Inspección visual cada 250 golpes con lupa y luz rasante |
| 4 | Al final: comparar el pico medio de los golpes 1–50 con el de los 951–1 000 |

### 5.4 Ensayo de doble impacto y cadencia (dosier §29.1)

| # | Paso |
|---:|---|
| 1 | Dos golpes separados 10 ms, 30 ms, 50 ms, 100 ms y 200 ms |
| 2 | Registrar cuántos detecta el sistema |
| 3 | **Determinar experimentalmente el tiempo de bloqueo mínimo** (dosier §9.6 propone 30–100 ms) |

## 6. Criterios de aceptación numéricos

| # | Magnitud | Criterio |
|---:|---|---|
| I1 | Repetibilidad del utillaje (CV del pico en 30 golpes en P1) | **< 5 %** |
| I2 | Relación señal/ruido en P1 | **≥ 5:1** |
| I3 | Relación señal/ruido en P3 (periferia) | **≥ 3:1** |
| I4 | Uniformidad centro/periferia (A_P1 / A_P3) | **< 4:1** |
| I5 | **Acoplamiento a la diana vecina (A_vecina / A_golpeada)** | **< 0,25** |
| I6 | Acoplamiento a diana no adyacente | **< 0,10** |
| I7 | Degradación tras 1 000 impactos | **< 10 %** del pico inicial |
| I8 | Integridad tras 1 000 impactos | Sin fisura visible con luz rasante |
| I9 | Resistencia a impacto único de 3× la energía nominal | Sin fisura ni deformación permanente |
| I10 | Rebote | **< 30 %** de la altura de caída |
| I11 | Deriva térmica (5 °C vs 40 °C) | **< 25 %** de variación del pico |
| I12 | Tiempo de bloqueo mínimo determinado | Documentado, dentro de 30–100 ms |

**I5 es el criterio que decide si el proyecto es viable con la arquitectura
prevista.** Si el acoplamiento supera 0,50 con el mejor aislamiento que se pueda
construir, hay que replantear la independencia mecánica de las dianas (dosier
§7.2) antes de seguir con la electrónica.

## 7. Registro obligatorio

Cada serie produce una ficha con:

```
Fecha / operador / número de serie de la diana
Material y espesor / adhesivo / posición del piezo
Utillaje (A o B) / energía nominal / velocidad medida (si B)
Temperatura y humedad
Ruido de fondo (pico-pico)
30 valores de pico en P1, P2 y P3
Media, desviación típica, coeficiente de variación
Matriz 9x9 de acoplamiento
Capturas de osciloscopio: 1 golpe representativo por posición
Dictamen: PASA / NO PASA por cada criterio I1..I12
```

## 8. Seguridad del ensayo

1. **Protección ocular obligatoria** para todos los presentes durante los ensayos
   con utillaje B.
2. Pantalla de policarbonato entre operador y diana.
3. Fondo absorbente y red de frenado montados antes de disparar (dosier §7.5).
4. El péndulo debe tener retención mecánica para que no oscile libremente al
   terminar.
5. Los ensayos de fatiga automatizados **no se dejan desatendidos**.
6. Los fragmentos de un disco roto se retiran antes de continuar.

## 9. Estado

**Ninguno de estos ensayos se ha ejecutado.** No hay utillaje construido, no hay
material, no hay resultados. Este documento es la especificación del ensayo.
