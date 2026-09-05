idf_component_register(
    SRCS "app_main.c"
         "app_tasks.c"
         "app_commands.c"
         "app_provision.c"
    INCLUDE_DIRS "."
    PRIV_INCLUDE_DIRS "../boards"
    REQUIRES diana_core diana_hal diana_platform_esp esp_timer esp_system
             json
    # CA del broker MQTT (P0-2). Se empotra como TEXTO terminado en NUL, que es
    # justo lo que espera esp-mqtt en broker.verification.certificate. Si el
    # fichero no contiene un PEM, el modulo se niega a arrancar MQTT: ver
    # diana_mqtt_ca_is_valid() y el propio broker_ca.pem.
    EMBED_TXTFILES "certs/broker_ca.pem"
)
