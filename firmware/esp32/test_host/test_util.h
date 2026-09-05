/**
 * @file test_util.h
 * @brief Micro-framework de pruebas en host. Sin dependencias.
 *
 * Cada fichero test_*.c expone una funcion `int run_<nombre>(void)` que
 * devuelve el numero de fallos. main.c las llama todas y agrega el recuento.
 */
#ifndef DIANA_TEST_UTIL_H
#define DIANA_TEST_UTIL_H

#include <stdio.h>
#include <string.h>

extern int g_tests_run;
extern int g_tests_failed;
extern const char *g_current_suite;

#define TEST_SUITE(name) g_current_suite = (name)

#define CHECK(cond, desc)                                                     \
    do {                                                                      \
        g_tests_run++;                                                        \
        if (cond) {                                                           \
            printf("  ok   %-52s\n", (desc));                                 \
        } else {                                                              \
            g_tests_failed++;                                                 \
            printf("  FALLO %-52s  (%s:%d)\n", (desc), __FILE__, __LINE__);   \
        }                                                                     \
    } while (0)

#define CHECK_EQ_INT(a, b, desc)                                              \
    do {                                                                      \
        long long _a = (long long)(a), _b = (long long)(b);                   \
        g_tests_run++;                                                        \
        if (_a == _b) {                                                       \
            printf("  ok   %-52s\n", (desc));                                 \
        } else {                                                              \
            g_tests_failed++;                                                 \
            printf("  FALLO %-52s  esperado %lld, obtenido %lld (%s:%d)\n",   \
                   (desc), _b, _a, __FILE__, __LINE__);                       \
        }                                                                     \
    } while (0)

#define CHECK_EQ_STR(a, b, desc)                                              \
    do {                                                                      \
        const char *_a = (a), *_b = (b);                                      \
        g_tests_run++;                                                        \
        if (_a && _b && strcmp(_a, _b) == 0) {                                \
            printf("  ok   %-52s\n", (desc));                                 \
        } else {                                                              \
            g_tests_failed++;                                                 \
            printf("  FALLO %-52s  esperado '%s', obtenido '%s' (%s:%d)\n",   \
                   (desc), _b ? _b : "(null)", _a ? _a : "(null)",            \
                   __FILE__, __LINE__);                                       \
        }                                                                     \
    } while (0)

#define SECTION(title) printf("\n[%s] %s\n", g_current_suite, (title))

/**
 * Vuelca un payload JSON generado por el firmware a out/messages/, anadiendo
 * la clave "_schema" que espera el validador de contratos. La suite de Python
 * lo valida despues contra el JSON Schema real.
 */
void dump_message(const char *schema, const char *name, const char *json);
/* Volcado para el contrato RECONCILIADO (ADR-0007). Ver main.c. */
void dump_message_adr0007(const char *schema, const char *name, const char *json);

int run_module_fsm(void);
int run_target_fsm(void);
int run_queue(void);
int run_idempotency(void);
int run_crosstalk(void);
int run_do_only(void);
int run_provisioning(void);
int run_command(void);
int run_reconnect(void);
int run_contract(void);
int run_coordination(void);
int run_led(void);
int run_ota(void);
int run_mqtt_endpoint(void);

#endif /* DIANA_TEST_UTIL_H */
