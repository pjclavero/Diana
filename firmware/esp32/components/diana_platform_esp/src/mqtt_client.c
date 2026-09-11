/**
 * @file mqtt_client.c
 * @brief Cliente MQTT con Last Will EXACTAMENTE como manda el contrato §3.
 *        NO COMPILADO.
 */
#include "platform_internal.h"

#include <stdbool.h>
#include <string.h>

#include "diana/mqtt_endpoint.h"

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include <errno.h>
#include <string.h>

static const char *TAG = "diana.mqtt";

/* ===========================================================================
 * C-2 · DIAGNOSTICO DISTINGUIBLE POR CAPAS
 * ===========================================================================
 *
 * Cuando el banco falle hay que saber EN QUE CAPA, y el codigo de salida no lo
 * dice. Medido: en MQTT 5 un fallo de autenticacion da rc=135, pero una
 * denegacion de ACL en publicacion devuelve rc=0 y un `Warning: ... Not
 * authorized` que solo esta en el log del BROKER. Desde el cliente, un
 * PUBLISH denegado y uno entregado son indistinguibles salvo por el PUBACK que
 * no llega.
 *
 * Este bloque existe para que cada capa tenga un mensaje PROPIO:
 *
 *   [TCP]      no hay socket: cable, IP, ruta, puerto cerrado
 *   [TLS]      hay socket, el handshake no cuaja: version, cifrados, alerta
 *   [CERT]     el handshake llega a validar y la cadena no encaja: CA distinta
 *   [HOSTNAME] la cadena valida pero el nombre no esta en el CN/SAN
 *   [AUTH]     TLS completo, CONNACK rechaza credenciales (rc=4 / rc=135)
 *   [ACL]      CONNACK acepta y el broker descarta lo que el modulo hace
 *
 * Sin esto, el banco es una adivinanza: los seis fallos se ven igual desde
 * fuera (el modulo no publica).
 * =========================================================================== */

/* Banderas de verificacion de mbedTLS que esp-tls propaga tal cual. Se
 * redeclaran aqui, en vez de incluir mbedtls/x509.h, para que este fichero no
 * dependa de la disposicion interna de mbedTLS: son valores del formato del
 * campo, estables y publicos. */
#define DIANA_X509_BADCERT_EXPIRED      0x01u
#define DIANA_X509_BADCERT_REVOKED      0x02u
#define DIANA_X509_BADCERT_CN_MISMATCH  0x04u
#define DIANA_X509_BADCERT_NOT_TRUSTED  0x08u
#define DIANA_X509_BADCERT_FUTURE       0x200u

/** Traduce las banderas de verificacion a la CAPA que hay que mirar. */
static void log_cert_flags(uint32_t flags)
{
    if (flags == 0) return;

    if (flags & DIANA_X509_BADCERT_CN_MISMATCH)
        ESP_LOGE(TAG, "[HOSTNAME] el nombre del broker NO figura en el CN/SAN "
                      "del certificado del servidor");
    if (flags & DIANA_X509_BADCERT_NOT_TRUSTED)
        ESP_LOGE(TAG, "[CERT] la cadena no llega a la CA empotrada: el broker "
                      "presenta un certificado de OTRA autoridad");
    if (flags & DIANA_X509_BADCERT_EXPIRED)
        ESP_LOGE(TAG, "[CERT] certificado del servidor CADUCADO (o el reloj del "
                      "modulo esta atrasado: sin NTP la fecha no es de fiar)");
    if (flags & DIANA_X509_BADCERT_FUTURE)
        ESP_LOGE(TAG, "[CERT] certificado aun NO VALIDO (reloj del modulo "
                      "adelantado, o emitido en el futuro)");
    if (flags & DIANA_X509_BADCERT_REVOKED)
        ESP_LOGE(TAG, "[CERT] certificado del servidor REVOCADO");

    uint32_t conocidas = DIANA_X509_BADCERT_EXPIRED | DIANA_X509_BADCERT_REVOKED
                       | DIANA_X509_BADCERT_CN_MISMATCH
                       | DIANA_X509_BADCERT_NOT_TRUSTED
                       | DIANA_X509_BADCERT_FUTURE;
    if (flags & ~conocidas)
        ESP_LOGE(TAG, "[CERT] otras banderas de verificacion: 0x%08x",
                 (unsigned)(flags & ~conocidas));
}

