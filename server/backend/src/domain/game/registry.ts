import { GameModeStrategy } from './types';
import { RandomModeStrategy } from './strategies/random.strategy';
import { SequenceModeStrategy } from './strategies/sequence.strategy';
import { AllAgainstClockModeStrategy } from './strategies/all-against-clock.strategy';
import { ReactionModeStrategy } from './strategies/reaction.strategy';

/**
 * Registro de estrategias de modo de juego.
 *
 * Extensibilidad (encargo §10): añadir un modo consiste en implementar
 * `GameModeStrategy` y llamar a `register()`. Ni el motor ni el registro
 * conocen los modos concretos más allá de la carga por defecto.
 */
export class GameModeRegistry {
  private readonly strategies = new Map<string, GameModeStrategy>();

  register(strategy: GameModeStrategy): this {
    if (this.strategies.has(strategy.key)) {
      throw new Error(`El modo de juego '${strategy.key}' ya está registrado`);
    }
    this.strategies.set(strategy.key, strategy);
    return this;
  }

  has(key: string): boolean {
    return this.strategies.has(key);
  }

  get(key: string): GameModeStrategy {
    const strategy = this.strategies.get(key);
    if (!strategy) {
      throw new Error(
        `Modo de juego desconocido: '${key}'. Registrados: ${this.keys().join(', ') || 'ninguno'}`,
      );
    }
    return strategy;
  }

  keys(): string[] {
    return [...this.strategies.keys()].sort();
  }

  list(): GameModeStrategy[] {
    return this.keys().map((key) => this.get(key));
  }
}

/** Registro con los cuatro modos de la Ola 1. */
export function createDefaultRegistry(): GameModeRegistry {
  return new GameModeRegistry()
    .register(new RandomModeStrategy())
    .register(new SequenceModeStrategy())
    .register(new AllAgainstClockModeStrategy())
    .register(new ReactionModeStrategy());
}
