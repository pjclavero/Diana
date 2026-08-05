# La puerta del contrato REST (panel ↔ backend)

Este directorio es el ÚNICO sitio del panel autorizado a hablar con el backend
por REST. Documento breve y comprobable: qué cubre hoy la puerta, qué NO cubre,
y qué hay que hacer exactamente para que cubra lo que falta.

## Cómo funciona

```
server/backend  ──`npm run openapi`──▶  contracts/api/openapi.json  (112 rutas)
                                            │
                             `openapi-typescript` (npx, versión fija)
                                            ▼
                        src/api/generated/schema.d.ts  ──▶  typedRequest.ts
                                                                │
                    todos los clientes REST del panel ◀──────────┘
```

- `make api-contract` regenera las dos cosas y falla con `git diff --exit-code`
  si el árbol diverge. En CI es el job **Contrato REST**.
- `typedRequest.ts` expone `apiRequest` / `apiRequestAs`, tipados contra
  `paths`. Es la puerta.
- `no-fetch-fuera-de-la-puerta.test.ts` recorre el AST de todo `src/` y falla
  si alguien llama a `fetch` fuera de la puerta, con fichero y línea. Existe
  porque **ésa fue la causa de fondo de las once pantallas rotas**: cada
  cliente traía su propio `fetch` y nadie comprobaba nunca si la ruta existía.

  **Hasta dónde llega ese guardarraíl, dicho sin adornos.** Es un detector
  sintáctico: reconoce formas de escritura, no el hecho de salir a la red. Caza
  `fetch(...)`, `window|globalThis|self.fetch(...)`, la misma llamada en
  notación con corchetes y `new XMLHttpRequest()`. **Se le escapan** el alias
  por variable (`const f = window.fetch; f(...)`), la desestructuración, el
  alias del objeto global, `fetch` recibido como parámetro, el `import()`
  dinámico y cualquier biblioteca HTTP de terceros. Cada una de esas fugas está
  fijada por una prueba del bloque «fugas conocidas», que existe para que esta
  lista no envejezca en silencio: si una se pone roja es que el detector ha
  mejorado y hay que actualizar la lista, no relajar la prueba. Conclusión
  práctica: **detiene al que escribe un cliente nuevo de la forma normal —que
  es como nacieron los trece de este directorio—, no a quien rodee la regla.**
- `puerta-de-tipos.test.ts` COMPILA casos con el compilador de TypeScript para
  demostrar qué rechaza la puerta y qué no. Una puerta de tipos no se puede
  comprobar con una prueba de ejecución.

El generador **no es dependencia del panel**: se invoca con `npx -y
openapi-typescript@7.13.0`. Motivo en el comentario de `api-contract` en el
`Makefile` — declara `peer typescript@^5.x` en todas sus versiones publicadas y
el panel usa `~6.0.2`, así que como `devDependency` rompía `npm ci` con
ERESOLVE en el job **Frontend**.

## Qué atrapa la puerta HOY (comprobado en `puerta-de-tipos.test.ts`)

| Clase de fallo | ¿Cubierta? |
| --- | --- |
| Ruta inventada por el panel | **Sí**, error de compilación |
| Ruta renombrada en el backend y no actualizada aquí | **Sí** |
| URL interpolada que no casa con la plantilla del contrato | **Sí** |
| Método HTTP que esa ruta no declara | **Sí** *(no lo estaba: ver abajo)* |
| **Forma** de la respuesta distinta de la real | **NO** |

> La fila del método estaba declarada como cubierta y **no lo estaba**: el
> parámetro `M` sólo se acotaba a `HttpMethod`, de modo que un método
> inexistente compilaba y se limitaba a resolver la respuesta a `never`. Lo
> destapó el banco de compilación y está corregido (`MethodsOf<P>`).

## Qué falta EXACTAMENTE para que atrape la forma

La puerta ya tiene el mecanismo montado: `ApiResponseOf<P, M>` lee la forma del
contrato, y `apiRequestAs` se autodesactiva (deja de compilar) en cuanto el
contrato declara esa forma. Lo que falta no está en el panel, está en el
backend, y es una sola cosa:

**Ningún controlador de Nest anota sus respuestas.** No es «muchos sí, algunos
no»: son **0 de 112 rutas** con `@ApiResponse({ type })`. Sin ese decorador, el
generador de OpenAPI de Nest emite `content?: never` para el 200 y
`ApiResponseOf` resuelve a `unknown`, que acepta cualquier cosa.

Para cerrar el hueco en una ruta hacen falta tres pasos:

1. **Una clase DTO de respuesta** en el backend, con `@ApiProperty()` en cada
   campo (Nest no infiere las propiedades sin él).
2. **`@ApiResponse({ status: 200, type: MiRespuestaDto })`** (o
   `@ApiOkResponse({ type: … })`) en el método del controlador. Para listados
   paginados, un DTO envoltorio con `items: Item[]` y el total — es justo la
   forma que hoy se supone a mano.
3. **`make api-contract`**: el JSON y `schema.d.ts` se regeneran, y en el panel
   la llamada correspondiente deja de compilar si la forma supuesta no cuadra.
   Ahí se sustituye `apiRequestAs<X>()(…)` por `apiRequest(…)` a secas.

### Por dónde empezar, y por qué por ahí

Por los **listados paginados**, en este orden:

1. `GET /api/games`, `GET /api/systems`, `GET /api/teams`, `GET /api/players`,
   `GET /api/modules`, `GET /api/users`, `GET /api/firmware`.

Razón, no gusto: son los que devuelven `{ items, … }` y cuyo consumidor
desenvuelve `.items` a mano. Si esa envoltura cambia o desaparece, el panel no
da error — **pinta una tabla vacía**, que es el fallo más caro de todos porque
parece un dato («no hay partidas») en vez de una avería. Es exactamente el
fallo que había en `realAdapter.listSystems`, que tipaba `/api/systems` como
array cuando está paginado. Anotando esos siete endpoints, la clase entera de
«tabla vacía en silencio» pasa a ser error de compilación.

Después, las respuestas de orden (`CommandAck` de identify / test-led /
test-sensor / calibrate), donde el panel supone `{command_id, delivered}`.

## Estado de la migración de clientes (2026-08-05)

Pasan por la puerta **7 de 13**: `modulesApi`, `realAdapter`, `playersApi`,
`viewsApi`, `participantsApi`, `scoreboardApi`, `firmwareApi`.

Siguen con llamada propia, como **deuda declarada** y con motivo, en
`no-fetch-fuera-de-la-puerta.test.ts`: `invitationsApi`, `presetsApi`,
`topologyApi`, `resilienceApi`, `managerActivationApi`, `diagnosticsApi` y
`auth/authApi`. Esa lista sólo puede encoger: la prueba falla si una entrada
sobra, y falla si aparece un cliente nuevo que no esté en ella.

## Huecos del backend declarados en `realAdapter.ts`

`RUTAS_AUSENTES_DEL_BACKEND` enumera las rutas que el panel necesita y el
backend no expone (X-21). Ya no producen un 404 mudo: fallan diciendo qué
falta. La prueba comprueba que ninguna exista ya en el contrato, de modo que
el día que el backend implemente cualquiera, CI se pone rojo y obliga a
migrarla en vez de dejar el hueco muerto.
