import type { ReactNode } from "react";
import "./Feedback.css";

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <p className="feedback feedback--loading" role="status">
      {label}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="feedback feedback--error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="feedback feedback--empty" role="status">
      {children}
    </p>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__header">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}
