import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import {
  createInvitation,
  getSmtp,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  updateSmtp,
  type Invitation,
  type SmtpSettings,
} from "../../api/invitationsApi";

/**
 * G-D/F5 · Invitaciones de jugador por correo. Se crea una invitación (código con
 * caducidad); mientras no haya SMTP configurado, el código se muestra aquí para
 * entregarlo a mano. Al aceptar (pantalla pública /invitacion/:code) el invitado pasa
 * a ser jugador registrado. La configuración SMTP es sólo del admin.
 */
export function InvitationsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("administrador");

  const [items, setItems] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listInvitations());
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se han podido cargar las invitaciones.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "La operación no se ha podido completar.");
    } finally {
      setBusy(null);
    }
  }

  function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    void act(() => createInvitation(email.trim(), name.trim() || undefined).then(() => { setEmail(""); setName(""); }), "create");
  }

  const link = (code: string) => `${window.location.origin}/invitacion/${code}`;

  return (
    <div>
      <h1>Invitaciones de jugador</h1>

      {isAdmin && <SmtpPanel />}

      <Card title="Invitar por correo">
        <p>Se genera un código con caducidad de 24 h. Si no hay SMTP configurado, entrégalo tú (el código aparece abajo).</p>
        <form onSubmit={invite} className="inline-form">
          <label>
            Correo <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Nombre (opcional) <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" disabled={busy === "create"}>
            {busy === "create" ? "Invitando…" : "Invitar"}
          </button>
        </form>
      </Card>

      {error && <ErrorState message={error} onRetry={load} />}
      {!items && !error && <LoadingState />}

      {items && (
        <Card title={`Invitaciones (${items.length})`}>
          {items.length === 0 ? (
            <p>Aún no hay invitaciones.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Correo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Código / enlace</th>
                    <th scope="col">Envío</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}{i.displayName ? ` · ${i.displayName}` : ""}</td>
                      <td>
                        <span className={`badge ${i.status === "accepted" ? "badge--ok" : i.status === "revoked" ? "badge--muted" : "badge--warn"}`}>{i.status}</span>
                      </td>
                      <td>
                        {i.status === "pending" ? (
                          <>
                            <strong>{i.code}</strong>
                            <br />
                            <code>{link(i.code)}</code>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td><small>{i.dispatchNote}</small></td>
                      <td>
                        {i.status === "pending" && (
                          <>
                            <button type="button" disabled={busy === i.id} onClick={() => act(() => resendInvitation(i.id), i.id)}>
                              Regenerar
                            </button>{" "}
                            <button type="button" disabled={busy === i.id} onClick={() => act(() => revokeInvitation(i.id), i.id)}>
                              Revocar
                            </button>
                          </>
                        )}
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

/** Configuración SMTP (solo admin). La contraseña no se muestra; se deja en blanco para no cambiarla. */
function SmtpPanel() {
  const [smtp, setSmtp] = useState<SmtpSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [secure, setSecure] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await getSmtp();
      setSmtp(s);
      setHost(s.host ?? "");
      setPort(s.port ? String(s.port) : "");
      setUsername(s.username ?? "");
      setFrom(s.fromAddress ?? "");
      setSecure(s.secure);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido cargar la configuración SMTP.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const s = await updateSmtp({
        host: host.trim() || null,
        port: port ? Number(port) : null,
        secure,
        username: username.trim() || null,
        password: password || null,
        from_address: from.trim() || null,
      });
      setSmtp(s);
      setPassword("");
      setOk(s.configured ? "SMTP guardado (correo configurado)." : "SMTP guardado (aún incompleto: falta host o remitente).");
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido guardar la configuración SMTP.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Configuración de correo (SMTP)">
      <p>
        Estado:{" "}
        {smtp?.configured ? (
          <span className="badge badge--ok">configurado</span>
        ) : (
          <span className="badge badge--warn">sin configurar</span>
        )}{" "}
        — mientras no esté configurado, las invitaciones se entregan con el código a mano.
      </p>
      <form onSubmit={save} className="firmware-upload">
        <label>Host <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.ejemplo.com" /></label>
        <label>Puerto <input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" /></label>
        <label>Usuario <input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Contraseña {smtp?.hasPassword ? "(guardada; deja en blanco para no cambiarla)" : ""} <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>Remitente <input type="email" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="diana@ejemplo.com" /></label>
        <label><input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} /> Conexión segura (TLS)</label>
        <button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar SMTP"}</button>
      </form>
      {ok && <p role="status">{ok}</p>}
      {error && <ErrorState message={error} />}
    </Card>
  );
}
