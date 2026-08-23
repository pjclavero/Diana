/**
 * @file seq_guard.h
 * @brief Barrera antirrepetición epoch/sequence para corrientes autorizadas
 *        de comandos (separada de la idempotencia de respuesta por request_id).
 *
 * PROBLEMA RESUELTO
 * -----------------
 * Una lista de request_id (UUIDs) en NVS no es una barrera antirrepetición
 * real: en cuanto se llena expulsa una entrada viva y permite redespachar una
 * orden antigua. El modelo epoch/sequence cierra esa brecha sin necesidad de
 * almacenar identificadores completos.
 *
 * MODELO
 * ------
 * Cada corriente autorizada de comandos incluye tres campos:
 *   - command_epoch   (128 bits): identidad de la sesión de aprovisionamiento.
 *   - command_sequence (64 bits): contador estrictamente creciente dentro
 *                                 de esa sesión.
 *   - request_id      (existente): correlación e idempotencia de RESPUESTA
 *                                  (no barrera antirrepetición).
 *
 * Estado persistido en NVS (total ~816 bytes vs ~15,5 KB del modelo anterior):
 *   - epoch vigente              (16 bytes)
 *   - mayor secuencia aceptada   ( 8 bytes)
 *   - bitmap de ventana          (16 bytes = 128 bits)
 *   - caché de 32 resultados compactos (32 × 24 bytes = 768 bytes)
 *
 * REGLAS DE ACEPTACIÓN (máquina de estados)
 * ------------------------------------------
 * 1. sin epoch configurado               → DIANA_SEQ_REJECTED_NO_EPOCH
 * 2. epoch distinto al vigente           → DIANA_SEQ_REJECTED_EPOCH
 *    (el cambio de epoch solo ocurre por diana_seq_guard_reprovision())
 * 3. sequence > max_seq                  → DIANA_SEQ_ACCEPTED
 *    (nueva secuencia; actualiza max_seq y bitmap)
 * 4. offset = max_seq - sequence >= 128  → DIANA_SEQ_REJECTED_TOO_OLD
 * 5. offset < 128 y bit marcado          → DIANA_SEQ_DUPLICATE
 *    (la secuencia ya se procesó; responde con resultado de la caché)
 * 6. offset < 128 y bit NO marcado       → DIANA_SEQ_GAP_ACCEPTED
 *    (llegó fuera de orden; aceptado; bit marcado; entra en caché)
 *    *** Política documentada: ver comentario SEQ_POLICY_GAP más abajo. ***
 *
 * BITMAP
 * ------
 * 128 bits almacenados en uint8_t[16] en orden LSB-first:
 *   bit i de bitmap[i/8] = secuencia (max_seq - i)
 *   bit 0 (LSB de bitmap[0]) = max_seq (más reciente)
 *   bit 127 (MSB de bitmap[15]) = max_seq - 127 (más antigua en ventana)
 * Cuando max_seq avanza en delta:
 *   los bits se desplazan hacia índices mayores (más viejos),
 *   el bit 0 se pone a 1 (nueva secuencia aceptada),
 *   los bits que salen por el extremo superior se descartan.
 *
 * POLÍTICA DE HUECOS (SEQ_POLICY_GAP)
 * ------------------------------------
 * Un hueco dentro de la ventana (sequence dentro de [max_seq-127, max_seq-1]
 * sin bit marcado) representa un mensaje que llegó fuera de orden en tránsito.
 * Se acepta porque:
 *   a) El epoch verifica que pertenece a la corriente autorizada.
 *   b) Se marca el bit para que un replay posterior sea detectado como DUPLICATE.
 *   c) La ventana de 128 posiciones limita la antigüedad máxima tolerable.
 *
 * Riesgo aceptado: no se puede distinguir un reordenamiento legítimo de una
 * secuencia forjada dentro de la ventana. La defensa contra secuencias forjadas
 * dentro del rango de la ventana depende de la capa MQTT (TLS + ACLs de topic),
 * no del firmware solo. Esta limitación está reconocida explícitamente.
 *
 * Alternativa descartada: rechazar todos los huecos (exigir orden estricto).
 * Se descartó porque los brokers MQTT con QoS 1 pueden reordenar mensajes
 * durante la reconexión, lo que dejaría el firmware inoperante en escenarios
 * legítimos de red inestable.
 *
 * INVARIANTE CALIBRACIÓN A/B
 * --------------------------
 * El guardarrail seq_guard no reemplaza la comprobación de calibration_id en
 * diana_calibration_abort(): incluso si una secuencia pasa seq_guard, la capa
 * de calibración sigue rechazando un abort con calibration_id distinto al
 * activo. Ambas defensas son independientes y complementarias.
 *
 * Lógica portable: sin ESP-IDF. Testeable en host con gcc.
 */
