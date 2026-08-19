# Validación física pendiente

**Este documento existe para separar lo implementado de lo validado en banco.**
Parte del firmware ya se ha compilado, flasheado y observado sobre hardware real,
pero la validación física completa sigue abierta. Ningún valor de este documento
debe tratarse como calibrado.

## 0. Resumen para quien vaya a montar el banco

| Ámbito | Estado |
|---|---|
| Lógica de negocio | probada en PC, 389 comprobaciones |
| Conformidad con el contrato MQTT | validada contra los esquemas reales |
| Compilación con ESP-IDF | ejecutada con ESP-IDF v5.5 |
| Flash/monitor | ejecutado en COM6 sobre ESP32-S3 `10:20:ba:4b:b7:04` |
| LED | 2 aros de 24 LED encendidos tras configurar 72 LED/fila |
| Sensores DO | reposo observado alto; firmware en `DIANA_DO_ACTIVE_LOW` |
| Bloqueo físico | primer 74HC165 reportado muy caliente; no alimentar hasta revisar |
| Umbrales piezoeléctricos | no aplican en DO-only; debounce/refractory pendientes |

## 0.1. Incidencia crítica de banco 2026-08-20

El usuario reportó que el primer 74HC165 estaba muy caliente y que D1 parecía
activo permanente. Se retiró alimentación. Esto bloquea la validación de
sensores.

Antes de alimentar de nuevo:

1. Probar el primer 74HC165 sin sensores conectados.
2. Verificar `VCC=3.3 V`, `GND` y ausencia de corto entre alimentación y masa.
3. Medir `DO` de cada sensor alimentado a 5 V.
4. Si `DO HIGH` es mayor que 3.3 V, insertar adaptación de nivel.
5. Fijar a nivel conocido todas las entradas no usadas.
6. Repetir D1/D2/D3 sólo cuando el 74HC165 permanezca frío.

## 1. Ruta analógica histórica: NO aplica al perfil DO-only

Los valores por defecto de `diana/config.h` pertenecen a la ruta analogica
historica y no calibran el prototipo DO-only:

| Parámetro | Valor | De dónde sale |
|---|---:|---|
| `threshold` | 900 cuentas | **inventado.** No hay ninguna medida detrás |
| `hysteresis` | 80 cuentas | **inventado** |
| `noise_floor` | 140 cuentas | **inventado** |
| `blanking_us` | 60 000 (60 ms) | centro del rango de ensayo 30–100 ms (dosier §9.6) |
| `group_window_us` | 2 000 (2 ms) | centro del rango de ensayo 1–3 ms (dosier §9.6) |
| `neighbour_ratio` | 0,35 | **inventado.** Sin base experimental |

Los dos primeros números de la columna "valor" para blanking y ventana tienen
al menos un rango del dosier detrás. `threshold`, `hysteresis`, `noise_floor` y
`neighbour_ratio` **no tienen ninguna justificación física**: son marcadores de
posición para que el código arranque y las pruebas puedan ejercitar la lógica.

Por eso el firmware deja `calibrated_at` a `null` en `config/reported` mientras
no se haya calibrado de verdad: un canal sin fecha de calibración **no está
validado**, y eso es visible desde el backend.

### Procedimiento para fijarlos (dosier §9.7)

Por cada uno de los 9 canales:

1. Medir el ruido en reposo durante 60 s. Anotar media y máximo → `noise_floor`.
2. Golpear tres veces en el **centro** de la diana. Anotar el pico de la
   envolvente.
3. Disparar tres veces cerca del **borde**. Anotar el pico (será menor: es el
   caso peor que hay que detectar).
4. `threshold` ≈ punto medio entre el máximo del ruido y el mínimo de los
   impactos de borde. Si no hay separación clara, el canal no sirve: revisar
   montaje mecánico o ganancia.
5. `hysteresis` ≈ 10 % del umbral, ajustando hasta que no haya dobles conteos.
6. Repetir golpeando en las **dianas vecinas** y anotando lo que ve este canal:
   el mayor cociente vecino/principal observado, más un margen, fija
   `neighbour_ratio`.
7. Repetir en las 9 dianas. Los umbrales serán distintos entre sí: el contrato
   ya los define por canal.
8. Guardar el perfil y ejecutar la prueba automática de validación.

**Criterio de rechazo:** si el cociente entre el impacto de borde más débil y la
diafonía más fuerte del vecino es menor que 2, el diseño mecánico no aísla lo
suficiente (dosier §7.4) y ningún umbral lo va a arreglar.

## 2. Temporización: lo que la prueba en host NO puede demostrar

La suite en host usa un reloj virtual. Eso valida la **lógica** de las ventanas,
pero no que en el hardware real se cumplan los plazos. Falta medir:

