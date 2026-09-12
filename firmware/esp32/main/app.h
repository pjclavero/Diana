/**
 * @file app.h
 * @brief Estado de la aplicacion del modulo.
 */
#ifndef DIANA_APP_H
#define DIANA_APP_H

#include "diana/command.h"
#include <stdatomic.h>

#include "diana/config.h"
#include "diana/coordinator.h"
#include "diana/event.h"
#include "diana/identity.h"
#include "diana/led.h"
#include "diana/messages.h"
#include "diana/module_fsm.h"
#include "diana/ota.h"
#include "diana/platform_esp.h"
#include "diana/provisioning.h"
#include "diana/topic_route.h"
#include "diana/queue.h"
#include "diana/sensors.h"
#include "diana/target_fsm.h"

#define DIANA_FIRMWARE_VERSION "0.1.0"

/** Plazo para confirmar una imagen OTA antes del rollback automatico. */
#define DIANA_OTA_CONFIRM_WINDOW_MS 120000

typedef struct {
    diana_hal          hal;
    diana_platform    *pf;

    diana_identity     id;
    diana_config       cfg;
    diana_module_fsm   fsm;
    diana_target_set   targets;
    diana_sensor_state sensors;
    diana_event_queue  queue;
    diana_command_guard guard;
    diana_ota          ota;

    diana_selector_position selector;
    diana_module_role  role;

    /* PUBLICACION DIFERIDA de module-status.
     *
     * La tarea de entradas DETECTA el cambio de selector pero NO publica: tiene
     * 3 KB de pila y gira cada 20 ms, y `esp_mqtt_client_publish` con QoS 1
     * puede bloquear. Publicar desde ahi tumbo la conexion en el banco --- el
     * broker echo al modulo por keepalive vencido ("has exceeded timeout") y
     * quedo en bucle de reconexion ---, y el status nunca llego a salir.
     *
     * Es el mismo patron que ya usan las suscripciones: se ANOTA la intencion y
     * la emite quien tiene contexto para hacerlo (la tarea de red, 8 KB).
     *
     * Atomica porque la escriben y la leen tareas distintas. COALESCE por
     * naturaleza: si el selector va y vuelve antes de publicar, se publica el
     * estado ACTUAL una sola vez --- no hay cola historica de posiciones que
     * reproducir, y no la queremos. */
    _Atomic bool       status_dirty;

    /* Estado del rol de COORDINADOR. Solo se usa si el selector estable es
     * PRINCIPAL; en SATELITE el modulo ni siquiera esta suscrito a la entrada. */
    diana_coordinator  coord;

    bool               identify_active;
    bool               identify_button_active;
    uint64_t           identify_until_us;

    /* Prueba de LED por diana (canal de mantenimiento, `led_test`).
     *
     * UN VENCIMIENTO POR DIANA, no un hueco global. El modelo anterior guardaba
     * un solo indice y un solo plazo, y eso producia tres defectos medidos en
     * el banco: encender D2 apagaba D1; apagar D1 apagaba en realidad la ultima
     * encendida, porque la rama de apagado borraba el hueco sin mirar que diana
     * se pedia; y el unico plazo era el de la ultima orden.
     *
     * Nada en el contrato dice que una prueba deba cancelar otra: cada
     * `led_test` lleva su `target_index` y su `duration_ms` y es independiente.
     *
     * 0 = esa diana no esta en prueba. */
    uint64_t           led_test_until_us[DIANA_TARGET_COUNT];

    /* ultimo comando, para module-status.last_command */
    bool               has_last_command;
    char               last_command_id[DIANA_UUID_LEN];
    diana_command_result last_command_result;
    char               last_command_detail[121];

    uint64_t           boot_us;
    uint32_t           mqtt_reconnects;

    char topic_hit[DIANA_TOPIC_MAXLEN];
    char topic_presence[DIANA_TOPIC_MAXLEN];
    char topic_status[DIANA_TOPIC_MAXLEN];
    char topic_telemetry[DIANA_TOPIC_MAXLEN];
    char topic_diagnostic[DIANA_TOPIC_MAXLEN];
    char topic_config_reported[DIANA_TOPIC_MAXLEN];
    /* D1b · plano DEVICE_MANAGEMENT firmado. Los DOS caminos existen desde
     * MP0-F.0 (ADR-0008, contrato v1.2): la ORDEN llega por
     * targets/v1/module/{id}/provision (suscrito en mqtt_client.c) y el ESTADO
     * de autoridad se publica retenido en .../provision/state. */
    char topic_provision_state[DIANA_TOPIC_MAXLEN];
    diana_prov_ctx prov;

} diana_app;

