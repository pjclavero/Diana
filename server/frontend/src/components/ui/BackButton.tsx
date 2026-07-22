import { useNavigate } from "react-router-dom";

/**
 * Botón "volver" reutilizable. Vuelve a la pantalla anterior del historial
 * (`navigate(-1)`); si se pasa `to`, navega a esa ruta en su lugar (útil como
 * destino estable cuando no hay historial, p. ej. al entrar por enlace directo).
 */
export function BackButton({ to, label = "← Volver" }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="back-button"
      onClick={() => (to ? navigate(to) : navigate(-1))}
    >
      {label}
    </button>
  );
}
