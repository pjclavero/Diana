/**
 * @file topic_route.h
 * @brief Enrutado EXACTO de topicos entrantes (arbol v1.2, ADR-0008).
 *
 * POR QUE EXISTE ESTE FICHERO. El despacho de mensajes entrantes vivia en
 * main/app_commands.c y emparejaba por SUBCADENA:
 *
 *     if (strstr(rx->topic, "/command")) { ... canal de juego ... }
 *
 * `strstr` no distingue un sufijo de una aparicion en medio. Con esa regla
 * `targets/v1/module/m1/maintenance/command` --el canal EXCLUSIVO del backend
 * (contrato v1.1)-- entraba por el handler del canal de juego, porque
 * "/maintenance/command" CONTIENE "/command". Lo mismo le pasaba a cualquier
 * topico futuro terminado en "/ota" o que contuviese "/config/desired".
 * Colision silenciosa: nada falla, simplemente el mensaje lo atiende quien no
 * debe, y la separacion de autoridad por dominio deja de existir.
 *
 * Aqui el emparejado es una TABLA CONTRACTUAL, espejo de `parseTopic()` en
 * server/backend/src/contracts/topics.ts: se parte el topico en
 * `targets/v1/<ambito>/<id>/<cola>` y la cola se compara ENTERA con strcmp.
 * Un topico que no este en la tabla es DESCONOCIDO, nunca "parecido a".
 *
 * Vive en diana_core y no en main/ por la misma razon que mqtt_endpoint.c:
 * main/ NO se compila en la suite de host, asi que una regla escrita alli es
 * infalsable. Aqui se puede ejecutar contra los seis casos del contrato y
 * poner ROJA la suite si alguien vuelve a `strstr`.
 */
#ifndef DIANA_TOPIC_ROUTE_H
#define DIANA_TOPIC_ROUTE_H

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Cabe un module_id/system_id completo (identifier de hasta 63 chars). */
#define DIANA_ROUTE_ID_BUF 64

/**
 * Un valor por cada TopicKind del contrato v1.2. La correspondencia con
 * `TopicKind` de topics.ts es 1:1 A PROPOSITO: dos tablas que dicen cosas
 * distintas son peor que una sola incompleta.
 */
typedef enum {
    DIANA_ROUTE_UNKNOWN = 0,          /**< no pertenece al contrato v1 */
    DIANA_ROUTE_SYSTEM_STATUS,
    DIANA_ROUTE_SYSTEM_COMMAND,
    DIANA_ROUTE_GAME_STATE,
    DIANA_ROUTE_GAME_EVENT,
    DIANA_ROUTE_MODULE_PRESENCE,
    DIANA_ROUTE_MODULE_STATUS,
    DIANA_ROUTE_MODULE_TELEMETRY,
    DIANA_ROUTE_MODULE_CONFIG_DESIRED,
    DIANA_ROUTE_MODULE_CONFIG_REPORTED,
    DIANA_ROUTE_MODULE_COMMAND,               /**< canal de JUEGO */
    DIANA_ROUTE_MODULE_MAINTENANCE_COMMAND,   /**< canal EXCLUSIVO del backend */
    DIANA_ROUTE_MODULE_HIT,
    DIANA_ROUTE_MODULE_DIAGNOSTIC,
    DIANA_ROUTE_MODULE_OTA,
    DIANA_ROUTE_MODULE_PROVISION_COMMAND,     /**< plano DEVICE_MANAGEMENT */
    DIANA_ROUTE_MODULE_PROVISION_STATE,
    DIANA_ROUTE_COUNT
} diana_topic_route_kind;

/**
 * Clasifica `topic` contra la tabla del contrato.
 *
 * @param id_out  si no es NULL, recibe el `module_id`/`system_id` del topico.
 *                Queda a "" cuando el resultado es DIANA_ROUTE_UNKNOWN: un id
 *                extraido de un topico que no conocemos no significa nada.
 * @return el TopicKind, o DIANA_ROUTE_UNKNOWN. NUNCA devuelve una coincidencia
 *         aproximada: la cola se compara entera.
 */
diana_topic_route_kind diana_topic_route(const char *topic,
                                         char *id_out, size_t id_cap);

/** Nombre de contrato del TopicKind (identico a topics.ts). NULL si desconocido. */
const char *diana_topic_route_str(diana_topic_route_kind k);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_TOPIC_ROUTE_H */
