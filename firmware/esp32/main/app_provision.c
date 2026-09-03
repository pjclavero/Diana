/**
 * @file app_provision.c
 * @brief Camino de RUNTIME del plano DEVICE_MANAGEMENT (D1b).
 *
 *   [ningun topico suscrito]  X  diana_platform_rx (con retained)
 *        -> diana_prov_app_handle() -> diana_prov_message()
 *        -> diana_prov_handle() -> NVS
 *
 *   OJO A LA PRIMERA FLECHA, QUE NO EXISTE. El firmware NO se suscribe a
 *   ningun topico de provisioning: mqtt_client.c suscribe command,
 *   config/desired, ota y el estado de partida, y este interceptor empareja por
 *   sufijo `/provision`, que nunca llega. Es decir, la cadena esta cableada y
 *   presente en el ELF, pero HOY NO ES ALCANZABLE POR TRANSPORTE
 *   (CONTRACT_GAP-PROVISION-COMMAND-TOPIC).
 *
 *   La cadena TERMINA en NVS. Tampoco se publica estado: el contrato v1 no
 *   tiene topico para ello y sus TopicKind estan congelados
 *   (CONTRACT_GAP-PROVISION-STATE-TOPIC).
 *
 *   Ninguno de los dos huecos se resuelve anadiendo un topico suelto: exigiria
 *   un TopicKind nuevo, o sea modificar de facto el contrato v1 para poner
 *   verde un gate. Ambos estan transferidos a MP0-F.0 (PROVISIONING CONTRACT
 *   GATE), con ADR y evolucion contractual completa. NO es MP1: se movio al
 *   descubrirse que faltaba tambien el camino de ENTRADA, no solo el de salida.
 *
 * Este fichero es DELIBERADAMENTE fino. Todo lo que decide algo —parseo,
 * conformidad, delegacion, ECDSA, maquina de estados, persistencia, serializado
 * de la respuesta— vive en diana_core, que se compila y se ejercita en host. Lo
 * unico que hay aqui es lo que no se puede probar sin ESP-IDF: emparejar el
 * topico, sacar el flag retain del transporte y publicar. Si alguna regla
 * aparece en este fichero, esta en el sitio equivocado.
 *
 * LO QUE ESTE CARRIL **NO** RESUELVE, y hay que decirlo: la raiz de
 * aprovisionamiento se lee de NVS ("diana_prov"/"root_key", punto SEC1 de 65
 * bytes) porque es donde la dejaria el flasheo de fabrica, pero NADIE la
 * escribe todavia. Sin ella el modulo funciona en FALLO CERRADO —toda
 * credencial se rechaza con delegation_invalid_signature— que es el
 * comportamiento correcto, no un fallo. El utillaje de fabrica es otro carril.
 */
#include "app.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "diana.prov";

/** Claves de fabrica en NVS. El namespace es el mismo que usa el estado
 *  persistente del modulo: son datos del mismo dominio. El espacio en si ya
 *  no es nombrable desde aqui; se lee con diana_prov_factory_read(). */
#define PROV_NVS_ROOT_KEY  "root_key"
#define PROV_NVS_ROOT_ID   "root_key_id"
#define PROV_NVS_FP        "prov_fp"