/** Traduce el codigo de CONNACK. Distingue AUTENTICACION de todo lo demas. */
static void log_connack(int rc)
{
    switch (rc) {
    case 0:
        return;                            /* aceptado */
    case 1:
        ESP_LOGE(TAG, "[MQTT] CONNACK 1: version de protocolo no soportada");
        break;
    case 2:
        ESP_LOGE(TAG, "[MQTT] CONNACK 2: client_id rechazado. El broker usa "
                      "use_username_as_clientid; revisa que el usuario exista");
        break;
    case 3:
        ESP_LOGE(TAG, "[MQTT] CONNACK 3: broker no disponible");
        break;
    case 4:
    case 135:
        /* 4 = MQTT 3.1.1 'bad user or password'; 135 = MQTT 5 'not authorized'
         * en el CONNACK. Ambos son AUTENTICACION, no ACL: aqui el broker ni
         * siquiera ha aceptado la sesion. */
        ESP_LOGE(TAG, "[AUTH] CONNACK %d: usuario o contrasena RECHAZADOS", rc);
        ESP_LOGE(TAG, "[AUTH] el usuario tiene que ser el module_id LITERAL, "
                      "sin prefijo (F-02), y estar en el fichero de passwords");
        break;
    case 5:
        ESP_LOGE(TAG, "[AUTH] CONNACK 5: no autorizado a conectar");
        break;
    default:
        ESP_LOGE(TAG, "[MQTT] CONNACK %d", rc);
        break;
    }
}

/**
 * Descompone un MQTT_EVENT_ERROR en la capa que lo produjo.
 *
 * LIMITE HONESTO: esp-mqtt no siempre rellena todos los campos. Cuando el
 * handshake falla sin banderas de verificacion, lo unico que se puede afirmar
 * es "[TLS] el handshake no cuaja", y se dice asi -- no se adivina la causa.
 */
static void log_mqtt_error(esp_mqtt_event_handle_t ev)
{
    const esp_mqtt_error_codes_t *e = ev->error_handle;
    if (!e) {
        ESP_LOGE(TAG, "[MQTT] error de transporte sin detalle disponible");
        return;
    }

    switch (e->error_type) {
    case MQTT_ERROR_TYPE_TCP_TRANSPORT:
        if (e->esp_tls_cert_verify_flags != 0) {
            /* Hubo socket Y handshake: el fallo es de VERIFICACION, no de red. */
            ESP_LOGE(TAG, "[TLS] handshake rechazado en la verificacion del "
                          "certificado (flags=0x%08x)",
                     (unsigned)e->esp_tls_cert_verify_flags);
            log_cert_flags((uint32_t)e->esp_tls_cert_verify_flags);
        } else if (e->esp_tls_stack_err != 0) {
            ESP_LOGE(TAG, "[TLS] handshake fallido en la pila TLS: "
                          "stack_err=-0x%04x (version, cifrados o alerta del "
                          "servidor). No hay banderas de certificado: el fallo "
                          "es ANTERIOR a validar la cadena",
                     (unsigned)(-e->esp_tls_stack_err));
        } else if (e->esp_transport_sock_errno != 0) {
            ESP_LOGE(TAG, "[TCP] no hay socket con el broker: errno=%d (%s). "
                          "Capa de red: enlace, IP, ruta o puerto cerrado -- "
                          "el TLS ni se ha intentado",
                     e->esp_transport_sock_errno,
                     strerror(e->esp_transport_sock_errno));
        } else {
            ESP_LOGE(TAG, "[TCP/TLS] transporte caido sin detalle: "
                          "esp_tls_last_esp_err=0x%x", (unsigned)e->esp_tls_last_esp_err);
        }
        if (e->esp_tls_last_esp_err != 0)
            ESP_LOGE(TAG, "        esp_tls_last_esp_err=0x%x (%s)",
                     (unsigned)e->esp_tls_last_esp_err,
                     esp_err_to_name(e->esp_tls_last_esp_err));
        break;

    case MQTT_ERROR_TYPE_CONNECTION_REFUSED:
        /* Se llego a hablar MQTT: TCP y TLS estan BIEN. Lo que falla es de
         * sesion, y casi siempre es autenticacion. */
        ESP_LOGE(TAG, "[MQTT] el broker rechazo el CONNECT (TCP y TLS OK)");
        log_connack((int)e->connect_return_code);
        break;

    default:
        ESP_LOGE(TAG, "[MQTT] error tipo %d", (int)e->error_type);
        break;
    }
}

