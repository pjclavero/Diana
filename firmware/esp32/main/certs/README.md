# `main/certs/` · la CA del broker y su declaracion

Dos ficheros, ambos empotrados en la imagen (`EMBED_TXTFILES`), que tienen que
contar **la misma historia**:

| fichero | que es |
|---|---|
| `broker_ca.pem` | el material que el modulo usa para verificar al broker |
| `broker_ca.sha256` | **la declaracion**: que CA se espera que sea ese material |

## Por que hay una declaracion y no solo el PEM

Sin CA valida el modulo no arranca MQTT y lo grita por consola. Eso ya estaba y
es correcto. Lo que la declaracion cierra es el otro fallo, el que no se ve:

> alguien sustituye el marcador por un certificado de ejemplo —el de un
> tutorial, un autofirmado de pruebas, el `snakeoil` de Debian— porque "hacia
> falta un PEM para que arrancase".

Ese certificado pasa `diana_mqtt_ca_is_valid()` igual de bien que el bueno. El
fallo ruidoso se convierte en uno silencioso que no aparece hasta el handshake,
y si ese certificado llegara a firmar algo, no aparece nunca.

Con la declaracion, sustituir el PEM **sin tocarla** deja el modulo sin conectar
con un mensaje que nombra las dos huellas. Sustituir ambos es un cambio visible
en el diff, revisable, que es exactamente lo que se queria.

## Estados posibles

- `NONE` (estado actual) — todavia no hay CA. `broker_ca.pem` **tiene que ser**
  el marcador no-PEM. Si aparece un PEM valido con la declaracion en `NONE`,
  `check_broker_ca.py` se pone rojo.
- 64 cifras hex — hay CA. El PEM **tiene que ser** ese certificado exacto.

No hay un tercer estado. En particular no existe "declaracion vacia = acepta lo
que haya": una declaracion ausente, vacia o malformada devuelve `false` en
`diana_mqtt_ca_is_declared()` y el modulo no conecta.

## Poner la CA de produccion

```sh
# 1. el certificado (publico: no es un secreto, se versiona)
openssl x509 -in ca.crt -out firmware/esp32/main/certs/broker_ca.pem -outform PEM

# 2. la declaracion, del MISMO fichero que se acaba de escribir
openssl x509 -in firmware/esp32/main/certs/broker_ca.pem -noout -fingerprint -sha256 \
  | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z' \
  > firmware/esp32/main/certs/broker_ca.sha256

# 3. la guarda tiene que quedar verde
python3 firmware/esp32/tools/check_broker_ca.py
```

La huella es la de `openssl` sin adornos: sobre el DER, hex en minusculas, sin
`:`. `diana_mqtt_ca_fingerprint()` calcula ese mismo valor dentro del firmware,
y una prueba de host lo ata a un certificado real cuya huella se obtuvo con
openssl (`test_mqtt_endpoint.c`).

## Lo que esto NO demuestra

Que la CA sea la del broker de produccion. La declaracion ata el binario a **un**
certificado concreto y hace visible cualquier cambio; que ese certificado sea el
correcto lo demuestra el handshake contra el broker vivo, en el banco.
Sigue abierto como `PENDING_PHYSICAL_VALIDATION`.
