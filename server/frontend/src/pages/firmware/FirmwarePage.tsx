import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { listModules, listMyModules, type ModuleEntity } from "../../api/modulesApi";
import {
  availableForModule,
  deployFirmware,
  listDeployments,
  uploadFirmwareBinary,
  type AvailableFirmware,
  type DeploymentRow,
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

/**
 * Subida del BINARIO de firmware (solo admin). Se sube el archivo `.bin`; el
 * backend calcula sha256 y tamaño y sirve la descarga por HTTP local para la OTA.
 * Sin firma la versión queda sin firmar y NO es desplegable (dosier 23.3).
 */
function UploadFirmware({ onUploaded }: { onUploaded: () => void }) {
  const [version, setVersion] = useState("");
  const [targetBoard, setTargetBoard] = useState("");
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Selecciona el archivo .bin del firmware.");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const created = await uploadFirmwareBinary(file, { version, targetBoard, signature: signature || undefined, notes: notes || undefined });
      setOk(`Subida la versión ${created.version} (${(created.sizeBytes / 1024).toFixed(0)} KiB, sha256 ${created.sha256.slice(0, 12)}…)${created.signed ? "" : " — SIN firmar, no desplegable"}.`);
      setVersion("");
      setTargetBoard("");
      setSignature("");
      setNotes("");
      setFile(null);
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : "No se ha podido subir el binario.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Subir firmware (binario)">
      <form onSubmit={submit} className="firmware-upload">
        <label>
          Archivo del firmware (.bin){" "}
          <input required type="file" accept=".bin,application/octet-stream" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          Versión (semver){" "}
          <input required value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" />
        </label>
        <label>
          Placa objetivo{" "}
          <input required value={targetBoard} onChange={(e) => setTargetBoard(e.target.value)} placeholder="esp32-s3" />
        </label>
        <label>
          Firma (base64, obligatoria para poder desplegar la OTA){" "}
          <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="firma del binario" />
        </label>
        <label>
          Notas{" "}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Subiendo…" : "Subir binario"}
        </button>
      </form>
      {ok && <p role="status">{ok}</p>}
      {error && <ErrorState message={error} />}
    </Card>
  );
}
