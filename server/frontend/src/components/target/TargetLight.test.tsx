import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TargetLight } from "./TargetLight";
import { TARGET_STATE_META } from "../../utils/targetStateMeta";
import type { TargetState } from "../../types/domain";

describe("TargetLight (requisito duro: nunca sólo color)", () => {
  it("expone un aria-label textual distinto del color para cada estado", () => {
    (Object.keys(TARGET_STATE_META) as TargetState[]).forEach((state) => {
      const { unmount } = render(<TargetLight targetIndex={5} state={state} />);
      const el = screen.getByRole("status");
      const label = el.getAttribute("aria-label") ?? "";
      // El aria-label debe ser texto legible, no un código de color ni vacío.
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/^#[0-9a-f]{3,6}$/i);
      expect(label).toContain(TARGET_STATE_META[state].aria);
      unmount();
    });
  });

  it("muestra una etiqueta de texto visible además del color de fondo", () => {
    render(<TargetLight targetIndex={3} state="active" />);
    expect(screen.getByText(TARGET_STATE_META.active.shortLabel)).toBeInTheDocument();
  });

  it("aplica una clase de patrón distinta por estado, no sólo un color inline", () => {
    render(<TargetLight targetIndex={1} state="hit" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain(`pattern-${TARGET_STATE_META.hit.pattern}`);
  });

  it("se comporta como botón accesible por teclado cuando recibe onClick", () => {
    render(<TargetLight targetIndex={2} state="safe" onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
