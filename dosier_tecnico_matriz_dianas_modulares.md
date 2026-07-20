# Dosier técnico y plan de desarrollo  
# Sistema modular de dianas electrónicas 3×3

**Estado del documento:** propuesta técnica base para diseño, prototipado y desarrollo  
**Versión:** 0.1  
**Ámbito inicial:** hasta 9 módulos de 3×3 dianas  
**Capacidad máxima inicial:** 81 dianas electrónicas  
**Arquitectura de comunicaciones:** Ethernet en estrella + MQTT  
**Controlador por módulo:** ESP32-S3 + módulo Ethernet W5500  
**Alimentación:** fuente independiente de 12 V por módulo y conversión local a 5 V  
**Servidor:** despliegue autocontenido mediante Docker Compose  

---

# Índice

1. Resumen ejecutivo  
2. Idea del producto  
3. Objetivos y alcance  
4. Decisiones de arquitectura ya fijadas  
5. Funcionamiento general  
6. Configuración física del sistema  
7. Diseño mecánico  
8. Diseño electrónico del módulo  
9. Diseño de los canales piezoeléctricos  
10. Diseño de iluminación RGB  
11. Alimentación y protecciones  
12. Diseño de comunicaciones Ethernet  
13. Firmware de los ESP32  
14. Coordinación entre módulos  
15. Protocolo MQTT y modelo de eventos  
16. Modos de juego  
17. Cronometraje, impactos y precisión  
18. Arquitectura del servidor  
19. Servicios Docker  
20. Backend y motor de partidas  
21. Base de datos  
22. Panel web  
23. Seguridad  
24. Disponibilidad, recuperación y copias  
25. Observabilidad y diagnóstico  
26. Requisitos del servidor  
27. Materiales y lista preliminar  
28. Esquemas eléctricos que deben producirse  
29. Estrategia de pruebas  
30. Organización multiequipo  
31. Organizador, supervisor y puertas de calidad  
32. Plan de ejecución por fases  
33. Entregables obligatorios  
34. Riesgos y mitigaciones  
35. Decisiones pendientes  
36. Criterios de aceptación final  
37. Evoluciones posteriores  
38. Resumen de arquitectura congelada  

---

# 1. Resumen ejecutivo

El proyecto consiste en un sistema modular de dianas electrónicas para proyectiles ligeros, inicialmente bolas de 0,20 g disparadas aproximadamente a 300 fps.

Cada módulo físico contiene una matriz de **3×3 dianas circulares**, con:

- Nueve superficies independientes de impacto.
- Un sensor piezoeléctrico por diana.
- Ocho LED RGB direccionables por diana.
- Un ESP32-S3.
- Un módulo Ethernet W5500.
- Una fuente propia de 12 V.
- Conversión interna de 12 V a 5 V.
- Conexión Ethernet independiente.
- Selector físico de función principal, automática o satélite.
- Capacidad de funcionamiento individual o coordinado.

Un módulo contiene:

```text
9 dianas
9 sensores piezoeléctricos
72 LED RGB
1 ESP32-S3
1 módulo Ethernet W5500
1 fuente propia de 12 V
1 conexión Ethernet
```

Hasta nueve módulos podrán conectarse a un switch Ethernet para formar una matriz lógica máxima de **9×9 dianas**, es decir, 81 objetivos.

El sistema permitirá crear partidas, controlar los colores de las dianas, detectar impactos, medir tiempos, registrar jugadores, calcular estadísticas y administrar los módulos desde un panel web.

El backend se distribuirá como un proyecto **Docker Compose autocontenido**, con:

- Mosquitto MQTT.
- Backend y motor de partidas.
- PostgreSQL.
- Frontend web.
- WebSocket.
- Reverse proxy.
- Worker de tareas.
- Copias de seguridad.
- Servicios de diagnóstico.

El cronometraje de los impactos se realizará en los ESP32. El servidor no será la fuente temporal primaria de una partida, evitando que la latencia de red, MQTT, Docker o la base de datos afecte al resultado.

---

# 2. Idea del producto

El producto será una plataforma de entrenamiento y juego basada en dianas luminosas modulares.

Cada diana podrá mostrar distintos estados:

| Estado | Color principal | Significado |
|---|---|---|
| Segura | Azul | No se debe disparar |
| Activa | Rojo | Objetivo válido |
| Alcanzada | Verde | Impacto correcto |
| Cuenta atrás | Amarillo | Preparación |
| Penalización | Magenta | Impacto incorrecto |
| Error | Rojo y blanco | Fallo técnico |
| Desactivada | Apagado | Diana fuera de servicio |

Funcionamiento básico:

1. El administrador crea una partida.
2. Selecciona jugadores, módulos y modo de juego.
3. El servidor envía la configuración.
4. El módulo principal coordina el inicio.
5. Las dianas cambian de color según las reglas.
6. El jugador dispara sobre las dianas rojas.
7. El piezo detecta el impacto.
8. El ESP32 registra el instante exacto.
9. La diana alcanzada pasa a verde.
10. El resultado se comunica al coordinador y al servidor.
11. El panel actualiza tiempos, puntuación y estadísticas.

El sistema se diseñará para ser:

- Modular.
- Transportable.
- Reparabile.
- Escalable.
- Configurable.
- Operable sin Internet.
- Seguro frente a fallos de red.
- Actualizable.
- Fácil de desplegar en un servidor Linux.

---

# 3. Objetivos y alcance

## 3.1 Objetivos funcionales

El sistema debe permitir:

- Operar con un único módulo.
- Operar con varios módulos.
- Coordinar hasta nueve módulos inicialmente.
- Detectar impactos individuales.
- Evitar falsos impactos entre dianas.
- Controlar el estado visual de cada diana.
- Registrar los tiempos de impacto.
- Crear distintos modos de juego.
- Administrar jugadores y equipos.
- Calcular puntuaciones y estadísticas.
- Representar la posición física de los módulos.
- Identificar módulos desde el panel.
- Calibrar cada sensor.
- Detectar módulos desconectados.
- Guardar resultados aunque falle temporalmente el servidor.
- Exportar resultados.
- Actualizar firmware de forma controlada.

## 3.2 Alcance físico inicial

- Dianas de aproximadamente 200 mm de diámetro.
- Nueve dianas por módulo.
- Ocho LED RGB por diana.
- Hasta nueve módulos.
- Uso interior como prioridad inicial.
- Conexiones Ethernet cableadas.
- Alimentación independiente por módulo.

## 3.3 Fuera del alcance inicial

No forman parte obligatoria de la primera versión:

- Procesamiento de vídeo.
- Inteligencia artificial.
- Detección automática de disparos fallidos fuera de las dianas.
- Aplicación móvil nativa.
- Juego remoto por Internet.
- PoE.
- Funcionamiento sobre Raspberry Pi 2.
- Control de réplicas o marcadoras.
- Reconocimiento biométrico.
- Uso exterior permanente.
- Matrices de más de nueve módulos.

Estos elementos podrán tratarse como evoluciones.

---

# 4. Decisiones de arquitectura ya fijadas

Las siguientes decisiones se consideran base del proyecto:

1. Cada módulo tendrá una matriz de 3×3 dianas.
2. Cada diana tendrá un piezo propio.
3. Cada diana tendrá ocho LED RGB direccionables.
4. Cada módulo tendrá un ESP32-S3.
5. Ethernet se implementará mediante un módulo W5500 conectado por SPI.
6. Cada módulo tendrá una conexión Ethernet independiente.
7. Cada módulo tendrá su propia fuente de 12 V.
8. Los 12 V no se conectarán directamente al ESP32 ni a los LED.
9. Cada módulo incorporará un convertidor local de 12 V a 5 V.
10. Los módulos se conectarán en estrella a un switch Ethernet.
11. Uno de los módulos actuará como coordinador principal.
12. El módulo principal se seleccionará mediante un selector físico.
13. El servidor se desplegará mediante Docker Compose.
14. La base de datos principal será PostgreSQL.
15. La comunicación de gestión y telemetría utilizará MQTT.
16. El cronometraje de los impactos se realizará en los ESP32.
17. El servidor almacenará, visualizará y administrará las partidas.
18. La primera versión se optimizará para un servidor Linux medio.
19. Una edición ligera será una mejora posterior.
20. Las dianas deberán estar aisladas mecánicamente entre sí.

---

# 5. Funcionamiento general

## 5.1 Arquitectura física

