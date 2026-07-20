/**
 * @file sha256.h
 * @brief SHA-256 portable, usado para verificar la imagen OTA.
 *
 * En ESP32 podria delegarse en mbedtls, pero se mantiene una implementacion
 * propia para que la logica de verificacion OTA sea ejecutable y comprobable en
 * host sin ESP-IDF. Verificada contra los vectores de prueba de FIPS 180-4 en
 * test_ota.c.
 */
#ifndef DIANA_SHA256_H
#define DIANA_SHA256_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint32_t state[8];
    uint64_t bitlen;
    uint8_t  buf[64];
    size_t   buflen;
} diana_sha256;

void diana_sha256_init(diana_sha256 *c);
void diana_sha256_update(diana_sha256 *c, const void *data, size_t len);
void diana_sha256_final(diana_sha256 *c, uint8_t out[32]);

/** Calcula el hash y lo escribe en hex minusculas (64 chars + NUL). */
void diana_sha256_hex(const void *data, size_t len, char out[65]);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_SHA256_H */
