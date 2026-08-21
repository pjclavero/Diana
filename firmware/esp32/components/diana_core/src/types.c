#include "diana/types.h"

#include <string.h>

#define STR_TABLE(fn, type, ...)                                    \
    static const char *const fn##_tab[] = {__VA_ARGS__};            \
    const char *fn(type v)                                          \
    {                                                               \
        if ((int)v < 0 || (size_t)v >= sizeof(fn##_tab) / sizeof(fn##_tab[0])) \
            return "";                                              \
        return fn##_tab[v];                                         \
    }

STR_TABLE(diana_target_state_str, diana_target_state,
          "off", "safe", "active", "hit", "countdown", "penalty", "error",
          "calibration", "locked", "sensor_error", "maintenance", "disabled")

STR_TABLE(diana_module_state_str, diana_module_state,
          "boot", "selftest", "network", "registering", "ready", "calibration",
          "maintenance", "game_prepare", "game_countdown", "game_active",
          "game_paused", "game_finished", "error")

STR_TABLE(diana_hit_classification_str, diana_hit_classification,
          "valid_hit", "hit_on_safe", "hit_on_already_hit", "out_of_order",
          "crosstalk_rejected", "ambiguous", "during_pause", "calibration_hit",
          "early_shot")

STR_TABLE(diana_selector_str, diana_selector_position,
          "SATELITE", "AUTO", "PRINCIPAL")

STR_TABLE(diana_role_str, diana_module_role,
          "principal", "satellite", "auto")

/* ADR-0007. Literales copiados de contracts/mqtt/hit-event.schema.json
 * (properties.detection_method.enum). Si divergen, el test de conformidad de
 * enumerados lo detecta. */
STR_TABLE(diana_detection_method_str, diana_detection_method,
          "analog_envelope", "digital_threshold")

STR_TABLE(diana_diagnostic_kind_str, diana_diagnostic_kind,
          "boot", "reset_reason", "sensor_error", "led_chain_error",
          "low_voltage", "over_temperature", "queue_overflow", "mqtt_disconnect",
          "calibration_result", "self_test_result", "schema_rejected",
          "command_rejected", "ota_result")

STR_TABLE(diana_severity_str, diana_severity,
          "info", "warning", "error", "critical")

STR_TABLE(diana_command_action_str, diana_command_action,
          "identify", "set_targets", "set_all_targets", "reboot",
          "start_calibration", "abort_calibration", "self_test", "led_test",
          "flush_queue", "set_maintenance", "clear_error")

STR_TABLE(diana_command_result_str, diana_command_result,
          "accepted", "rejected", "expired", "duplicate", "failed")

STR_TABLE(diana_presence_reason_str, diana_presence_reason,
          "connect", "shutdown", "lwt")

STR_TABLE(diana_ota_action_str, diana_ota_action,
          "update", "confirm", "rollback", "cancel")

STR_TABLE(diana_issuer_str, diana_issuer,
          "backend", "coordinator", "operator-cli")

STR_TABLE(diana_reset_reason_str, diana_reset_reason,
          "unknown", "poweron", "software", "panic", "watchdog", "brownout",
          "ota")

static int parse_in(const char *const *tab, int n, const char *s, int *out)
{
    if (!s || !out) return -1;
    for (int i = 0; i < n; ++i) {
        if (strcmp(tab[i], s) == 0) {
            *out = i;
            return 0;
        }
    }
    return -1;
}

int diana_target_state_parse(const char *s, diana_target_state *out)
{
    int v = 0;
    if (parse_in(diana_target_state_str_tab, DIANA_TARGET_STATE_COUNT, s, &v) != 0)
        return -1;
    *out = (diana_target_state)v;
    return 0;
}

int diana_command_action_parse(const char *s, diana_command_action *out)
{
    int v = 0;
    if (parse_in(diana_command_action_str_tab, DIANA_CMD_ACTION_COUNT, s, &v) != 0)
        return -1;
    *out = (diana_command_action)v;
    return 0;
}

int diana_issuer_parse(const char *s, diana_issuer *out)
{
    int v = 0;
    if (parse_in(diana_issuer_str_tab, DIANA_ISSUER_COUNT, s, &v) != 0) return -1;
    *out = (diana_issuer)v;
    return 0;
}

int diana_ota_action_parse(const char *s, diana_ota_action *out)
{
    int v = 0;
    if (parse_in(diana_ota_action_str_tab, DIANA_OTA_ACTION_COUNT, s, &v) != 0)
        return -1;
    *out = (diana_ota_action)v;
    return 0;
}

diana_module_role diana_role_from_selector(diana_selector_position sel)
{
    switch (sel) {
    case DIANA_SELECTOR_PRINCIPAL: return DIANA_ROLE_PRINCIPAL;
    case DIANA_SELECTOR_SATELITE:  return DIANA_ROLE_SATELLITE;
    default:                       return DIANA_ROLE_AUTO;
    }
}
