/**
 * @file base64url.h
 * @brief base64url SIN relleno (RFC 4648 §5), que es como el contrato
 *        transporta firmas y claves publicas.
 *
 * Decodificador ESTRICTO: alfabeto '-'/'_' (nunca '+'/'/'), sin '=' de
 * relleno, sin espacios, sin saltos de linea y sin bits sobrantes distintos de
 * cero en el ultimo grupo. Un decodificador permisivo hace que dos cadenas
 * distintas produzcan los mismos bytes, y entonces "la firma es unica" deja de
 * ser cierto.
 */
#ifndef DIANA_BASE64URL_H
#define DIANA_BASE64URL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Decodifica `in` (terminada en NUL) sobre `out`.
 *
 * @param out_len  a la entrada, capacidad de `out`; a la salida, bytes escritos.
 * @return true si la cadena es base64url sin relleno VALIDA y cabe en `out`.
 *         false en cualquier otro caso; `out` queda sin definir y no debe
 *         usarse (fallo cerrado).
 */
bool diana_base64url_decode(const char *in, uint8_t *out, size_t *out_len);

/**
 * Codifica `len` bytes en base64url sin relleno. `out` debe tener sitio para
 * 4*ceil(len/3) + 1 caracteres. @return numero de caracteres escritos, o 0 si
 * no cabe.
 */
size_t diana_base64url_encode(const uint8_t *in, size_t len, char *out, size_t out_cap);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_BASE64URL_H */
