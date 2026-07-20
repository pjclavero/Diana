/**
 * @file test_ota.c
 * @brief OTA A/B: sha256, firma, rechazo durante partida y rollback.
 *
 * LIMITE CONOCIDO: la verificacion de FIRMA en host es un doble (el HAL decide
 * valida/invalida). Lo que se prueba aqui es el CAMINO de decision: que sin
 * firma valida no se activa nada, y que el orden de comprobaciones es el
 * correcto. La criptografia real la aporta el esquema de app firmada de
 * ESP-IDF y NO se ha podido ejecutar.
 */
#include <string.h>

#include "diana/ota.h"
#include "diana/sha256.h"
#include "hal_host.h"
#include "test_util.h"

static void ready_fsm(diana_module_fsm *f)
{
    diana_module_fsm_init(f, 0);
    diana_module_fsm_apply(f, DIANA_EV_SELFTEST_START, 0);
    diana_module_fsm_apply(f, DIANA_EV_SELFTEST_OK, 0);
    diana_module_fsm_apply(f, DIANA_EV_MQTT_CONNECTED, 0);
    diana_module_fsm_apply(f, DIANA_EV_REGISTERED, 0);
}

int run_ota(void)
{
    TEST_SUITE("ota");
    int before = g_tests_failed;

    SECTION("SHA-256 contra vectores de FIPS 180-4");
    char hex[65];
    diana_sha256_hex("", 0, hex);
    CHECK_EQ_STR(hex,
                 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                 "hash de la cadena vacia");
    diana_sha256_hex("abc", 3, hex);
    CHECK_EQ_STR(hex,
                 "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                 "hash de 'abc'");
    diana_sha256_hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", 56,
                     hex);
    CHECK_EQ_STR(hex,
                 "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
                 "hash del vector de 448 bits");

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 8);
    host_hal_init(&ctx, &nv, &hal, 11);

    static uint8_t image[4096];
    for (size_t i = 0; i < sizeof(image); ++i) image[i] = (uint8_t)(i * 7 + 3);
    char image_sha[65];
    diana_sha256_hex(image, sizeof(image), image_sha);

    diana_ota_firmware fw;
    memset(&fw, 0, sizeof(fw));
    snprintf(fw.version, sizeof(fw.version), "0.2.0");
    snprintf(fw.url, sizeof(fw.url), "http://192.168.1.209/firmware/diana-0.2.0.bin");
    fw.size_bytes = (uint32_t)sizeof(image);
    snprintf(fw.sha256, sizeof(fw.sha256), "%s", image_sha);
    snprintf(fw.signature, sizeof(fw.signature), "MEUCIQDexampleSignatureBase64==");
    snprintf(fw.target_board, sizeof(fw.target_board), "esp32s3-w5500-protoA");

    diana_ota ota;
    diana_module_fsm fsm;

    SECTION("PROHIBIDO actualizar durante una partida (dosier 13.6)");
    diana_ota_init(&ota, &hal, "esp32s3-w5500-protoA", "0.1.0", 60000);
    ready_fsm(&fsm);
    diana_module_fsm_apply(&fsm, DIANA_EV_GAME_PREPARE, 0);
    diana_module_fsm_apply(&fsm, DIANA_EV_GAME_COUNTDOWN, 0);
    diana_module_fsm_apply(&fsm, DIANA_EV_GAME_START, 0);
    diana_ota_result r = diana_ota_apply(&ota, &fsm, &fw, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_GAME_ACTIVE, "OTA rechazada con partida activa");
    CHECK_EQ_INT(ctx.activations, 0, "no se ha activado ninguna particion");
    printf("       motivo: %s\n", diana_ota_result_str(r));

    diana_module_fsm_apply(&fsm, DIANA_EV_GAME_PAUSE, 0);
    r = diana_ota_apply(&ota, &fsm, &fw, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_GAME_ACTIVE, "tambien rechazada con partida en pausa");
    CHECK_EQ_INT(ctx.activations, 0, "sigue sin activarse nada");

    SECTION("sha256 que no cuadra -> no se activa");
    ready_fsm(&fsm);
    diana_ota_init(&ota, &hal, "esp32s3-w5500-protoA", "0.1.0", 60000);
    diana_ota_firmware bad_hash = fw;
    snprintf(bad_hash.sha256, sizeof(bad_hash.sha256),
             "0000000000000000000000000000000000000000000000000000000000000000");
    r = diana_ota_apply(&ota, &fsm, &bad_hash, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_SHA256, "sha256 distinto rechazado");
    CHECK_EQ_INT(ctx.activations, 0, "sin activar");

    SECTION("imagen alterada un solo byte -> sha256 falla");
    image[2048] ^= 0x01;
    r = diana_ota_apply(&ota, &fsm, &fw, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_SHA256, "un bit cambiado invalida el hash");
    image[2048] ^= 0x01;

    SECTION("tamano distinto de size_bytes -> rechazado");
    r = diana_ota_apply(&ota, &fsm, &fw, image, sizeof(image) - 1, 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_SIZE, "tamano incorrecto rechazado");

    SECTION("placa distinta -> rechazado");
    diana_ota_firmware other_board = fw;
    snprintf(other_board.target_board, sizeof(other_board.target_board), "esp32c3-otra");
    r = diana_ota_apply(&ota, &fsm, &other_board, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_BOARD, "target_board distinto rechazado");

    SECTION("misma version instalada -> rechazado");
    diana_ota_firmware same = fw;
    snprintf(same.version, sizeof(same.version), "0.1.0");
    r = diana_ota_apply(&ota, &fsm, &same, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_SAME_VERSION, "reinstalar la misma version rechazado");

    SECTION("firma invalida -> NO se activa (fallo cerrado)");
    ctx.signature_valid = false;
    r = diana_ota_apply(&ota, &fsm, &fw, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_SIGNATURE, "firma invalida rechazada");
    CHECK_EQ_INT(ctx.activations, 0, "sin activar pese a sha256 correcto");

    SECTION("sin implementacion de verificacion de firma tampoco se activa");
    diana_hal no_sig = hal;
    no_sig.ota_verify_signature = NULL;
    diana_ota ota_ns;
    diana_ota_init(&ota_ns, &no_sig, "esp32s3-w5500-protoA", "0.1.0", 60000);
    r = diana_ota_apply(&ota_ns, &fsm, &fw, image, sizeof(image), 0);
    CHECK_EQ_INT(r, DIANA_OTA_REJ_SIGNATURE, "sin verificador de firma se rechaza");

    SECTION("camino feliz: verifica y queda pendiente de confirmacion");
    ctx.signature_valid = true;
    r = diana_ota_apply(&ota, &fsm, &fw, image, sizeof(image), 1000000);
    CHECK_EQ_INT(r, DIANA_OTA_OK, "OTA aceptada");
    CHECK_EQ_INT(ctx.activations, 1, "particion inactiva marcada arrancable");
    CHECK_EQ_INT(ota.state, DIANA_OTA_PENDING_CONFIRM, "queda pendiente de confirmar");

    SECTION("rollback automatico si no llega 'confirm' a tiempo");
    CHECK(!diana_ota_tick(&ota, 1000000 + 59000000ULL), "aun no vence el plazo");
    CHECK_EQ_INT(ctx.rollbacks, 0, "sin rollback todavia");
    CHECK(diana_ota_tick(&ota, 1000000 + 61000000ULL), "vencido el plazo: rollback");
    CHECK_EQ_INT(ctx.rollbacks, 1, "rollback ejecutado");
    CHECK_EQ_INT(ota.state, DIANA_OTA_IDLE, "estado reiniciado tras rollback");

    SECTION("'confirm' cancela el rollback automatico");
    diana_ota ota2;
    diana_ota_init(&ota2, &hal, "esp32s3-w5500-protoA", "0.1.0", 60000);
    ctx.rollbacks = 0;
    r = diana_ota_apply(&ota2, &fsm, &fw, image, sizeof(image), 2000000);
    CHECK_EQ_INT(r, DIANA_OTA_OK, "OTA aceptada de nuevo");
    CHECK_EQ_INT(diana_ota_confirm(&ota2), 0, "confirmacion aceptada");
    CHECK(!diana_ota_tick(&ota2, 2000000 + 999000000ULL),
          "confirmada: no hay rollback aunque pase el tiempo");
    CHECK_EQ_INT(ctx.rollbacks, 0, "ningun rollback tras confirmar");

    SECTION("no se puede confirmar lo que no esta pendiente");
    CHECK(diana_ota_confirm(&ota2) != 0, "segunda confirmacion rechazada");

    return g_tests_failed - before;
}
