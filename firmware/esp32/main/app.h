/**
 * @file app.h
 * @brief Estado de la aplicacion del modulo. NO COMPILADO (falta ESP-IDF).
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
} diana_app;

extern diana_app g_app;

/* Tareas (app_tasks.c). */
void diana_task_sensors(void *arg);
void diana_task_leds(void *arg);
void diana_task_network(void *arg);
void diana_task_telemetry(void *arg);

/* Publicacion de mensajes. */
void diana_publish_presence(diana_app *a, diana_presence_reason reason);
void diana_publish_status(diana_app *a);
/**
 * Publica un kind=command_rejected CORRELADO con la orden rechazada. Si
 * command_id no es un UUID valido, publica schema_rejected en su lugar: un
 * rechazo incorrelable no se disfraza de rechazo correlado.
 */
void diana_publish_command_rejected(diana_app *a, const char *command_id,
                                    diana_command_reject_reason reason,
                                    const char *message);

void diana_publish_diagnostic(diana_app *a, diana_diagnostic_kind kind,
                              diana_severity sev, const char *message);
void diana_publish_config_reported(diana_app *a);

/* Comandos entrantes (app_commands.c). */
void diana_handle_message(diana_app *a, const diana_platform_rx *rx);

#endif /* DIANA_APP_H */