```text
                              RED LOCAL
                                  │
                         ┌────────┴────────┐
                         │ Switch Ethernet │
                         └─┬──┬──┬──┬──┬──┘
                           │  │  │  │  │
             ┌─────────────┘  │  │  │  └─────────────┐
             │                │  │  │                │
       ┌─────▼─────┐    ┌─────▼─────┐         ┌─────▼─────┐
       │ Módulo 1  │    │ Módulo 2  │   ...   │ Módulo 9  │
       │ PRINCIPAL │    │ SATÉLITE   │         │ SATÉLITE   │
       └───────────┘    └───────────┘         └───────────┘
             │
             │ MQTT / API / eventos
             ▼
       ┌───────────────────────────────────────┐
       │ Servidor Docker                      │
       │ MQTT · Backend · PostgreSQL · Web    │
       └───────────────────────────────────────┘
```

## 5.2 Flujo de un impacto

```text
Proyectil
   │
   ▼
Superficie independiente
   │ vibración
   ▼
Piezo
   │ pulso protegido
   ▼
Comparador / detector de envolvente
   │
   ├── interrupción digital inmediata
   └── medida analógica de amplitud
          │
          ▼
       ESP32 local
          │
          ├── registra tiempo monotónico
          ├── determina la diana
          ├── aplica antirrebote
          ├── compara vibraciones vecinas
          ├── cambia los LED
          └── genera evento
                    │
                    ▼
             Coordinador principal
                    │
                    ▼
                 MQTT
                    │
                    ▼
        Backend → PostgreSQL → WebSocket
                    │
                    ▼
                 Panel web
```

---

# 6. Configuración física del sistema

## 6.1 Coordenadas de módulos

La matriz máxima inicial será de 3×3 módulos:

```text
(-1,-1)  (0,-1)  (1,-1)
(-1, 0)  (0, 0)  (1, 0)
(-1, 1)  (0, 1)  (1, 1)
```

El panel permitirá:

- Asignar una coordenada a cada módulo.
- Girarlo 0°, 90°, 180° o 270°.
- Identificarlo haciendo parpadear sus LED.
- Bloquear una posición.
- Marcarlo como fuera de servicio.
- Sustituirlo conservando la configuración de posición.
- Detectar posiciones duplicadas.

## 6.2 Coordenadas internas

Cada módulo tendrá nueve posiciones locales:

```text
┌─────┬─────┬─────┐
│  1  │  2  │  3  │
├─────┼─────┼─────┤
│  4  │  5  │  6  │
├─────┼─────┼─────┤
│  7  │  8  │  9  │
└─────┴─────┴─────┘
```

El servidor transformará las coordenadas locales y la rotación en coordenadas globales.

Con nueve módulos en matriz 3×3, el conjunto se comportará como una matriz lógica de 9×9 dianas.

## 6.3 Selector de función

Se recomienda un selector físico de tres posiciones:

```text
SATÉLITE | AUTO | PRINCIPAL
```

### PRINCIPAL

- Autoridad local de la partida.
- Coordina el comienzo.
- Mantiene el reloj principal.
- Distribuye estados.
- Valida impactos.
- Resuelve duplicados.
- Envía el resultado consolidado.

### SATÉLITE

- Espera instrucciones.
- Controla sus dianas.
- Registra impactos localmente.
- Envía eventos al principal.
- Mantiene una cola local en caso de pérdida de conexión.

### AUTO

- Participa en la elección de coordinador.
- Facilita instalaciones rápidas.
- No sustituye la validación de conflictos.

El sistema no permitirá iniciar una partida si detecta dos módulos forzados como principal.

---

# 7. Diseño mecánico

## 7.1 Dimensiones estimadas

Con dianas de 200 mm:

- Tres dianas ocupan 600 mm.
- Debe añadirse separación, marco y tolerancias.
- Tamaño estimado del módulo: entre 650 y 700 mm de lado.
- Una matriz completa de nueve módulos se aproximará a 2×2 metros.

## 7.2 Independencia mecánica de cada diana

Las nueve dianas no deben formar parte de una única plancha rígida continua.

Cada diana debe disponer de:

- Disco de impacto reemplazable.
- Alojamiento independiente.
- Tres o cuatro apoyos elásticos.
- Separación respecto al bastidor.
- Piezo pegado en la cara posterior.
- Aro luminoso independiente.
- Protección de los LED.
- Acceso de mantenimiento.
- Número o identificador visible en el interior.

## 7.3 Material de las superficies

Se ensayarán inicialmente:

- Policarbonato de 2 mm.
- Policarbonato de 3 mm.
- Policarbonato de 4 mm.

El material definitivo se elegirá mediante pruebas de:

- Sensibilidad.
- Resistencia.
- Deformación.
- Fatiga.
- Rebote.
- Ruido mecánico.
- Vibración cruzada.
- Facilidad de sustitución.

El metacrilato puede utilizarse en prototipos visuales, pero el policarbonato será prioritario por su resistencia al impacto.

## 7.4 Aislamiento de vibraciones

Se utilizarán:

- Silentblocks pequeños.
- Juntas de goma.
- Arandelas elastoméricas.
- Separación entre marcos.
- Refuerzos que no unan rígidamente las caras activas.

El aislamiento mecánico será la primera barrera contra impactos fantasma. El software será la segunda.

## 7.5 Captura de bolas

Cada módulo o estructura deberá incorporar:

- Fondo absorbente.
- Cortina textil o red de frenado.
- Recipiente o canal de recogida.
- Protección contra rebotes.
- Acceso de vaciado.
- Separación entre zona de bolas y electrónica.
- Protección frontal de conectores.
- Piezas reemplazables.

## 7.6 Transporte y mantenimiento

Se estudiará una estructura:

- Con asas.
- Con patas desmontables o anclajes.
- Con panel posterior registrable.
- Con tapas para electrónica.
- Con dianas sustituibles desde delante o detrás.
- Con conectores internos etiquetados.
- Con posibilidad de dividir el módulo en tres filas mecánicas.

Una posible mejora consiste en construir tres filas desmontables de tres dianas, manteniendo un único controlador lógico.

---

# 8. Diseño electrónico del módulo

## 8.1 Diagrama de bloques

```text
Entrada 230 V AC
       │
       ▼
Fuente 12 V / 3 A
       │
       ├── Fusible y protección
       │
       ▼
Convertidor 12 V → 5 V / 5–6 A
       │
       ├── ESP32-S3
       ├── W5500 Ethernet
       ├── Electrónica piezo
       ├── Conversor de nivel
       └── 72 LED RGB

ESP32-S3
  ├── SPI → W5500
  ├── GPIO → comparadores de impacto
  ├── ADC/multiplexor → amplitudes
  ├── GPIO/RMT → cadenas LED
  ├── GPIO → selector principal/auto/satélite
  ├── GPIO → botón identificar
  ├── ADC → supervisión de tensión
  └── memoria no volátil → configuración y cola
```

## 8.2 Controlador

Controlador base:

- ESP32-S3.
- Desarrollo inicial sobre placa de desarrollo.
- PCB portadora propia en versiones posteriores.
- Firmware basado preferentemente en ESP-IDF.
- Watchdog habilitado.
- Almacenamiento NVS para configuración.
- Partición OTA doble.
- Registro de reinicios y causa de fallo.

## 8.3 Ethernet

Módulo base:

- W5500.
- Interfaz SPI.
- RJ45 con magnetismos integrados.
- Dirección MAC única.
- DHCP por defecto.
- Dirección estática opcional.
- Indicadores de enlace y actividad.
- Protección ESD en el puerto.
- Cable CAT5e o superior.

## 8.4 Entradas y salidas necesarias

Estimación inicial:

| Función | Recursos |
|---|---:|
| SPI W5500 | 4–5 GPIO |
| Interrupciones de piezo | 9 GPIO |
| Multiplexor analógico | 4 GPIO + 1 ADC |
| Cadenas LED | 3 GPIO |
| Selector de función | 2 GPIO |
| Botón de identificación | 1 GPIO |
| Medición de tensión | 1 ADC |
| Estado y mantenimiento | 1–2 GPIO |
| Reserva | 3–5 GPIO |

El pinout definitivo debe verificarse contra:

- Pines de arranque.
- Pines reservados.
- PSRAM o flash de la placa elegida.
- Restricciones del ADC.
- Compatibilidad con SPI y RMT.
- Disponibilidad física en los conectores.

---

# 9. Diseño de los canales piezoeléctricos

## 9.1 Objetivo

Cada canal debe:

- Detectar un impacto breve.
- Proteger al ESP32.
- Generar una señal digital inmediata.
- Permitir medir la amplitud.
- Mantener el pico el tiempo suficiente para leerlo.
- Evitar múltiples conteos por resonancia.
- Permitir calibración individual.

## 9.2 Arquitectura de referencia por canal

