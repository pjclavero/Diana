# Proyecto ESP-IDF del firmware Diana.
#
#   idf.py set-target esp32s3
#   idf.py build flash monitor
#
# La logica de negocio vive en components/diana_core y NO depende de ESP-IDF:
# se compila y prueba tambien en PC con `make -C firmware test`.

cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/components")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(diana_firmware)