/* Emite las suscripciones. Declarada aqui porque quien la dispara es el
 * handler de MQTT_EVENT_CONNECTED, que esta mas arriba en el fichero. */
static int mqtt_do_subscribe(struct diana_platform *p);

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id,
                               void *data)
{
    struct diana_platform *p = (struct diana_platform *)arg;
    esp_mqtt_event_handle_t ev = (esp_mqtt_event_handle_t)data;
    (void)base; (void)id;

    switch (ev->event_id) {
    case MQTT_EVENT_CONNECTED:
        p->mqtt_connected = true;
        p->mqtt_reconnects++;
        /* Este mensaje acota MUCHO: si aparece, TCP, TLS, la cadena, el
         * hostname y la AUTENTICACION estan los cinco bien. Todo lo que falle
         * despues es ACL o logica. */
        ESP_LOGI(TAG, "[OK] CONNACK aceptado: TCP+TLS+cert+hostname+auth "
                      "correctos (sesion #%u)", (unsigned)p->mqtt_reconnects);
        /* CONFIG_RECONCILIATION. LAS SUSCRIPCIONES SE EMITEN AQUI Y SOLO AQUI.
         * Antes se pedian justo despues de esp_mqtt_client_start(), con el
         * cliente aun sin conectar: se perdian TODAS y el modulo no recibia
         * nunca el config/desired retenido. Ver mqtt_do_subscribe(). */
        if (p->sub_requested && mqtt_do_subscribe(p) != 0)
            ESP_LOGE(TAG, "[MQTT] no se pudieron emitir las suscripciones tras "
                          "el CONNACK: el modulo NO recibira config/desired");
        break;

    case MQTT_EVENT_DISCONNECTED:
        p->mqtt_connected = false;
        /* Una desconexion INMEDIATA tras el CONNACK suele ser el broker
         * cerrando por ACL o por un LWT mal formado, no un fallo de red. Sin
         * el detalle del error no se puede afirmar cual: se dice lo que se ve. */
        ESP_LOGW(TAG, "[MQTT] desconectado del broker (sesiones=%u, "
                      "publicados=%u, confirmados=%u)",
                 (unsigned)p->mqtt_reconnects, (unsigned)p->mqtt_pub_sent,
                 (unsigned)p->mqtt_pub_acked);
        break;

    case MQTT_EVENT_SUBSCRIBED:
        /* ACL EN SUSCRIPCION. Aqui SI hay senal en el cliente: el SUBACK
         * devuelve 0x80 y esp-mqtt lo marca como SUBSCRIBE_FAILED. Es el unico
         * fallo de ACL que el modulo puede detectar por si mismo. */
        if (ev->error_handle &&
            ev->error_handle->error_type == MQTT_ERROR_TYPE_SUBSCRIBE_FAILED) {
            ESP_LOGE(TAG, "[ACL] SUBACK 0x80: el broker DENIEGA la suscripcion "
                          "(msg_id=%d). Autenticado si, autorizado no: revisa "
                          "el acl para este usuario", ev->msg_id);
        } else {
            ESP_LOGI(TAG, "[OK] suscripcion concedida (msg_id=%d)", ev->msg_id);
        }
        break;

    case MQTT_EVENT_PUBLISHED:
        /* PUBACK de un QoS 1. Es la UNICA confirmacion de que el broker acepto
         * la publicacion: sin esto, un PUBLISH denegado por ACL es
         * indistinguible de uno entregado (rc=0 en ambos casos). La diferencia
         * publicados/confirmados es el sintoma que hay que mirar en el banco. */
        p->mqtt_pub_acked++;
        ESP_LOGD(TAG, "[OK] PUBACK msg_id=%d (%u/%u confirmados)", ev->msg_id,
                 (unsigned)p->mqtt_pub_acked, (unsigned)p->mqtt_pub_sent);
        break;

    case MQTT_EVENT_DATA: {
        /* El instante de recepcion se toma con el reloj MONOTONICO: es la base
         * de la caducidad por expires_in_ms (contrato §6). No se usa la hora de
         * pared, que puede no estar sincronizada. */
        diana_platform_rx rx;
        memset(&rx, 0, sizeof(rx));
        rx.recv_us = (uint64_t)esp_timer_get_time();
        rx.retained = (ev->retain != 0);

        size_t tlen = (size_t)ev->topic_len;
        if (tlen >= sizeof(rx.topic)) tlen = sizeof(rx.topic) - 1;
        memcpy(rx.topic, ev->topic, tlen);
        rx.topic[tlen] = '\0';

        /* Un payload que no cabe se DESCARTA y se registra: truncarlo produciria
         * JSON invalido y un rechazo confuso aguas abajo. */
        if ((size_t)ev->total_data_len >= sizeof(rx.payload)) {
            ESP_LOGE(TAG, "payload de %d bytes descartado en %s",
                     ev->total_data_len, rx.topic);
            break;
        }
        memcpy(rx.payload, ev->data, (size_t)ev->data_len);
        rx.payload[ev->data_len] = '\0';
        rx.payload_len = (size_t)ev->data_len;

        if (xQueueSend(p->rx_queue, &rx, 0) != pdTRUE)
            ESP_LOGW(TAG, "cola de recepcion llena: mensaje perdido");
        break;
    }

    case MQTT_EVENT_ERROR:
        log_mqtt_error(ev);
        break;

    default:
        break;
    }
}

