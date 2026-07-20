import { targetStateMeta } from "../../utils/targetStateMeta";
import type { TargetState } from "../../types/domain";
import "./TargetLight.css";

export interface TargetLightProps {
  targetIndex: number;
  state: TargetState;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
}

/**
 * Representación accesible de una diana. Requisito duro (dosier §10.5):
 * el estado NUNCA se comunica sólo por color. Se combina:
 *  - color (fondo)
 *  - patrón/animación (clase `pattern-*`)
 *  - símbolo textual (glifo, independiente del color)
 *  - etiqueta de texto visible (`shortLabel`)
 *  - atributo accesible (`aria-label` + `role`)
 */
export function TargetLight({ targetIndex, state, onClick, size = "md" }: TargetLightProps) {
  const meta = targetStateMeta(state);
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      className={`target-light target-light--${size} pattern-${meta.pattern}`}
      style={{ backgroundColor: meta.color }}
      onClick={onClick}
      type={onClick ? "button" : undefined}
      role={onClick ? undefined : "status"}
      aria-label={`Diana ${targetIndex}: ${meta.aria}`}
      data-state={state}
      data-target-index={targetIndex}
    >
      <span className="target-light__symbol" aria-hidden="true">
        {meta.symbol}
      </span>
      <span className="target-light__index" aria-hidden="true">
        {targetIndex}
      </span>
      <span className="target-light__label">{meta.shortLabel}</span>
    </Tag>
  );
}
