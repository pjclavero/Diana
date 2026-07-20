import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import "./AppShell.css";

const NAV_SECTIONS: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: "General",
    links: [
      { to: "/", label: "Inicio" },
      { to: "/sistema", label: "Estado del sistema" },
      { to: "/modulos", label: "Módulos" },
      { to: "/topologia", label: "Editor de matriz" },
    ],
  },
  {
    title: "Partidas",
    links: [
      { to: "/partidas/nueva", label: "Nueva partida" },
      { to: "/resultados", label: "Resultados" },
      { to: "/estadisticas", label: "Estadísticas" },
    ],
  },
  {
    title: "Personas",
    links: [
      { to: "/jugadores", label: "Jugadores" },
      { to: "/equipos", label: "Equipos" },
    ],
  },
  {
    title: "Sistema",
    links: [
      { to: "/firmware", label: "Firmware" },
      { to: "/incidencias", label: "Incidencias" },
      { to: "/usuarios", label: "Usuarios y permisos" },
      { to: "/copias", label: "Copias y estado" },
    ],
  },
];

export function AppShell() {
  const [open, setOpen] = useState(false);

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
      </header>

      <nav
        id="app-shell-nav"
        className={`app-shell__nav ${open ? "app-shell__nav--open" : ""}`}
        aria-label="Navegación principal"
      >
        {NAV_SECTIONS.map((section) => (
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
        <Outlet />
      </main>
    </div>
  );
}
