import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api";
import { DEFAULT_SYSTEM_ID } from "../../config";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import type { GameConfig, GameMode } from "../../types/domain";

const MODES: { value: GameMode; label: string }[] = [
  { value: "random", label: "Dianas aleatorias" },
  { value: "sequence", label: "Secuencia fija" },
  { value: "all_vs_clock", label: "Todas contra reloj" },
  { value: "reaction", label: "Reacción" },
  { value: "memory", label: "Memoria" },
  { value: "no_shoot", label: "No disparar" },
  { value: "duel", label: "Duelo" },
];

export function NewGamePage() {
  const navigate = useNavigate();
  const { data: presets } = useAsync(() => apiClient.listPresets(), []);
  const { data: players } = useAsync(() => apiClient.listPlayers(), []);
  const { data: teams } = useAsync(() => apiClient.listTeams(), []);
  const { data: modules } = useAsync(() => apiClient.listModules(DEFAULT_SYSTEM_ID), []);

  const [mode, setMode] = useState<GameMode>("random");
  const [presetId, setPresetId] = useState("");
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [ammoInitial, setAmmoInitial] = useState<string>("9");
  const [ammoKnown, setAmmoKnown] = useState(true);
  const [countdownS, setCountdownS] = useState(3);
  const [timeLimitS, setTimeLimitS] = useState(60);
  const [penaltyS, setPenaltyS] = useState(2);
  const [strictOrder, setStrictOrder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = presets?.find((p) => p.id === id);
    if (preset?.config.mode) setMode(preset.config.mode);
    if (preset?.config.targets) {
      setSelectedTargets(new Set(preset.config.targets.map((t) => `${t.module_id}:${t.target_index}`)));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedTargets.size === 0) {
      setError("Seleccione al menos una diana.");
      return;
    }
    if (selectedPlayers.size === 0 && selectedTeams.size === 0) {
      setError("Seleccione al menos un jugador o un equipo.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const config: GameConfig = {
        mode,
        preset_id: presetId || null,
        targets: [...selectedTargets].map((key) => {
          const [module_id, idx] = key.split(":");
          return { module_id, target_index: Number(idx) };
        }),
        player_ids: [...selectedPlayers],
        team_ids: [...selectedTeams],
        ammo_initial: ammoKnown ? Number(ammoInitial) : null,
        countdown_ms: countdownS * 1000,
        time_limit_ms: timeLimitS > 0 ? timeLimitS * 1000 : null,
        penalty_ms: penaltyS * 1000,
        strict_order: strictOrder,
      };
      const summary = await apiClient.createGame(config);
      navigate(`/partidas/${summary.game_id}/cuenta-atras`);
    } catch {
      setError("No se ha podido crear la partida. Revise la configuración e inténtelo de nuevo.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Crear partida</h1>
      {error && <ErrorState message={error} />}

      <form onSubmit={handleSubmit}>
        <Card title="Modo y preset">
          <label>
            Modo de juego
            <select value={mode} onChange={(e) => setMode(e.target.value as GameMode)}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Preset
            <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">sin preset</option>
              {presets?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </Card>

        <Card title="Dianas">
          {!modules && <LoadingState label="Cargando módulos…" />}
          {modules?.map((m) => (
            <fieldset key={m.module_id}>
              <legend>{m.module_id}</legend>
              <div className="checkbox-row">
                {m.targets.map((t) => {
                  const key = `${m.module_id}:${t.target_index}`;
                  return (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={selectedTargets.has(key)}
                        onChange={() => toggle(selectedTargets, setSelectedTargets, key)}
                      />
                      Diana {t.target_index}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </Card>

        <Card title="Jugadores y equipos">
          <fieldset>
            <legend>Jugadores</legend>
            <div className="checkbox-row">
              {players?.map((p) => (
                <label key={p.id}>
                  <input type="checkbox" checked={selectedPlayers.has(p.id)} onChange={() => toggle(selectedPlayers, setSelectedPlayers, p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Equipos</legend>
            <div className="checkbox-row">
              {teams?.map((t) => (
                <label key={t.id}>
                  <input type="checkbox" checked={selectedTeams.has(t.id)} onChange={() => toggle(selectedTeams, setSelectedTeams, t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card title="Munición y penalizaciones">
          <label>
            <input type="checkbox" checked={ammoKnown} onChange={(e) => setAmmoKnown(e.target.checked)} />
            Se conocerá la munición restante al terminar
          </label>
          {ammoKnown && (
            <label>
              Munición inicial
              <input type="number" min={1} value={ammoInitial} onChange={(e) => setAmmoInitial(e.target.value)} />
            </label>
          )}
          {!ammoKnown && <p>La precisión se mostrará como no calculable si no se introduce la munición restante al finalizar.</p>}
          <label>
            Penalización (s)
            <input type="number" min={0} value={penaltyS} onChange={(e) => setPenaltyS(Number(e.target.value))} />
          </label>
          <label>
            <input type="checkbox" checked={strictOrder} onChange={(e) => setStrictOrder(e.target.checked)} />
            Exigir orden estricto
          </label>
        </Card>

        <Card title="Tiempos">
          <label>
            Cuenta atrás de preparación (s)
            <input type="number" min={0} value={countdownS} onChange={(e) => setCountdownS(Number(e.target.value))} />
          </label>
          <label>
            Tiempo límite (s, 0 = sin límite)
            <input type="number" min={0} value={timeLimitS} onChange={(e) => setTimeLimitS(Number(e.target.value))} />
          </label>
        </Card>

        <button type="submit" disabled={creating}>
          {creating ? "Creando partida…" : "Crear e ir a cuenta atrás"}
        </button>
      </form>
    </div>
  );
}
