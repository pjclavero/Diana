import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { HomePage } from "./pages/home/HomePage";
import { SystemStatusPage } from "./pages/system/SystemStatusPage";
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
import { ResultsPage } from "./pages/results/ResultsPage";
import { StatisticsPage } from "./pages/stats/StatisticsPage";
import { FirmwarePage } from "./pages/firmware/FirmwarePage";
import { IncidentsPage } from "./pages/incidents/IncidentsPage";
import { UsersPage } from "./pages/users/UsersPage";
import { BackupsPage } from "./pages/backups/BackupsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/sistema" element={<SystemStatusPage />} />
        <Route path="/modulos" element={<ModulesPage />} />
        <Route path="/modulos/:moduleId" element={<ModuleDetailPage />} />
        <Route path="/modulos/:moduleId/calibracion" element={<CalibrationPage />} />
        <Route path="/modulos/:moduleId/prueba-sensores" element={<TestSensorsPage />} />
        <Route path="/modulos/:moduleId/prueba-leds" element={<TestLedsPage />} />
        <Route path="/topologia" element={<TopologyPage />} />
        <Route path="/jugadores" element={<PlayersPage />} />
        <Route path="/equipos" element={<TeamsPage />} />
        <Route path="/partidas/nueva" element={<NewGamePage />} />
        <Route path="/partidas/:gameId/cuenta-atras" element={<CountdownPage />} />
        <Route path="/partidas/:gameId/directo" element={<LiveGamePage />} />
        <Route path="/resultados" element={<ResultsPage />} />
        <Route path="/resultados/:gameId" element={<ResultsPage />} />
        <Route path="/estadisticas" element={<StatisticsPage />} />
        <Route path="/firmware" element={<FirmwarePage />} />
        <Route path="/incidencias" element={<IncidentsPage />} />
        <Route path="/usuarios" element={<UsersPage />} />
        <Route path="/copias" element={<BackupsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
