/**
 * @file diana_board.h
 * @brief Selecciona el pinout segun la placa elegida en `idf.py menuconfig`.
 *
 * Ningun otro fichero debe incluir un header de placa concreto: todos incluyen
 * este. Asi cambiar de banco de pruebas a modulo definitivo es una opcion de
 * configuracion, no una edicion de codigo.
 */
#ifndef DIANA_BOARD_H
#define DIANA_BOARD_H

#include "sdkconfig.h"

/* DIANA_TARGET_COUNT: sin el, las comprobaciones de coherencia del final se
 * evaluarian contra un cero implicito y no detectarian nada. */
#include "diana/types.h"

#if defined(CONFIG_DIANA_BOARD_W5500_TOPOB)
#  include "esp32s3_w5500_topoB.h"
#else
#  include "esp32s3_topoB_fase1.h"
#endif

/* Polaridad de la salida del comparador. La PCB definitiva usa LM339 en
 * colector abierto (activo BAJO); los modulos comerciales de la fase 1 son
 * activos en ALTO (hallazgo M-02). De esto dependen: el flanco de la
 * interrupcion, la resistencia de IRQ_ANY y como se interpretan los bits del
 * registro de desplazamiento. */
#if CONFIG_DIANA_PIEZO_ACTIVE_LOW
#  define DIANA_PIEZO_TRIGGERED_BIT   0
#  define DIANA_PIEZO_IRQ_EDGE        GPIO_INTR_NEGEDGE
#  define DIANA_PIEZO_IRQ_PULL_UP     1
#else
#  define DIANA_PIEZO_TRIGGERED_BIT   1
#  define DIANA_PIEZO_IRQ_EDGE        GPIO_INTR_POSEDGE
#  define DIANA_PIEZO_IRQ_PULL_UP     0
#endif

/* Coherencia: un canal cableado de mas que dianas existen es un error de
 * configuracion, no algo que descubrir en ejecucion. */
#if DIANA_PIEZO_CHANNELS > DIANA_TARGET_COUNT
#  error "DIANA_PIEZO_CHANNELS no puede superar DIANA_TARGET_COUNT"
#endif
#if DIANA_PIEZO_CHANNELS > DIANA_SR_BITS
#  error "El registro de desplazamiento no tiene bits para todos los canales"
#endif

#endif /* DIANA_BOARD_H */
