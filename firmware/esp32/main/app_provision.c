/**
 * @file app_provision.c
 * @brief Camino de RUNTIME del plano DEVICE_MANAGEMENT (D1b).
 *
 *   targets/v1/module/{id}/provision  (QoS 1, retain=false)
 *        -> diana_platform_rx (con retained)
 *        -> diana_handle_message() -> diana_prov_app_handle()
 *        -> diana_prov_message() -> diana_prov_handle() -> NVS
 *        -> diana_prov_state_json()
 *        -> targets/v1/module/{id}/provision/state (QoS 1, retain=TRUE)
 *
 *   LOS DOS HUECOS DE D1b ESTAN CERRADOS (MP0-F.0, ADR-0008, contrato v1.2):
 *
 *     · CONTRACT_GAP-PROVISION-COMMAND-TOPIC: mqtt_client.c ya suscribe
 *       `provision` con QoS 1. Antes la cadena estaba cableada y presente en
 *       el ELF pero NO era alcanzable por transporte, porque nadie se
 *       suscribia al topico.
 *
 *     · CONTRACT_GAP-PROVISION-STATE-TOPIC: `out.publish` ya se consume y el
 *       estado de autoridad se emite retenido en `provision/state`.
 *
 *   Ninguno de los dos se ha cerrado anadiendo un topico suelto para poner
 *   verde un gate: ambos TopicKind existen en el contrato (topics.ts,
 *   contracts/mqtt/module-provision-{command,state}.schema.json) con ADR y
 *   evolucion contractual deliberada. Este carril construye el PUENTE; el
 *   motor de D1b no se toca.
 *
 * Este fichero es DELIBERADAMENTE fino. Todo lo que decide algo —parseo,
 * conformidad, delegacion, ECDSA, maquina de estados, persistencia, serializado
 * de la respuesta— vive en diana_core, que se compila y se ejercita en host. Lo
 * unico que hay aqui es lo que no se puede probar sin ESP-IDF: sacar el flag
 * retain del transporte y publicar. Si alguna regla aparece en este fichero,
 * esta en el sitio equivocado. Por eso el emparejado del topico TAMPOCO vive
 * ya aqui: lo decide diana_topic_route(), en diana_core, que si se ejecuta en
 * la suite de host.
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

    /* El topico de estado lo construye build_topics() en app_main.c, con la
     * misma tabla contractual que el resto (DIANA_TOPIC_PROVISION_STATE). */

    ESP_LOGI(TAG, "estado de aprovisionamiento al arranque: %s",
             diana_prov_state_str((diana_prov_state)a->prov.st.state));
}

/**
 * Emite el estado de autoridad en targets/v1/module/{id}/provision/state.
 *
 * QoS y retain NO se eligen aqui: salen de la tabla del contrato
 * (diana_topic_qos/diana_topic_retain sobre DIANA_TOPIC_PROVISION_STATE), como
 * el resto de publicadores del modulo. El PAYLOAD lo serializa
 * diana_prov_state_json() en diana_core: aqui no hay un segundo serializador,
 * porque dos serializadores del mismo mensaje divergen siempre.
 *
 * NO_SECRET_IN_STATE: este camino no puede filtrar material sensible porque no
 * lo escribe -- ni root_key, ni clave operativa, ni contrasena MQTT. La
 * garantia esta donde se construye el JSON, y la prueba que la sostiene vive en
 * test_host/tests/test_prov_bridge.c con control positivo.
 */
void diana_publish_provision_state(diana_app *a, const diana_prov_command *cmd,
                                   const diana_prov_outcome *out)
{
    /* publish=false = descartado sin respuesta posible. No se inventa una
     * fotografia para tener algo retenido en el broker. */
    if (!out->publish) return;
    if (a->topic_provision_state[0] == '\0') {
        ESP_LOGE(TAG, "sin topico de estado de aprovisionamiento: no se publica");
        return;
    }

    char buf[DIANA_MSG_JSON_MAX];
    size_t n = diana_prov_state_json(&a->prov, cmd, out, buf, sizeof(buf));
    if (n == 0) {
        ESP_LOGE(TAG, "no se ha podido serializar module-provision-state");
        return;
    }

    diana_hal_mqtt_msg msg = {
        .topic = a->topic_provision_state,
        .payload = buf,
        .payload_len = n,
        .qos = diana_topic_qos(DIANA_TOPIC_PROVISION_STATE),
        .retain = diana_topic_retain(DIANA_TOPIC_PROVISION_STATE),
    };
    a->hal.mqtt_publish(a->hal.ctx, &msg);
}

/**
 * Declaracion NO solicitada al conectar. Solo emite algo cuando hay algo que
 * declarar (sin autoridad o autoridad caduca): diana_prov_connect_declaration()
 * deja publish=false en READY y PREPARED.
 */
void diana_prov_app_announce(diana_app *a)
{
    diana_prov_outcome out;
    diana_prov_connect_declaration(&a->prov, &out);
    /* Sin orden que correlar: la declaracion no responde a ningun request_id y
     * el esquema deja request_id opcional justamente para este caso. */
    diana_publish_provision_state(a, NULL, &out);
}

/**
 * Atiende una orden del plano DEVICE_MANAGEMENT y PUBLICA el estado resultante.
 *
 * El emparejado del topico ya no se hace aqui: diana_handle_message() enruta
 * con diana_topic_route() y llama a esta funcion solo para
 * DIANA_ROUTE_MODULE_PROVISION_COMMAND. Devuelve true si el mensaje era suyo,
 * para que no siga por el canal de juego.
 *
 * El flag `retained` viaja intacto hasta diana_prov_message(), que lo rechaza
 * LO PRIMERO de todo con retained_provisioning_rejected. Esa regla es de D1b y
 * este carril NO la toca.
 */
bool diana_prov_app_handle(diana_app *a, const diana_platform_rx *rx)
{
    char id[DIANA_ROUTE_ID_BUF];
    if (diana_topic_route(rx->topic, id, sizeof(id)) !=
        DIANA_ROUTE_MODULE_PROVISION_COMMAND)
        return false;

    diana_prov_command cmd;
    diana_prov_outcome out;
    diana_prov_message(&a->prov, rx->payload, rx->payload_len, rx->retained,
                       &cmd, &out);

    ESP_LOGI(TAG, "orden de aprovisionamiento: retenida=%d resultado=%s "
                  "estado=%s motivo=%s aplicada=%d",
             (int)rx->retained, diana_prov_result_str(out.result),
             diana_prov_state_str(out.state), diana_prov_reason_str(out.reason),
             (int)out.applied);

    diana_publish_provision_state(a, &cmd, &out);
    return true;
}
