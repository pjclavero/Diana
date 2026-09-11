import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { estadoDeLista } from "../../utils/estadoModulo";

const ROLE_LABEL: Record<string, string> = { admin: "Administrador", operator: "Operador", viewer: "Sólo lectura" };

export function UsersPage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.listUsers(), []);
  // Antes esta pantalla pintaba `data?.map(...)` dentro de la tabla: ante un
  // fallo de consulta enseñaba una tabla VACÍA con sus cabeceras, que se lee
  // como «no hay usuarios». Un panel de permisos que dice «no hay cuentas»
  // porque no pudo preguntar es peligroso de un modo evidente.
  const estado = estadoDeLista({ cargando: loading, error, datos: data });

  return (
    <div>
      <h1>Usuarios y permisos</h1>
      {estado === "cargando" && <LoadingState />}
      {estado === "error" && (
        <ErrorState
          message={`${error} No se puede afirmar qué cuentas existen: la consulta no llegó a responder.`}
          onRetry={reload}
        />
      )}

      {estado === "vacio" && (
        <Card title="Cuentas">
          <EmptyState>
            No hay ninguna cuenta registrada (comprobado ahora mismo contra el backend).
          </EmptyState>
        </Card>
      )}

      {estado === "con-datos" && (
      <Card title="Cuentas">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Rol</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td>{u.active ? "Activo" : "Inactivo"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      )}
    </div>
  );
}
