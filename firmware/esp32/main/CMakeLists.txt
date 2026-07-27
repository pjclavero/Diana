idf_component_register(
    SRCS "app_main.c"
         "app_tasks.c"
         "app_commands.c"
    INCLUDE_DIRS "." "../boards"
    # El watchdog de tarea (esp_task_wdt.h) vive dentro de esp_system desde
    # ESP-IDF 5.x: no es un componente propio.
    REQUIRES diana_core diana_hal diana_platform_esp esp_timer esp_system
             json
)
