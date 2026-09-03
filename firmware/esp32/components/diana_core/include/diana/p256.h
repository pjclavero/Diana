/**
 * @file p256.h
 * @brief Verificacion ECDSA sobre P-256 (secp256r1) con SHA-256, portable.
 *
 * El dispositivo VERIFICA, nunca firma: aqui no hay generacion de claves ni de
 * firmas a proposito. Una clave privada de aprovisionamiento no tiene por que
 * existir jamas en el firmware, y no existe.
 *
 * El algoritmo es FIJO. No hay selector por identificador de algoritmo, ni
 * tabla de "algoritmos soportados": el unico admitido es
 * ECDSA-P256-SHA256-P1363-B64URL y quien reciba otro literal debe rechazar el
 * mensaje ANTES de llegar aqui (diana_prov_* lo hace). Un verificador que
 * elija curva o digest a partir de un campo del propio mensaje deja que el
 * atacante degrade el algoritmo.
 *
 * Implementacion propia y portable (aritmetica de Montgomery de 32 bits) para
 * que la logica sea ejecutable y comprobable EN HOST sin ESP-IDF, igual que
 * diana_sha256. No pretende ser resistente a canal lateral: todo lo que
 * procesa es publico (firma, clave publica y mensaje), no hay ningun secreto
 * en juego en esta ruta.
 */
#ifndef DIANA_P256_H
#define DIANA_P256_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Longitud de la firma en representacion P1363 cruda: r||s, 32+32 bytes. */
#define DIANA_P256_SIG_LEN 64
/** Clave publica en punto no comprimido SEC1: 0x04 || X(32) || Y(32). */
#define DIANA_P256_PUBKEY_LEN 65
/** Longitud del digest SHA-256. */
#define DIANA_P256_DIGEST_LEN 32

/**
 * Verifica una firma ECDSA P-256 sobre un digest SHA-256 ya calculado.
 *
 * @param pubkey  65 bytes, punto no comprimido SEC1 (0x04||X||Y). Se comprueba
 *                que este realmente en la curva: aceptar un punto fuera de la
 *                curva es una via conocida de falsificacion.
 * @param digest  32 bytes de SHA-256 del mensaje canonico.
 * @param sig     64 bytes P1363 (r||s en big-endian, sin DER).
 * @return true SOLO si la firma es valida. Cualquier anomalia (punto invalido,
 *         r o s fuera de [1, n-1], longitudes malas) devuelve false: fallo
 *         CERRADO, nunca "no se pudo comprobar, se acepta".
 */
/**
 * Invocaciones acumuladas del verificador (ambas puertas publicas).
 *
 * Sirve para que "aqui NO se verifica nada" sea una afirmacion falsable en vez
 * de una marca de traza. Solo lectura; no influye en ninguna decision.
 */
uint64_t diana_p256_verify_calls(void);
void     diana_p256_verify_calls_reset(void);

bool diana_p256_verify(const uint8_t pubkey[DIANA_P256_PUBKEY_LEN],
                       const uint8_t digest[DIANA_P256_DIGEST_LEN],
                       const uint8_t sig[DIANA_P256_SIG_LEN]);

/**
 * Igual que diana_p256_verify pero calculando el SHA-256 del mensaje.
 * Es la entrada que usa el aprovisionamiento: el mensaje es la CADENA CANONICA
 * completa, no el JSON recibido.
 */
bool diana_p256_verify_message(const uint8_t pubkey[DIANA_P256_PUBKEY_LEN],
                               const void *msg, size_t msg_len,
                               const uint8_t sig[DIANA_P256_SIG_LEN]);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_P256_H */
