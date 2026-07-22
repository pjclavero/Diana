import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import {
  createPreset,
  deletePreset,
  listGameModes,
  listPresets,
  type GameModeOption,
  type Preset,
  type PresetList,
} from "../../api/presetsApi";

/** Campos numéricos de config admitidos (comunes a los modos). Vacío = no se envía. */
const CONFIG_FIELDS: { key: string; label: string }[] = [
  { key: "repetitions", label: "Repeticiones" },
  { key: "intervalMs", label: "Intervalo (ms)" },
  { key: "penaltyMs", label: "Penalización (ms)" },
  { key: "timeLimitMs", label: "Límite de tiempo (ms)" },
];

/**
 * G-F · Presets de partida (datos REALES). El gestor guarda sus configuraciones
 * más usadas (máx. 5) y ve las de muestra; el admin gestiona las de muestra. Así no
 * hay que reconfigurar siempre lo mismo.
 */
export function PresetsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("administrador");

  const [data, setData] = useState<PresetList | null>(null);
  const [modes, setModes] = useState<GameModeOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [presets, gameModes] = await Promise.all([listPresets(), listGameModes()]);
      setData(presets);
      setModes(gameModes);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los presets.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await deletePreset(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido borrar el preset.");
    } finally {
      setBusy(null);
    }
  }

  const atLimit = !isAdmin && data ? data.ownCount >= data.maxOwn : false;

  return (
    <div>
      <h1>Presets de partida</h1>
      <p>Guarda las configuraciones de partida que más usas para no repetir el montaje cada vez.</p>

      {error && <ErrorState message={error} onRetry={load} />}
      {!data && !error && <LoadingState />}

      {data && (
        <>
          {!isAdmin && (
            <p role="status">
              Presets propios: <strong>{data.ownCount}</strong> / {data.maxOwn}
              {atLimit && " — has llegado al máximo; borra uno para crear otro."}
            </p>
          )}

          <NewPresetForm modes={modes} disabled={atLimit} onCreated={load} isAdmin={isAdmin} />

          {data.items.length === 0 && <p>Aún no hay presets.</p>}
          <div className="module-cards">
            {data.items.map((p) => (
              <PresetCard key={p.id} preset={p} canDelete={isAdmin || (!p.isSample && p.ownerId != null)} busy={busy === p.id} onDelete={() => remove(p.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PresetCard({ preset: p, canDelete, busy, onDelete }: { preset: Preset; canDelete: boolean; busy: boolean; onDelete: () => void }) {
  return (
    <Card title={p.name}>
      <p>
        Modo: <strong>{p.gameMode.displayName}</strong>
        {p.isSample && <span className="badge badge--muted"> muestra</span>}
      </p>
      {p.description && <p>{p.description}</p>}
      {Object.keys(p.config ?? {}).length > 0 && (
        <p>
          <small>{Object.entries(p.config).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</small>
        </p>
      )}
      {canDelete && (
        <button type="button" disabled={busy} onClick={onDelete}>
          {busy ? "Borrando…" : "Borrar"}
        </button>
      )}
    </Card>
  );
}

function NewPresetForm({ modes, disabled, onCreated, isAdmin }: { modes: GameModeOption[]; disabled: boolean; onCreated: () => void; isAdmin: boolean }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const configOut: Record<string, number> = {};
    for (const f of CONFIG_FIELDS) {
      const raw = config[f.key];
      if (raw !== undefined && raw !== "") configOut[f.key] = Number(raw);
    }
    try {
      const created = await createPreset({ name, description: description || undefined, mode, config: configOut });
      setOk(`Preset «${created.name}» guardado.`);
      setName("");
      setDescription("");
      setMode("");
      setConfig({});
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : "No se ha podido guardar el preset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={isAdmin ? "Nuevo preset de muestra" : "Nuevo preset"}>
      <form onSubmit={submit} className="firmware-upload">
        <label>
          Nombre <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={128} />
        </label>
        <label>
          Descripción <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={512} />
        </label>
        <label>
          Modo de juego{" "}
          <select required value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">— elige modo —</option>
            {modes.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {CONFIG_FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}{" "}
            <input
              type="number"
              value={config[f.key] ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <button type="submit" disabled={busy || disabled}>
          {busy ? "Guardando…" : disabled ? "Límite alcanzado" : "Guardar preset"}
        </button>
      </form>
      {ok && <p role="status">{ok}</p>}
      {error && <ErrorState message={error} />}
    </Card>
  );
}
