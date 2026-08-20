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
    INCLUDE_DIRS "include"
    REQUIRES diana_hal
)
