/**
 * @file json.h
 * @brief Emisor JSON minimo, sin malloc, para los payloads MQTT.
 *
 * Escribe sobre un buffer del llamante. Si el buffer se agota marca overflow y
 * todas las escrituras posteriores son no-op: el llamante comprueba con
 * diana_json_ok() antes de publicar. Nunca trunca en silencio un payload valido.
 */
#ifndef DIANA_JSON_H
#define DIANA_JSON_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char  *buf;
    size_t cap;
    size_t len;
    bool   overflow;
    bool   need_comma;
} diana_json;

void  diana_json_init(diana_json *j, char *buf, size_t cap);
bool  diana_json_ok(const diana_json *j);
size_t diana_json_len(const diana_json *j);

void diana_json_obj_open(diana_json *j);
void diana_json_obj_close(diana_json *j);
void diana_json_arr_open(diana_json *j);
void diana_json_arr_close(diana_json *j);

void diana_json_key(diana_json *j, const char *key);

void diana_json_str(diana_json *j, const char *key, const char *val);
void diana_json_int(diana_json *j, const char *key, int64_t val);
void diana_json_uint(diana_json *j, const char *key, uint64_t val);
void diana_json_bool(diana_json *j, const char *key, bool val);
void diana_json_null(diana_json *j, const char *key);
/** Numero decimal con 'decimals' cifras (para cpu_load_pct, neighbour_ratio). */
void diana_json_num(diana_json *j, const char *key, double val, int decimals);

/** Valores sueltos dentro de un array. */
void diana_json_arr_obj_open(diana_json *j);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_JSON_H */