int diana_platform_mqtt_start(struct diana_platform *p, const char *client_id,
                              const char *uri, const char *user, const char *pass,
                              const char *ca_pem, size_t ca_len,
                              const char *ca_declared_fp,
                              const char *lwt_topic, const char *lwt_payload)
{
    if (!p || !uri || !user || !client_id) return -1;

    /* ---------------------------------------------------------------------
     * PUERTA DE TRANSPORTE (P0-2). Se evalua ANTES de crear nada: si la URI es
     * mqtts:// hace falta una CA valida, y si no la hay se sale con error. No
     * hay rama que reescriba la URI, ni reintento en claro, ni "probamos sin
     * verificar". Esta es la ultima linea de defensa por si alguien llamase a
     * esta funcion sin pasar antes por diana_mqtt_may_connect().
     * --------------------------------------------------------------------- */
    bool tls = (strncmp(uri, "mqtts://", 8) == 0);
    if (tls && !diana_mqtt_ca_is_valid(ca_pem, ca_len)) {
        ESP_LOGE(TAG, "mqtts:// sin CA valida: no se conecta (fallo cerrado)");
        return -4;
    }
    /* C-1 · segunda capa: la CA empotrada tiene que ser la DECLARADA. Una CA
     * sintacticamente valida pero ajena -- un certificado de ejemplo plantado
     * "para que arranque" -- pasa la guarda de arriba y convierte un fallo
     * ruidoso en uno silencioso. Aqui no pasa: se corta igual que sin CA.
     * Ver main/certs/README.md. */
    if (tls && !diana_mqtt_ca_is_declared(ca_pem, ca_len, ca_declared_fp)) {
        ESP_LOGE(TAG, "mqtts:// con CA NO DECLARADA: no se conecta (fallo cerrado)");
        return -5;
    }
    if (!tls) {
        /* Solo se llega aqui con el perfil de banco compilado a proposito. */
        ESP_LOGW(TAG, "transporte SIN TLS hacia %s: perfil de laboratorio", uri);
    }

    p->rx_queue = xQueueCreate(16, sizeof(diana_platform_rx));
    if (!p->rx_queue) return -1;

    esp_mqtt_client_config_t cfg = {0};
    cfg.broker.address.uri = uri;
    cfg.credentials.username = user;
    cfg.credentials.authentication.password = pass;

    if (tls) {
        /* CA explicita, empotrada en la imagen. Deliberadamente NO se usa el
         * almacen global ni el bundle de certificados de Espressif: el modulo
         * habla con UN broker conocido, y aceptar cualquier CA publica
         * convertiria la verificacion en un tramite vacio.
         *
         * Tampoco se toca skip_cert_common_name_check: su valor por defecto
         * (false) es el que deja ACTIVA la verificacion del nombre de host
         * contra el CN/SAN del certificado del servidor. Escribirlo aunque
         * fuese a false solo serviria para que el dia que alguien lo cambie a
         * true el diff pareciese inocuo. Si el broker se configura por IP, esa
         * IP tiene que estar en el SAN del certificado.
         *
         * certificate_len = 0 le dice a esp-mqtt que el PEM es una cadena
         * terminada en NUL, que es como lo deja EMBED_TXTFILES. */
        cfg.broker.verification.certificate = ca_pem;
        cfg.broker.verification.certificate_len = 0;
    }

    /* client_id == module_id, sin prefijo (contrato §8). Ademas el broker lo
     * REESCRIBE con el usuario autenticado (use_username_as_clientid), asi que
     * la autorizacion no se apoya en un valor que elija el cliente. NO se deja
     * el valor por defecto de esp-mqtt ('ESP32_xxxxxx'). */
    cfg.credentials.client_id = client_id;
    cfg.credentials.set_null_client_id = false;

    /* Last Will: contrato §3. QoS 1, retain=true, payload con online=false y
     * reason=lwt. Se registra en CONNECT, antes de cualquier publicacion. */
    cfg.session.last_will.topic = lwt_topic;
    cfg.session.last_will.msg = lwt_payload;
    cfg.session.last_will.msg_len = (int)strlen(lwt_payload);
    cfg.session.last_will.qos = 1;
    cfg.session.last_will.retain = 1;

    /* Sesion persistente: el broker conserva las suscripciones y los mensajes
     * QoS 1 pendientes entre reconexiones. */
    cfg.session.disable_clean_session = true;
    cfg.session.keepalive = 30;
    cfg.network.reconnect_timeout_ms = 2000;
    cfg.network.disable_auto_reconnect = false;

    p->mqtt = esp_mqtt_client_init(&cfg);
    if (!p->mqtt) return -2;

    ESP_ERROR_CHECK(esp_mqtt_client_register_event(p->mqtt, ESP_EVENT_ANY_ID,
                                                   mqtt_event_handler, p));
    return esp_mqtt_client_start(p->mqtt) == ESP_OK ? 0 : -3;
}

