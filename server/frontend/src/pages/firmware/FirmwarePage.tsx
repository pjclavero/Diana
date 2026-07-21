import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { listModules, listMyModules, type ModuleEntity } from "../../api/modulesApi";
import {
  availableForModule,
  createFirmwareVersion,
  deployFirmware,
  listDeployments,
  type AvailableFirmware,
  type DeploymentRow,
  type NewFirmwareVersion,
} from "../../api/firmwareApi";

/**
 * F3 · Firmware / OTA (datos REALES). El admin sube versiones firmadas; el gestor
 * (y el admin) ven las versiones disponibles para sus módulos y **aceptan** la
 * actualización, lo que dispara la OTA remota. Cada módulo muestra su versión
 * vigente y el historial de despliegues.
 */
export function FirmwarePage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("administrador");

  const [modules, setModules] = useState<ModuleEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setModules(isAdmin ? await listModules() : await listMyModules());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar los módulos.");
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1>Firmware y actualizaciones</h1>
      <p>
        {isAdmin
          ? "Sube versiones firmadas y despliega la OTA en cualquier módulo."
          : "Aquí ves la versión de tus módulos y aceptas las actualizaciones disponibles."}
      </p>

      {isAdmin && <UploadFirmware onUploaded={load} />}

      {error && <ErrorState message={error} onRetry={load} />}
      {!modules && !error && <LoadingState />}
      {modules && modules.length === 0 && <p>No hay módulos {isAdmin ? "registrados" : "vinculados a tu cuenta"}.</p>}

      {modules &&
        modules.map((m) => <ModuleFirmwareCard key={m.id} module={m} canDeploy={isAdmin || hasRole("gestor")} />)}
    </div>
  );
}

/** Tarjeta por módulo: versión vigente, disponibles e historial de despliegues. */
function ModuleFirmwareCard({ module, canDeploy }: { module: ModuleEntity; canDeploy: boolean }) {
  const [info, setInfo] = useState<AvailableFirmware | null>(null);
  const [history, setHistory] = useState<DeploymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, h] = await Promise.all([availableForModule(module.id), listDeployments(module.id)]);
      setInfo(a);
      setHistory(h);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido cargar el firmware del módulo.");
    }
  }, [module.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deploy() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await deployFirmware(module.id, choice);
      setChoice("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido lanzar la actualización.");
    } finally {
      setBusy(false);
    }
  }

  const inProgress = info?.deployment_in_progress ?? null;
  const deployable = info?.available.filter((v) => !v.is_current) ?? [];

  return (
    <Card title={module.friendlyName || module.slug}>
      <p>
        <code>{module.slug}</code> · {module.online ? "en línea" : "desconectado"} · versión actual{" "}
        <strong>{info?.current_version ?? module.firmwareVersion ?? "—"}</strong>
      </p>

      {error && <ErrorState message={error} onRetry={load} />}

      {inProgress && (
        <p role="status">
          Despliegue en curso: <strong>{inProgress.status}</strong>. Espera a que termine antes de lanzar otro.
        </p>
      )}

      {canDeploy && !inProgress && info && (
        <div>
          {deployable.length === 0 ? (
            <p>No hay versiones firmadas más recientes disponibles.</p>
          ) : (
            <p>
              <label>
                Actualizar a:{" "}
                <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Versión para ${module.slug}`}>
                  <option value="">— elige versión —</option>
                  {deployable.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version} ({v.targetBoard})
                    </option>
                  ))}
                </select>
              </label>{" "}
              <button disabled={!choice || busy} onClick={deploy}>
                Aceptar y actualizar
              </button>
            </p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details>
          <summary>Historial de despliegues ({history.length})</summary>
          <ul>
            {history.map((d) => (
              <li key={d.id}>
                {new Date(d.startedAt).toLocaleString("es-ES")} · {d.firmwareVersion.version} ·{" "}
                <strong>{d.status}</strong>
                {d.previousVersion ? ` (desde ${d.previousVersion})` : ""}
                {d.error ? ` · error: ${d.error}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

const EMPTY: NewFirmwareVersion = { version: "", targetBoard: "", url: "", sha256: "", sizeBytes: 0, signature: "", signed: true };

/** Alta de versión de firmware (solo admin). Registra la versión firmada. */
function UploadFirmware({ onUploaded }: { onUploaded: () => void }) {
  const [form, setForm] = useState<NewFirmwareVersion>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof NewFirmwareVersion>(key: K, value: NewFirmwareVersion[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const created = await createFirmwareVersion({ ...form, sizeBytes: Number(form.sizeBytes) });
      setOk(`Registrada la versión ${created.version}.`);
      setForm(EMPTY);
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : "No se ha podido registrar la versión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Subir versión de firmware">
      <form onSubmit={submit} className="firmware-upload">
        <label>
          Versión (semver){" "}
          <input required value={form.version} onChange={(e) => set("version", e.target.value)} placeholder="1.2.0" />
        </label>
        <label>
          Placa objetivo{" "}
          <input required value={form.targetBoard} onChange={(e) => set("targetBoard", e.target.value)} placeholder="esp32-s3" />
        </label>
        <label>
          URL del binario{" "}
          <input required value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="http://192.168.1.209:8080/fw/1.2.0.bin" />
        </label>
        <label>
          SHA-256{" "}
          <input required value={form.sha256} onChange={(e) => set("sha256", e.target.value)} minLength={64} maxLength={64} />
        </label>
        <label>
          Tamaño (bytes){" "}
          <input required type="number" min={1} value={form.sizeBytes || ""} onChange={(e) => set("sizeBytes", Number(e.target.value))} />
        </label>
        <label>
          Firma (base64){" "}
          <input required value={form.signature} onChange={(e) => set("signature", e.target.value)} />
        </label>
        <label>
          Notas{" "}
          <input value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={form.signed} onChange={(e) => set("signed", e.target.checked)} /> Firmada (obligatorio para OTA)
        </label>
        <button type="submit" disabled={busy}>
          Registrar versión
        </button>
      </form>
      {ok && <p role="status">{ok}</p>}
      {error && <ErrorState message={error} />}
    </Card>
  );
}