```text
Piezo
  │
  ├── Resistencia de descarga en paralelo
  │
  ▼
Resistencia serie limitadora
  │
  ▼
Protección contra pulsos positivos y negativos
  │
  ├── Rama digital → comparador → GPIO de interrupción
  │
  └── Rama analógica → rectificador/envolvente → multiplexor → ADC
```

## 9.3 Valores iniciales para prototipo

Los valores finales deben validarse en banco. Como punto de partida:

- Resistencia de descarga: 1 MΩ.
- Resistencia serie: 47–100 kΩ.
- Diodos Schottky de protección.
- Limitación de tensión compatible con 3,3 V.
- Condensador de envolvente: rango inicial 10–100 nF.
- Resistencia de descarga de envolvente: ajustada para 2–10 ms.
- Comparador de baja tensión.
- Histéresis para evitar oscilaciones.
- Umbral ajustable por banco o por canal.

No se conectará un piezo directamente a una entrada del ESP32 sin protección.

## 9.4 Captura digital

Cada comparador entregará una señal digital.

Ventajas:

- Interrupción inmediata.
- No depende de la velocidad de escaneo ADC.
- Permite registrar impactos simultáneos.
- Reduce el riesgo de perder pulsos.

## 9.5 Captura analógica

La amplitud de los nueve canales podrá leerse mediante:

- Un multiplexor analógico de 16 canales.
- Un ADC externo multicanal.
- Un circuito de retención de pico.

Para el prototipo se propone:

```text
9 envolventes analógicas
       │
       ▼
CD74HC4067 o equivalente
       │
       ▼
ADC del ESP32-S3
```

Para una versión de mayor precisión puede sustituirse por un ADC externo SPI multicanal.

## 9.6 Detección de vibración cruzada

Cuando varios canales se activen dentro de una ventana corta:

1. Se agrupan los eventos próximos.
2. Se comparan amplitudes.
3. Se identifica el canal principal.
4. Se estudia la relación con los canales vecinos.
5. Se descartan señales secundarias por debajo del coeficiente configurado.
6. Se registra el diagnóstico si la decisión es ambigua.

Ventana inicial de ensayo:

- 1–3 ms para agrupación primaria.
- 30–100 ms de bloqueo tras un impacto válido.

Los valores se ajustarán experimentalmente.

## 9.7 Calibración

Cada diana almacenará:

- Ruido base.
- Pico medio de impacto.
- Umbral.
- Histéresis.
- Tiempo de bloqueo.
- Coeficiente de vibración vecina.
- Sensibilidad central.
- Sensibilidad periférica.
- Fecha de calibración.
- Número de impactos de prueba.

Procedimiento:

1. Medir ruido en reposo.
2. Golpear o disparar tres veces en el centro.
3. Disparar tres veces cerca del borde.
4. Repetir en dianas vecinas.
5. Calcular umbral recomendado.
6. Detectar sensibilidad insuficiente.
7. Guardar el perfil.
8. Ejecutar una prueba automática de validación.

---

# 10. Diseño de iluminación RGB

## 10.1 Distribución

Cada diana tendrá ocho LED RGB direccionables.

```text
9 dianas × 8 LED = 72 LED por módulo
```

Los LED se instalarán alrededor de la diana bajo un difusor.

## 10.2 Cadenas de datos

Se recomienda dividir los 72 LED en tres cadenas:

```text
Fila superior: 24 LED
Fila central:  24 LED
Fila inferior: 24 LED
```

Ventajas:

- Una avería no apaga todo el módulo.
- Menor longitud de cadena.
- Actualización más rápida.
- Cableado ordenado por filas.
- Mantenimiento más sencillo.

## 10.3 Conversión de nivel

La salida del ESP32 funciona a 3,3 V y los LED a 5 V.

Se utilizará:

- `74AHCT125`, `74HCT245` o equivalente.
- Resistencia serie de datos de 330–470 Ω.
- Masa común.
- Condensadores de desacoplo.
- Inyección de alimentación por fila.

## 10.4 Potencia

Cálculo conservador:

```text
72 LED × 60 mA = 4,32 A a 5 V
```

Ese valor representa blanco máximo simultáneo. El uso real será inferior, pero el diseño debe soportar picos.

Medidas:

- Convertidor de 5–6 A.
- Límite global de brillo.
- Presupuesto de potencia en firmware.
- Blanco máximo restringido a diagnóstico.
- Condensador de 1.000–2.200 µF en el bus de LED.
- Inyección de 5 V en cada fila.
- Pistas y cables dimensionados para la corriente.

## 10.5 Accesibilidad visual

No se dependerá exclusivamente del color.

| Estado | Color | Patrón |
|---|---|---|
| Segura | Azul | Fijo |
| Objetivo | Rojo | Pulso lento |
| Acierto | Verde | Destello y fundido |
| Preparación | Amarillo | Cuenta atrás |
| Penalización | Magenta | Parpadeo rápido |
| Error | Rojo/blanco | Alternancia |
| Identificación | Cian | Barrido |
| Mantenimiento | Blanco tenue | Fijo |

---

# 11. Alimentación y protecciones

## 11.1 Alimentación independiente

Cada módulo tendrá alimentación propia.

```text
230 V AC
   │
   ▼
Fuente 12 V / 3 A
   │
   ▼
Convertidor 12 V → 5 V / 5–6 A
   │
   ├── ESP32-S3
   ├── W5500
   ├── electrónica de sensores
   └── LED RGB
```

No se distribuirá potencia entre módulos.

## 11.2 Ventajas

- Un fallo afecta a un único módulo.
- No hay largas líneas de corriente continua.
- Menos caída de tensión.
- Fácil sustitución.
- Escalado sencillo.
- No es necesario pasar a 24 V.
- Cada unidad puede probarse por separado.

## 11.3 Protecciones

Cada módulo incluirá:

- Fusible de entrada.
- Interruptor bipolar o solución equivalente segura.
- Protección contra polaridad inversa en 12 V.
- Protección contra sobretensión.
- Protección térmica.
- Tierra o doble aislamiento según la fuente utilizada.
- Conector bloqueable para 12 V interno.
- Separación física entre 230 V y baja tensión.
- Caja cerrada para la fuente.
- Prensaestopas y alivio de tracción.
- Etiquetado eléctrico.
- Conector de servicio protegido.

Si la fuente de 230 V se integra en la caja, el diseño deberá ser revisado por personal competente en seguridad eléctrica. Para los primeros prototipos se recomienda utilizar una fuente externa certificada de 12 V.

---

# 12. Diseño de comunicaciones Ethernet

## 12.1 Topología

La red tendrá topología en estrella:

```text
Módulo 1 ─┐
Módulo 2 ─┤
Módulo 3 ─┤
Servidor ─┼── Switch Ethernet
Paneles  ─┤
Módulo 9 ─┘
```

## 12.2 Configuración de red

- DHCP por defecto.
- Nombre de host único.
- Identificador persistente.
- IP fija opcional.
- mDNS opcional.
- Detección de enlace.
- Reconexión automática.
- Cola de eventos sin conexión.
- Heartbeat periódico.
- Tiempo de espera configurable.

## 12.3 Identidad de módulo

Cada módulo tendrá:

- `module_id` único.
- MAC.
- número de serie.
- versión de hardware.
- versión de firmware.
- función seleccionada.
- posición asignada.
- nombre amigable.
- credencial MQTT propia.

## 12.4 Descubrimiento

El servidor reconocerá nuevos módulos mediante:

- Conexión MQTT.
- Mensaje de presencia.
- Last Will.
- Registro inicial.
- Aprobación administrativa.

Como mejora posterior se podrá añadir descubrimiento local por UDP o mDNS.

---

# 13. Firmware de los ESP32

## 13.1 Arquitectura interna

El firmware se dividirá en módulos:

```text
firmware/
├── board/
├── drivers/
│   ├── ethernet/
│   ├── piezo/
│   ├── leds/
│   ├── power/
│   └── inputs/
├── services/
│   ├── mqtt/
│   ├── discovery/
│   ├── time_sync/
│   ├── coordinator/
│   ├── event_queue/
│   ├── ota/
│   └── diagnostics/
├── game/
│   ├── state_machine/
│   ├── targets/
│   ├── scoring/
│   └── modes/
├── storage/
├── security/
└── tests/
```

## 13.2 Tareas principales

- Lectura de impactos.
- Control LED.
- Red Ethernet.
- MQTT.
- Máquina de estados.
- Coordinación.
- Sincronización temporal.
- Persistencia de configuración.
- Cola de eventos.
- Diagnóstico.
- OTA.
- Watchdog.

## 13.3 Máquina de estados del módulo

