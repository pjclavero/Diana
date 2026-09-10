#!/usr/bin/env bash
# ==============================================================================
# Diana · secrets-scan.sh — escaneo de material sensible en el repositorio
# ==============================================================================
# QUÉ HACE
#   Recorre los ficheros RASTREADOS POR GIT (`git ls-files`, no el árbol sucio:
#   lo que importa es lo que se publica, no lo que hay en el disco de nadie) y
#   falla si encuentra:
#
#     A. Material de clave privada / PKI que sólo debe existir en fábrica o
#        administración  ..............................................  D2
#     B. Credenciales de laboratorio o hashes de broker en la fuente única de
#        identidades y sus derivados  .................................  D3
#     C. Secretos genéricos: claves privadas PEM, hashes de mosquitto_passwd,
#        tokens de proveedor, asignaciones PASSWORD/SECRET/TOKEN con un valor
#        que no es un marcador de plantilla.
#
# POR QUÉ NO ES UN `grep -i password`
#   Un recuento de apariciones de texto da falsos negativos en cuanto alguien
#   renombra la variable. Aquí cada regla describe la FORMA del secreto (un
#   bloque PEM, un hash `$6$…`, un token con su prefijo de proveedor) o una
#   RUTA que no debe existir versionada; los nombres de variable sólo se usan
#   para la regla C, que además exige que el VALOR no sea un marcador.
#
# CALIBRACIÓN (obligatoria antes de creerse un PASS)
#   ./secrets-scan.sh --self-test
#   planta secretos de mentira en una copia temporal del repo y comprueba que
#   el escáner se pone ROJO con cada uno. Un escáner que nunca ha fallado no es
#   evidencia de nada.
#
# NO IMPRIME SECRETOS: de cada coincidencia se informa fichero, línea y regla.
# Nunca el contenido.
#
# Uso:
#   ./scripts/security/secrets-scan.sh            # escanea el repo
#   ./scripts/security/secrets-scan.sh --self-test
# Salida: rc=0 limpio · rc=1 hallazgos · rc=2 error de uso/entorno
# ==============================================================================
set -uo pipefail
export LC_ALL=C

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: esto no es un repositorio git." >&2; exit 2; }
cd "$REPO_ROOT" || exit 2

FINDINGS=0
report() {  # regla, fichero, línea, explicación — NUNCA el contenido
  printf 'HALLAZGO [%s] %s:%s — %s\n' "$1" "$2" "${3:-?}" "$4"
  FINDINGS=$((FINDINGS + 1))
}

