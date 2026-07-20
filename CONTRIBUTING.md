# Cómo contribuir a Diana

## Ramas

- `main` — desplegable siempre. **No se trabaja sobre ella**; sólo recibe PR.
- `develop` — integración. Base de todas las ramas de paquete.
- `feat/wpNN-…` — una rama por paquete de trabajo, con su worktree propio.

No se hace `force-push` sobre ramas compartidas. No se mezcla una rama con pruebas en rojo.

## Propiedad de rutas

Cada paquete escribe **sólo** dentro de sus rutas
([`docs/coordination/OWNERSHIP.md`](docs/coordination/OWNERSHIP.md)). Un cambio
transversal se solicita, no se hace por la vía rápida: dos agentes editando el mismo
fichero en paralelo es la forma más barata de perder trabajo.

## Commits

Pequeños, explicativos y de una sola naturaleza. **No** se mezcla infraestructura,
firmware y frontend en un mismo commit.

```
tipo(ámbito): resumen en imperativo

feat(backend): ingesta MQTT idempotente por event_id
fix(firmware): no perder la cola al reconectar
docs(adr): ADR-0002 modelo temporal
```

Tipos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `hw`.

## Contratos

`contracts/` es la fuente única. Antes de tocarlo:

1. Un cambio incompatible exige `v2` y un ADR. No se modifica `v1` en sitio.
2. Todo cambio añade su ejemplo válido **y** su ejemplo inválido.
3. `python3 contracts/validate.py` debe pasar en verde.

Un contrato se congela antes de que firmware y backend desarrollen en paralelo.

## Antes de pedir revisión

```bash
make lint
make test
python3 contracts/validate.py
```

Y en el PR: qué se ha ejecutado y con qué salida. Un PR sin evidencia no se revisa.

## Reglas de evidencia

Nada se declara validado sin haberlo ejecutado. En particular está prohibido escribir
"debería funcionar", "probablemente" o "parece correcto". Si algo no se ha podido probar
—porque falta hardware, credenciales o acceso— se dice, se explica por qué y se documenta
el procedimiento de validación pendiente.

Los fallos preexistentes no se ocultan ni se silencian: se registran.

## Quién aprueba

Quien implementa no aprueba su propio trabajo. Toda función necesita, además del autor,
revisión de calidad y —cuando aplique— de seguridad, antes del dictamen del supervisor.
