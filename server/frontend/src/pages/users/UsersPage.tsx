import { apiClient } from "../../api";
import { useAsync } from "../../hooks/useAsync";
import { Card, ErrorState, LoadingState } from "../../components/ui/Feedback";

const ROLE_LABEL: Record<string, string> = { admin: "Administrador", operator: "Operador", viewer: "Sólo lectura" };

export function UsersPage() {
  const { data, loading, error, reload } = useAsync(() => apiClient.listUsers(), []);

  return (
    <div>
      <h1>Usuarios y permisos</h1>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

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
    </div>
  );
}
