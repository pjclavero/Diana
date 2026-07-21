import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import "./AppShell.css";

/** En modo mock los datos de negocio son de demostración (la sesión es real). */
const DEMO_DATA = (import.meta.env.VITE_API_MODE ?? "mock") !== "real";

interface NavLinkDef {
  to: string;
  label: string;
  /** Permiso necesario para ver el enlace; si falta, es visible para todos. */
  perm?: string;
}

const NAV_SECTIONS: { title: string; links: NavLinkDef[] }[] = [
  {
    title: "General",
    links: [
      { to: "/", label: "Inicio" },
      { to: "/sistema", label: "Estado del sistema", perm: "modules:read" },
      { to: "/modulos", label: "Módulos", perm: "modules:read" },
      { to: "/modulos-propiedad", label: "Propiedad de módulos", perm: "modules:read" },
      { to: "/topologia", label: "Editor de matriz", perm: "topology:write" },
    ],
  },
  {
    title: "Partidas",
    links: [
      { to: "/partidas/nueva", label: "Nueva partida", perm: "games:write" },
      { to: "/resultados", label: "Resultados" },
      { to: "/estadisticas", label: "Estadísticas" },
    ],
  },
  {
    title: "Personas",
    links: [
      { to: "/jugadores", label: "Jugadores", perm: "players:read" },
      { to: "/equipos", label: "Equipos", perm: "teams:read" },
    ],
  },
  {
    title: "Sistema",
    links: [
      { to: "/firmware", label: "Firmware", perm: "firmware:read" },
      { to: "/incidencias", label: "Incidencias", perm: "incidents:read" },
      { to: "/usuarios", label: "Usuarios y permisos", perm: "users:read" },
      { to: "/copias", label: "Copias y estado", perm: "maintenance:read" },
    ],
  },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { user, logout, can } = useAuth();

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    links: section.links.filter((link) => !link.perm || can(link.perm)),
  })).filter((section) => section.links.length > 0);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Saltar al contenido principal
      </a>
      <header className="app-shell__topbar">
        <button
          className="app-shell__menu-btn"
          aria-expanded={open}
          aria-controls="app-shell-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span> Menú
        </button>
        <span className="app-shell__title">Diana · Panel de control</span>
        <span className="app-shell__spacer" />
        {user && (
          <span className="app-shell__user">
            <span className="app-shell__user-name">{user.username}</span>
            <span className="app-shell__user-role">{user.role}</span>
            <button className="app-shell__logout" onClick={logout}>
              Cerrar sesión
            </button>
          </span>
        )}
      </header>

      <nav
        id="app-shell-nav"
        className={`app-shell__nav ${open ? "app-shell__nav--open" : ""}`}
        aria-label="Navegación principal"
      >
        {sections.map((section) => (
          <div key={section.title} className="app-shell__nav-section">
            <h2>{section.title}</h2>
            <ul>
              {section.links.map((link) => (
                <li key={link.to}>
                  <NavLink to={link.to} onClick={() => setOpen(false)} className={({ isActive }) => (isActive ? "active" : "")} end={link.to === "/"}>
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <main id="main-content" className="app-shell__content" tabIndex={-1}>
        {DEMO_DATA && (
          <p className="app-shell__demo" role="status">
            La sesión, los roles y la propiedad de módulos son reales; algunas pantallas aún
            muestran datos de demostración y se conectan al backend por fases.
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
