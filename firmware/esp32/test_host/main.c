/**
 * @file main.c
 * @brief Runner de la suite de pruebas en host.
 *
 * Compila y ejecuta TODA la logica del firmware con gcc, sin ESP-IDF ni
 * hardware. Salida: recuento de comprobaciones y codigo de salida 0/1.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "test_util.h"

int g_tests_run = 0;
int g_tests_failed = 0;
const char *g_current_suite = "?";

static const char *out_dir(void)
{
    const char *d = getenv("DIANA_MSG_DIR");
    return d ? d : "out/messages";
}

void dump_message(const char *schema, const char *name, const char *json)
{
    const char *dir = out_dir();
    mkdir(dir, 0777);

    char path[512];
    snprintf(path, sizeof(path), "%s/%s.json", dir, name);
    FILE *f = fopen(path, "w");
    if (!f) {
        printf("  AVISO no se pudo escribir %s\n", path);
        return;
    }
    /* Inserta "_schema" al principio del objeto, como en contracts/examples. */
    const char *p = json;
    while (*p && *p != '{') ++p;
    fprintf(f, "{\"_schema\":\"%s\",", schema);
    fputs(p + 1, f);
    fputc('\n', f);
    fclose(f);
}

typedef struct {
    const char *name;
    int (*fn)(void);
} suite;

int main(void)
{
    const suite suites[] = {
        {"module_fsm",   run_module_fsm},
        {"target_fsm",   run_target_fsm},
        {"queue",        run_queue},
        {"idempotency",  run_idempotency},
        {"crosstalk",    run_crosstalk},
        {"command",      run_command},
        {"reconnect",    run_reconnect},
        {"coordination", run_coordination},
        {"led",          run_led},
        {"ota",          run_ota},
        {"contract",     run_contract},
    };
    const size_t n = sizeof(suites) / sizeof(suites[0]);

    printf("=======================================================\n");
    printf(" Diana · suite de firmware en HOST (sin ESP-IDF, sin HW)\n");
    printf("=======================================================\n");

    for (size_t i = 0; i < n; ++i) {
        printf("\n--- suite: %s ---\n", suites[i].name);
        suites[i].fn();
    }

    printf("\n=======================================================\n");
    printf(" TOTAL: %d comprobaciones, %d correctas, %d fallidas\n",
           g_tests_run, g_tests_run - g_tests_failed, g_tests_failed);
    printf("=======================================================\n");
    return g_tests_failed == 0 ? 0 : 1;
}
