import type { ConnectionStatus } from "../../api/gameSocket";
import "./ConnectionBadge.css";

const META: Record<ConnectionStatus, { label: string; symbol: string; className: string }> = {
  connecting: { label: "Conectando", symbol: "◐", className: "conn--connecting" },
  connected: { label: "En directo", symbol: "●", className: "conn--connected" },
  degraded: { label: "Conexión degradada, reintentando", symbol: "▲", className: "conn--degraded" },
  disconnected: { label: "Sin conexión", symbol: "✕", className: "conn--disconnected" },
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const meta = META[status];
  return (
    <span className={`conn-badge ${meta.className}`} role="status">
      <span aria-hidden="true">{meta.symbol}</span> {meta.label}
    </span>
  );
}