```text
ARRANQUE
   │
   ▼
AUTODIAGNÓSTICO
   │
   ▼
RED
   │
   ▼
REGISTRO
   │
   ├── ERROR
   └── LISTO
          │
          ├── CALIBRACIÓN
          ├── MANTENIMIENTO
          └── PARTIDA
                 │
                 ├── PREPARACIÓN
                 ├── CUENTA ATRÁS
                 ├── ACTIVA
                 ├── PAUSADA
                 └── FINALIZADA
```

## 13.4 Máquina de estados de una diana

```text
APAGADA
   │
   ▼
SEGURA_AZUL
   │
   ▼
ACTIVA_ROJA
   │ impacto válido
   ▼
ALCANZADA_VERDE
   │
   └── SEGURA / ACTIVA / FIN
```

Estados adicionales:

- `CALIBRACION`
- `BLOQUEADA`
- `ERROR_SENSOR`
- `PENALIZACION`
- `MANTENIMIENTO`
- `DESHABILITADA`

## 13.5 Persistencia local

El ESP32 guardará:

- Identidad.
- Configuración de red.
- Credenciales.
- Calibración.
- Brillo máximo.
- posición conocida.
- rol.
- último estado válido.
- cola de eventos no confirmados.
- versión de firmware.

## 13.6 Actualización OTA

Requisitos:

- Imagen firmada.
- Particiones A/B.
- Verificación antes de activar.
- Rollback automático.
- Despliegue progresivo.
- Prohibición de actualizar durante una partida.
- Registro de resultado.
- Opción de recuperación por USB.

---

# 14. Coordinación entre módulos

## 14.1 Autoridad de partida

El módulo principal será la autoridad local para:

- Inicio.
- Pausa.
- Final.
- Secuencia de objetivos.
- Tiempo relativo.
- Validación de impactos.
- Resolución de eventos duplicados.
- Estado consolidado.

El servidor será la autoridad administrativa para:

- Crear la partida.
- Asignar jugadores.
- Configurar reglas.
- Autorizar el comienzo.
- Guardar el resultado.
- Gestionar usuarios.

## 14.2 Sincronización temporal

Cada impacto tendrá:

- Marca temporal monotónica local.
- Identificador de ronda.
- secuencia.
- desplazamiento temporal estimado respecto al coordinador.
- tiempo transcurrido desde el inicio.

El tiempo mostrado al jugador será el tiempo relativo consolidado por el coordinador.

Objetivo inicial:

- Resolución visible de 1 ms.
- Error entre módulos medido y documentado.
- Sin dependencia del reloj del navegador.
- Sin usar la llegada a PostgreSQL como tiempo del impacto.

## 14.3 Pérdida de conectividad

Si un satélite pierde comunicación:

- Guarda eventos localmente.
- Mantiene el estado conocido durante un margen corto.
- Señaliza el error.
- No inventa órdenes.
- Reintenta la conexión.
- Reenvía eventos con identificadores únicos.

Si el principal se pierde:

- La ronda se pausa o finaliza de forma segura.
- No se elige un nuevo principal silenciosamente durante una ronda.
- El administrador decide recuperar o repetir.
- Los eventos ya capturados permanecen guardados.

## 14.4 Duplicación

Cada evento tendrá un UUID o identificador equivalente.

El principal y el backend aplicarán idempotencia para que QoS 1 o las retransmisiones no creen impactos duplicados.

---

# 15. Protocolo MQTT y modelo de eventos

## 15.1 Convención de temas

```text
targets/v1/system/{system_id}/status
targets/v1/system/{system_id}/command
targets/v1/system/{system_id}/game/state
targets/v1/system/{system_id}/game/event

targets/v1/module/{module_id}/presence
targets/v1/module/{module_id}/status
targets/v1/module/{module_id}/telemetry
targets/v1/module/{module_id}/config/desired
targets/v1/module/{module_id}/config/reported
targets/v1/module/{module_id}/command
targets/v1/module/{module_id}/hit
targets/v1/module/{module_id}/diagnostic
targets/v1/module/{module_id}/ota
```

## 15.2 QoS

| Mensaje | QoS recomendado |
|---|---:|
| Impacto | 1 |
| Inicio/fin de partida | 1 |
| Configuración | 1 |
| Estado visual no crítico | 0 o 1 |
| Telemetría frecuente | 0 |
| Resultado final | 1 |
| Actualización OTA | 1 |

## 15.3 Ejemplo de evento de impacto

```json
{
  "schema_version": 1,
  "event_id": "01J...",
  "system_id": "system-a",
  "game_id": "game-2026-0012",
  "round_id": "round-04",
  "module_id": "module-03",
  "target_id": 7,
  "module_position": {"x": -1, "y": 0},
  "module_rotation": 90,
  "local_sequence": 1842,
  "elapsed_us": 1832456,
  "amplitude": 2710,
  "threshold": 920,
  "target_state": "red",
  "classification": "valid_hit",
  "firmware_version": "0.1.0"
}
```

## 15.4 Tipos de eventos

- Presencia.
- Conexión.
- Desconexión.
- Impacto válido.
- Impacto incorrecto.
- Vibración descartada.
- Impacto ambiguo.
- Cambio de estado.
- Inicio de ronda.
- Pausa.
- Fin.
- Error de sensor.
- Reinicio.
- Baja tensión.
- Sobretemperatura.
- Resultado de calibración.
- Actualización de firmware.

## 15.5 Validación de esquema

Todos los mensajes se validarán contra esquemas versionados.

El repositorio tendrá una carpeta compartida:

```text
contracts/
├── mqtt/
├── api/
├── database/
└── examples/
```

Los contratos deberán ser aprobados por arquitectura y supervisor antes de que firmware y backend desarrollen en paralelo.

---

# 16. Modos de juego

## 16.1 Dianas aleatorias

- Se activa una diana al azar.
- El jugador debe golpearla.
- Pasa a verde.
- Se activa otra.
- Se mide reacción y tiempo total.

Parámetros:

- Número de objetivos.
- Repeticiones.
- Intervalo.
- Tiempo máximo.
- Penalización por error.
- Módulos permitidos.

## 16.2 Secuencia fija

- El administrador define una secuencia.
- Las dianas se activan en orden.
- Se registran parciales.
- Puede exigirse orden estricto.

## 16.3 Todas contra reloj

- Todas las dianas seleccionadas pasan a rojo.
- Cada impacto correcto pasa una a verde.
- El tiempo termina cuando todas están alcanzadas.

## 16.4 Reacción

- Una diana se activa tras un retardo aleatorio.
- Se mide el tiempo desde la activación hasta el impacto.
- Los disparos anticipados penalizan.

## 16.5 Memoria

- El sistema muestra una secuencia luminosa.
- El jugador debe reproducirla disparando.
- Se registran aciertos, orden y tiempo.

## 16.6 No disparar

- Conviven objetivos válidos y prohibidos.
- Los impactos sobre azul o un patrón prohibido penalizan.
- Puede medir control de disparo.

## 16.7 Duelo

Evolución posterior:

- Dos jugadores o equipos.
- Zonas asignadas.
- Objetivos compartidos.
- Puntuación por velocidad o control.

---

# 17. Cronometraje, impactos y precisión

## 17.1 Impactos

El sistema distingue:

- Impacto válido sobre rojo.
- Impacto sobre azul.
- Impacto sobre una diana ya alcanzada.
- Impacto fuera de orden.
- Vibración cruzada.
- Impacto ambiguo.
- Evento duplicado.
- Impacto durante pausa.
- Impacto de calibración.

## 17.2 Disparos disponibles y realizados

Debe diferenciarse entre:

- Munición inicial disponible.
- Munición restante.
- Disparos realizados.
- Impactos válidos.
- Impactos incorrectos.
- Disparos que no alcanzaron una diana.

La precisión se calcula usando disparos realizados, no solo munición disponible.

```text
precisión total =
impactos detectados / disparos realizados × 100

precisión válida =
impactos válidos / disparos realizados × 100
```

## 17.3 Casos posibles

### Munición consumida completamente

Si la partida exige utilizar toda la munición:

```text
disparos realizados = munición inicial
```

La precisión puede calcularse directamente.

### Munición restante introducida

```text
disparos realizados =
munición inicial - munición restante
```

### Munición restante desconocida

La precisión no debe mostrarse como exacta.

El panel mostrará:

```text
Precisión no calculable:
se desconoce el número real de disparos.
```

### Contador automático futuro

Se podrá integrar un contador de disparos mediante:

- Barrera óptica.
- Sensor acústico en la zona de tiro.
- Sensor de gatillo.
- Cronógrafo.
- Integración electrónica externa.

## 17.4 Estadísticas

- Tiempo al primer impacto.
- Tiempo total.
- Tiempo medio entre impactos.
- Mejor parcial.
- Peor parcial.
- Variabilidad.
- Impactos válidos.
- Impactos incorrectos.
- Impactos por diana.
- Disparos realizados.
- Precisión total.
- Precisión válida.
- Munición restante.
- Penalizaciones.
- Evolución histórica.
- Comparación entre jugadores.
- Récord por modo y configuración.

