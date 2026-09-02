/*
 * prov_nvs.h — espacio NVS de la AUTORIDAD. Cabecera PRIVADA de diana_core.
 *
 * Estas macros estaban en la cabecera publica, y eso convertia el espacio de
 * la autoridad en un recurso de libre acceso: cualquier fichero podia escribir
 * ahi con solo nombrarlo. Una supervision independiente demostro que el
 * guardian de camino unico -- que era una expresion regular -- no podia
 * defender esa propiedad: bastaba usar el literal en vez de la macro, o un
 * envoltorio de kv_set, o un fichero con el mismo nombre base.
 *
 * La proteccion ya no depende de detectar al infractor, sino de que el
 * infractor no pueda nombrar el recurso: el valor del espacio solo es visible
 * dentro de diana_core, y la unica lectura desde fuera pasa por
 * diana_prov_factory_read(). Escribir sigue siendo exclusivo de
 * provisioning.c.
 *
 * Excepcion consciente: test_host lo incluye por ruta relativa para poder
 * simular corrupcion del estado persistido. Es codigo de prueba, no entra en
 * el firmware, y el analizador estructural lo excluye explicitamente.
 */
#ifndef DIANA_PROV_NVS_PRIVATE_H
#define DIANA_PROV_NVS_PRIVATE_H

#define DIANA_PROV_NVS_NS          "diana_prov"
#define DIANA_PROV_NVS_KEY         "state"

#endif /* DIANA_PROV_NVS_PRIVATE_H */
