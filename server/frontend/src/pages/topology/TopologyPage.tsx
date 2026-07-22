import { useEffect, useMemo, useState } from "react";
import { apiClient, type Topology, type TopologySlot } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
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
  const { data: initial, loading, error, reload } = useAsync(() => apiClient.getTopology(DEFAULT_SYSTEM_ID), []);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [identifyingId, setIdentifyingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  useEffect(() => {
    if (initial) setTopology(structuredClone(initial));
  }, [initial]);

  const duplicates = useMemo(() => (topology ? findDuplicates(topology.slots) : new Set<string>()), [topology]);
  const hasDuplicates = duplicates.size > 0;

  function bySlot(pos: { x: number; y: number }): TopologySlot | undefined {
    return topology?.slots.find((s) => s.position.x === pos.x && s.position.y === pos.y);
  }

  function updateSlot(pos: { x: number; y: number }, patch: Partial<TopologySlot>) {
    setTopology((t) => {
      if (!t) return t;
      return { ...t, slots: t.slots.map((s) => (slotKey(s.position) === slotKey(pos) ? { ...s, ...patch } : s)) };
    });
  }

  function rotate(pos: { x: number; y: number }) {
    const s = bySlot(pos);
    if (!s || s.locked) return;
    const next: Rotation = ((s.rotation + 90) % 360) as Rotation;
    updateSlot(pos, { rotation: next });
  }

  function toggleLock(pos: { x: number; y: number }) {
    updateSlot(pos, { locked: !bySlot(pos)?.locked });
  }

  function toggleOutOfService(pos: { x: number; y: number }) {
    updateSlot(pos, { out_of_service: !bySlot(pos)?.out_of_service });
  }

  function moveModule(moduleId: string, targetPos: { x: -1 | 0 | 1; y: -1 | 0 | 1 }) {
    setTopology((t) => (t ? { ...t, slots: applyMove(t.slots, moduleId, targetPos) } : t));
  }

  function removeFromGrid(moduleId: string) {
    setTopology((t) => (t ? { ...t, slots: t.slots.map((s) => (s.module_id === moduleId ? { ...s, module_id: null } : s)) } : t));
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
    if (!topology) return;
    if (hasDuplicates) {
      setSaveMsg("No se puede guardar: hay módulos duplicados en la matriz.");
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const saved = await apiClient.saveTopology(topology);
      setTopology(saved);
      setSaveMsg("Disposición guardada.");
    } catch {
      setSaveMsg("No se pudo guardar la disposición. Inténtelo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const unassignedIds = useMemo(() => {
    if (!topology) return [] as string[];
    const placed = new Set(topology.slots.map((s) => s.module_id).filter(Boolean) as string[]);
    // En un sistema real, los IDs candidatos vendrían de listModules(); aquí
    // ofrecemos reinsertar cualquier módulo ya conocido en la topología.
    return [...placed];
  }, [topology]);

  return (
    <div>
      <h1>Editor de matriz de módulos</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {topology && (
        <>
          <Card
            title={`Matriz 3×3 · ${topology.name}`}
            actions={
              <button type="button" onClick={handleSave} disabled={saving || hasDuplicates}>
                {saving ? "Guardando…" : "Guardar disposición"}
              </button>
            }
          >
            {hasDuplicates && (
              <p role="alert" className="topology-warning">
                Posiciones duplicadas para: {[...duplicates].join(", ")}. Corríjalo antes de guardar.
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
                      // Imprescindible en TODA la celda (también la ocupada) para que sea
                      // un destino de suelta válido; sin esto la celda central no aceptaba.
                      e.preventDefault();
                      if (draggedId && dragOverKey !== slotKey(pos)) setDragOverKey(slotKey(pos));
                    }}
                    onDragLeave={(e) => {
                      // Sólo limpia si el puntero abandona la celda de verdad (no al pasar
                      // por un hijo), comparando con relatedTarget.
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverKey((k) => (k === slotKey(pos) ? null : k));
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
                        <strong>{slot.module_id}</strong>
                        {isDuplicate && <span className="badge badge--error">Duplicado</span>}
                        {slot.out_of_service && <span className="badge badge--warn">Fuera de servicio</span>}
                        <p>Rotación: {slot.rotation}°</p>
                        <div className="topology-chip__actions">
                          <button type="button" onClick={() => rotate(pos)} disabled={slot.locked} aria-label={`Rotar ${slot.module_id} 90 grados`}>
                            Rotar 90°
                          </button>
                          <button type="button" onClick={() => identify(slot.module_id!)} disabled={identifyingId === slot.module_id}>
                            {identifyingId === slot.module_id ? "Identificando…" : "Identificar"}
                          </button>
                          <button type="button" onClick={() => toggleLock(pos)}>
                            {slot.locked ? "Desbloquear" : "Bloquear"}
                          </button>
                          <button type="button" onClick={() => toggleOutOfService(pos)}>
                            {slot.out_of_service ? "Poner en servicio" : "Fuera de servicio"}
                          </button>
                          <button type="button" onClick={() => removeFromGrid(slot.module_id!)} disabled={slot.locked}>
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
          </Card>

          <Card title="Módulos conocidos">
            <p>Arrastre un módulo a una celda vacía, o use el selector “Mover a” de cada tarjeta con el teclado.</p>
            <ul className="topology-pool">
              {unassignedIds.map((id) => (
                <li key={id} draggable onDragStart={() => setDraggedId(id)} onDragEnd={() => setDraggedId(null)}>
                  {id}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