---

# 18. Arquitectura del servidor

## 18.1 Principio general

El servidor se desplegará como un proyecto Docker Compose autocontenido.

No será un único contenedor. Será un conjunto versionado de servicios coordinados.

```text
                         ┌──────────────────┐
                         │ Reverse proxy    │
                         └────────┬─────────┘
                                  │
                 ┌────────────────┴───────────────┐
                 │                                │
          ┌──────▼──────┐                  ┌──────▼──────┐
          │ Frontend    │                  │ Backend API │
          └─────────────┘                  └──────┬──────┘
                                                 │
                                  ┌──────────────┼──────────────┐
                                  │              │              │
                           ┌──────▼─────┐ ┌──────▼─────┐ ┌─────▼─────┐
                           │ PostgreSQL │ │ Mosquitto  │ │ Worker    │
                           └────────────┘ └────────────┘ └───────────┘
```

## 18.2 Stack recomendado

Propuesta de referencia:

- Backend: TypeScript + NestJS.
- Frontend: React + TypeScript.
- Base de datos: PostgreSQL.
- ORM: Prisma o equivalente.
- Broker: Eclipse Mosquitto.
- WebSocket: gateway del backend.
- Worker: proceso separado del backend.
- Proxy: Nginx o Caddy.
- Contenedores: Docker Engine + Compose.
- Pruebas: unitarias, integración y E2E.
- Migraciones: automáticas y versionadas.
- Contratos: OpenAPI y JSON Schema.

La tecnología podrá cambiarse mediante una decisión de arquitectura formal, pero no se mezclarán varios stacks sin necesidad.

---

# 19. Servicios Docker

## 19.1 Estructura del repositorio

```text
project/
├── compose.yml
├── compose.dev.yml
├── .env.example
├── backend/
├── frontend/
├── firmware/
├── hardware/
├── mechanical/
├── contracts/
├── infrastructure/
│   ├── mosquitto/
│   ├── proxy/
│   ├── postgres/
│   ├── backups/
│   └── monitoring/
├── tests/
├── docs/
└── scripts/
```

## 19.2 Contenedores

| Servicio | Función |
|---|---|
| `proxy` | Entrada HTTP/HTTPS |
| `frontend` | Panel web |
| `backend` | API, WebSocket y lógica |
| `worker` | Informes y tareas diferidas |
| `postgres` | Persistencia principal |
| `mosquitto` | Mensajería con módulos |
| `backup` | Copias programadas |
| `migrate` | Migraciones de base de datos |
| `monitoring` | Opcional para métricas |

## 19.3 Volúmenes

- Datos PostgreSQL.
- Configuración Mosquitto.
- Persistencia MQTT si se activa.
- Copias.
- Certificados.
- Exportaciones.
- Firmware publicado.
- Registros limitados.

## 19.4 Perfiles

```text
full:
- todos los servicios

dev:
- herramientas de desarrollo
- puertos de depuración
- datos de prueba

test:
- base de datos efímera
- broker efímero
- pruebas automáticas

lite futuro:
- backend compacto
- SQLite
- Mosquitto
- frontend estático
```

---

# 20. Backend y motor de partidas

## 20.1 Módulos del backend

```text
backend/
├── auth/
├── users/
├── players/
├── teams/
├── systems/
├── modules/
├── targets/
├── topology/
├── calibration/
├── games/
├── rounds/
├── scoring/
├── statistics/
├── mqtt/
├── websocket/
├── firmware/
├── maintenance/
├── audit/
└── exports/
```

## 20.2 Responsabilidades

- Autenticación.
- Permisos.
- Registro de módulos.
- Configuración de topología.
- Diseño de partidas.
- Validación de reglas.
- Publicación MQTT.
- Recepción de eventos.
- Idempotencia.
- Persistencia.
- Estadísticas.
- Actualización en directo.
- Gestión OTA.
- Auditoría.
- Exportación.

## 20.3 Separación de autoridad

El backend no debe sustituir el tiempo local del ESP32.

Debe:

- Aceptar el tiempo relativo capturado.
- Validar orden y consistencia.
- Guardar el tiempo de recepción por separado.
- Detectar retrasos.
- Marcar eventos fuera de ventana.
- No alterar silenciosamente un resultado.

---

# 21. Base de datos

## 21.1 Entidades principales

- `users`
- `roles`
- `players`
- `teams`
- `target_systems`
- `modules`
- `module_positions`
- `targets`
- `sensor_calibrations`
- `game_modes`
- `game_presets`
- `games`
- `rounds`
- `participants`
- `hit_events`
- `shot_counts`
- `penalties`
- `results`
- `statistics`
- `firmware_versions`
- `deployments`
- `incidents`
- `audit_log`

## 21.2 Principios

- Identificadores globales.
- Eventos inmutables.
- Resultados derivados reproducibles.
- Migraciones versionadas.
- Índices para consultas por jugador, partida y fecha.
- Retención configurable.
- Auditoría de cambios administrativos.
- Zonas horarias almacenadas correctamente.
- Tiempos de impacto guardados en microsegundos o unidad equivalente.
- Separación entre tiempo del dispositivo y tiempo del servidor.

## 21.3 Copias

- Copia diaria.
- Copia antes de cada actualización.
- Retención semanal y mensual.
- Prueba periódica de restauración.
- Exportación externa opcional.
- Cifrado de copias si contienen datos personales.

---

# 22. Panel web

## 22.1 Pantalla de inicio

- Estado general.
- Sistemas disponibles.
- Módulos conectados.
- Partida activa.
- Alertas.
- Acceso rápido a prueba y calibración.

## 22.2 Editor de topología

- Matriz de 3×3 módulos.
- Arrastrar y soltar.
- Rotar.
- Identificar.
- Ver dianas internas.
- Detectar duplicados.
- Guardar configuraciones.
- Crear distintas disposiciones.

## 22.3 Gestión de partidas

- Elegir modo.
- Elegir preset.
- Seleccionar dianas.
- Asignar jugadores.
- Configurar munición.
- Definir penalizaciones.
- Cuenta atrás.
- Inicio.
- Pausa.
- Cancelación.
- Repetición.
- Resultado.

## 22.4 Vista en directo

- Matriz visual.
- Colores actuales.
- Cronómetro.
- Último impacto.
- Parciales.
- Puntuación.
- Estado de módulos.
- Conectividad.
- Penalizaciones.
- Munición restante.

## 22.5 Diagnóstico

- Evento de impacto en vivo.
- Amplitud.
- Umbral.
- ruido.
- tensión.
- temperatura si se incorpora sensor.
- firmware.
- uptime.
- reinicios.
- pérdidas MQTT.
- cola pendiente.
- estado de cada cadena LED.

## 22.6 Administración

- Usuarios.
- Roles.
- Jugadores.
- Equipos.
- Modos.
- Firmware.
- Copias.
- Auditoría.
- Configuración de red.
- certificados.

---

# 23. Seguridad

## 23.1 Red

- Segmento de red propio cuando sea posible.
- MQTT sin acceso anónimo.
- Credencial distinta por módulo.
- ACL por temas.
- TLS en producción.
- Contraseñas fuera del repositorio.
- Rotación de credenciales.
- Firewall del servidor.
- Panel no expuesto directamente sin autenticación.

## 23.2 Aplicación

Roles mínimos:

- Administrador.
- Operador.
- Árbitro.
- Consulta.
- Mantenimiento.

Medidas:

- Sesiones seguras.
- Protección CSRF si procede.
- Validación de entrada.
- Rate limiting.
- Auditoría.
- Gestión de secretos.
- Dependencias escaneadas.
- Cabeceras HTTP seguras.
- Copias cifradas.
- Logs sin credenciales.

## 23.3 Firmware

- Firmware firmado.
- OTA autenticada.
- Rollback.
- Credenciales únicas.
- Protección frente a comandos antiguos.
- Número de secuencia.
- Rechazo de mensajes de otra instalación.
- Prohibición de comandos críticos sin partida válida.

## 23.4 Seguridad física

- Protección ocular.
- Fondo de captura.
- Prevención de rebotes.
- Distancia de uso definida.
- Revisión de superficies dañadas.
- Bloqueo de juego con tapa abierta si se añade sensor.
- Fuente certificada.
- Separación de 230 V.
- Fusibles.
- Señalización de zona de tiro.
- Procedimiento de parada.

---

# 24. Disponibilidad, recuperación y copias

## 24.1 Fallo del backend

Los módulos deben poder:

