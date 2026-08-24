/**
 * @file led.h
 * @brief Mapeo de estado de diana a color Y PATRON, y presupuesto de potencia.
 *
 * Dosier 10.5: "No se dependera exclusivamente del color". Cada estado tiene
 * color y patron, y el patron es parte del contrato visual: dos estados nunca
 * comparten la pareja (color, patron).
 *
 * Banco 2026-08-20: aros WS2812B reales de 24 LED por diana, 3 dianas por
 * fila. El modulo completo tiene 216 LED; el firmware impone un limite global
 * de brillo y un presupuesto de corriente.
 */
#ifndef DIANA_LED_H
#define DIANA_LED_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_PATTERN_OFF = 0,
    DIANA_PATTERN_SOLID,          /* fijo */
    DIANA_PATTERN_SLOW_PULSE,     /* pulso lento */
    DIANA_PATTERN_FLASH_FADE,     /* destello y fundido */
    DIANA_PATTERN_COUNTDOWN,      /* cuenta atras */
    DIANA_PATTERN_FAST_BLINK,     /* parpadeo rapido */
    DIANA_PATTERN_ALTERNATE,      /* alternancia rojo/blanco */
    DIANA_PATTERN_SWEEP,          /* barrido */
    DIANA_PATTERN_DIM_SOLID,      /* blanco tenue fijo */
    DIANA_PATTERN_COUNT
} diana_led_pattern;

typedef struct {
    uint8_t r, g, b;
    diana_led_pattern pattern;
    uint16_t period_ms;   /* 0 si el patron no es periodico */
} diana_led_style;

/** Estilo del estado de diana (tabla del dosier 10.5). */
diana_led_style diana_led_style_for(diana_target_state st);

/** Estilo de identificacion: cian, barrido (comando 'identify'). */
diana_led_style diana_led_style_identify(void);

const char *diana_led_pattern_str(diana_led_pattern p);

/**
 * Renderiza el fotograma de una cadena (0..2) para las 3 dianas de esa fila.
 * @param states     estados de las 9 dianas, indice 0 = diana 1.
 * @param identify   true si el modulo esta en modo identificacion.
 * @param brightness limite global de brillo 1..255 (config.led_brightness_max).
 * @param t_ms       tiempo monotonico en ms, para animar los patrones.
 * @param out        buffer de DIANA_LEDS_PER_CHAIN pixeles.
 */
void diana_led_render_chain(uint8_t chain, const diana_target_state *states,
                            bool identify, uint8_t brightness, uint64_t t_ms,
                            diana_hal_rgb out[DIANA_LEDS_PER_CHAIN]);

/**
 * Corriente estimada de un fotograma completo, en mA.
 * Modelo: 20 mA por canal a plena escala y por LED (60 mA en blanco), lineal
 * con el valor del canal. Es un MODELO, no una medida: la corriente real
 * depende del LED concreto y debe verificarse con pinza amperimetrica.
 */
uint32_t diana_led_estimate_ma(const diana_hal_rgb *pixels, size_t count);

/**
 * Aplica el presupuesto de potencia: si la corriente estimada de las 3 cadenas
 * supera 'budget_ma', escala TODOS los pixeles por igual hasta encajar.
 * Devuelve el factor aplicado en tanto por mil (1000 = sin recorte).
 */
uint16_t diana_led_apply_budget(diana_hal_rgb *chains[DIANA_LED_CHAINS],
                                size_t per_chain, uint32_t budget_ma);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_LED_H */
