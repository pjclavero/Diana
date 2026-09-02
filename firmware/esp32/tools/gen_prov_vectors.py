#!/usr/bin/env python3
"""Genera vectores de prueba REALES para el plano DEVICE_MANAGEMENT (D1b).

Reimplementa la canonicalizacion del contrato de forma INDEPENDIENTE (en
Python) y firma con ECDSA P-256 de verdad. El fichero generado contiene SOLO
material publico: clave publica de la raiz, SPKI de las claves operativas y
firmas. La clave privada es EFIMERA: se genera en memoria en cada ejecucion y
no se escribe en ningun sitio.

Que un vector generado aqui verifique en C demuestra dos cosas a la vez:
la canonicalizacion de C coincide byte a byte con la del contrato (si no, el
digest no coincide y la firma no verifica) y el verificador ECDSA propio es
correcto frente a una implementacion de referencia.

    python3 firmware/esp32/tools/gen_prov_vectors.py \
        > firmware/esp32/test_host/tests/prov_vectors.h
"""
import hashlib
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils

ABSENT = 0xFFFFFFFF
DOMAIN_ORDER = "diana/provision/v1"
DOMAIN_DELEG = "diana/delegation/v1"
ALG = "ECDSA-P256-SHA256-P1363-B64URL"
SCOPE = "DIANA_PROVISIONING"


def b64u(raw: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def rec(value) -> bytes:
    """longitud(4, big-endian) ++ valor; ausente = 0xFFFFFFFF sin valor."""
    if value is None or value == "":
        return ABSENT.to_bytes(4, "big")
    s = value if isinstance(value, str) else str(value)
    b = s.encode("utf-8")
    return len(b).to_bytes(4, "big") + b


def canon_order(c: dict) -> bytes:
    return b"".join([
        rec(DOMAIN_ORDER),
        rec(c["action"]),
        rec(c.get("mode") or None),
        rec(c["system_id"]),
        rec(c["device_id"]),
        rec(str(c["provisioning_sequence"])),
        rec(c.get("rotation_id")),
        rec(c.get("current_epoch")),
        rec(c.get("next_epoch")),
        rec(c.get("epoch")),
        rec(str(c["issued_at_ms"])),
        rec(c["provisioning_key_fingerprint"]),
        rec(c.get("provision_id")),
    ])


def canon_deleg(d: dict) -> bytes:
    return b"".join([
        rec(DOMAIN_DELEG),
        rec(str(d["delegation_version"])),
        rec(d["delegation_id"]),
        rec(d["root_key_id"]),
        rec(d["operational_key_id"]),
        rec(d["operational_public_key"]),
        rec(d["scope"]),
        rec(str(d["delegation_sequence"])),
        rec(d["system_id"]),
    ])


def sign_p1363(key, msg: bytes) -> str:
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(der)
    return b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def sec1(key) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint)


def spki_b64u(key) -> str:
    return b64u(key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo))


def c_bytes(name: str, raw: bytes) -> str:
    body = ", ".join("0x%02x" % b for b in raw)
    return "static const uint8_t %s[%d] = {%s};\n" % (name, len(raw), body)


DEVICE = "module-07"
SYSTEM = "system-a"
FPRINT = "1f" * 32          # provisioning_key_fingerprint de fabrica
FPRINT_OTHER = "2e" * 32

EPOCH_A = "11111111-1111-4111-8111-111111111111"
EPOCH_B = "22222222-2222-4222-8222-222222222222"
EPOCH_C = "33333333-3333-4333-8333-333333333333"
ROT_1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
ROT_2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
PROV_ID = "cccccccc-3333-4333-8333-cccccccccccc"
PROV_ID2 = "dddddddd-4444-4444-8444-dddddddddddd"


def order(name, **kw):
    c = {
        "name": name,
        "action": "PROVISION",
        "mode": "",
        "system_id": SYSTEM,
        "device_id": DEVICE,
        "provisioning_sequence": 1,
        "rotation_id": "",
        "current_epoch": "",
        "next_epoch": "",
        "epoch": "",
        "provision_id": "",
        "issued_at_ms": 1750000000000,
        "provisioning_key_fingerprint": FPRINT,
    }
    c.update(kw)
    return c