void diana_prov_app_init(diana_app *a)
{
    /* El fingerprint de fabrica identifica la CLAVE DE APROVISIONAMIENTO que el
     * backend debe presentar. Si no esta en NVS se deja vacio: entonces la
     * comprobacion provisioning_key_mismatch no puede pasar y el modulo se
     * queda sin aprovisionar. Fallo cerrado, otra vez. */
    char fp[DIANA_PROV_FP_HEX_BUF];
    size_t len = sizeof(fp);
    memset(fp, 0, sizeof(fp));
    if (!diana_prov_factory_read(&a->hal, PROV_NVS_FP, fp, sizeof(fp) - 1u, &len))
        fp[0] = '\0';

    diana_prov_init(&a->prov, &a->hal, a->id.module_id, a->cfg.system_id, fp);

    uint8_t root[DIANA_P256_PUBKEY_LEN];
    len = sizeof(root);
    char root_id[DIANA_PROV_ID_BUF];
    size_t idlen = sizeof(root_id);
    memset(root_id, 0, sizeof(root_id));
    if (diana_prov_factory_read(&a->hal, PROV_NVS_ROOT_KEY, root, sizeof(root), &len) &&
        len == sizeof(root)) {
        if (!diana_prov_factory_read(&a->hal, PROV_NVS_ROOT_ID, root_id,
                                     sizeof(root_id) - 1u, &idlen))
            root_id[0] = '\0';
        diana_prov_set_root_key(&a->prov, root, root_id);
        ESP_LOGI(TAG, "raiz de aprovisionamiento cargada de NVS (%s)",
                 root_id[0] ? root_id : "sin id");
    } else {
        ESP_LOGW(TAG, "SIN raiz de aprovisionamiento en NVS: toda credencial "
                      "sera rechazada (fallo cerrado)");
    }

    /* CONTRACT_GAP-PROVISION-STATE-TOPIC: no se construye topico de estado.
     * Los TopicKind del contrato v1 estan CONGELADOS y no incluyen
     * provision/state. D1b entra aqui SOLO como camino de ordenes:
     * recepcion, validacion y ejecucion. La publicacion del estado de
     * autoridad se decide en MP1 con ADR y evolucion contractual
     * deliberada, no metiendo dos topicos por la puerta de atras. */

    ESP_LOGI(TAG, "estado de aprovisionamiento al arranque: %s",
             diana_prov_state_str((diana_prov_state)a->prov.st.state));
}

/**
 * Atiende una orden del plano DEVICE_MANAGEMENT. NO publica nada: el estado de
 * autoridad resultante se queda sin emitir a proposito
 * (CONTRACT_GAP-PROVISION-STATE-TOPIC). El comentario que habia aqui hablaba de
 * publicar module-provision-state y contradecia al `(void)out.publish;` de unas
 * lineas mas abajo; era un resto de un publicador que no existe.
 *
 * OJO AL ALCANCE: esta funcion empareja por sufijo `/provision`, y el firmware
 * NO se suscribe a ningun topico de provisioning
 * (CONTRACT_GAP-PROVISION-COMMAND-TOPIC). Es decir, hoy es alcanzable desde el
 * despacho pero NO desde el transporte.
 */
bool diana_prov_app_handle(diana_app *a, const diana_platform_rx *rx)
{
    /* Emparejado por SUFIJO exacto. Con strstr(), un topico
     * ".../provision/state" —que el propio modulo publica— entraria por aqui.
     * El resto del fichero de comandos usa strstr y ese defecto ya existe alli;
     * aqui no se replica. */
    size_t tlen = strlen(rx->topic);
    static const char SUF[] = "/provision";
    size_t slen = sizeof(SUF) - 1u;
    if (tlen < slen || strcmp(rx->topic + (tlen - slen), SUF) != 0) return false;

    diana_prov_command cmd;
    diana_prov_outcome out;
    diana_prov_message(&a->prov, rx->payload, rx->payload_len, rx->retained,
                       &cmd, &out);

    ESP_LOGI(TAG, "orden de aprovisionamiento: retenida=%d resultado=%s "
                  "estado=%s motivo=%s aplicada=%d",
             (int)rx->retained, diana_prov_result_str(out.result),
             diana_prov_state_str(out.state), diana_prov_reason_str(out.reason),
             (int)out.applied);

    /* CONTRACT_GAP-PROVISION-STATE-TOPIC: `out.publish` queda sin consumir a
     * proposito. La orden SI se recibe, valida y aplica; lo que NO se emite es
     * el estado de autoridad resultante, porque el contrato v1 no tiene topico
     * para ello y sus TopicKind estan congelados. Se decide en MP1 con ADR.
     *
     * Tampoco existe aqui un `announce` de estado por la misma razon. */
    (void)out.publish;
    return true;
}
