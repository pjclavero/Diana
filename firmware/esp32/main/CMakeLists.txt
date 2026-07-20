idf_component_register(
    SRCS "app_main.c"
         "app_tasks.c"
         "app_commands.c"
    INCLUDE_DIRS "."
    REQUIRES diana_core diana_hal diana_platform_esp esp_timer esp_task_wdt
             json
)
