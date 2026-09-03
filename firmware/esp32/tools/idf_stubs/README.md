# Stubs EXPLICITOS de cabeceras externas

Estos ficheros existen por una razon concreta y medida: el guardian de camino
unico generaba stubs vacios **en silencio** para cualquier cabecera que no
encontrara, y una revision independiente lo exploto (evasion 11c) metiendo el
bypass en una cabecera real del build que el guardian no sabia localizar: le
generaba un stub vacio, la unidad "preprocesaba bien", y el codigo malicioso
desaparecia del analisis.

Regla vigente, sin excepciones:

  - cabecera que EXISTE en el arbol del proyecto  -> se resuelve por -I.
    Si aun asi no se resuelve, es FALLO DURO. Nunca se estuba.
  - cabecera externa (ESP-IDF, componentes gestionados) -> solo se estuba si
    esta en la lista explicita del guardian, y con el contenido de este
    directorio cuando lo necesite.
  - cualquier otra cabecera que falte -> FALLO DURO.

`esp_idf_version.h` tiene valores REALES, no vacios, para que una guarda
legitima como `#if ESP_IDF_VERSION_MAJOR < 5 / #error` se evalue como se evalua
en el build de verdad. Con el stub vacio esa guarda ponia el guardian rojo con
codigo correcto, que es la mejor forma de que alguien acabe desactivandolo.