- Finalizar la ronda actual si conservan coordinación.
- Guardar eventos.
- Reintentar.
- Reenviar.
- No perder el tiempo capturado.

## 24.2 Fallo de MQTT

- Cola local.
- Reintento exponencial.
- Identificadores idempotentes.
- Estado visible de degradación.
- No comenzar una nueva partida sin canal válido, salvo modo local explícito.

## 24.3 Fallo de PostgreSQL

- Backend en modo degradado.
- No perder eventos en memoria sin límite.
- Pausar el comienzo de nuevas partidas.
- Alertar al operador.
- Restaurar tras recuperar la base.

## 24.4 Reinicio del servidor

Los contenedores tendrán:

- Healthchecks.
- Políticas de reinicio.
- Dependencias controladas.
- Migraciones seguras.
- Arranque idempotente.
- Validación de configuración.

---

# 25. Observabilidad y diagnóstico

## 25.1 Métricas

- Módulos online.
- Latencia MQTT.
- Eventos por segundo.
- Impactos válidos.
- Eventos descartados.
- Reconexiones.
- Reinicios.
- Uso de CPU y RAM.
- Estado de PostgreSQL.
- Tamaño de base.
- Duración de consultas.
- Errores WebSocket.
- Colas pendientes.

## 25.2 Registros

- JSON estructurado.
- Correlación por `game_id`, `round_id` y `event_id`.
- Rotación.
- Niveles configurables.
- Sin secretos.
- Descarga desde administración.
- Retención limitada.

## 25.3 Diagnóstico de módulo

Cada módulo publicará:

- Uptime.
- RSSI no aplicable si solo Ethernet.
- estado de enlace.
- IP.
- firmware.
- causa de último reinicio.
- memoria libre.
- tensión de 5 V o 12 V si se mide.
- errores de piezo.
- estado de cadenas LED.
- cola pendiente.
- selector físico.

---

# 26. Requisitos del servidor

## 26.1 Requisitos recomendados

```text
CPU:       2–4 núcleos
RAM:       4–8 GB
Disco:     40 GB SSD o superior
Red:       Ethernet
Sistema:   Debian o Ubuntu Server
Docker:    Docker Engine
Compose:   Docker Compose
```

## 26.2 Requisitos mínimos orientativos

```text
CPU:       2 núcleos
RAM:       2 GB
Disco:     20 GB
```

Los mínimos deben validarse mediante pruebas de carga.

## 26.3 Requisitos de red

- Switch con puertos suficientes.
- Diez puertos útiles para nueve módulos y servidor, como mínimo.
- Más puertos si se conectan paneles o puntos de acceso.
- Cableado CAT5e o superior.
- DHCP local.
- DNS local opcional.
- Acceso Wi-Fi mediante punto de acceso independiente si se usan tabletas.

## 26.4 Instalación local

El sistema debe funcionar sin Internet.

```text
Switch
├── servidor
├── módulos
├── punto de acceso Wi-Fi
└── puesto de administración
```

---

# 27. Materiales y lista preliminar

## 27.1 Por diana

- Disco de policarbonato de 200 mm.
- Piezo de 27–35 mm.
- Ocho LED RGB direccionables.
- Difusor.
- Soportes elásticos.
- Tornillería.
- Cableado.
- Conector de servicio.
- Protección frontal.

## 27.2 Por módulo 3×3

- 1 ESP32-S3.
- 1 W5500 Ethernet.
- 1 RJ45.
- 9 piezos.
- 72 LED.
- 3 conversores de nivel o canales suficientes.
- 9 comparadores.
- Multiplexor analógico o ADC externo.
- Componentes de protección.
- PCB principal.
- PCB de sensores o placas por fila.
- Fuente externa o interna de 12 V / 3 A.
- Convertidor 12 V → 5 V / 5–6 A.
- Fusible.
- Interruptor.
- Selector de tres posiciones.
- Botón de identificación.
- Conectores internos.
- Caja.
- Bastidor.
- Fondo de captura.
- Cable Ethernet.
- Cable de alimentación.

## 27.3 Por instalación

- Switch Ethernet.
- Servidor Linux.
- Punto de acceso Wi-Fi opcional.
- Regleta protegida.
- Cableado.
- Estructura o soportes.
- Equipo de seguridad.
- Repuestos de piezo.
- Repuestos de LED.
- Dianas de sustitución.
- Herramientas de mantenimiento.

## 27.4 Material de laboratorio

- Osciloscopio.
- Fuente de laboratorio.
- Multímetro.
- Analizador lógico.
- Cronógrafo.
- Cámara lenta opcional.
- Medidor de consumo.
- Impresora 3D o medios de prototipado.
- Herramientas de corte.
- Equipo de soldadura.

---

# 28. Esquemas eléctricos que deben producirse

El equipo de hardware deberá entregar esquemas formales, no solo diagramas conceptuales.

## 28.1 Esquema 1: alimentación

Debe incluir:

- Entrada de 12 V.
- Fusible.
- protección de polaridad.
- TVS.
- filtro.
- convertidor 5 V.
- regulador 3,3 V si no se utiliza el de la placa.
- medición de tensión.
- distribución a LED.
- distribución a lógica.
- puntos de prueba.

## 28.2 Esquema 2: ESP32 y W5500

Debe incluir:

- SPI.
- Chip select.
- interrupción.
- reset.
- RJ45.
- magnetismos.
- ESD.
- reloj si el módulo lo requiere.
- desacoplo.
- pinout.
- programación.
- botones de boot y reset.

## 28.3 Esquema 3: canal piezo

Debe incluir:

- piezo.
- descarga.
- resistencia serie.
- protección positiva y negativa.
- comparador.
- histéresis.
- detector de envolvente.
- filtro.
- salida digital.
- salida analógica.
- puntos de prueba.

## 28.4 Esquema 4: multiplexor o ADC

Debe incluir:

- nueve entradas.
- selección.
- referencia.
- filtrado.
- protección.
- conexión al ESP32.
- tiempo de retención.
- descarga controlada si procede.

## 28.5 Esquema 5: LED

Debe incluir:

- tres cadenas.
- conversión de nivel.
- resistencia de datos.
- condensadores.
- inyección de potencia.
- conectores por fila.
- protección.
- puntos de test.

## 28.6 Esquema 6: entradas de usuario

- selector principal/auto/satélite.
- botón identificar.
- LED de estado.
- interruptor.
- posible parada.
- antirrebote.

## 28.7 Esquema 7: PCB y conectores

- conectores por fila.
- numeración.
- polaridad.
- pinout.
- capacidad de corriente.
- fijaciones.
- separación de potencia y señal.
- planos de masa.
- retorno de LED.
- accesibilidad.

## 28.8 Revisión obligatoria

Antes de fabricar una PCB:

- Revisión eléctrica.
- Revisión de seguridad.
- Revisión de fabricación.
- ERC.
- DRC.
- revisión de corrientes.
- revisión de térmica.
- revisión de BOM.
- revisión de disponibilidad.
- aprobación del supervisor.

---

# 29. Estrategia de pruebas

## 29.1 Pruebas de una diana

- Impacto central.
- Impacto periférico.
- Distintas velocidades.
- Distintos grosores.
- Ruido ambiental.
- Golpe en estructura.
- Doble impacto.
- Cadencia rápida.
- 1.000 impactos.
- Fatiga.
- temperatura.

## 29.2 Pruebas de tres dianas

- Vibración cruzada.
- Impactos simultáneos.
- Separación mecánica.
- falsas detecciones.
- comparación de amplitud.
- algoritmos de clasificación.

## 29.3 Pruebas de módulo completo

- Nueve sensores.
- 72 LED.
- Consumo máximo.
- temperatura.
- reinicio.
- pérdida Ethernet.
- recuperación MQTT.
- actualización OTA.
- selector.
- calibración.
- almacenamiento local.

## 29.4 Pruebas multímódulo

- Dos módulos.
- elección de principal.
- conflicto de principales.
- sincronización.
- impacto simultáneo.
- desconexión.
- reconexión.
- rotación.
- posición.
- hasta nueve módulos.

## 29.5 Pruebas de servidor

- API.
- MQTT.
- WebSocket.
- migraciones.
- permisos.
- copias.
- restauración.
- carga.
- idempotencia.
- pérdida de PostgreSQL.
- actualización.
- rollback.

## 29.6 Pruebas E2E

Escenarios obligatorios:

1. Alta de módulo.
2. Calibración.
3. Creación de jugador.
4. Creación de partida.
5. Inicio.
6. Impactos.
7. penalización.
8. fin.
9. estadísticas.
10. exportación.
11. reinicio de servidor.
12. recuperación de eventos.
13. sustitución de módulo.
14. actualización OTA.

## 29.7 Calidad temporal

