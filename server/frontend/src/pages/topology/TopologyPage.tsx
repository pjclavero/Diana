import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient, type TopologySlot } from "../../api";
import {
  applyLayout,
  captureLayout,
  deleteLayout,
  getPanelMatrix,
  listLayouts,
  listTopologyPanels,
  savePanelMatrix,
  toggleFavoriteLayout,
  type MatrixLayout,
  type PanelMatrix,
  type PanelSummary,
} from "../../api/topologyApi";
import { useAsync } from "../../hooks/useAsync";
import { BackButton } from "../../components/ui/BackButton";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { applyMove } from "./topologyMove";
import "./TopologyPage.css";

type Rotation = 0 | 90 | 180 | 270;

const GRID_ORDER: { x: -1 | 0 | 1; y: -1 | 0 | 1 }[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

function slotKey(pos: { x: number; y: number }) {
  return `${pos.x},${pos.y}`;
}

/** Rejilla completa de 9 casillas a partir de la matriz real del panel. */
function toEditorSlots(matrix: PanelMatrix): TopologySlot[] {
  return GRID_ORDER.map((pos) => {
    const placed = matrix.slots.find((s) => s.x === pos.x && s.y === pos.y);
    return {
      module_id: placed?.module_id ?? null,
      position: pos,
      rotation: ((placed?.rotation ?? 0) % 360) as Rotation,
      locked: false,
      out_of_service: false,
    };
  });
}

function findDuplicates(slots: TopologySlot[]): Set<string> {
  const seen = new Map<string, number>();
  for (const s of slots) {
    if (!s.module_id) continue;
    seen.set(s.module_id, (seen.get(s.module_id) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [id, count] of seen) if (count > 1) dup.add(id);
  return dup;
}

export function TopologyPage() {
  const { data: panels, loading: loadingPanels, error: panelsError, reload: reloadPanels } = useAsync(
    () => listTopologyPanels().then((r) => r.items),
    [],
  );
  const [panelId, setPanelId] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<PanelMatrix | null>(null);
  const [slots, setSlots] = useState<TopologySlot[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [identifyingId, setIdentifyingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Matrices favoritas (G-H)
  const [layouts, setLayouts] = useState<MatrixLayout[]>([]);
  const [layoutName, setLayoutName] = useState("");
  const [layoutMsg, setLayoutMsg] = useState<string | null>(null);

  // El primer panel disponible se selecciona solo; con varios, manda el selector.
  useEffect(() => {
    if (panels && panels.length > 0 && panelId === null) setPanelId(panels[0].id);
  }, [panels, panelId]);

  const loadMatrix = useCallback(async (id: string) => {
    setLoadingMatrix(true);
    setMatrixError(null);
    try {
      const data = await getPanelMatrix(id);
      setMatrix(data);
      setSlots(toEditorSlots(data));
    } catch (e) {
      setMatrixError(e instanceof Error ? e.message : "No se pudo cargar la matriz del panel.");
      setMatrix(null);
      setSlots([]);
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  useEffect(() => {
    if (panelId) void loadMatrix(panelId);
  }, [panelId, loadMatrix]);

  const reloadLayouts = useCallback(async () => {
    try {
      const r = await listLayouts();
      setLayouts(r.items);
    } catch {
      /* la lista de favoritas es accesoria: si falla, el editor sigue usable */
    }
  }, []);

  useEffect(() => {
    void reloadLayouts();
  }, [reloadLayouts]);

  const duplicates = useMemo(() => findDuplicates(slots), [slots]);
  const hasDuplicates = duplicates.size > 0;

  const labelOf = useCallback(
    (moduleId: string) => {
      const placed = matrix?.slots.find((s) => s.module_id === moduleId);
      if (placed) return placed.slug;
      const free = matrix?.unassigned.find((m) => m.id === moduleId);
      return free?.slug ?? moduleId;
    },
    [matrix],
  );

  function bySlot(pos: { x: number; y: number }): TopologySlot | undefined {
    return slots.find((s) => slotKey(s.position) === slotKey(pos));
  }

  function updateSlot(pos: { x: number; y: number }, patch: Partial<TopologySlot>) {
    setSlots((current) =>
      current.map((s) => (slotKey(s.position) === slotKey(pos) ? { ...s, ...patch } : s)),
    );
  }

  function rotate(pos: { x: number; y: number }) {
    const s = bySlot(pos);
    if (!s || s.locked) return;
    updateSlot(pos, { rotation: ((s.rotation + 90) % 360) as Rotation });
  }

  function toggleLock(pos: { x: number; y: number }) {
    updateSlot(pos, { locked: !bySlot(pos)?.locked });
  }

  function moveModule(moduleId: string, targetPos: { x: -1 | 0 | 1; y: -1 | 0 | 1 }) {
    setSlots((current) => applyMove(current, moduleId, targetPos));
  }

  function removeFromGrid(moduleId: string) {
    setSlots((current) => current.map((s) => (s.module_id === moduleId ? { ...s, module_id: null } : s)));
  }

  async function identify(moduleId: string) {
    setIdentifyingId(moduleId);
    try {
      await apiClient.identifyModule(moduleId, 4000);
    } finally {
      setTimeout(() => setIdentifyingId(null), 4000);
    }
  }

  async function handleSave() {
    if (!panelId) return;
    if (hasDuplicates) {
      setSaveMsg("No se puede guardar: hay módulos duplicados en la matriz.");
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const saved = await savePanelMatrix(
        panelId,
        slots
          .filter((s) => s.module_id)
          .map((s) => ({ module_id: s.module_id, x: s.position.x, y: s.position.y, rotation: s.rotation })),
      );
      setMatrix(saved);
      setSlots(toEditorSlots(saved));
      setSaveMsg("Disposición guardada.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "No se pudo guardar la disposición.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCaptureLayout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!panelId || !layoutName.trim()) return;
    setLayoutMsg(null);
    try {
      await captureLayout(layoutName.trim(), panelId, true);
      setLayoutName("");
      setLayoutMsg("Matriz guardada en favoritas.");
      await reloadLayouts();
    } catch (e) {
      setLayoutMsg(e instanceof Error ? e.message : "No se pudo guardar la matriz.");
    }
  }

  async function handleApplyLayout(layout: MatrixLayout) {
    if (!panelId) return;
    setLayoutMsg(null);
    try {
      const result = await applyLayout(layout.id, panelId);
      await loadMatrix(panelId);
      setLayoutMsg(
        result.missing.length > 0
          ? `Aplicada «${layout.name}»: ${result.applied.length} módulo(s) colocado(s). No están en este panel: ${result.missing.join(", ")}.`
          : `Aplicada «${layout.name}»: ${result.applied.length} módulo(s) colocado(s).`,
      );
    } catch (e) {
      setLayoutMsg(e instanceof Error ? e.message : "No se pudo aplicar la matriz.");
    }
  }

  async function handleToggleFavorite(layout: MatrixLayout) {
    try {
      await toggleFavoriteLayout(layout.id, !layout.favorite);
      await reloadLayouts();
    } catch (e) {
      setLayoutMsg(e instanceof Error ? e.message : "No se pudo cambiar la marca de favorita.");
    }
  }

  async function handleDeleteLayout(layout: MatrixLayout) {
    try {
      await deleteLayout(layout.id);
      await reloadLayouts();
      setLayoutMsg(`Matriz «${layout.name}» borrada.`);
    } catch (e) {
      setLayoutMsg(e instanceof Error ? e.message : "No se pudo borrar la matriz.");
    }
  }

  const placedIds = useMemo(
    () => new Set(slots.map((s) => s.module_id).filter(Boolean) as string[]),
    [slots],
  );
  // Bolsa: módulos del panel que ahora mismo no están en la rejilla.
  const poolModules = useMemo(() => {
    if (!matrix) return [] as { id: string; slug: string }[];
    const all = [
      ...matrix.slots.map((s) => ({ id: s.module_id, slug: s.slug })),
      ...matrix.unassigned.map((m) => ({ id: m.id, slug: m.slug })),
    ];
    const unique = new Map(all.map((m) => [m.id, m]));
    return [...unique.values()].filter((m) => !placedIds.has(m.id));
  }, [matrix, placedIds]);

  return (
    <div>
      <BackButton />
      <h1>Editor de matriz de módulos</h1>

      {loadingPanels && <LoadingState />}
      {panelsError && <ErrorState message={panelsError} onRetry={reloadPanels} />}

      {panels && panels.length === 0 && (
        <Card title="Sin paneles">
          <p>No hay ningún panel dado de alta todavía. Cree uno antes de colocar módulos.</p>
        </Card>
      )}

      {panels && panels.length > 0 && (
        <Card title="Panel">
          <label>
            Panel a editar
            <select value={panelId ?? ""} onChange={(e) => setPanelId(e.target.value)}>
              {panels.map((p: PanelSummary) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.placedCount}/{p.moduleCount} módulos colocados)
                </option>
              ))}
            </select>
          </label>
          <p>
            Cada panel es una matriz 3×3 de módulos independiente. Con varios paneles se editan de uno
            en uno aquí y se agrupan en <strong>Vistas</strong> para jugar sobre varios a la vez.
          </p>
        </Card>
      )}

      {loadingMatrix && <LoadingState />}
      {matrixError && <ErrorState message={matrixError} onRetry={() => panelId && loadMatrix(panelId)} />}

      {matrix && !loadingMatrix && (
        <>
          <Card
            title={`Matriz 3×3 · ${matrix.system.name}`}
            actions={
              <button type="button" onClick={handleSave} disabled={saving || hasDuplicates}>
                {saving ? "Guardando…" : "Guardar disposición"}
              </button>
            }
          >
            {hasDuplicates && (
              <p role="alert" className="topology-warning">
                Posiciones duplicadas para: {[...duplicates].map(labelOf).join(", ")}. Corríjalo antes de
                guardar.
              </p>
            )}
            {saveMsg && <p role="status">{saveMsg}</p>}

            <div className="topology-grid" role="grid" aria-label="Matriz de módulos 3 por 3">
              {GRID_ORDER.map((pos) => {
                const slot = bySlot(pos);
                const isDuplicate = slot?.module_id ? duplicates.has(slot.module_id) : false;
                return (
                  <div
                    key={slotKey(pos)}
                    role="gridcell"
                    className={`topology-cell ${isDuplicate ? "topology-cell--duplicate" : ""} ${slot?.locked ? "topology-cell--locked" : ""} ${dragOverKey === slotKey(pos) && !slot?.locked ? "topology-cell--dragover" : ""}`}
                    onDragOver={(e) => {
                      // Una celda bloqueada no es destino válido: no hacemos preventDefault
                      // para que el cursor muestre "no soltar aquí" (honesto con el usuario).
                      if (slot?.locked) return;
                      // Imprescindible en TODA celda no bloqueada (también la ocupada) para
                      // que sea destino de suelta válido; sin esto la celda central no aceptaba.
                      e.preventDefault();
                      if (draggedId && dragOverKey !== slotKey(pos)) setDragOverKey(slotKey(pos));
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                        setDragOverKey((k) => (k === slotKey(pos) ? null : k));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverKey(null);
                      if (draggedId) moveModule(draggedId, pos);
                    }}
                  >
                    <div className="topology-cell__coord">
                      ({pos.x}, {pos.y})
                    </div>
                    {slot?.module_id ? (
                      <div
                        className="topology-chip"
                        draggable={!slot.locked}
                        onDragStart={() => setDraggedId(slot.module_id)}
                        onDragEnd={() => setDraggedId(null)}
                      >
                        <strong>{labelOf(slot.module_id)}</strong>
                        {isDuplicate && <span className="badge badge--error">Duplicado</span>}
                        <p>Rotación: {slot.rotation}°</p>
                        <div className="topology-chip__actions">
                          <button
                            type="button"
                            onClick={() => rotate(pos)}
                            disabled={slot.locked}
                            aria-label={`Rotar ${labelOf(slot.module_id)} 90 grados`}
                          >
                            Rotar 90°
                          </button>
                          <button
                            type="button"
                            onClick={() => identify(slot.module_id!)}
                            disabled={identifyingId === slot.module_id}
                          >
                            {identifyingId === slot.module_id ? "Identificando…" : "Identificar"}
                          </button>
                          <button type="button" onClick={() => toggleLock(pos)}>
                            {slot.locked ? "Desbloquear" : "Bloquear"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFromGrid(slot.module_id!)}
                            disabled={slot.locked}
                          >
                            Quitar
                          </button>
                        </div>
                        <label className="topology-move">
                          Mover a
                          <select
                            value=""
                            onChange={(e) => {
                              const [x, y] = e.target.value.split(",").map(Number) as [-1 | 0 | 1, -1 | 0 | 1];
                              if (e.target.value) moveModule(slot.module_id!, { x, y });
                            }}
                          >
                            <option value="">elegir posición…</option>
                            {GRID_ORDER.filter((p) => slotKey(p) !== slotKey(pos)).map((p) => (
                              <option key={slotKey(p)} value={slotKey(p)}>
                                ({p.x}, {p.y})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <p className="topology-cell__empty">Posición vacía</p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="topology-hint">
              El bloqueo es una ayuda del editor: evita mover una celda por error, pero no se guarda en
              el servidor.
            </p>
          </Card>

          <Card title="Módulos sin colocar">
            {poolModules.length === 0 ? (
              <p>Todos los módulos de este panel están colocados en la matriz.</p>
            ) : (
              <>
                <p>Arrastre un módulo a una celda vacía, o use el selector “Mover a” con el teclado.</p>
                <ul className="topology-pool">
                  {poolModules.map((m) => (
                    <li
                      key={m.id}
                      draggable
                      onDragStart={() => setDraggedId(m.id)}
                      onDragEnd={() => setDraggedId(null)}
                    >
                      {m.slug}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="Matrices favoritas">
            <p>
              Guarde la colocación actual con un nombre para recuperarla luego. Se guarda por{" "}
              <strong>slug de módulo</strong>, así sigue sirviendo si sustituye hardware.
            </p>
            <form onSubmit={handleCaptureLayout} className="topology-layout-form">
              <label>
                Nombre de la matriz
                <input
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  maxLength={128}
                  placeholder="Ej.: Fila baja para principiantes"
                />
              </label>
              <button type="submit" disabled={!layoutName.trim()}>
                Guardar matriz actual
              </button>
            </form>
            {layoutMsg && <p role="status">{layoutMsg}</p>}
            {layouts.length === 0 ? (
              <p>Todavía no hay matrices guardadas.</p>
            ) : (
              <ul className="topology-layouts">
                {layouts.map((layout) => (
                  <li key={layout.id}>
                    <span>
                      {layout.favorite && <span aria-label="favorita">★ </span>}
                      <strong>{layout.name}</strong> · {layout.moduleCount} módulo(s)
                    </span>
                    <span className="topology-layouts__actions">
                      <button type="button" onClick={() => handleApplyLayout(layout)}>
                        Aplicar a este panel
                      </button>
                      <button type="button" onClick={() => handleToggleFavorite(layout)}>
                        {layout.favorite ? "Quitar de favoritas" : "Marcar favorita"}
                      </button>
                      <button type="button" onClick={() => handleDeleteLayout(layout)}>
                        Borrar
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
