# Proyecto KiCad — módulo 3×3 — QUÉ ES Y QUÉ NO ES ESTE DIRECTORIO

> **ESTADO: SIN VALIDAR.** No se ha ejecutado ERC. No se ha abierto ningún fichero
> con KiCad. Estos ficheros **no autorizan la fabricación de ninguna PCB**.

## 1. Comprobación del entorno (hecha, no supuesta)

```
$ command -v kicad-cli   → NO ENCONTRADO
$ command -v kicad       → NO ENCONTRADO
$ command -v eeschema    → NO ENCONTRADO
$ command -v pcbnew      → NO ENCONTRADO
$ python3 -c "import pcbnew"  → ModuleNotFoundError: No module named 'pcbnew'
$ dpkg -l | grep -i kicad     → sin paquetes kicad
```

No hay KiCad en la máquina de trabajo, ni forma de ejecutar ERC/DRC, ni hardware
para medir nada. Todo lo que sigue está condicionado por eso.

## 2. ¿Se abren estos ficheros en KiCad?

**No lo sé y no puedo afirmarlo.** Lo único que puedo declarar es lo que sí he
comprobado, con las comprobaciones que sí existen en este entorno:

| Comprobación | Herramienta | Resultado |
|---|---|---|
| Balance de paréntesis con manejo de literales y escapes | script propio | 9/9 ficheros a profundidad 0, sin cierres sobrantes |
| Parseo completo como s-expression (tokenizador + árbol) | script propio | 9/9 ficheros parsean; raíz = `kicad_sch` |
| Unicidad de UUID entre todos los ficheros | script propio | 322 UUID, 0 duplicados |
| Apertura real en Eeschema | KiCad | **NO EJECUTADA — KiCad no disponible** |
| ERC | KiCad | **NO EJECUTADO** |
| DRC | KiCad | **NO EJECUTADO** |

Que un fichero parsee como s-expression **no garantiza** que KiCad lo acepte:
KiCad valida además el orden, el nombre y la aridad de cada token contra su
esquema interno, y esa validación no se puede reproducir aquí.

## 3. Qué contienen los ficheros

Sí contienen:

- `diana-module-3x3.kicad_pro` — fichero de proyecto con clases de red
  predimensionadas (`POWER_LED` 2,0 mm, `POWER_12V` 1,2 mm, `PIEZO_HV` con
  aislamiento 0,8 mm, `ETHERNET`).
- `diana-module-3x3.kicad_sch` — hoja raíz con las **8 sub-hojas** del encargo y
  todos sus **pines jerárquicos** (la interfaz entre hojas, es decir, el netlist
  de primer nivel).
- Las 8 hojas hijas, cada una con sus **etiquetas jerárquicas** y el resumen
  normativo del conexionado como bloques de texto.
- `04-piezo-array-9ch.kicad_sch` **instancia 9 veces** la hoja
  `03-piezo-channel.kicad_sch` — reutilización jerárquica real de KiCad, no
  nueve copias.

**No contienen instancias de símbolos** (resistencias, condensadores, CI,
conectores). Esta es una decisión deliberada y es el punto donde ser honesto
importa más:

> Escribir a mano el bloque `lib_symbols` de ~90 componentes sin poder abrir
> KiCad ni una sola vez tiene alta probabilidad de producir un fichero que KiCad
> rechace por completo o, peor, que abra con conexiones silenciosamente
> equivocadas. Un esquemático que *parece* correcto y no lo es es más peligroso
> que la ausencia de esquemático.

Por eso el conexionado normativo, componente a componente y nodo a nodo, vive en
formato legible y sin ambigüedad en:

- [`../schematics/`](../schematics/) — descripción completa de las 8 hojas.
- [`netlist/components.csv`](netlist/components.csv) — todos los componentes con
  referencia, valor, encapsulado y hoja.
- [`netlist/netlist.csv`](netlist/netlist.csv) — todas las redes, nodo a nodo.

Un ingeniero puede transcribir el diseño a KiCad desde esos tres ficheros sin
tener que interpretar nada.

## 4. Trabajo pendiente en este directorio

1. Abrir `diana-module-3x3.kicad_sch` en KiCad 8 y corregir lo que rechace.
2. Colocar los símbolos de `netlist/components.csv` en cada hoja y cablearlos
   según `netlist/netlist.csv`.
3. Asignar huellas y ejecutar **ERC**. Sólo después de eso puede alguien escribir
   la palabra «conforme» en un informe.
4. Layout, DRC, revisión de corrientes y revisión térmica (dosier §28.8).

## 5. Regeneración

```
python3 generate_kicad.py
```

Es determinista: los UUID se derivan de una semilla fija, así que regenerar no
produce ruido en el control de versiones.
