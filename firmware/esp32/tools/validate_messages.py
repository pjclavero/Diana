#!/usr/bin/env python3
"""
Valida los mensajes REALES generados por el firmware contra los JSON Schema
CONGELADOS de contracts/mqtt/.

La suite en C (test_host) vuelca cada payload que produce el firmware a un
directorio, con la clave "_schema" que indica su esquema. Este script:

  1. valida cada mensaje volcado contra su esquema,
  2. comprueba que las cadenas de los enumerados del firmware (src/types.c)
     coinciden EXACTAMENTE con los enum de common.schema.json y de los esquemas
     de mqtt/. Una divergencia aqui es un fallo de contrato, no de estilo.

Reutiliza el registro de esquemas de contracts/validate.py: no duplica la
resolucion de $ref.

Uso:  python3 firmware/esp32/tools/validate_messages.py --dir <directorio>
Salida: 0 si todo conforma, 1 en caso contrario.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[3]          # firmware/esp32/tools/x.py -> raiz del repo
CONTRACTS = REPO / "contracts"
TYPES_C = HERE.parents[1] / "components" / "diana_core" / "src" / "types.c"


def set_contracts(path: Path) -> None:
    """
    Apunta la validacion a OTRO arbol de contratos.

    Existe por ADR-0007: el discriminador `detection_method` vive en el contrato
    reconciliado por otro carril, que este worktree no puede contener
    (`contracts/**` no es propiedad de este carril). El arbol alternativo se
    extrae FUERA del repositorio y se valida contra el, sin copiar nada aqui.
    """
    global CONTRACTS
    CONTRACTS = path.resolve()


def load_contract_module():
    spec = importlib.util.spec_from_file_location(
        "diana_contracts_validate", CONTRACTS / "validate.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check_messages(msg_dir: Path, cv) -> list[str]:
    failures: list[str] = []
    registry = cv.load_registry()
    files = sorted(msg_dir.glob("*.json"))

    if not files:
        return ["no se ha volcado ningun mensaje: la suite en C no llego a ejecutarse"]

    for path in files:
        try:
            doc = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            failures.append(f"[json] {path.name}: JSON invalido generado por el firmware: {exc}")
            continue

        schema_name = doc.get("_schema")
        if not schema_name:
            failures.append(f"[msg] {path.name}: falta _schema")
            continue
        if not (CONTRACTS / "mqtt" / schema_name).exists():
            failures.append(f"[msg] {path.name}: esquema desconocido {schema_name}")
            continue

        validator = cv.validator_for(schema_name, registry)
        errors = sorted(validator.iter_errors(cv.strip_meta(doc)),
                        key=lambda e: list(e.path))
        if errors:
            detail = "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:3])
            failures.append(f"[msg] {path.name} NO valida contra {schema_name} -> {detail}")
        else:
            print(f"  ok   {path.name:34s} valida contra {schema_name}")

    print(f"\n  {len(files)} mensajes generados por el firmware comprobados")
    return failures


def firmware_enum_strings() -> dict[str, list[str]]:
    """Extrae las tablas STR_TABLE(...) de src/types.c."""
    src = TYPES_C.read_text()
    tables: dict[str, list[str]] = {}
    # Anclado a principio de linea: si no, la propia definicion #define STR_TABLE
    # casa primero y se traga la primera tabla real.
    for m in re.finditer(r"^STR_TABLE\(\s*(\w+)\s*,\s*\w+\s*,(.*?)\)\n", src,
                         re.S | re.M):
        name, body = m.group(1), m.group(2)
        tables[name] = re.findall(r'"([^"]*)"', body)
    return tables


def check_enums(cv) -> list[str]:
    """Compara enumerados del firmware con los del contrato."""
    failures: list[str] = []
    common = json.loads((CONTRACTS / "schemas" / "common.schema.json").read_text())
    defs = common["$defs"]

    def schema_enum(path: str, *keys):
        """Navega el esquema por claves (str) o indices (int) y devuelve su enum."""
        doc = json.loads((CONTRACTS / "mqtt" / path).read_text())
        for k in keys:
            doc = doc[k]
        return doc["enum"]

    expected = {
        "diana_target_state_str":        defs["targetState"]["enum"],
        "diana_module_state_str":        defs["moduleState"]["enum"],
        "diana_hit_classification_str":  defs["hitClassification"]["enum"],
        "diana_selector_str":            defs["selectorPosition"]["enum"],
        "diana_role_str":                defs["moduleRole"]["enum"],
        "diana_issuer_str":              defs["commandEnvelope"]["properties"]["issuer"]["enum"],
        "diana_diagnostic_kind_str":     schema_enum("module-diagnostic.schema.json",
                                                     "properties", "kind"),
        "diana_severity_str":            schema_enum("module-diagnostic.schema.json",
                                                     "properties", "severity"),
        "diana_command_action_str":      schema_enum("module-command.schema.json",
                                                     "properties", "action"),
        "diana_presence_reason_str":     schema_enum("module-presence.schema.json",
                                                     "properties", "reason"),
        "diana_ota_action_str":          schema_enum("ota-command.schema.json",
                                                     "properties", "action"),
        "diana_command_result_str":      schema_enum("module-status.schema.json",
                                                     "properties", "last_command",
                                                     "oneOf", 0, "properties", "result"),
    }

    hit = json.loads((CONTRACTS / "mqtt" / "hit-event.schema.json").read_text())
    if "detection_method" in hit.get("properties", {}):
        expected["diana_detection_method_str"] = \
            hit["properties"]["detection_method"]["enum"]
    else:
        print("  --   detection_method no existe en este contrato: sin comprobar")

    actual = firmware_enum_strings()

    for fn, want in expected.items():
        got = actual.get(fn)
        if got is None:
            failures.append(f"[enum] no se encontro la tabla {fn} en types.c")
        elif got != want:
            failures.append(
                f"[enum] {fn} diverge del contrato:\n"
                f"        firmware: {got}\n"
                f"        contrato: {want}"
            )
        else:
            print(f"  ok   {fn:34s} coincide con el contrato ({len(want)} valores)")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="directorio con los mensajes volcados")
    ap.add_argument("--contracts", default=None,
                    help="arbol de contratos alternativo (por defecto, el del repo)")
    args = ap.parse_args()

    if args.contracts:
        set_contracts(Path(args.contracts))
        print(f"\n  contratos: {CONTRACTS}")

    cv = load_contract_module()

    print("\n--- validacion de los mensajes generados por el firmware ---")
    failures = check_messages(Path(args.dir), cv)

    print("\n--- conformidad de los enumerados del firmware con el contrato ---")
    failures += check_enums(cv)

    print()
    if failures:
        print(f"CONTRATO: {len(failures)} FALLOS")
        for f in failures:
            print(f"  FALLO {f}")
        return 1
    print("CONTRATO: conforme")
    return 0


if __name__ == "__main__":
    sys.exit(main())