# ===========================================================================
# Autoprueba de calibración
# ===========================================================================
self_test() {
  local tmproot tmp rc ok=0 ko=0
  tmproot="$(mktemp -d)"; tmp="$tmproot/repo"
  trap 'rm -rf "$tmproot"' RETURN
  git -c advice.detachedHead=false clone --no-hardlinks --quiet "$REPO_ROOT" "$tmp" || {
    echo "ERROR: no se pudo clonar para la autoprueba." >&2; return 2; }
  # El clon lleva el HEAD; la copia del ARBOL DE TRABAJO es la que se calibra
  # (si no, se estaria midiendo una version distinta de la que se va a usar).
  mkdir -p "$tmp/scripts/security"
  cp "$REPO_ROOT/scripts/security/secrets-scan.sh" "$tmp/scripts/security/secrets-scan.sh"
  chmod +x "$tmp/scripts/security/secrets-scan.sh"

  probe() {  # $1 = nombre, $2 = ruta relativa, $3 = contenido plantado
    local name="$1" path="$2" body="$3" out
    mkdir -p "$tmp/$(dirname "$path")"
    printf '%s\n' "$body" >> "$tmp/$path"
    ( cd "$tmp" && git add -f -- "$path" >/dev/null 2>&1 )
    # Verifica que la mutación ENTRÓ de verdad antes de medir.
    if ! ( cd "$tmp" && git ls-files --error-unmatch -- "$path" >/dev/null 2>&1 ); then
      echo "  ERROR · la mutación '$name' NO llegó al índice; medición inválida"; ko=$((ko+1)); return
    fi
    out="$( cd "$tmp" && ./scripts/security/secrets-scan.sh 2>&1 )"; rc=$?
    if [[ $rc -ne 0 ]]; then
      echo "  ROJO OK · $name (el escáner lo detecta)"; ok=$((ok+1))
    else
      echo "  VERDE FALSO · $name NO se detecta"; ko=$((ko+1))
    fi
    ( cd "$tmp" && git rm -f --quiet --ignore-unmatch -- "$path" >/dev/null 2>&1 || true )
    ( cd "$tmp" && git checkout -- "$path" >/dev/null 2>&1 || true )
    rm -f "$tmp/$path"
  }

  echo "[calibración] baseline: el repositorio sin plantar nada"
  out="$( cd "$tmp" && ./scripts/security/secrets-scan.sh 2>&1 )"; rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "  VERDE OK · baseline limpio"; ok=$((ok+1))
  else
    echo "  ROJO INESPERADO · el baseline ya tiene hallazgos:"; echo "$out" | sed 's/^/    /'; ko=$((ko+1))
  fi

  echo "[calibración] secretos plantados a propósito (deben poner el escáner ROJO)"
  probe "clave privada de la CA (D2)" "infrastructure/mosquitto/certs/ca.key" \
    "-----BEGIN RSA PRIVATE KEY-----"
  probe "passwd del broker versionado (D3)" "infrastructure/mosquitto/passwd" \
    'module-01:$7$101$falsohashdeprueba$falsohashdeprueba='
  probe "contrasena en la fuente unica (D3)" "infrastructure/mosquitto/identities.json" \
    '  "password": "no-deberia-existir-jamas"'
  probe "artefacto de identidad NUEVO con credencial (D3)" "infrastructure/mosquitto/identities.extra.json" \
    '{ "password": "no-deberia-existir-jamas" }'
  probe "artefacto de CI que publica el material TLS (D2)" ".github/workflows/probe.yml" \
    '      - uses: actions/upload-artifact@v4
        with:
          path: infrastructure/mosquitto/certs'
  probe "token de proveedor" "docs/nota-de-prueba.md" \
    "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  probe "credencial embebida" "docs/nota-de-prueba-2.md" \
    'MQTT_BACKEND_PASSWORD=Contrasena-Real-De-Laboratorio-2026'
  # Con cuerpo base64: la regla exige material, no solo la cabecera.
  probe "clave PEM con material" "docs/nota-de-prueba-3.pem" \
    "-----BEGIN PRIVATE KEY-----
QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=
-----END PRIVATE KEY-----"

  echo
  echo "[calibración] $ok comprobación(es) en verde, $ko fallida(s)"
  [[ $ko -eq 0 ]]
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test; exit $?
fi

mapfile -t TRACKED < <(git ls-files)
[[ ${#TRACKED[@]} -gt 0 ]] || { echo "ERROR: git ls-files no devolvió nada." >&2; exit 2; }

# ---------------------------------------------------------------------------
# Excepciones DECLARADAS. Cada una lleva su motivo; sin motivo no hay excepción.
# ---------------------------------------------------------------------------
is_allowlisted() {
  case "$1" in
    # NO hay excepcion por directorio. Habia una, `*/testdata/*`, y era un
    # bypass en bloque: bastaba colocar una clave privada REAL bajo un
    # directorio con ese nombre para que el escaner la ignorase. Una supervision
    # independiente lo exploto y colo 6 de 6 evasiones, incluida una clave con
    # material. Ademas no protegia nada: `git ls-files | grep /testdata/`
    # devolvia CERO ficheros, asi que el agujero no compraba ni una excepcion
    # legitima.
    #
    # Si algun dia hace falta material de prueba que dispare una regla, la
    # excepcion se declara POR FICHERO y con su motivo, como las dos de abajo.
    # Una excepcion por patron de ruta la escribe el infractor.
    # Este mismo escáner y su documentación describen los patrones que buscan.
    scripts/security/secrets-scan.sh)     return 0 ;;
    docs/security/pki-y-secretos.md)      return 0 ;;
    *) return 1 ;;
  esac
}

# Una clave privada de verdad es una cabecera PEM MÁS un cuerpo base64. Los
# literales `'-----BEGIN EC PRIVATE KEY-----'` que usan los tests como valor de
# columna no son claves: no hay material que robar. Distinguirlos por la
# ESTRUCTURA evita tanto el falso positivo como el falso negativo de una regla
# que se limitase a la cabecera.
has_private_key_material() {
  local file="$1"
  grep -qE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$file" 2>/dev/null || return 1
  grep -qE '^[A-Za-z0-9+/]{40,}={0,2}$' "$file" 2>/dev/null
}

# ===========================================================================
# A. D2 · material que sólo debe existir en fábrica/administración
# ===========================================================================
# Regla (docs/security/pki-y-secretos.md): la clave privada de la CA vive
# EXCLUSIVAMENTE en $CA_DIR (por defecto /root/diana-pki, modo 0700) de la
# máquina de administración. No entra en el repositorio, ni en una imagen de
# contenedor, ni en un artefacto de CI, ni en el directorio de despliegue
# infrastructure/mosquitto/certs/, ni en ningún cliente. Quien la tenga puede
# emitir un certificado de servidor válido y suplantar al broker.
for f in "${TRACKED[@]}"; do
  is_allowlisted "$f" && continue
  case "$f" in
    *ca.key|*/ca.key)
      report D2-CA-KEY "$f" 0 "clave privada de CA versionada: debe vivir SÓLO en \$CA_DIR de administración" ;;
    infrastructure/mosquitto/certs/*)
      report D2-CERT-DIR "$f" 0 "material TLS de despliegue versionado (infrastructure/mosquitto/certs/ está en .gitignore)" ;;
    infrastructure/mosquitto/passwd)
      report D3-PASSWD "$f" 0 "fichero de credenciales del broker versionado" ;;
    *.p12|*.pfx|*.jks)
      report D2-KEYFILE "$f" 0 "almacén de claves versionado" ;;
    *.key|*.pem)
      # Un .pem PÚBLICO (certificado de CA, cadena) no es un secreto, y el
      # árbol tiene marcadores de posición que sólo llevan texto. Lo que no
      # puede estar versionado es MATERIAL PRIVADO: se decide por el
      # contenido, no por la extensión.
      if has_private_key_material "$f"; then
        report D2-KEYFILE "$f" 0 "fichero con material de clave PRIVADA versionado"
      fi ;;
  esac
done

# La regla de .gitignore que sostiene D2/D3 tiene que seguir existiendo: si
# alguien la borra, el escáner de rutas de arriba dejaría de tener red debajo.
for pat in 'infrastructure/mosquitto/certs/' 'infrastructure/mosquitto/passwd' '*.key'; do
  grep -qxF "$pat" .gitignore || \
    report D2-GITIGNORE .gitignore 0 "falta el patrón '$pat': el material sensible dejaría de estar ignorado"
done

# `compose.yml` no debe montar el directorio de certificados entero en el
# broker: eso metería ca.key dentro del contenedor si alguien la dejase ahí.
if grep -qE '^\s*-\s*\./infrastructure/mosquitto/certs:?/?:' compose.yml 2>/dev/null; then
  report D2-CERT-MOUNT compose.yml 0 "se monta el DIRECTORIO de certificados en un contenedor; móntense los ficheros uno a uno"
fi

# Ningun workflow debe SUBIR COMO ARTEFACTO el material sensible: un artefacto
# de CI es descargable por cualquiera con acceso al repositorio y sobrevive a la
# ejecucion. Se mira la ruta que se publica, no el nombre del paso.
for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [[ -f "$wf" ]] || continue
  while IFS=: read -r ln _; do
    [[ -n "$ln" ]] && report D2-CI-ARTIFACT "$wf" "$ln" "un artefacto de CI publica material sensible (certs/, passwd, *.key)"
  done < <(grep -nE 'path:.*(mosquitto/certs|mosquitto/passwd|ca\.key|\*\.key|\*\.pem)' "$wf" 2>/dev/null || true)
done

# ===========================================================================
# B. D3 · la fuente única de identidades y sus derivados, sin credenciales
# ===========================================================================
# Regla: infrastructure/mosquitto/identities.json declara QUIÉN existe, jamás
# CON QUÉ contraseña. Los secretos los crea generate-users.sh con
# mosquitto_passwd sobre `passwd`, que está en .gitignore y nunca se versiona.
# La lista NO se escribe a mano: se DESCUBRE sobre los ficheros rastreados. Una
# lista fija deja fuera cualquier artefacto de identidad nuevo, y ese es
# justamente el fichero por el que volveria a colarse una credencial de
# laboratorio (lo demostro la calibracion: un `identities.probe.json` plantado
# pasaba inadvertido mientras la lista era fija).
mapfile -t IDENTITY_FILES < <(printf '%s\n' "${TRACKED[@]}" | grep -E '(^|/)(identities|users\.generated|modules\.generated)[^/]*$' || true)
for f in "${IDENTITY_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  # B.1 — ninguna CLAVE de credencial en el JSON/artefacto.
  while IFS=: read -r ln _; do
    [[ -n "$ln" ]] && report D3-CRED-KEY "$f" "$ln" "campo de credencial en un artefacto de identidad (las contraseñas las crea generate-users.sh, nunca el repo)"
  done < <(grep -nEi '"(password|passwd|pass|secret|token|api_?key|credential)"\s*:' "$f" 2>/dev/null || true)

  # B.2 — ningún hash de mosquitto_passwd colado en el artefacto.
  while IFS=: read -r ln _; do
    [[ -n "$ln" ]] && report D3-PW-HASH "$f" "$ln" "hash de mosquitto_passwd en un artefacto de identidad"
  done < <(grep -nE '\$(6|7)\$' "$f" 2>/dev/null || true)

  # B.3 — la plantilla .env sólo lleva NOMBRES de variable; su valor de
  # contraseña debe ser el marcador, nunca una contraseña de laboratorio.
  if [[ "$f" == *".env.example" ]]; then
    while IFS=: read -r ln rest; do
      val="${rest#*=}"
      case "$val" in
        CAMBIAR|CHANGEME|changeme|''|'<'*'>'|xxx*|XXX*) ;;
        *) report D3-ENV-VALUE "$f" "$ln" "la plantilla trae un VALOR de contraseña en vez del marcador CAMBIAR" ;;
      esac
    done < <(grep -nE '^[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|API_KEY)[A-Z0-9_]*=' "$f" 2>/dev/null || true)
  fi
done

# ===========================================================================
# C. Secretos genéricos en cualquier fichero rastreado
# ===========================================================================
scan_generic() {
  local f="$1" ln pat rule desc
  # Bloques PEM de clave privada CON cuerpo (ver has_private_key_material).
  if has_private_key_material "$f"; then
    while IFS=: read -r ln _; do
      [[ -n "$ln" ]] && report PEM-PRIVATE-KEY "$f" "$ln" "bloque de clave privada PEM con material"
    done < <(grep -nE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$f" 2>/dev/null || true)
  fi

  # Entrada de mosquitto_passwd: usuario:$7$…
  while IFS=: read -r ln _; do
    [[ -n "$ln" ]] && report MOSQUITTO-PASSWD "$f" "$ln" "entrada de mosquitto_passwd (usuario:hash)"
  done < <(grep -nE '^[A-Za-z0-9._-]+:\$(6|7)\$' "$f" 2>/dev/null || true)

  # Tokens con prefijo de proveedor, y claves de acceso AWS.
  while IFS=: read -r ln _; do
    [[ -n "$ln" ]] && report PROVIDER-TOKEN "$f" "$ln" "token con prefijo de proveedor"
  done < <(grep -nE '(gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})' "$f" 2>/dev/null || true)

  # Asignación de credencial con VALOR literal. Se descartan referencias a
  # variables (${...}, $VAR), marcadores y valores manifiestamente de ejemplo.
  while IFS=: read -r ln rest; do
    [[ -z "$ln" ]] && continue
    # El valor se extrae respetando el separador REAL de la línea ([:=]); antes
    # se cortaba siempre por '=', y en una línea YAML/JSON sin '=' el "valor"
    # acababa siendo la línea entera (falso positivo de 203 caracteres sobre un
    # `$comment` que sólo mencionaba la palabra SECRET).
    val="$(printf '%s' "$rest" | sed -E 's/^[^#]*[A-Za-z0-9_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*//')"
    val="${val%%#*}"
    val="$(printf '%s' "$val" | tr -d '"'"'"' ,;\r')"
    [[ ${#val} -lt 12 ]] && continue
    # Una linea que interpola una variable no lleva el secreto: lo referencia.
    case "$rest" in *'${'*) continue ;; esac
    case "$val" in
      '$'*|*'${'*) continue ;;
      # Restos de sintaxis, no valores: tipos, listas, aperturas de bloque.
      *' '*|*'<'*|*'{'*|*'('*) continue ;;
      # Marcadores de plantilla e instrucciones al operador.
      *CAMBIAR*|*CHANGEME*|*CHANGE_ME*|*changeme*|*change_me*) continue ;;
      *EXAMPLE*|*example*|*placeholder*|*PLACEHOLDER*) continue ;;
      *xxx*|*XXX*|'<'*) continue ;;
      *your-*|*YOUR-*|*dummy*|*sample*) continue ;;
      # Valores que se DECLARAN de prueba. Un secreto de produccion no se
      # llama a si mismo "de-pruebas" ni "not-a-production-secret"; si alguien
      # etiqueta asi una credencial real, el problema es esa mentira, no el
      # escaner. Se acepta a cambio de no exceptuar rutas enteras de test,
      # que es lo que de verdad abriria un agujero.
      *test*|*TEST*|*prueba*|*PRUEBA*|*no-productivo*|*not-a-production*|*e2e*) continue ;;
    esac

    # El valor es el NOMBRE de una variable de entorno, no un secreto.
    #
    # `export const MOSQUITTO_PASSWD_FILE_ENV = 'DIANA_MOSQUITTO_PASSWD_FILE';`
    # casaba la regla porque el identificador lleva PASSWD y el valor es un
    # literal largo. Marcarlo es un FALSO POSITIVO, y un escaner que da rojos
    # falsos acaba desactivado -- que es peor que no tenerlo.
    #
    # Un nombre de variable de entorno es MAYUSCULAS, digitos y guiones bajos,
    # nada mas. Una contrasena real que tuviera EXACTAMENTE esa forma seria
    # pesima y ademas la cazarian las otras reglas (fichero de credenciales,
    # PEM, artefacto de CI). No se exceptua ninguna ruta ni ningun fichero: se
    # afina la regla, que es donde estaba el error.
    if [[ "$val" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
      continue
    fi
    report HARDCODED-CREDENTIAL "$f" "$ln" "asignación de credencial con un valor literal de ${#val} caracteres"
  done < <(grep -nE '^[^#]*\b[A-Za-z0-9_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)[A-Za-z0-9_]*\s*[:=]\s*["'"'"']?[^"'"'"'[:space:]]{12,}' "$f" 2>/dev/null || true)
}

for f in "${TRACKED[@]}"; do
  is_allowlisted "$f" && continue
  [[ -f "$f" ]] || continue
  # Sólo texto: un binario no se analiza línea a línea.
  grep -qI . "$f" 2>/dev/null || continue
  scan_generic "$f"
done


echo
if [[ $FINDINGS -eq 0 ]]; then
  echo "secrets-scan: PASS — sin material sensible en los ${#TRACKED[@]} ficheros rastreados."
  exit 0
fi
echo "secrets-scan: FAIL — $FINDINGS hallazgo(s)."
exit 1