/**
 * Emite TODAS las suscripciones. Se llama UNICAMENTE desde
 * MQTT_EVENT_CONNECTED (ver mqtt_subscribe_now en el handler), nunca antes.
 *
 * ── CONFIG_RECONCILIATION · el defecto que esto cierra ───────────────────────
 *
 * Antes, app_main.c llamaba a diana_platform_mqtt_subscribe() en la linea
 * SIGUIENTE a diana_platform_mqtt_start(), y ahi el cliente todavia no ha
 * conectado: esp_mqtt_client_start() es ASINCRONO y el CONNACK llega cientos
 * de milisegundos despues (TCP + handshake TLS + CONNECT). Un
 * esp_mqtt_client_subscribe() sobre un cliente no conectado no encola nada:
 * devuelve -1 y se pierde. Como ningun otro punto del firmware volvia a
 * suscribirse --el handler de MQTT_EVENT_CONNECTED solo registraba el CONNACK--
 * el modulo NUNCA llegaba a estar suscrito a `config/desired`, y el retenido
 * v1 del backend no le llegaba jamas. El sintoma medido era exactamente ese:
 * publicaciones del modulo correctas (presencia, impactos hasta PostgreSQL) y
 * reported_config_version clavado en 0.
 *
 * `disable_clean_session = true` no salvaba nada: el broker solo conserva
 * suscripciones que alguna vez se hicieron, y aqui no se hizo ninguna.
 *
 * Se resuscribe en CADA CONNACK a proposito. Es idempotente, cuesta cuatro
 * paquetes, y cubre el caso de que el broker pierda la sesion (reinicio,
 * expiry, o un clean-session forzado desde el servidor): depender de la sesion
 * persistente seria depender de un estado que no controlamos.
 */
int diana_platform_mqtt_subscribe(struct diana_platform *p, const char *module_id)
{
    if (!p || !module_id || !module_id[0]) return -1;

    /* Se ANOTA la intencion; la emision va en el CONNACK. Si ya estamos
     * conectados (resuscripcion pedida en caliente), se emite tambien ahora. */
    snprintf(p->sub_module_id, sizeof(p->sub_module_id), "%s", module_id);
    p->sub_requested = true;
    if (p->mqtt && p->mqtt_connected) return mqtt_do_subscribe(p);
    return 0;
}

