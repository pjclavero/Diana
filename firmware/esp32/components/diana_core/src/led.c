#include "diana/led.h"

#include <string.h>

/* Tabla del dosier 10.5. El patron es tan normativo como el color. */
diana_led_style diana_led_style_for(diana_target_state st)
{
    diana_led_style s = {0, 0, 0, DIANA_PATTERN_OFF, 0};
    switch (st) {
    case DIANA_TARGET_OFF:
        s = (diana_led_style){0, 0, 0, DIANA_PATTERN_OFF, 0};
        break;
    case DIANA_TARGET_SAFE:            /* Segura: azul fijo */
        s = (diana_led_style){0, 0, 255, DIANA_PATTERN_SOLID, 0};
        break;
    case DIANA_TARGET_ACTIVE:          /* Objetivo: rojo, pulso lento */
        s = (diana_led_style){255, 0, 0, DIANA_PATTERN_SLOW_PULSE, 1200};
        break;
    case DIANA_TARGET_HIT:             /* Acierto: verde, destello y fundido */
        s = (diana_led_style){0, 255, 0, DIANA_PATTERN_FLASH_FADE, 600};
        break;
    case DIANA_TARGET_COUNTDOWN:       /* Preparacion: amarillo, cuenta atras */
        s = (diana_led_style){255, 200, 0, DIANA_PATTERN_COUNTDOWN, 1000};
        break;
    case DIANA_TARGET_PENALTY:         /* Penalizacion: magenta, parpadeo rapido */
        s = (diana_led_style){255, 0, 255, DIANA_PATTERN_FAST_BLINK, 200};
        break;
    case DIANA_TARGET_ERROR:           /* Error: rojo/blanco alternando */
        s = (diana_led_style){255, 0, 0, DIANA_PATTERN_ALTERNATE, 400};
        break;
    case DIANA_TARGET_CALIBRATION:     /* Calibracion: cian, pulso lento */
        s = (diana_led_style){0, 255, 255, DIANA_PATTERN_SLOW_PULSE, 1600};
        break;
    case DIANA_TARGET_LOCKED:          /* Bloqueada: naranja fijo */
        s = (diana_led_style){255, 110, 0, DIANA_PATTERN_SOLID, 0};
        break;
    case DIANA_TARGET_SENSOR_ERROR:    /* Error de sensor: rojo/blanco, rapido */
        s = (diana_led_style){255, 0, 0, DIANA_PATTERN_FAST_BLINK, 300};
        break;
    case DIANA_TARGET_MAINTENANCE:     /* Mantenimiento: blanco tenue fijo */
        s = (diana_led_style){60, 60, 60, DIANA_PATTERN_DIM_SOLID, 0};
        break;
    case DIANA_TARGET_DISABLED:        /* Deshabilitada: blanco muy tenue, pulso */
        s = (diana_led_style){25, 25, 25, DIANA_PATTERN_SLOW_PULSE, 2400};
        break;
    default:
        break;
    }
    return s;
}

diana_led_style diana_led_style_identify(void)
{
    /* Identificacion: cian, barrido (dosier 10.5). */
    diana_led_style s = {0, 255, 255, DIANA_PATTERN_SWEEP, 800};
    return s;
}

static const char *const PATTERN_STR[] = {
    "off", "solid", "slow_pulse", "flash_fade", "countdown", "fast_blink",
    "alternate", "sweep", "dim_solid",
};

const char *diana_led_pattern_str(diana_led_pattern p)
{
    if ((int)p < 0 || p >= DIANA_PATTERN_COUNT) return "";
    return PATTERN_STR[p];
}

/* Fase 0..255 dentro del periodo. */
static uint8_t phase_of(uint64_t t_ms, uint16_t period_ms)
{
    if (period_ms == 0) return 0;
    return (uint8_t)((t_ms % period_ms) * 256 / period_ms);
}

/* Triangular 0..255 -> 0..255 (ida y vuelta). */
static uint8_t triangle(uint8_t phase)
{
    return (phase < 128) ? (uint8_t)(phase * 2) : (uint8_t)((255 - phase) * 2);
}

static uint8_t scale8(uint8_t v, uint8_t f)
{
    return (uint8_t)(((uint16_t)v * (uint16_t)f) / 255);
}

