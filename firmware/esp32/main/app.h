/**
 * @file app.h
 * @brief Estado de la aplicacion del modulo.
 */
#ifndef DIANA_APP_H
#define DIANA_APP_H

#include "diana/command.h"
#include "diana/config.h"
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

    bool               identify_active;
    bool               identify_button_active;
    uint64_t           identify_until_us;

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
void diana_publish_config_reported(diana_app *a);

/* Comandos entrantes (app_commands.c). */
void diana_handle_message(diana_app *a, const diana_platform_rx *rx);

#endif /* DIANA_APP_H */