static int mqtt_do_subscribe(struct diana_platform *p)
{
    if (!p || !p->mqtt || !p->sub_requested) return -1;
    const char *module_id = p->sub_module_id;

    char topic[DIANA_TOPIC_MAXLEN];
    /* v1.2 · ADR-0008: `provision` cierra CONTRACT_GAP-PROVISION-COMMAND-TOPIC.
     * Hasta aqui la cadena de D1b estaba cableada y presente en el ELF pero NO
     * era alcanzable por transporte: nadie se suscribia al topico. QoS 1 como
     * el resto, y la ORDEN se rechaza si llega retenida -- eso lo impone
     * diana_prov_message(), no la suscripcion.
     *
     * `provision/state` NO se suscribe: lo publica el propio modulo, y
     * suscribirse a lo que uno emite solo ensancha la superficie. */
    static const char *const suffixes[] = {
        "command", "config/desired", "ota", "provision",
    };
    for (size_t i = 0; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
        snprintf(topic, sizeof(topic), "targets/v1/module/%s/%s", module_id,
                 suffixes[i]);
        if (esp_mqtt_client_subscribe(p->mqtt, topic, 1) < 0) {
            ESP_LOGE(TAG, "[MQTT] SUBSCRIBE rechazado por el cliente para '%s'",
                     topic);
            return -1;
        }
        p->sub_sent++;
    }
    /* Estado de partida publicado por el principal (ACL: solo lectura). */
    if (esp_mqtt_client_subscribe(p->mqtt, "targets/v1/system/+/game/state", 1) < 0) {
        ESP_LOGE(TAG, "[MQTT] SUBSCRIBE rechazado para el estado de partida");
        return -1;
    }
    p->sub_sent++;
    ESP_LOGI(TAG, "[OK] %u suscripciones emitidas tras el CONNACK",
             (unsigned)p->sub_sent);
    return 0;
}

bool diana_platform_rx_pop(struct diana_platform *p, diana_platform_rx *out,
                           uint32_t timeout_ms)
{
    if (!p->rx_queue) return false;
    return xQueueReceive(p->rx_queue, out, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

int diana_pf_mqtt_publish(void *ctx, const diana_hal_mqtt_msg *msg)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    if (!p->mqtt || !p->mqtt_connected) return DIANA_HAL_ERR_GENERIC;

    int id = esp_mqtt_client_publish(p->mqtt, msg->topic, (const char *)msg->payload,
                                     (int)msg->payload_len, msg->qos,
                                     msg->retain ? 1 : 0);
    /* C-2 · se cuenta lo ENTREGADO AL CLIENTE. Comparado con mqtt_pub_acked
     * (PUBACK), la diferencia sostenida en QoS 1 es la firma de una denegacion
     * de ACL en publicacion, que no produce ningun error en este punto. */
    if (id >= 0 && msg->qos > 0) {
        p->mqtt_pub_sent++;

        /* Sintoma de ACL en publicacion, hecho OBSERVABLE. Con QoS 1 el broker
         * confirma todo lo que acepta; si el modulo lleva 16 publicaciones
         * entregadas al cliente y NINGUNA confirmada estando conectado, no es
         * congestion: el broker las esta descartando. Es la unica forma de ver
         * desde el modulo un `Not authorized` que solo existe en el log del
         * broker. Se avisa una vez por umbral, no en cada publicacion. */
        if (p->mqtt_pub_acked == 0 && p->mqtt_pub_sent == 16)
            ESP_LOGE(TAG, "[ACL] 16 publicaciones QoS1 SIN un solo PUBACK "
                          "estando conectado: el broker las esta descartando. "
                          "Autenticacion correcta, autorizacion NO: revisa el "
                          "acl para el topico '%s'", msg->topic);
    }
    /* Un id negativo significa que el cliente no lo ha aceptado: el core lo
     * encolara localmente. Con QoS 1 un id >= 0 significa entregado al cliente,
     * no confirmado por el broker; la confirmacion real la da el PUBACK. */
    return id < 0 ? DIANA_HAL_ERR_GENERIC : id;
}

bool diana_pf_mqtt_connected(void *ctx)
{
    return ((struct diana_platform *)ctx)->mqtt_connected;
}