def main() -> int:
    root = ec.generate_private_key(ec.SECP256R1())
    op1 = ec.generate_private_key(ec.SECP256R1())
    op2 = ec.generate_private_key(ec.SECP256R1())
    stranger = ec.generate_private_key(ec.SECP256R1())

    delegs = []
    # D3 comparte SECUENCIA con D2 pero es otra credencial, tambien firmada
    # por la raiz: es el unico modo de producir delegation_sequence_conflict
    # (manipular D2 la invalidaria antes, por firma).
    # D4 es una credencial VALIDA de la raiz pero emitida para OTRO sistema:
    # sin ella no se puede distinguir "no comprueba el system_id" de "lo
    # comprueba", porque manipular D1 la invalidaria antes por firma.
    for tag, seq, opkey, kid, did, sysid in (
            ("D1", 1, op1, "op-key-1", "dede1111", SYSTEM),
            ("D2", 2, op2, "op-key-2", "dede2222", SYSTEM),
            ("D3", 2, op1, "op-key-3", "dede3333", SYSTEM),
            ("D4", 1, op1, "op-key-4", "dede4444", "system-b")):
        d = {
            "tag": tag,
            "delegation_version": 1,
            "delegation_id": "%s-0000-4000-8000-000000000000" % did,
            "root_key_id": "root-key-2026",
            "operational_key_id": kid,
            "operational_public_key": spki_b64u(opkey),
            "scope": SCOPE,
            "delegation_sequence": seq,
            "system_id": sysid,
        }
        d["root_signature"] = sign_p1363(root, canon_deleg(d))
        d["fingerprint"] = hashlib.sha256(canon_deleg(d)).hexdigest()
        delegs.append(d)

    orders = [
        order("provision_ok", action="PROVISION", provisioning_sequence=10,
              epoch=EPOCH_A, provision_id=PROV_ID),
        order("provision_ok2", action="PROVISION", provisioning_sequence=40,
              epoch=EPOCH_C, provision_id=PROV_ID2),
        order("provision_other_device", action="PROVISION",
              provisioning_sequence=11, epoch=EPOCH_A, provision_id=PROV_ID,
              device_id="module-99"),
        order("provision_bad_fp", action="PROVISION", provisioning_sequence=12,
              epoch=EPOCH_A, provision_id=PROV_ID,
              provisioning_key_fingerprint=FPRINT_OTHER),
        order("prepare_ok", action="PREPARE", mode="NORMAL",
              provisioning_sequence=20, rotation_id=ROT_1,
              current_epoch=EPOCH_A, next_epoch=EPOCH_B),
        order("prepare_stale", action="PREPARE", mode="NORMAL",
              provisioning_sequence=21, rotation_id=ROT_2,
              current_epoch=EPOCH_C, next_epoch=EPOCH_B),
        order("commit_ok", action="COMMIT", mode="NORMAL",
              provisioning_sequence=30, rotation_id=ROT_1),
        order("commit_unknown", action="COMMIT", mode="EMERGENCY",
              provisioning_sequence=31, rotation_id=ROT_2),

        # --- casos abiertos por la supervision independiente ---------------
        #
        # prepare_seq_vieja: PREPARE que la maquina de dominio ACEPTARIA (el
        # dispositivo esta READY y current_epoch es el vigente), con secuencia
        # 5 POR DEBAJO de la ya consumida. Existe porque el unico replay del
        # gate era `provision_ok` dos veces, y ahi la segunda la para el estado
        # de dominio (`already_provisioned`), no la barrera: el caso era
        # DEGENERADO y no distinguia una cosa de la otra. Con este vector la
        # barrera de secuencia es lo UNICO que puede rechazar.
        order("prepare_seq_vieja", action="PREPARE", mode="NORMAL", provisioning_sequence=5,
              rotation_id=ROT_2, current_epoch=EPOCH_A, next_epoch=EPOCH_C),

        # provision_other_system: firma criptograficamente valida, delegacion
        # valida y device CORRECTO, pero system_id ajeno. Existe porque el
        # unico vector con sistema ajeno era una DELEGACION, asi que la
        # comprobacion de system_id de la ORDEN no la mataba ninguna prueba.
        order("provision_other_system", action="PROVISION",
              provisioning_sequence=13, epoch=EPOCH_C, provision_id=PROV_ID,
              system_id="system-z"),
    
        # --- FRONTERAS DE CANONICALIZACION (paso 7) ----------------------------
        # El bucle de test_provisioning.c recorre TODOS los vectores comparando
        # longitud y SHA-256 de la canonica en C contra esta referencia Python.
        # Cada caso de abajo existe para que una diferencia de tratamiento entre
        # ambas implementaciones se vea, en vez de quedar en la zona sin cubrir.

        # Minimo absoluto: todos los opcionales ausentes.
        order("canon_minimo", action="PROVISION", provisioning_sequence=1),

        # Secuencia en sus extremos. El maximo es el de uint64.
        order("canon_seq_cero", action="PROVISION", provisioning_sequence=0),
        order("canon_seq_max", action="PROVISION",
              provisioning_sequence=18446744073709551615),

        # issued_at_ms en sus extremos: cambia la LONGITUD del registro, que es
        # justo lo que una canonica con prefijo de longitud debe respetar.
        order("canon_ts_cero", action="PROVISION", provisioning_sequence=2,
              issued_at_ms=0),
        order("canon_ts_max", action="PROVISION", provisioning_sequence=3,
              issued_at_ms=18446744073709551615),

        # Todos los opcionales PRESENTES a la vez: la ruta contraria al minimo.
        order("canon_todos_opcionales", action="COMMIT", mode="EMERGENCY",
              provisioning_sequence=4,
              rotation_id="11111111-1111-4111-8111-111111111111",
              current_epoch="22222222-2222-4222-8222-222222222222",
              next_epoch="33333333-3333-4333-8333-333333333333",
              epoch="44444444-4444-4444-8444-444444444444",
              provision_id="55555555-5555-4555-8555-555555555555"),

        # CADENA VACIA frente a AUSENTE. rec() las trata IGUAL (0xFFFFFFFF), asi
        # que estos dos vectores deben producir canonicas IDENTICAS. Es la
        # semantica vigente y aqui queda anclada: si alguien la cambia en un lado
        # y no en el otro, el test lo cazara. Ver CONTRACT_GAP-H4-EMPTY-VS-ABSENT.
        order("canon_vacio_explicito", action="PROVISION", provisioning_sequence=5,
              rotation_id="", current_epoch="", provision_id=""),
        order("canon_vacio_ausente", action="PROVISION", provisioning_sequence=5),

        # UTF-8 multibyte: la longitud del registro va en BYTES, no en caracteres.
        # Si una implementacion contase caracteres, esta canonica divergiria.
        order("canon_utf8", action="PROVISION", provisioning_sequence=6,
              rotation_id="rotacion-\u00f1-\u20ac-\u4e2d"),

        # Un solo byte de diferencia en un campo: canonicas distintas.
        order("canon_un_byte_a", action="PROVISION", provisioning_sequence=7,
              rotation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        order("canon_un_byte_b", action="PROVISION", provisioning_sequence=7,
              rotation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"),
    ]
    for c in orders:
        raw = canon_order(c)
        c["canon_sha256"] = hashlib.sha256(raw).hexdigest()
        c["canon_len"] = len(raw)
        c["signature"] = sign_p1363(op1, raw)
        c["signature_op2"] = sign_p1363(op2, raw)
        c["signature_stranger"] = sign_p1363(stranger, raw)

    o = sys.stdout.write
    o("/* GENERADO por firmware/esp32/tools/gen_prov_vectors.py - NO EDITAR.\n"
      " * Solo material PUBLICO: claves publicas y firmas. Las claves privadas\n"
      " * usadas para producirlo fueron efimeras y no existen en ningun sitio. */\n")
    o("#ifndef DIANA_PROV_VECTORS_H\n#define DIANA_PROV_VECTORS_H\n\n")
    o("#include <stdint.h>\n\n")
    o('#define PV_DEVICE_ID "%s"\n' % DEVICE)
    o('#define PV_SYSTEM_ID "%s"\n' % SYSTEM)
    o('#define PV_FINGERPRINT "%s"\n' % FPRINT)
    o('#define PV_EPOCH_A "%s"\n' % EPOCH_A)
    o('#define PV_EPOCH_B "%s"\n' % EPOCH_B)
    o('#define PV_EPOCH_C "%s"\n' % EPOCH_C)
    o('#define PV_ROT_1 "%s"\n' % ROT_1)
    o('#define PV_ROT_2 "%s"\n\n' % ROT_2)

    o(c_bytes("PV_ROOT_KEY", sec1(root)))
    o(c_bytes("PV_STRANGER_KEY", sec1(stranger)))
    o('static const char PV_ROOT_KEY_ID[] = "root-key-2026";\n\n')

    o("typedef struct {\n"
      "    const char *tag;\n"
      "    uint64_t    version;\n"
      "    const char *delegation_id;\n"
      "    const char *root_key_id;\n"
      "    const char *operational_key_id;\n"
      "    const char *operational_public_key;\n"
      "    const char *scope;\n"
      "    uint64_t    sequence;\n"
      "    const char *system_id;\n"
      "    const char *root_signature;\n"
      "    const char *fingerprint_hex;\n"
      "} pv_delegation;\n\n")
    o("static const pv_delegation PV_DELEGS[%d] = {\n" % len(delegs))
    for d in delegs:
        o('    {"%s", %d, "%s", "%s", "%s", "%s", "%s", %dULL, "%s", "%s", "%s"},\n'
          % (d["tag"], d["delegation_version"], d["delegation_id"],
             d["root_key_id"], d["operational_key_id"],
             d["operational_public_key"], d["scope"], d["delegation_sequence"],
             d["system_id"], d["root_signature"], d["fingerprint"]))
    o("};\n\n")

    o("typedef struct {\n"
      "    const char *name;\n"
      "    const char *action;\n"
      "    const char *mode;\n"
      "    const char *system_id;\n"
      "    const char *device_id;\n"
      "    uint64_t    sequence;\n"
      "    const char *rotation_id;\n"
      "    const char *current_epoch;\n"
      "    const char *next_epoch;\n"
      "    const char *epoch;\n"
      "    uint64_t    issued_at_ms;\n"
      "    const char *fingerprint;\n"
      "    const char *provision_id;\n"
      "    const char *signature;        /* firmada por la clave operativa 1 */\n"
      "    const char *signature_op2;    /* por la operativa 2 */\n"
      "    const char *signature_stranger;\n"
      "    const char *canon_sha256;     /* digest de la cadena canonica */\n"
      "    uint32_t    canon_len;\n"
      "} pv_order;\n\n")
    o("static const pv_order PV_ORDERS[%d] = {\n" % len(orders))
    for c in orders:
        o('    {"%s", "%s", "%s", "%s", "%s", %dULL, "%s", "%s", "%s", "%s", %dULL,\n'
          '     "%s", "%s",\n     "%s",\n     "%s",\n     "%s",\n     "%s", %d},\n'
          % (c["name"], c["action"], c["mode"], c["system_id"], c["device_id"],
             c["provisioning_sequence"], c["rotation_id"], c["current_epoch"],
             c["next_epoch"], c["epoch"], c["issued_at_ms"],
             c["provisioning_key_fingerprint"], c["provision_id"],
             c["signature"], c["signature_op2"], c["signature_stranger"],
             c["canon_sha256"], c["canon_len"]))
    o("};\n\n")
    o("#endif /* DIANA_PROV_VECTORS_H */\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
