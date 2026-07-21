# Evidencia · firmware / OTA

## Verificacion de firma: delegada al HAL, y el HAL delega en ESP-IDF
```
    diana_sha256_hex(image, image_len, hex);
    if (strcmp(hex, fw->sha256) != 0) return reject(ota, DIANA_OTA_REJ_SHA256);

    /* 6. Firma. Sin implementacion de firma NO se activa: fallar cerrado. */
    if (!ota->hal || !ota->hal->ota_verify_signature)
        return reject(ota, DIANA_OTA_REJ_SIGNATURE);
    if (ota->hal->ota_verify_signature(ota->hal->ctx, image, image_len,
                                       fw->signature) != DIANA_HAL_OK)
        return reject(ota, DIANA_OTA_REJ_SIGNATURE);

    ota->state = DIANA_OTA_VERIFIED;

    /* 7. Solo ahora se marca arrancable la particion inactiva. */
    if (!ota->hal->ota_activate ||
        ota->hal->ota_activate(ota->hal->ctx) != DIANA_HAL_OK)
        return reject(ota, DIANA_OTA_REJ_ACTIVATE_FAILED);
--- ota_esp.c ---

int diana_pf_ota_verify_signature(void *ctx, const uint8_t *image, size_t len,
                                  const char *signature_b64)
{
    (void)ctx; (void)image; (void)len; (void)signature_b64;

    /* La firma la verifica el propio ESP-IDF con la clave publica embebida en
     * el bootloader (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT). No se
     * reimplementa aqui la criptografia: hacerlo seria un error de seguridad.
     *
     * esp_ota_end() falla con ESP_ERR_OTA_VALIDATE_FAILED si la firma o el
     * formato no son validos, de modo que la verificacion ocurre ANTES de que
     * se pueda marcar la particion como arrancable. */
    const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
    if (!next) {
        ESP_LOGE(TAG, "no hay particion OTA de destino");
        return DIANA_HAL_ERR_GENERIC;
    }

    esp_partition_pos_t pos = {.offset = next->address, .size = next->size};
    esp_image_metadata_t meta;
    /* ESP_IMAGE_VERIFY comprueba cabecera, checksum y, con firma activada, la
     * firma de la imagen. */
    if (esp_image_verify(ESP_IMAGE_VERIFY, &pos, &meta) != ESP_OK) {
        ESP_LOGE(TAG, "la imagen descargada NO supera la verificacion");
        return DIANA_HAL_ERR_INVALID;
    }
    return DIANA_HAL_OK;
}

int diana_pf_ota_activate(void *ctx)
```

## sdkconfig.defaults: firma activada, pero NUNCA compilado (aviso del propio fichero)
```
# Valores por defecto de ESP-IDF para Diana (ESP32-S3 + W5500).
# Se aplican con `idf.py set-target esp32s3 && idf.py build`.
#
# NOTA: este fichero NO se ha podido validar con un build real de ESP-IDF en el
# entorno donde se escribio (no hay toolchain instalado). Ver README.md.

46:CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT=y
47:CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y
48:CONFIG_SECURE_BOOT_SIGNING_KEY="secure_boot_signing_key.pem"
51:CONFIG_NVS_ENCRYPTION=y
```

## Caducidad de comandos y aceptacion sin reloj
```
    /* --- 7. Caducidad ------------------------------------------------------
     * Guarda monotonica local: retraso del PROPIO firmware desde que recibio el
     * mensaje. Adicional, nunca la unica (ver cabecera). */
    uint64_t held_us = (clock->now_us >= clock->recv_us)
                           ? (clock->now_us - clock->recv_us)
                           : 0;
    if (held_us > (uint64_t)cmd->expires_in_ms * 1000ULL) {
        g->rejected_expired++;
        char d[121];
        snprintf(d, sizeof(d), "retenido %llu ms en el modulo > expires_in_ms %u",
                 (unsigned long long)(held_us / 1000ULL),
                 (unsigned)cmd->expires_in_ms);
        return verdict(DIANA_CMD_RESULT_EXPIRED, d);
    }

    bool clock_ok = (clock->epoch_ms > 0);
    if (clock_ok) {
        /* Emitido en el futuro: reloj descuadrado o sobre falsificado. */
        if (cmd->issued_at_ms > clock->epoch_ms + DIANA_CLOCK_SKEW_TOLERANCE_MS) {
            g->rejected_skew++;
            char d[121];
            snprintf(d, sizeof(d),
                     "issued_at_ms %llu ms en el futuro respecto al modulo",
                     (unsigned long long)(cmd->issued_at_ms - clock->epoch_ms));
            return verdict(DIANA_CMD_RESULT_REJECTED, d);
        }
        uint64_t age_ms = (clock->epoch_ms > cmd->issued_at_ms)
                              ? (clock->epoch_ms - cmd->issued_at_ms)
                              : 0;
        if (age_ms > (uint64_t)cmd->expires_in_ms) {
            g->rejected_expired++;
            char d[121];
            snprintf(d, sizeof(d),
                     "caducado: %llu ms desde issued_at_ms > expires_in_ms %u",
                     (unsigned long long)age_ms, (unsigned)cmd->expires_in_ms);
            return verdict(DIANA_CMD_RESULT_EXPIRED, d);
        }
    }

    /* --- 8. Aceptado: consume y PERSISTE el nonce -------------------------- */
    g->last_nonce[cmd->issuer] = cmd->nonce;
    g->nonce_seen[cmd->issuer] = true;
    persist_nonces(g);
    remember(g, cmd->command_id);
    g->accepted++;

    if (!clock_ok) {
        g->accepted_without_clock++;
        /* Se dice lo que NO se ha comprobado. El backend lo ve en
         * module/…/status.last_command.detail. */
        return verdict(DIANA_CMD_RESULT_ACCEPTED,
                       "caducidad no verificada: sin hora sincronizada; "
                       "defensa por nonce persistido");
    }
    return verdict(DIANA_CMD_RESULT_ACCEPTED, NULL);
```
