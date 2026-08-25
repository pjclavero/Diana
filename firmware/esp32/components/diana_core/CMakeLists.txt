# Logica de negocio pura: NO debe depender de ESP-IDF.
# La unica dependencia permitida es diana_hal (interfaz, sin implementacion).
idf_component_register(
    SRCS "src/types.c"
         "src/json.c"
         "src/ids.c"
         "src/identity.c"
         "src/config.c"
         "src/module_fsm.c"
         "src/target_fsm.c"
         "src/sensors.c"
         "src/shiftreg.c"
         "src/event.c"
         "src/queue.c"
         "src/command.c"
         "src/led.c"
         "src/sha256.c"
         "src/messages.c"
         "src/ota.c"
         # --- D1b · plano DEVICE_MANAGEMENT firmado -------------------------
         # Estos seis estaban en el arbol pero NO aqui: se compilaban solo con
         # el gcc de host y el toolchain xtensa nunca los habia visto. Sin ellos
         # en el binario, DEVICE_MANAGEMENT_PATH no puede declararse UNIQUE.
         "src/base64url.c"
         "src/p256.c"
         "src/seq_guard.c"
         "src/prov_canonical.c"
         "src/prov_parse.c"
         "src/provisioning.c"
    INCLUDE_DIRS "include"
    REQUIRES diana_hal
)
