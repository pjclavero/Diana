import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { HomePage } from "./pages/home/HomePage";
import { ModulesPage } from "./pages/modules/ModulesPage";
import { ModuleDetailPage } from "./pages/module-detail/ModuleDetailPage";
import { CalibrationPage } from "./pages/calibration/CalibrationPage";
import { TestSensorsPage } from "./pages/test-sensors/TestSensorsPage";
import { TestLedsPage } from "./pages/test-leds/TestLedsPage";
import { TopologyPage } from "./pages/topology/TopologyPage";
import { PlayersPage } from "./pages/players/PlayersPage";
import { TeamsPage } from "./pages/teams/TeamsPage";
import { NewGamePage } from "./pages/new-game/NewGamePage";
import { CountdownPage } from "./pages/countdown/CountdownPage";
import { LiveGamePage } from "./pages/live/LiveGamePage";
import { ScoreboardPage } from "./pages/scoreboard/ScoreboardPage";
import { StatisticsPage } from "./pages/stats/StatisticsPage";
import { PresetsPage } from "./pages/presets/PresetsPage";
import { DemoPage } from "./pages/demo/DemoPage";
import { DueloPage } from "./pages/duelo/DueloPage";
import { ParticipantsPage } from "./pages/participants/ParticipantsPage";
import { FirmwarePage } from "./pages/firmware/FirmwarePage";
import { IncidentsPage } from "./pages/incidents/IncidentsPage";
import { UsersPage } from "./pages/users/UsersPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ModuleOwnershipPage } from "./pages/modules-ownership/ModuleOwnershipPage";
import { ViewsPage } from "./pages/views/ViewsPage";
import { LoginPage } from "./pages/login/LoginPage";
import { ChangePasswordPage } from "./pages/login/ChangePasswordPage";
import { JoinPage } from "./pages/join/JoinPage";
import { InvitationAcceptPage } from "./pages/invitations/InvitationAcceptPage";
import { InvitationsPage } from "./pages/invitations/InvitationsPage";
import { ManagerActivationPage } from "./pages/invitations/ManagerActivationPage";
import { useAuth } from "./auth/AuthContext";

/**
 * `results` se retiró (auditoría 2026-08-05 §4, decisión del operador):
 * pintaba datos de demostración con el mismo contrato que `marcador` ya
 * sirve con datos reales y con el tratamiento correcto de «no calculable».
 * Los enlaces y marcadores antiguos a `/resultados` siguen llevando a algún
 * sitio útil en vez de a un 404.
 */
function ResultsRedirect() {
  const { gameId } = useParams();
  return <Navigate to={gameId ? `/marcador/${gameId}` : "/marcador"} replace />;
}

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Rutas PÚBLICAS (sin login), antes de la barrera de sesión: unión por QR y
  // aceptación de invitación.
  if (location.pathname.startsWith("/unirse/") || location.pathname.startsWith("/invitacion/")) {
    return (
      <Routes>
        <Route path="/unirse/:code" element={<JoinPage />} />
        <Route path="/invitacion/:code" element={<InvitationAcceptPage />} />
      </Routes>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Cargando…</div>
    );
  }
  if (!user) return <LoginPage />;
  if (user.must_change_password) return <ChangePasswordPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        {/* `system` se fusionó con Inicio (auditoría 2026-08-05 §4): el
            enlace antiguo sigue llevando al panel, no a un 404. */}
        <Route path="/sistema" element={<Navigate to="/" replace />} />
        <Route path="/modulos" element={<ModulesPage />} />
        <Route path="/modulos-propiedad" element={<ModuleOwnershipPage />} />
        <Route path="/modulos/:moduleId" element={<ModuleDetailPage />} />
        <Route path="/modulos/:moduleId/calibracion" element={<CalibrationPage />} />
        <Route path="/modulos/:moduleId/prueba-sensores" element={<TestSensorsPage />} />
        <Route path="/modulos/:moduleId/prueba-leds" element={<TestLedsPage />} />
        <Route path="/topologia" element={<TopologyPage />} />
        <Route path="/vistas" element={<ViewsPage />} />
        <Route path="/jugadores" element={<PlayersPage />} />
        <Route path="/equipos" element={<TeamsPage />} />
        <Route path="/partidas/nueva" element={<NewGamePage />} />
        <Route path="/partidas/:gameId/cuenta-atras" element={<CountdownPage />} />
        <Route path="/partidas/:gameId/directo" element={<LiveGamePage />} />
        <Route path="/resultados" element={<ResultsRedirect />} />
        <Route path="/resultados/:gameId" element={<ResultsRedirect />} />
        <Route path="/marcador" element={<ScoreboardPage />} />
        <Route path="/marcador/:gameId" element={<ScoreboardPage />} />
        <Route path="/estadisticas" element={<StatisticsPage />} />
        <Route path="/presets" element={<PresetsPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/duelo" element={<DueloPage />} />
        <Route path="/participantes" element={<ParticipantsPage />} />
        <Route path="/invitaciones" element={<InvitationsPage />} />
        <Route path="/acceso-gestor" element={<ManagerActivationPage />} />
        <Route path="/firmware" element={<FirmwarePage />} />
        <Route path="/incidencias" element={<IncidentsPage />} />
        <Route path="/usuarios" element={<UsersPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
