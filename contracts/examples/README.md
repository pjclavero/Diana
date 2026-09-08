# Ejemplos del contrato: cuál se copia y cuál no

Hay tres directorios y **sólo uno** contiene mensajes que se puedan publicar.

| Directorio | Qué es | ¿Publicable tal cual? |
| --- | --- | --- |
| `publishable/` | Los bytes exactos que un productor manda por MQTT | **Sí** |
| `valid/` | El mismo mensaje + metadatos del repositorio (`_schema`) | **No** |
| `invalid/` | Mensajes que el contrato debe rechazar, + `_reason` | No, a propósito |

## Por qué `valid/` no es publicable

Los ficheros de `valid/` llevan `_schema` **dentro del payload**, para que las
herramientas del repositorio sepan contra qué esquema validarlos. Tanto
`contracts/validate.py` (`strip_meta`) como el ayudante de pruebas del backend
(`server/backend/test/helpers/examples.ts`) retiran esa clave antes de validar.

El backend real no retira nada, y los esquemas de `contracts/mqtt/` declaran
`additionalProperties: false`. Consecuencia medida: el fichero **tal cual está
en disco** se rechaza con `schema_violation`, y como el broker ya ha devuelto
PUBACK, el productor no se entera — el rechazo sólo aparece en el log del
backend. Un productor nuevo que copiase `valid/hit-event/valid-hit.json`
publicaría mensajes que nadie procesa y creería que funciona.

Es la misma familia de defecto que ya ha mordido antes en este proyecto: **el
artefacto que se verifica no es el que se usa.**

## Cómo se mantiene

`publishable/` se **genera**, no se edita:

```sh
node contracts/examples/generate-publishable.mjs           # regenera
node contracts/examples/generate-publishable.mjs --check   # falla si diverge
```

Para cambiar un ejemplo se edita el de `valid/` y se regenera.
`publishable/INDEX.json` guarda la correspondencia fichero → esquema fuera del
payload, que es donde debía estar desde el principio.

## Qué lo garantiza

No el generador: la prueba
`server/backend/test/contracts/publishable-examples.spec.ts`, que

1. lee cada fichero de `publishable/` **crudo de disco** (`fs.readFileSync`,
   sin pasar por ningún ayudante que limpie claves) y lo mete por la ingesta
   real del backend, exigiendo `accepted`;
2. hace lo mismo con cada fichero de `valid/` y exige `rejected` /
   `schema_violation` mencionando `_schema` — control negativo: el día que la
   premisa cambie, se pone rojo en vez de dejar el remedio por inercia;
3. exige correspondencia **total y biyectiva** entre los dos directorios, de
   modo que un ejemplo válido nuevo sin su gemelo publicable rompe la suite.
