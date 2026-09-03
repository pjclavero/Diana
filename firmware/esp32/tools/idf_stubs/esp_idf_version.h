/* Stub EXPLICITO. Valores REALES de la version con la que se compila el
 * firmware (imagen oficial espressif/idf:v5.5, ver docs/firmware/MAPA-FIRMWARE.md).
 * No esta vacio a proposito: con macros indefinidas, una guarda legitima como
 *   #if ESP_IDF_VERSION_MAJOR < 5
 *   #error "Diana requiere ESP-IDF 5.x"
 *   #endif
 * se evaluaba como 0 < 5 y ponia el guardian rojo con codigo correcto. */
#ifndef DIANA_STUB_ESP_IDF_VERSION_H
#define DIANA_STUB_ESP_IDF_VERSION_H

#define ESP_IDF_VERSION_MAJOR   5
#define ESP_IDF_VERSION_MINOR   5
#define ESP_IDF_VERSION_PATCH   0
#define ESP_IDF_VERSION_VAL(major, minor, patch) \
        ((major) * 10000 + (minor) * 100 + (patch))
#define ESP_IDF_VERSION \
        ESP_IDF_VERSION_VAL(ESP_IDF_VERSION_MAJOR, \
                            ESP_IDF_VERSION_MINOR, \
                            ESP_IDF_VERSION_PATCH)

#endif
