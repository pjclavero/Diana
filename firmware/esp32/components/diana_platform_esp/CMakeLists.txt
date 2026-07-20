# Implementacion REAL del HAL sobre ESP-IDF (ESP32-S3 + W5500).
idf_component_register(
    SRCS "src/hal_esp32.c"
         "src/net_w5500.c"
         "src/mqtt_client.c"
         "src/store_nvs.c"
         "src/store_queue.c"
         "src/io_piezo.c"
         "src/io_leds.c"
         "src/io_inputs.c"
         "src/ota_esp.c"
    INCLUDE_DIRS "include"
    REQUIRES diana_hal diana_core
             driver esp_eth esp_netif esp_event mqtt nvs_flash
             esp_adc esp_timer app_update spi_flash esp_partition
             esp_hw_support led_strip
)
