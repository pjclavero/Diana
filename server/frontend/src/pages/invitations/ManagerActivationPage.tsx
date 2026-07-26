import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { BackButton } from "../../components/ui/BackButton";
import {
  activateManager,
  listManagerActivations,
  myActivation,
  regenerateActivation,
  revokeActivation,
  type ManagerActivation,
  type MyActivation,
} from "../../api/managerActivationApi";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function estado(a: ManagerActivation): string {
  if (a.status === "activated") return "Activado";
  if (a.status === "revoked") return "Revocado";
  return a.expired ? "Caducado" : "Pendiente";
}

/**
 * Ascenso a gestor por venta de módulo (F5, §3.1).
 *
 * Vender un módulo **no** convierte a nadie en gestor: abre un código que el
 * comprador tiene que introducir. Esta pantalla sirve a los dos lados —el
 * comprador introduce el suyo, el administrador ve y regenera los que ha
 * emitido— porque son las dos mitades del mismo acto.
 */
export function ManagerActivationPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("administrador");

  const [mine, setMine] = useState<MyActivation | null>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [items, setItems] = useState<ManagerActivation[] | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMine(await myActivation());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se pudo consultar su estado.");
    }
    if (!isAdmin) return;
    try {
      const list = await listManagerActivations();
      setItems(list.items);
      setSmtpConfigured(list.smtpConfigured);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se pudieron cargar los ascensos.");
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy("activate");
    setError(null);
    setResult(null);
    try {
      const res = await activateManager(code);
      setResult(res.note);
      setCode("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se pudo activar.");
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, what: "regenerate" | "revoke") {
    setBusy(id);
    setError(null);
    try {
      if (what === "regenerate") await regenerateActivation(id);
      else await revokeActivation(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se pudo completar la operación.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <BackButton />
      <h1>Acceso de gestor</h1>

      <Card title="Activar mi acceso de gestor">
        {mine === null ? (
          <LoadingState />
        ) : mine.pending ? (
          <>
            <p>
              Tiene un ascenso a gestor pendiente. Introduzca el código que le han facilitado.
              Caduca el <strong>{formatDate(mine.expiresAt)}</strong>.
            </p>
            <form onSubmit={activate}>
              <label htmlFor="codigo">Código de activación</label>
              <input
                id="codigo"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                placeholder="Ej.: ABCD2345"
              />
              <button type="submit" disabled={busy === "activate" || code.trim().length === 0}>
                Activar
              </button>
            </form>
          </>
        ) : (
          <p>{mine.note ?? "No tiene ningún ascenso pendiente."}</p>
        )}
        {result && <p role="status">{result}</p>}
        {error && <ErrorState message={error} />}
      </Card>

      {isAdmin && (
        <Card title="Ascensos emitidos">
          {smtpConfigured === false && (
            <p role="alert">
              <strong>No hay SMTP configurado:</strong> no se ha enviado ningún correo. Tiene que
              facilitar el código al comprador usted mismo.
            </p>
          )}
          {items === null ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <p>Todavía no se ha vendido ningún módulo a un jugador.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Usuario</th>
                    <th scope="col">Módulo</th>
                    <th scope="col">Código</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Caduca</th>
                    <th scope="col">Entrega</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.user.username}</th>
                      <td>{a.module?.friendlyName ?? a.module?.slug ?? "—"}</td>
                      <td>
                        <code>{a.status === "pending" && !a.expired ? a.code : "—"}</code>
                      </td>
                      <td>{estado(a)}</td>
                      <td>{formatDate(a.expiresAt)}</td>
                      <td>{a.dispatchNote ?? "—"}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => act(a.id, "regenerate")}
                          disabled={busy === a.id || a.status === "activated"}
                        >
                          Regenerar
                        </button>{" "}
                        <button
                          type="button"
                          onClick={() => act(a.id, "revoke")}
                          disabled={busy === a.id || a.status !== "pending"}
                        >
                          Revocar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