Se medirá:

- Tiempo real del impacto.
- Tiempo capturado por ESP32.
- Tiempo recibido por principal.
- Tiempo recibido por broker.
- Tiempo almacenado.
- Tiempo mostrado.

Se documentará la diferencia y se fijará un presupuesto de error.

---

# 30. Organización multiequipo

## 30.1 Estructura

```text
Organizador del proyecto
          │
          ▼
Supervisor técnico
          │
 ┌────────┼─────────┬──────────┬──────────┬──────────┐
 ▼        ▼         ▼          ▼          ▼          ▼
Arquitectura Hardware Firmware Backend   Frontend   Mecánica
          │
          ├─────────────┬─────────────┬─────────────┐
          ▼             ▼             ▼             ▼
        DevOps         Calidad      Seguridad   Documentación
```

## 30.2 Organizador

Responsabilidades:

- Planificar fases.
- Dividir tareas.
- Evitar bloqueos.
- Coordinar dependencias.
- Mantener tablero.
- Preparar reuniones.
- Escalar riesgos.
- Verificar entregables.
- No aprobar técnicamente su propio trabajo.

## 30.3 Supervisor técnico

Responsabilidades:

- Custodiar la arquitectura.
- Aprobar contratos.
- Revisar decisiones.
- Resolver conflictos técnicos.
- Confirmar criterios de aceptación.
- Autorizar el paso de fase.
- Exigir evidencias.
- Detener trabajos que rompan la base.
- Emitir dictamen de conformidad.

## 30.4 Equipo de arquitectura

- Arquitectura global.
- Contratos.
- ADR.
- modelo de dominio.
- límites entre equipos.
- estrategia temporal.
- seguridad por diseño.

## 30.5 Equipo de hardware electrónico

- Esquemáticos.
- PCB.
- BOM.
- prototipos.
- pruebas eléctricas.
- potencia.
- protección.
- Ethernet.
- sensores.

## 30.6 Equipo mecánico e industrial

- Discos.
- soportes.
- aislamiento.
- estructura.
- captura.
- mantenimiento.
- ergonomía.
- transporte.
- fabricación.

## 30.7 Equipo de firmware

- Drivers.
- lectura piezo.
- LED.
- W5500.
- MQTT.
- sincronización.
- coordinación.
- OTA.
- pruebas hardware-in-the-loop.

## 30.8 Equipo backend

- API.
- MQTT.
- motor de partidas.
- base de datos.
- estadísticas.
- autenticación.
- WebSocket.
- exportación.

## 30.9 Equipo frontend

- Panel.
- topología.
- partida.
- diagnóstico.
- accesibilidad.
- visualización en directo.
- pruebas de usabilidad.

## 30.10 Equipo DevOps

- Docker.
- Compose.
- CI/CD.
- imágenes.
- migraciones.
- copias.
- observabilidad.
- despliegue.
- rollback.

## 30.11 Equipo de calidad

- Plan de pruebas.
- trazabilidad.
- pruebas automatizadas.
- E2E.
- carga.
- regresión.
- evidencias.
- validación de criterios.

## 30.12 Equipo de seguridad

- Amenazas.
- secretos.
- MQTT ACL.
- TLS.
- firmware firmado.
- dependencias.
- permisos.
- pruebas de abuso.
- revisión de exposición.

## 30.13 Equipo de documentación

- Manual técnico.
- instalación.
- operación.
- mantenimiento.
- esquemas.
- API.
- protocolos.
- incidencias.
- guía de fabricación.

---

# 31. Organizador, supervisor y puertas de calidad

## 31.1 Flujo de trabajo

```text
Organizador crea paquete de trabajo
               │
               ▼
Equipo ejecutor desarrolla
               │
               ▼
Equipo de calidad verifica
               │
               ▼
Seguridad revisa si aplica
               │
               ▼
Supervisor emite dictamen
               │
        ┌──────┴──────┐
        ▼             ▼
     CONFORME      NO CONFORME
        │             │
        ▼             └── vuelve al equipo
Siguiente fase
```

## 31.2 Reglas

- Ningún equipo aprueba su propio trabajo.
- Cada tarea tiene propietario.
- Cada interfaz tiene contrato.
- Cada fase tiene pruebas.
- No se comienza una fase dependiente sin puerta verde.
- Los cambios de arquitectura se documentan.
- Las pruebas negativas son obligatorias.
- Los fallos conocidos se registran.
- Los merges requieren revisión.
- La rama principal debe permanecer desplegable.

## 31.3 Trabajo paralelo

Pueden trabajar en paralelo:

- Mecánica de una diana.
- Circuito piezo.
- controlador LED.
- W5500.
- contratos MQTT.
- modelo de datos.
- diseño UX.
- infraestructura Docker.

No deben integrarse sin contratos congelados:

- Firmware y backend.
- Backend y frontend.
- hardware y firmware.
- topología y coordinación.
- OTA y seguridad.

## 31.4 Propiedad de áreas

Cada equipo tendrá rutas asignadas para evitar pisarse:

```text
hardware/**      → hardware
mechanical/**    → mecánica
firmware/**      → firmware
backend/**       → backend
frontend/**      → frontend
infrastructure/**→ DevOps
contracts/**     → arquitectura
tests/e2e/**     → calidad
docs/**          → documentación
```

Los cambios transversales requerirán una coordinación explícita.

---

# 32. Plan de ejecución por fases

## Fase 0 — Definición y contratos

Objetivos:

- Congelar requisitos.
- Crear repositorio.
- Definir contratos.
- Crear ADR.
- fijar pinout preliminar.
- fijar modelo de eventos.
- fijar criterios de éxito.

Entregables:

- Documento de arquitectura.
- Contratos MQTT.
- OpenAPI preliminar.
- modelo de datos.
- diagrama eléctrico.
- registro de riesgos.
- plan de pruebas.

Puerta:

- Supervisor: `ARQUITECTURA BASE CONFORME`.

---

## Fase 1 — Prototipo de una diana

Hardware:

- Un disco.
- Un piezo.
- ocho LED.
- ESP32-S3.
- protección.
- comparador.
- envolvente.

Firmware:

- captura.
- amplitud.
- LED.
- salida por consola.

Pruebas:

- centro.
- borde.
- falsos positivos.
- 1.000 impactos.
- distintos grosores.

Puerta:

- Impacto detectado de forma repetible.
- Sin daño al ESP32.
- Sin múltiples conteos indebidos.
- Material seleccionado provisionalmente.

---

## Fase 2 — Tres dianas y vibración cruzada

Objetivos:

- Tres dianas adyacentes.
- Tres canales.
- tres cadenas o segmentos LED.
- clasificación de vibración.

Pruebas:

- impacto en cada diana.
- impacto en estructura.
- doble impacto.
- cadencia.
- vecinos.

Puerta:

- Tasa de detección acordada.
- Tasa de falso positivo bajo el límite.
- algoritmo documentado.
- aislamiento mecánico aprobado.

---

## Fase 3 — Electrónica de módulo 3×3

Objetivos:

- Nueve canales.
- W5500.
- fuente.
- conversión.
- 72 LED.
- selector.
- PCB prototipo.

Pruebas:

- consumo.
- térmica.
- Ethernet.
- todas las dianas.
- estrés.

Puerta:

- ERC y DRC conformes.
- módulo eléctricamente estable.
- potencia con margen.
- BOM aprobada.

---

## Fase 4 — Firmware base

Objetivos:

- Drivers.
- máquinas de estado.
- MQTT.
- almacenamiento.
- diagnóstico.
- OTA inicial.

Pruebas:

- unitarias.
- integración.
- hardware-in-the-loop.
- reconexión.
- reinicios.

Puerta:

- Firmware reproducible.
- pruebas verdes.
- cola de eventos funcional.
- actualización y rollback probados.

---

## Fase 5 — Backend Docker

Objetivos:

- Compose.
- Mosquitto.
- PostgreSQL.
- backend.
- autenticación.
- API.
- WebSocket.
- migraciones.
- copias.

Pruebas:

- instalación limpia.
- migración.
- backup.
- restore.
- MQTT.
- idempotencia.

Puerta:

- Despliegue reproducible.
- healthchecks.
- copia y restauración demostradas.
- seguridad mínima conforme.

---

## Fase 6 — Panel web

Objetivos:

- sistemas.
- módulos.
- topología.
- calibración.
- partida.
- directo.
- estadísticas.

Pruebas:

- escritorio.
- tableta.
- móvil.
- accesibilidad.
- E2E.

Puerta:

- Operador puede completar una partida sin consola.
- errores comprensibles.
- estado en directo coherente.

---

## Fase 7 — Integración de un módulo completo

Objetivos:

