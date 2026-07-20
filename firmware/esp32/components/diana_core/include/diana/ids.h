/**
 * @file ids.h
 * @brief Generacion de identificadores conforme a common.schema.json.
 *
 * ADR-0003: event_id es UUIDv4 o ULID y lo genera el modulo que DETECTA el
 * impacto, no el coordinador ni el backend. boot_id es un UUIDv4 nuevo en cada
 * arranque.
 */
#ifndef DIANA_IDS_H
#define DIANA_IDS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Genera un UUIDv4 en minusculas (36 chars + NUL). out debe tener >= 37. */
void diana_uuid4(const diana_hal *hal, char out[DIANA_UUID_LEN]);

/** Genera un ULID (26 chars Crockford base32 + NUL). out debe tener >= 27. */
void diana_ulid(const diana_hal *hal, uint64_t time_ms, char out[27]);

/** Comprueba el patron uuid de common.schema.json. */
bool diana_is_uuid(const char *s);
/** Comprueba el patron eventId (uuid o ULID). */
bool diana_is_event_id(const char *s);
/** Comprueba el patron identifier: ^[a-z0-9][a-z0-9-]{2,62}$ */
bool diana_is_identifier(const char *s);
/** Comprueba el patron semver del contrato. */
bool diana_is_semver(const char *s);
/** Comprueba el patron sha256: 64 hex minusculas. */
bool diana_is_sha256_hex(const char *s);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_IDS_H */
