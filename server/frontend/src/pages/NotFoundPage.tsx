import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div>
      <h1>Página no encontrada</h1>
      <p>La pantalla solicitada no existe en el panel.</p>
      <Link to="/">Volver al inicio</Link>
    </div>
  );
}