#ifndef DIANA_SEQ_GUARD_H
#define DIANA_SEQ_GUARD_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

/* ================================================================= AMBITO
 * DECISION-PLANOS-DE-AUTORIDAD.md: la secuencia es monotonica dentro de
 *   system_id + authenticated_issuer + command_epoch + command_plane
 * y NO por tipo de orden. system_id no varia dentro de un modulo (un modulo
 * pertenece a una unica instalacion), asi que no se modela aqui de forma
 * explicita -- igual que en el simulador (seqGuard.ts, mismo razonamiento).
 *
 * Antes de esta revision, diana_seq_guard llevaba una UNICA ventana global
 * por dispositivo: un command_epoch/command_sequence de MANTENIMIENTO y uno
 * de JUEGO competian por el mismo max_seq/bitmap. Eso permite dos fallos:
 *   a) una operacion de mantenimiento puede agotar o desplazar la ventana
 *      del plano de juego (justo lo que el operador quiso evitar al exigir
 *      ambito por plano, no global);
 *   b) firmware y simulador dejan de coincidir en que aceptan/rechazan,
 *      justo en el mecanismo de seguridad de esta ronda.
 *
 * diana_seq_guard_set implementa el ambito real: una diana_seq_guard (sin
 * cambios de comportamiento respecto a la version anterior) POR CADA
 * combinacion (issuer, plane). Los tres planos son GAME, MAINTENANCE y
 * DEVICE_MANAGEMENT (diana_command_plane, types.h). */

/** Numero de planos. LITERAL, no derivado de DIANA_PLANE_COUNT: un mutante de
 * frontera no debe poder mover ambos lados a la vez (misma leccion que el
 * resto de limites de este fichero). Debe coincidir con DIANA_PLANE_COUNT;
 * el conjunto de conformidad de contrato es lo que ata ambos numeros. */
#define SEQ_GUARD_PLANE_COUNT 3

/** Numero de emisores posibles. LITERAL, ver comentario de arriba. Debe
 * coincidir con DIANA_ISSUER_COUNT. */
#define SEQ_GUARD_ISSUER_COUNT 3

