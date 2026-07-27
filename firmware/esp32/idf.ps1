# Lanzador de idf.py con el entorno ya preparado.
#
# El script export.ps1 de ESP-IDF solo afecta a la sesion en la que se ejecuta,
# asi que hay que invocarlo cada vez que se abre una consola nueva. Esto lo hace
# por ti:
#
#   .\idf.ps1 build
#   .\idf.ps1 flash monitor
#   .\idf.ps1 menuconfig
#   .\idf.ps1 -B build_modulo -DSDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.modulo" build
#
# Para salir del monitor: Ctrl+]
#
# Si ESP-IDF esta instalado en otra ruta, ajusta estas dos variables o
# defínelas antes de llamar al script.

param([Parameter(ValueFromRemainingArguments = $true)] $Args)

if (-not $env:IDF_PATH)        { $env:IDF_PATH = "E:\esp-idf\v5.5.2\esp-idf" }
if (-not $env:IDF_TOOLS_PATH)  { $env:IDF_TOOLS_PATH = "E:\espressif" }

if (-not (Test-Path "$env:IDF_PATH\export.ps1")) {
    Write-Error "No encuentro ESP-IDF en '$env:IDF_PATH'. Ajusta IDF_PATH."
    exit 1
}

& "$env:IDF_PATH\export.ps1" *> $null
& idf.py @Args
exit $LASTEXITCODE
