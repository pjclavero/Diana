# Diagnostico minimo W5500

Imagen ESP-IDF independiente para comprobar solamente el modulo Ethernet del
prototipo. Usa los pines reales: CS 10, MOSI 11, SCK 12 y MISO 13; RST e INT
quedan sin conectar y el enlace se consulta cada 10 ms.

```powershell
idf.py -p COM6 build flash monitor
```

Sin RJ45 debe mostrar `driver START` y continuar registrando `estable`, sin IP.
Con RJ45 y DHCP disponible debe anadir `LINK=UP` y `DHCP IP=...`.
