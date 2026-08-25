idf_component_register(
    SRCS "app_main.c"
         "app_tasks.c"
         "app_commands.c"
         "app_provision.c"
    INCLUDE_DIRS "."
    PRIV_INCLUDE_DIRS "../boards"
    REQUIRES diana_core diana_hal diana_platform_esp esp_timer esp_system
             json
)