| Qué | Cómo | Criterio |
|---|---|---|
| Latencia ISR → `event_us` | GPIO de traza + osciloscopio contra el pulso del comparador | < 50 µs y **estable**: el jitter es lo que envenena T1 |
| Tiempo de asentamiento del multiplexor | osciloscopio en SIG tras conmutar S0–S3 | el valor actual (5 µs) es una suposición |
| Duración de la lectura ADC de 9 canales | traza GPIO | debe caber holgadamente en `group_window_us` |
| Impactos simultáneos reales | golpear dos dianas a la vez | ambos disparos deben entrar en el mismo grupo |
| Resolución efectiva | comparar `event_us` de dos módulos ante un mismo golpe | dosier §14.2 pide 1 ms visible |

Si la latencia de la ISR resulta ser mayor que la ventana de agrupación, el
diseño de agrupación hay que replantearlo, no ajustarlo.

## 3. Red

| Qué | Criterio |
|---|---|
| **SNTP** | el módulo debe obtener hora tras conseguir IP. Sin ella, la caducidad de comandos **no se verifica**: se acepta declarándolo y la defensa queda sólo en el nonce. Comprobar que `epoch_ms` deja de ser 0 y cuánto tarda |
| **`client_id` = `module_id`** | conectar con un `client_id` distinto y comprobar que Mosquitto **deniega** las publicaciones: si no lo hace, la ACL no está aplicando el patrón `%c` |
| **Nonce persistido** | aceptar un comando, reiniciar el módulo y reinyectar el mismo comando: debe rechazarse. Es la prueba de que la NVS conserva el nonce |
| SPI del W5500 a 20 MHz | sin errores de trama; subir hasta encontrar el límite y bajar con margen |
| DHCP | concesión en < 5 s |
| IP estática | aplicada antes de arrancar el driver, sin conflicto |
| Desconexión del cable | detección de enlace y encolado, sin reiniciar |
| Reconexión | vaciado completo de la cola, **sin duplicados en el backend** |
| Corte largo (> 10 min) | el W5500 no siempre recupera solo; comprobar que el `esp_eth_stop/start` lo hace |

## 4. LED y potencia

| Qué | Criterio |
|---|---|
| Modelo de consumo | medir con pinza el consumo real en blanco máximo y comparar con los 12960 mA teoricos |
| Presupuesto de 3000 mA | comprobar que la fuente aguanta el pico sin caída de tensión |
| Conversión de nivel | verificar que los WS2812 leen bien el dato a 5 V |
| Caída por fila | medir la tensión al final de cada cadena; puede exigir inyección adicional |
| Legibilidad de los patrones | a la distancia de uso, con luz ambiente real, y con un observador daltónico |

Estado 2026-08-20: los aros reales son de 24 LED cada uno. El firmware se
corrigió de 24 LED por fila a 72 LED por fila (`3 x 24`) y el usuario confirmó
que los 2 aros conectados se encienden.

## 5. OTA

Lo probado en host es la **lógica de decisión**: orden de comprobaciones,
rechazo durante partida, sha256, rechazo si la firma no verifica, rollback por
plazo. La verificación de firma en host es un doble, no criptografía real.

Falta, con hardware:

1. OTA real A/B; la compilación USB de bring-up ya se hizo, pero no una OTA.
2. Generar la clave de firma y comprobar que una imagen **sin firmar** es
   rechazada por el bootloader.
3. Actualización completa A → B y arranque desde la nueva partición.
4. **Rollback real:** flashear a propósito una imagen que se cuelgue antes de
   confirmar, y comprobar que el bootloader vuelve a la anterior.
5. Intento de OTA con una partida en curso: debe rechazarse y quedar registrado.
6. Recuperación por USB con la NVS intacta.
7. Comprobar que la ISR en IRAM sigue atendiendo durante la escritura en flash.

## 6. Persistencia

| Qué | Criterio |
|---|---|
| Cola en la partición `evtqueue` | encolar, cortar la corriente a mitad de escritura, comprobar que la ranura incompleta se ignora y el resto sobrevive |
| Reserva de `local_sequence` | cortar la corriente 20 veces seguidas y comprobar que **ningún** valor se repite |
| NVS cifrada | verificar que la contraseña MQTT no se puede leer volcando la flash |
| Desgaste de flash | estimar ciclos de borrado a ritmo de partida real |

## 7. Autodiagnóstico

El autodiagnóstico de arranque comprueba selector, lectura en reposo de los 9
canales y tensión de 5 V. **No puede** comprobar por sí solo si un piezo está
despegado de la superficie: en reposo, un piezo suelto lee igual que uno bien
pegado. Eso exige la prueba de golpeo del punto 1.