void diana_led_render_chain(uint8_t chain, const diana_target_state *states,
                            bool identify, uint8_t brightness, uint64_t t_ms,
                            diana_hal_rgb out[DIANA_LEDS_PER_CHAIN])
{
    memset(out, 0, sizeof(diana_hal_rgb) * DIANA_LEDS_PER_CHAIN);
    if (chain >= DIANA_LED_CHAINS) return;
    if (brightness == 0) brightness = 1;

    for (uint8_t slot = 0; slot < 3; ++slot) {
        uint8_t target0 = (uint8_t)(chain * 3 + slot);   /* 0..8 */
        diana_led_style st = identify ? diana_led_style_identify()
                                      : diana_led_style_for(states[target0]);

        uint8_t phase = phase_of(t_ms, st.period_ms);

        for (uint8_t k = 0; k < DIANA_LEDS_PER_TARGET; ++k) {
            uint8_t r = st.r, g = st.g, b = st.b;
            uint8_t f = 255;

            switch (st.pattern) {
            case DIANA_PATTERN_OFF:
                r = g = b = 0;
                break;
            case DIANA_PATTERN_SOLID:
            case DIANA_PATTERN_DIM_SOLID:
                break;
            case DIANA_PATTERN_SLOW_PULSE:
                f = (uint8_t)(60 + (triangle(phase) * 195) / 255);
                break;
            case DIANA_PATTERN_FLASH_FADE:
                f = (uint8_t)(255 - phase); /* destella y se apaga */
                break;
            case DIANA_PATTERN_COUNTDOWN: {
                /* Los LED se apagan en sentido horario segun avanza la fase. */
                uint8_t lit = (uint8_t)(DIANA_LEDS_PER_TARGET -
                                        (phase * DIANA_LEDS_PER_TARGET) / 256);
                f = (k < lit) ? 255 : 0;
                break;
            }
            case DIANA_PATTERN_FAST_BLINK:
                f = (phase < 128) ? 255 : 0;
                break;
            case DIANA_PATTERN_ALTERNATE:
                /* Rojo y blanco alternandose: distinguible sin ver el color. */
                if (phase >= 128) { r = 255; g = 255; b = 255; }
                break;
            case DIANA_PATTERN_SWEEP: {
                uint8_t head = (uint8_t)((phase * DIANA_LEDS_PER_TARGET) / 256);
                f = (k == head) ? 255 : 30;
                break;
            }
            default:
                break;
            }

            f = scale8(f, brightness);
            uint8_t idx = (uint8_t)(slot * DIANA_LEDS_PER_TARGET + k);
            out[idx].r = scale8(r, f);
            out[idx].g = scale8(g, f);
            out[idx].b = scale8(b, f);
        }
    }
}

uint32_t diana_led_estimate_ma(const diana_hal_rgb *pixels, size_t count)
{
    /* 20 mA por canal a plena escala. Modelo, no medida. */
    uint64_t acc = 0;
    for (size_t i = 0; i < count; ++i) {
        acc += (uint64_t)pixels[i].r + pixels[i].g + pixels[i].b;
    }
    return (uint32_t)((acc * 20) / 255);
}

uint16_t diana_led_apply_budget(diana_hal_rgb *chains[DIANA_LED_CHAINS],
                                size_t per_chain, uint32_t budget_ma)
{
    uint32_t total = 0;
    for (int c = 0; c < DIANA_LED_CHAINS; ++c) {
        if (chains[c]) total += diana_led_estimate_ma(chains[c], per_chain);
    }
    if (budget_ma == 0 || total <= budget_ma) return 1000;

    uint32_t factor = (budget_ma * 1000) / total;  /* < 1000 */
    for (int c = 0; c < DIANA_LED_CHAINS; ++c) {
        if (!chains[c]) continue;
        for (size_t i = 0; i < per_chain; ++i) {
            chains[c][i].r = (uint8_t)((uint32_t)chains[c][i].r * factor / 1000);
            chains[c][i].g = (uint8_t)((uint32_t)chains[c][i].g * factor / 1000);
            chains[c][i].b = (uint8_t)((uint32_t)chains[c][i].b * factor / 1000);
        }
    }
    return (uint16_t)factor;
}