- Módulo real con servidor.
- alta.
- calibración.
- juego.
- resultados.
- pérdida de red.

Puerta:

- Flujo E2E completo.
- resultado persistido.
- recuperación probada.
- informe de calidad.

---

## Fase 8 — Coordinación de dos módulos

Objetivos:

- principal y satélite.
- sincronización.
- posición.
- rotación.
- impacto simultáneo.
- conflicto.

Puerta:

- tiempos coherentes.
- conflicto de principal detectado.
- desconexión tratada.
- eventos sin duplicados.

---

## Fase 9 — Modos de juego y estadísticas

Objetivos:

- aleatorio.
- secuencia.
- todas contra reloj.
- reacción.
- penalizaciones.
- precisión.

Puerta:

- reglas reproducibles.
- cálculos auditables.
- estadísticas validadas.
- exportación correcta.

---

## Fase 10 — Seguridad y endurecimiento

Objetivos:

- TLS.
- ACL.
- roles.
- firmware firmado.
- secretos.
- auditoría.
- escaneo.

Puerta:

- Informe de amenazas.
- pruebas de seguridad.
- sin credenciales por defecto.
- OTA segura.

---

## Fase 11 — Matriz de hasta nueve módulos

Objetivos:

- prueba de carga.
- topología 3×3.
- 81 dianas.
- consumo.
- red.
- mantenimiento.

Puerta:

- Prueba prolongada.
- recuperación.
- rendimiento.
- instalación documentada.

---

## Fase 12 — Preparación de producción

Objetivos:

- PCB final.
- carcasa final.
- BOM.
- manual.
- fabricación.
- pruebas de recepción.
- versión 1.0.

Puerta:

- Supervisor: `APTO PARA PRODUCCIÓN CONTROLADA`.

---

# 33. Entregables obligatorios

## Hardware

- Esquemáticos.
- PCB.
- Gerber.
- BOM.
- pick and place si aplica.
- planos.
- pinout.
- informe eléctrico.
- informe térmico.
- procedimiento de prueba.

## Mecánica

- CAD.
- planos.
- materiales.
- tolerancias.
- montaje.
- despiece.
- mantenimiento.
- captura.
- ensayo de impacto.

## Firmware

- código.
- compilación reproducible.
- binarios firmados.
- particiones.
- configuración.
- pruebas.
- protocolo.
- guía de recuperación.

## Servidor

- Docker Compose.
- imágenes.
- `.env.example`.
- migraciones.
- copias.
- restauración.
- healthchecks.
- documentación.

## Aplicación

- backend.
- frontend.
- OpenAPI.
- contratos MQTT.
- modelo de datos.
- permisos.
- E2E.

## Calidad

- plan.
- casos.
- evidencias.
- resultados.
- regresión.
- carga.
- aceptación.

## Seguridad

- modelo de amenazas.
- revisión de secretos.
- ACL.
- certificados.
- dependencias.
- OTA.
- informe final.

---

# 34. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Vibración cruzada | Impactos falsos | Aislamiento + amplitud + ventana |
| Piezo daña el ESP32 | Avería | Protección y pruebas de sobretensión |
| Fallo de LED corta cadena | Pérdida visual | Tres cadenas por filas |
| Caída de tensión | Reinicios | Fuente propia y conversión local |
| Dos principales | Partida inconsistente | Selector + bloqueo de inicio |
| Latencia de red | Tiempo incorrecto | Cronometraje local |
| Eventos duplicados | Puntuación incorrecta | UUID e idempotencia |
| MicroSD o disco lleno | Pérdida de servicio | Rotación y alertas |
| OTA fallida | Módulo inutilizable | A/B y rollback |
| Rebote de bolas | Riesgo físico | Fondo absorbente y protección |
| Fuente no segura | Riesgo eléctrico | Fuente certificada |
| Dependencia de servidor | Interrupción | Cola y coordinación local |
| Sobreconsumo LED | Reset o calor | Límite de brillo |
| Escasez de GPIO | Rediseño | Pinout temprano y revisión |
| Estadística de precisión falsa | Datos incorrectos | Exigir disparos realizados |
| Cambios de contrato | Bloqueos | Versionado y supervisor |

---

# 35. Decisiones pendientes

Antes de cerrar el diseño final deben resolverse:

1. Modelo exacto de ESP32-S3.
2. Modelo exacto de W5500.
3. Material y grosor definitivo.
4. Diseño del soporte elástico.
5. Cadencia máxima.
6. Distancia habitual.
7. Uso interior o exterior.
8. Fuente externa o integrada.
9. Modelo exacto de LED.
10. Comparador.
11. Multiplexor o ADC externo.
12. Umbral común o individual.
13. Exactitud temporal requerida.
14. Política al golpear azul.
15. Munición y precisión.
16. Identificación de jugadores.
17. Dimensión final del módulo.
18. Forma de montaje.
19. Sistema de captura.
20. Stack definitivo del backend.
21. Retención de datos.
22. Método de actualización OTA.
23. Necesidad de audio.
24. Requisitos legales y de seguro del lugar de uso.

Cada decisión se documentará mediante un ADR cuando afecte a varias áreas.

---

# 36. Criterios de aceptación final

El producto se considerará preparado cuando:

- Una diana detecte impactos de forma repetible.
- No se dañe la electrónica.
- Las vibraciones vecinas no generen resultados erróneos por encima del límite aceptado.
- Nueve dianas funcionen simultáneamente.
- Los LED representen correctamente los estados.
- El módulo se conecte por Ethernet.
- El servidor lo registre.
- La calibración pueda ejecutarse desde el panel.
- Una partida completa pueda gestionarse desde web.
- Los tiempos procedan del ESP32.
- Los eventos no se dupliquen.
- Las estadísticas sean reproducibles.
- Dos módulos se sincronicen.
- Nueve módulos puedan coexistir.
- El sistema sobreviva a una pérdida temporal de red.
- Las copias y restauración estén probadas.
- OTA y rollback estén probados.
- Los permisos estén aplicados.
- La documentación permita instalar, operar y mantener.
- Calidad y seguridad emitan conformidad.
- El supervisor apruebe la versión.

---

# 37. Evoluciones posteriores

- Perfil Docker ligero.
- SQLite para equipos limitados.
- Raspberry Pi.
- PoE.
- contador automático de disparos.
- aplicación móvil.
- audio.
- módulos 2×2.
- módulos individuales.
- uso exterior.
- más de nueve módulos.
- clasificación en la nube.
- varias sedes.
- torneos.
- integración con NFC o QR.
- cámara.
- retransmisión.
- API pública.
- modos de equipos.
- editor avanzado de ejercicios.
- informes de entrenamiento.

---

# 38. Resumen de arquitectura congelada

```text
MÓDULO FÍSICO
- Matriz 3×3
- 9 dianas de 200 mm
- 9 piezos
- 8 LED por diana
- 72 LED por módulo
- ESP32-S3
- W5500 Ethernet
- Fuente propia 12 V / 3 A
- Convertidor 12 V → 5 V / 5–6 A
- Selector SATÉLITE / AUTO / PRINCIPAL
- Ethernet independiente
- Aislamiento mecánico
- Captura de bolas

INSTALACIÓN
- Hasta 9 módulos
- Switch Ethernet
- Matriz lógica máxima 9×9
- 81 dianas
- Servidor Linux
- Operación local sin Internet

SERVIDOR
- Docker Compose
- Mosquitto
- Backend modular
- PostgreSQL
- Frontend web
- WebSocket
- Reverse proxy
- Worker
- Copias
- Diagnóstico

DESARROLLO
- Organizador
- Supervisor
- Arquitectura
- Hardware
- Mecánica
- Firmware
- Backend
- Frontend
- DevOps
- Calidad
- Seguridad
- Documentación

PRINCIPIO CRÍTICO
- El ESP32 registra el tiempo.
- El coordinador valida la partida.
- El servidor administra, guarda y visualiza.
```

---

# Dictamen de propuesta

La propuesta es técnicamente viable.

Los puntos de mayor riesgo y que deben resolverse antes de fabricar varios módulos son:

1. Aislamiento mecánico entre dianas.
2. Protección y lectura fiable de los piezos.
3. Clasificación de vibración cruzada.
4. Consumo y distribución de alimentación de los LED.
5. Disponibilidad de GPIO.
6. Sincronización entre módulos.
7. Captura segura de bolas.
8. Contratos estables entre firmware y backend.

La ejecución debe comenzar con una única diana, continuar con tres dianas y no avanzar a la PCB completa 3×3 hasta que el supervisor apruebe las pruebas mecánicas y eléctricas.

Este documento constituye la guía base para iniciar el diseño técnico, organizar los equipos y preparar el desarrollo del sistema.
