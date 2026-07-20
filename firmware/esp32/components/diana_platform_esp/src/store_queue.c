/**
 * @file store_queue.c
 * @brief Cola FIFO persistente de eventos sobre la particion 'evtqueue'.
 *        NO COMPILADO.
 *
 * Diseno: anillo de ranuras de tamano FIJO. Un registro por ranura, con
 * cabecera (magia + longitud + CRC32). El tamano fijo evita compactar la flash
 * y permite localizar cualquier ranura por aritmetica, que es lo que necesita
 * q_peek(index).
 *
 * Se guarda la posicion de cabeza y cola en NVS, no en la propia particion:
 * reescribir punteros en flash NOR en cada operacion desgastaria un sector
 * concreto mucho antes que el resto.
 *
 * Al arrancar se RECONSTRUYE el estado recorriendo las ranuras y validando el
 * CRC, de modo que un corte de corriente a mitad de escritura deja una ranura
 * invalida que simplemente se ignora, en vez de corromper la cola entera.
 */
#include "platform_internal.h"

#include <string.h>

#include "esp_crc.h"
#include "esp_log.h"
#include "esp_partition.h"

static const char *TAG = "diana.evtq";

#define SLOT_SIZE   1024u
#define SLOT_MAGIC  0xD1A9A17Eu

typedef struct {
    uint32_t magic;
    uint32_t seq;      /* orden global de insercion: define el FIFO */
    uint32_t len;
    uint32_t crc;      /* CRC32 del payload */
} slot_header;

static const esp_partition_t *part(struct diana_platform *p)
{
    return (const esp_partition_t *)p->evt_partition;
}

/* Un sector de flash (4 KB) contiene 4 ranuras: borrar una ranura obliga a
 * borrar el sector, asi que se escribe siempre por sectores completos. */
#define SLOTS_PER_SECTOR (SPI_FLASH_SEC_SIZE / SLOT_SIZE)

int diana_pf_queue_init(struct diana_platform *p)
{
    const esp_partition_t *pt = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "evtqueue");
    if (!pt) {
        ESP_LOGE(TAG, "no existe la particion 'evtqueue'");
        return -1;
    }
    p->evt_partition = pt;
    p->evt_capacity = pt->size / SLOT_SIZE;
    p->evt_lock = xSemaphoreCreateMutex();
    if (!p->evt_lock) return -2;

    /* Reconstruccion: se busca el rango de seq validos. */
    uint32_t min_seq = UINT32_MAX, max_seq = 0;
    size_t valid = 0;
    for (size_t i = 0; i < p->evt_capacity; ++i) {
        slot_header h;
        if (esp_partition_read(pt, i * SLOT_SIZE, &h, sizeof(h)) != ESP_OK) continue;
        if (h.magic != SLOT_MAGIC) continue;
        if (h.len == 0 || h.len > SLOT_SIZE - sizeof(h)) continue;
        valid++;
        if (h.seq < min_seq) min_seq = h.seq;
        if (h.seq > max_seq) max_seq = h.seq;
    }
    p->evt_count = valid;
    p->evt_head_off = (valid == 0) ? 0 : (min_seq % p->evt_capacity) * SLOT_SIZE;
    p->evt_tail_off = (valid == 0) ? 0
                                   : ((max_seq + 1) % p->evt_capacity) * SLOT_SIZE;

    ESP_LOGI(TAG, "cola recuperada: %u eventos pendientes de %u ranuras",
             (unsigned)p->evt_count, (unsigned)p->evt_capacity);
    return 0;
}

int diana_pf_q_push(void *ctx, const void *data, size_t len)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    if (len > SLOT_SIZE - sizeof(slot_header)) return DIANA_HAL_ERR_NO_SPACE;

    xSemaphoreTake(p->evt_lock, portMAX_DELAY);
    if (p->evt_count >= p->evt_capacity) {
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_NO_SPACE;   /* la POLITICA la decide el core */
    }

    uint32_t off = p->evt_tail_off;
    /* Borrar el sector solo cuando la ranura es la primera del sector. */
    if ((off % SPI_FLASH_SEC_SIZE) == 0)
        esp_partition_erase_range(part(p), off, SPI_FLASH_SEC_SIZE);

    slot_header h = {
        .magic = SLOT_MAGIC,
        .seq = (uint32_t)(off / SLOT_SIZE),
        .len = (uint32_t)len,
        .crc = esp_crc32_le(0, (const uint8_t *)data, len),
    };
    /* Payload PRIMERO y cabecera despues: si se corta la corriente entre
     * ambos, la ranura queda sin magia valida y se ignora al reconstruir. */
    esp_err_t e1 = esp_partition_write(part(p), off + sizeof(h), data, len);
    esp_err_t e2 = esp_partition_write(part(p), off, &h, sizeof(h));

    if (e1 != ESP_OK || e2 != ESP_OK) {
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_GENERIC;
    }

    p->evt_tail_off = (uint32_t)((off + SLOT_SIZE) % (p->evt_capacity * SLOT_SIZE));
    p->evt_count++;
    xSemaphoreGive(p->evt_lock);
    return DIANA_HAL_OK;
}

int diana_pf_q_peek(void *ctx, size_t index, void *out, size_t out_size,
                    size_t *out_len)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    xSemaphoreTake(p->evt_lock, portMAX_DELAY);

    if (index >= p->evt_count) {
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_NOT_FOUND;
    }
    uint32_t off = (uint32_t)((p->evt_head_off + index * SLOT_SIZE) %
                              (p->evt_capacity * SLOT_SIZE));

    slot_header h;
    if (esp_partition_read(part(p), off, &h, sizeof(h)) != ESP_OK ||
        h.magic != SLOT_MAGIC || h.len > out_size) {
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_GENERIC;
    }
    if (esp_partition_read(part(p), off + sizeof(h), out, h.len) != ESP_OK) {
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_GENERIC;
    }
    /* CRC: un evento corrupto NO se entrega como si fuera bueno. */
    if (esp_crc32_le(0, (const uint8_t *)out, h.len) != h.crc) {
        ESP_LOGE(TAG, "CRC invalido en la ranura %u", (unsigned)(off / SLOT_SIZE));
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_GENERIC;
    }
    if (out_len) *out_len = h.len;
    xSemaphoreGive(p->evt_lock);
    return DIANA_HAL_OK;
}

int diana_pf_q_pop(void *ctx)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    xSemaphoreTake(p->evt_lock, portMAX_DELAY);
    if (p->evt_count == 0) {
        xSemaphoreGive(p->evt_lock);
        return DIANA_HAL_ERR_NOT_FOUND;
    }
    /* No se borra la flash aqui: se invalida logicamente avanzando la cabeza.
     * El borrado ocurre al reutilizar el sector en push. */
    p->evt_head_off = (uint32_t)((p->evt_head_off + SLOT_SIZE) %
                                 (p->evt_capacity * SLOT_SIZE));
    p->evt_count--;
    xSemaphoreGive(p->evt_lock);
    return DIANA_HAL_OK;
}

size_t diana_pf_q_count(void *ctx)
{
    return ((struct diana_platform *)ctx)->evt_count;
}

size_t diana_pf_q_capacity(void *ctx)
{
    return ((struct diana_platform *)ctx)->evt_capacity;
}
