import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { ApiError } from "../../api/client";
import { acceptInvitation, invitationByCode, type InvitationInfo } from "../../api/invitationsApi";

/**
 * G-D/F5 · Pantalla PÚBLICA de aceptación de invitación (`/invitacion/:code`), sin
 * login. Al aceptar, la persona pasa a ser un jugador registrado (se guarda su histórico).
 */
export function InvitationAcceptPage() {
  const { code = "" } = useParams();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    invitationByCode(code)
      .then((i) => {
        setInfo(i);
        if (i.displayName) setName(i.displayName);
      })
      .catch((e) => setError(e instanceof ApiError ? e.userMessage : "No se ha encontrado la invitación."));
  }, [code]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await acceptInvitation(code, name.trim());
      setDone(r.displayName);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : "No se ha podido aceptar la invitación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Invitación a Diana</h1>
      {!info && !error && <LoadingState />}
      {error && <ErrorState message={error} />}

      {info && done && (
        <Card title="¡Listo!">
          <p>
            Bienvenido/a, <strong>{done}</strong>. Ya eres jugador registrado: tus partidas y estadísticas se guardarán.
          </p>
        </Card>
      )}

      {info && !done && (
        <Card title="Te han invitado a jugar">
          {info.acceptable ? (
            <form onSubmit={accept} className="inline-form">
              <p>Confirma tu nombre para registrarte y guardar tu histórico.</p>
              <label>
                Tu nombre <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={128} />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "Aceptando…" : "Aceptar invitación"}
              </button>
            </form>
          ) : (
            <p>Esta invitación {info.expired ? "ha caducado" : "ya no es válida"}. Pide una nueva a quien te invitó.</p>
          )}
        </Card>
      )}
    </div>
  );
}