#ifdef __cplusplus
extern "C" {
#endif

/* ----------------------------------------------------------------- constantes
 * IMPORTANTE: todos los límites son LITERALES, no derivados de otras constantes.
 * Un límite derivado (p.ej. SEQ_BITMAP_BYTES = SEQ_WINDOW / 8) permite que un
 * mutante de frontera (> → >=) modifique ambos lados a la vez y sobreviva.
 * Lección aprendida en el simulador de este mismo proyecto. */

/** Tamaño de la ventana de deduplicación en posiciones de secuencia. */
#define SEQ_GUARD_WINDOW    128

/** Tamaño del bitmap en bytes (128 / 8 = 16, fijado como literal). */
#define SEQ_GUARD_BM_BYTES   16

/** Número de entradas en la caché compacta de resultados. */
#define SEQ_GUARD_CACHE      32

/** Tamaño del epoch en bytes (128 bits / 8 = 16, fijado como literal). */
#define SEQ_GUARD_EPOCH_LEN  16

/** NVS namespace y clave para persistir el estado. */
#define DIANA_SEQ_NVS_NS    "diana_seq"
#define DIANA_SEQ_NVS_KEY   "state"

/* ------------------------------------------------------------------ tipos */

/** Resultado de diana_seq_guard_check(). */
typedef enum {
    DIANA_SEQ_ACCEPTED = 0,         /**< secuencia nueva, aceptada */
    DIANA_SEQ_GAP_ACCEPTED,         /**< hueco en ventana, fuera de orden, aceptado */
    DIANA_SEQ_DUPLICATE,            /**< secuencia ya procesada; resultado en caché */
    DIANA_SEQ_REJECTED_EPOCH,       /**< epoch no coincide con el vigente */
    DIANA_SEQ_REJECTED_TOO_OLD,     /**< secuencia demasiado antigua (fuera de ventana) */
    DIANA_SEQ_REJECTED_NO_EPOCH,    /**< no hay epoch configurado (sin provisionar) */
} diana_seq_result;

/**
 * Entrada compacta de la caché de resultados.
 * Permite responder a duplicados sin repetir efectos de negocio.
 * Tamaño: 24 bytes por entrada × 32 entradas = 768 bytes total.
 */
typedef struct {
    uint64_t sequence;              /**< número de secuencia de la solicitud */
    uint8_t  request_id_pfx[8];    /**< primeros 8 bytes del request_id (UUID sin guiones) */
    uint8_t  result_code;           /**< diana_command_result en uint8_t */
    bool     used;
    uint8_t  _pad[6];              /**< alineación a 8 bytes */
} diana_seq_cache_entry;            /* 24 bytes */

/**
 * Estado completo que se persiste en NVS.
 * Tamaño total (aproximado con alineación del compilador): ~816 bytes.
 *
 * Comparación con modelo anterior:
 *   diana_command_guard.ids[128][37]    = 4 736 bytes (lista de command_id)
 *   diana_calibration_guard.cache[128]  ≈ 10 688 bytes (cache de abort)
 *   TOTAL anterior                      ≈ 15 424 bytes (~15,5 KB)
 *
 *   diana_seq_state                     ≈   816 bytes (este módulo)
 *   Reducción                           ≈ 14 608 bytes (~94 % menos)
 */
typedef struct {
    uint8_t  epoch[16];                  /**< epoch vigente (128 bits) */
    uint64_t max_seq;                    /**< mayor secuencia aceptada */
    uint8_t  bitmap[16];                 /**< 128 bits: bit i = seq (max_seq − i) procesada */
    diana_seq_cache_entry cache[32];     /**< 32 entradas compactas (literal) */
    uint8_t  cache_next;                 /**< índice FIFO para la próxima escritura */
    bool     has_epoch;                  /**< false = sin epoch configurado (sin provisionar) */
    bool     has_seq;                    /**< false = ninguna secuencia aceptada todavía */
} diana_seq_state;

/**
 * Guarda completo (estado + HAL + contadores de diagnóstico).
 * No se persiste completo: solo diana_seq_state va a NVS.
 */
typedef struct {
    const diana_hal  *hal;
    diana_seq_state   state;

    /* Identifica la clave NVS de ESTA instancia cuando forma parte de un
     * diana_seq_guard_set (una guarda por (issuer, plane)). 0 = clave
     * historica DIANA_SEQ_NVS_KEY ("state"), compatible con el uso previo de
     * una guarda suelta (diana_seq_guard_init). No forma parte del estado
     * persistido: es routing hacia NVS, no dato de negocio. */
    uint8_t  nvs_slot;

    /* Contadores de diagnóstico (solo en RAM; se pierden al reiniciar). */
    uint32_t accepted;
    uint32_t gap_accepted;
    uint32_t duplicate_served;
    uint32_t rejected_epoch;
    uint32_t rejected_too_old;
    uint32_t rejected_no_epoch;
} diana_seq_guard;

/* ----------------------------------------------------------------- API */

/**
 * Inicializa la guarda y carga el estado desde NVS (si hal != NULL).
 * Con hal == NULL solo opera en memoria (útil para tests).
 */
void diana_seq_guard_init(diana_seq_guard *g, const diana_hal *hal);

/**
 * Igual que diana_seq_guard_init(), pero fija un slot NVS distinto de 0 para
 * que esta instancia persista en su PROPIA clave, independiente de otras
 * instancias que compartan hal. Usado por diana_seq_guard_set para que las
 * 9 combinaciones (issuer, plane) no se pisen en NVS.
 */
void diana_seq_guard_init_slot(diana_seq_guard *g, const diana_hal *hal,
                                uint8_t slot);

/**
 * Reprovisionamiento autenticado: cambia el epoch vigente y reinicia la
 * secuencia. SOLO debe llamarse desde la ruta de reprovisionamiento, NUNCA
 * desde el procesamiento de un command normal.
 *
 * Tras esta llamada:
 *   - epoch vigente = new_epoch
 *   - max_seq y bitmap reiniciados
 *   - caché reiniciada
 *   - has_seq = false (la primera secuencia nueva queda libre)
 */
void diana_seq_guard_reprovision(diana_seq_guard *g,
                                  const uint8_t new_epoch[16]);

/**
 * Evalúa un comando entrante según el modelo epoch/sequence.
 *
 * Parámetros:
 *   epoch        — epoch de 128 bits del comando entrante (array de 16 bytes)
 *   sequence     — número de secuencia del comando
 *   request_id   — request_id del comando (para la caché; puede ser NULL)
 *   out_cached   — si el resultado es DUPLICATE, se rellena con el resultado
 *                  guardado en caché (diana_command_result como uint8_t);
 *                  puede ser NULL si el llamante no lo necesita
 *
 * Si el resultado es ACCEPTED o GAP_ACCEPTED, el estado se persiste en NVS.
 * Si el resultado es DUPLICATE, no se persiste nada (sin efectos de estado).
 * Si el resultado es cualquier REJECTED, tampoco se persiste nada.
 */
diana_seq_result diana_seq_guard_check(diana_seq_guard *g,
                                       const uint8_t epoch[16],
                                       uint64_t sequence,
                                       const char *request_id,
                                       uint8_t *out_cached);

/**
 * Almacena explícitamente el resultado final de negocio en la caché.
 * Llamar después de diana_seq_guard_check() cuando el resultado real es
 * distinto de ACCEPTED (p.ej., si la lógica de negocio devolvió FAILED).
 *
 * Si el check devolvió DUPLICATE o REJECTED, no llamar a esta función.
 */
void diana_seq_guard_cache_result(diana_seq_guard *g,
                                   uint64_t sequence,
                                   const char *request_id,
                                   uint8_t result_code);

/** Mayor secuencia aceptada (para diagnóstico). */
uint64_t diana_seq_guard_max_seq(const diana_seq_guard *g);

/** true si hay epoch configurado. */
bool diana_seq_guard_has_epoch(const diana_seq_guard *g);

/* ============================================================ AMBITO REAL
 * (issuer, plane) -- ver comentario de cabecera de este fichero y
 * DECISION-PLANOS-DE-AUTORIDAD.md.
 *
 * Presupuesto de memoria (ver informe de la ronda para el detalle):
 *   sizeof(diana_seq_guard)      ~ 832 bytes  (antes: 816 de estado + resto RAM)
 *   diana_seq_guard_set          = SEQ_GUARD_ISSUER_COUNT * SEQ_GUARD_PLANE_COUNT
 *                                  guardas completas = 9 * sizeof(diana_seq_guard)
 * Cada combinacion persiste en su propia clave NVS (nvs_slot), asi que el
 * presupuesto en NVS crece proporcionalmente: 9 * sizeof(diana_seq_state).
 */
typedef struct {
    diana_seq_guard entry[SEQ_GUARD_ISSUER_COUNT][SEQ_GUARD_PLANE_COUNT];
} diana_seq_guard_set;

/**
 * Inicializa las 9 combinaciones (issuer, plane), cada una con su propio
 * slot NVS (issuer * SEQ_GUARD_PLANE_COUNT + plane, nunca 0 para que ninguna
 * coincida con el slot 0 reservado a diana_seq_guard_init() suelto).
 */
void diana_seq_guard_set_init(diana_seq_guard_set *set, const diana_hal *hal);

/**
 * Devuelve la guarda de UN ambito (issuer, plane). Nunca NULL para valores
 * validos de issuer/plane (0 <= issuer < DIANA_ISSUER_COUNT,
 * 0 <= plane < DIANA_PLANE_COUNT); fuera de rango devuelve NULL -- el
 * llamante ya habra rechazado el comando en diana_check_command_envelope()
 * antes de llegar aqui, asi que este caso es defensivo, no de negocio.
 */
diana_seq_guard *diana_seq_guard_set_entry(diana_seq_guard_set *set,
                                            diana_issuer issuer,
                                            diana_command_plane plane);

/* ====================================================== SOBRE OBLIGATORIO
 * "Sin modo heredado" (DECISION-PLANOS-DE-AUTORIDAD.md). Replica deliberada
 * del comportamiento de checkCommandEnvelope() del simulador (seqGuard.ts):
 * comprobacion PURA, sin estado, que debe ser la PRIMERA que ejecuta
 * cualquier manejador de comando -- antes de la cache de command_id, del
 * nonce, del reloj o de cualquier otra rama de la maquina de estados.
 */
typedef enum {
    DIANA_ENVELOPE_OK = 0,
    DIANA_ENVELOPE_RETAINED_REJECTED,     /* mensaje retenido: rechazo, ni se evalua */
    DIANA_ENVELOPE_MISSING,               /* falta epoch y/o sequence y/o plane */
    DIANA_ENVELOPE_WRONG_PLANE,           /* plane presente pero distinto del canal */
} diana_envelope_result;

/**
 * Comprobacion pura del sobre epoch/sequence/plane, SIN tocar ningun estado
 * (ni diana_seq_guard_set, ni la cache de command_id, ni el nonce).
 *
 * Parametros:
 *   has_epoch_seq   — false si falta command_epoch o command_sequence (o
 *                      ambos): en el contrato los dos son obligatorios a la
 *                      vez, igual que en missing-command-epoch.json y
 *                      missing-command-sequence.json (ambos invalidos).
 *   has_plane       — false si el campo command_plane no vino en el sobre.
 *   plane           — valor de command_plane si has_plane es true.
 *   expected_plane  — plano CONST de este canal (GAME en module/.../command,
 *                      MAINTENANCE en module/.../maintenance/command). El
 *                      firmware fija este valor por el canal por el que
 *                      llego el mensaje: NO se infiere del propio payload.
 *   retained        — true si el mensaje llego marcado RETAIN por el broker.
 *
 * Orden de las comprobaciones (retained primero, igual que el simulador):
 * un mensaje retenido "es viejo por construccion" y ni se evalua contra
 * epoch/sequence -- aceptarlo evaluado normalmente reproduciria una orden
 * ejecutable al reconectar.
 */
diana_envelope_result diana_check_command_envelope(bool has_epoch_seq,
                                                    bool has_plane,
                                                    diana_command_plane plane,
                                                    diana_command_plane expected_plane,
                                                    bool retained);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_SEQ_GUARD_H */