extern diana_app g_app;

/* Tareas (app_tasks.c). */
void diana_task_sensors(void *arg);
void diana_task_inputs(void *arg);
void diana_task_leds(void *arg);
void diana_task_network(void *arg);
void diana_task_telemetry(void *arg);

/* Publicacion de mensajes. */
void diana_publish_presence(diana_app *a, diana_presence_reason reason);
void diana_publish_status(diana_app *a);
/* Rechazo de comando CORRELADO con la orden que lo causo. Ver app_tasks.c:
 * sin un command_id valido no hay nada con que correlar y se emite
 * schema_rejected en vez de inventar un request_id. */
void diana_publish_command_rejected(diana_app *a, const char *command_id,
                                    diana_command_reject_reason reason,
                                    const char *message);

/* D1b: inicializa el contexto de autoridad desde NVS (fingerprint y root_key).
 * Sin root_key el modulo queda en FALLO CERRADO, que es lo correcto. */
void diana_prov_app_init(diana_app *a);

/* D1b: intercepta una orden de DEVICE_MANAGEMENT. Devuelve true si el mensaje
 * era suyo y ya ha sido tratado, para que no siga por el canal de juego. */
bool diana_prov_app_handle(diana_app *a, const diana_platform_rx *rx);

/* MP0-F.0 · ADR-0008. Publica module-provision-state RETENIDO. `cmd` puede ser
 * NULL cuando no hay orden que correlar (declaracion de arranque). NUNCA lleva
 * material secreto: ver NO_SECRET_IN_STATE. */
void diana_publish_provision_state(diana_app *a, const diana_prov_command *cmd,
                                   const diana_prov_outcome *out);

/* Declaracion NO solicitada del estado de autoridad al (re)conectar. Solo emite
 * si hay algo que declarar; en READY/PREPARED no publica nada. */
void diana_prov_app_announce(diana_app *a);

void diana_publish_diagnostic(diana_app *a, diana_diagnostic_kind kind,
                              diana_severity sev, const char *message);

/* VIA DE RETORNO del canal de mantenimiento (MODULE_DIAGNOSTICS_V1 · P0).
 *
 * Una orden de mantenimiento tiene que poder demostrar QUE HIZO. Hasta ahora el
 * modulo ejecutaba y solo publicaba `status` con `last_command`, que el backend
 * NO consume: el resultado no llegaba a ninguna parte y el panel se quedaba
 * esperando para siempre.
 *
 * Se publica `self_test_result` CORRELADO por request_id, que es el patron que
 * el simulador ya emitia y que el backend ya persiste en `incidents`. No se
 * inventa un kind nuevo: el contrato v1 no define `led_test_result` y P1 decidira
 * si hace falta.
 *
 * `target_index` 0 = la orden no era de una diana concreta. */
void diana_publish_maintenance_result(diana_app *a, const char *request_id,
                                      const char *component, int target_index,
                                      uint32_t duration_ms);
void diana_publish_config_reported(diana_app *a);

/* COORDINADOR · las dos publicaciones que emite un modulo PRINCIPAL.
 * `module/{id}/command` lleva las ordenes de juego a los modulos y
 * `system/{id}/game/state` declara la partida (RETENIDO, contrato). */
void diana_publish_module_command(diana_app *a, const diana_coord_plan *plan);
void diana_publish_game_state(diana_app *a, const diana_coord_plan *plan);

/* Comandos entrantes (app_commands.c). */
void diana_handle_message(diana_app *a, const diana_platform_rx *rx);

#endif /* DIANA_APP_H */
