import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../api/client";
import "./LoginPage.css";

/**
 * Cambio de contraseña obligatorio en el primer acceso (la cuenta inicial se
 * crea con `must_change_password`). Se muestra tras el login y antes del panel.
 */
export function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 12) {
      setError("La nueva contraseña debe tener al menos 12 caracteres.");
      return;
    }
    if (next !== repeat) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : "No se ha podido cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={onSubmit} aria-labelledby="cp-title">
        <h1 id="cp-title" className="login__title">
          Cambia tu contraseña
        </h1>
        <p className="login__field" style={{ marginTop: "-0.5rem" }}>
          Es tu primer acceso: define una contraseña nueva (mínimo 12 caracteres).
        </p>

        <label className="login__field">
          <span>Contraseña actual</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </label>
        <label className="login__field">
          <span>Nueva contraseña</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="login__field">
          <span>Repite la nueva contraseña</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </label>

        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}

        <button className="login__submit" type="submit" disabled={busy}>
          {busy ? "Guardando…" : "Guardar y continuar"}
        </button>
        <button type="button" className="login__field" style={{ background: "none", border: 0, color: "#2563eb", cursor: "pointer" }} onClick={logout}>
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
