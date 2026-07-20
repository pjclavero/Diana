#!/usr/bin/env python3
"""
Validador de contratos MQTT de Diana.

Comprueba tres cosas:
  1. Todos los esquemas de contracts/mqtt/ son JSON Schema 2020-12 correctos.
  2. Todo ejemplo bajo contracts/examples/valid/ valida contra su esquema.
  3. Todo ejemplo bajo contracts/examples/invalid/ FALLA contra su esquema
     (un ejemplo inválido que pasa es un agujero en el contrato).

Cada ejemplo declara su esquema en la clave "_schema" y, si es inválido,
el motivo en "_reason". Ambas claves se retiran antes de validar.

Uso:  python3 contracts/validate.py [--verbose]
Salida: 0 si todo conforma, 1 en caso contrario.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012
except ImportError:  # pragma: no cover
    print("ERROR: faltan dependencias. Instala: pip install jsonschema referencing", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent
MQTT = ROOT / "mqtt"
SCHEMAS = ROOT / "schemas"
EXAMPLES = ROOT / "examples"

META_KEYS = ("_schema", "_reason")


def load_registry() -> Registry:
    """Registra todos los esquemas sin acceso a red.

    Los $ref son relativos ('common.schema.json#/$defs/x') y se resuelven contra
    el $id del esquema que los contiene. Como common.schema.json vive en
    schemas/ y lo referencian esquemas de mqtt/, cada recurso se registra bajo
    ambas bases además de bajo su $id y su nombre de fichero.
    """
    bases = (
        "https://diana.seccionnueve/contracts/mqtt/",
        "https://diana.seccionnueve/contracts/schemas/",
    )
    registry = Registry()
    for path in list(MQTT.glob("*.schema.json")) + list(SCHEMAS.glob("*.schema.json")):
        doc = json.loads(path.read_text())
        resource = Resource.from_contents(doc, default_specification=DRAFT202012)
        registry = registry.with_resource(path.name, resource)
        for base in bases:
            registry = registry.with_resource(base + path.name, resource)
        if "$id" in doc:
            registry = registry.with_resource(doc["$id"], resource)
    return registry


def validator_for(schema_name: str, registry: Registry) -> Draft202012Validator:
    schema = json.loads((MQTT / schema_name).read_text())
    return Draft202012Validator(schema, registry=registry)


def strip_meta(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in META_KEYS}


def main(verbose: bool = False) -> int:
    registry = load_registry()
    failures: list[str] = []
    checked = 0

    # 1. Los esquemas son sintácticamente válidos.
    for path in sorted(MQTT.glob("*.schema.json")) + sorted(SCHEMAS.glob("*.schema.json")):
        try:
            Draft202012Validator.check_schema(json.loads(path.read_text()))
        except Exception as exc:
            failures.append(f"[schema] {path.name}: {exc}")
        else:
            checked += 1
            if verbose:
                print(f"  ok  schema   {path.name}")

    # 2 y 3. Ejemplos.
    for kind in ("valid", "invalid"):
        for path in sorted((EXAMPLES / kind).rglob("*.json")):
            doc = json.loads(path.read_text())
            rel = path.relative_to(EXAMPLES)
            schema_name = doc.get("_schema")
            if not schema_name:
                failures.append(f"[example] {rel}: falta la clave _schema")
                continue
            if kind == "invalid" and not doc.get("_reason"):
                failures.append(f"[example] {rel}: un ejemplo inválido debe documentar _reason")
                continue
            if not (MQTT / schema_name).exists():
                failures.append(f"[example] {rel}: esquema desconocido {schema_name}")
                continue

            validator = validator_for(schema_name, registry)
            errors = sorted(validator.iter_errors(strip_meta(doc)), key=lambda e: list(e.path))
            checked += 1

            if kind == "valid" and errors:
                detail = "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:3])
                failures.append(f"[valid] {rel} debería validar pero falla → {detail}")
            elif kind == "invalid" and not errors:
                failures.append(
                    f"[invalid] {rel} valida cuando NO debería. Motivo declarado: {doc['_reason']}"
                )
            elif verbose:
                mark = "ok  válido " if kind == "valid" else "ok  rechaza"
                print(f"  {mark} {rel}")

    print(f"\ncontratos: {checked} comprobaciones, {len(failures)} fallos")
    for f in failures:
        print(f"  FALLO {f}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(verbose="--verbose" in sys.argv))
