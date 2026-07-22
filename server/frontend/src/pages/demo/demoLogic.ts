/**
 * Lógica pura del modo demo (G-E, §6.4). Sin estado externo ni E/S: fácil de testear.
 * El modo demo es efímero: no toca la BD de partidas ni jugadores; los tiempos viven
 * SÓLO en la sesión (sessionStorage), y se pierden al cerrar (≈ "apagar").
 */

export const DEMO_TARGET_COUNT = 12;
const MAX_TIMES = 10;
const TIMES_KEY = "diana.demo.times";

/**
 * Genera una secuencia de `count` dianas (índices 1..9) al azar, evitando que la
 * misma diana se repita dos veces seguidas. `rand` inyectable para tests deterministas.
 */
export function makeSequence(count: number, rand: () => number = Math.random): number[] {
  const seq: number[] = [];
  let prev = -1;
  for (let i = 0; i < count; i++) {
    let next = 1 + Math.floor(rand() * 9);
    if (next < 1) next = 1;
    if (next > 9) next = 9;
    // Evita repetir la anterior: desplaza una posición de forma estable.
    if (next === prev) next = (next % 9) + 1;
    seq.push(next);
    prev = next;
  }
  return seq;
}

/** Antepone un tiempo (ms) y conserva los `max` más recientes (más nuevo primero). */
export function pushTime(list: number[], ms: number, max: number = MAX_TIMES): number[] {
  return [ms, ...list].slice(0, max);
}

/** Formatea milisegundos como s.decimas (p. ej. 8.42 s). */
export function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Lee los últimos tiempos de la sesión (vacío si no hay o si el JSON es inválido). */
export function loadTimes(): number[] {
  try {
    const raw = sessionStorage.getItem(TIMES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/** Guarda los tiempos en la sesión (efímero; no toca la BD). */
export function saveTimes(times: number[]): void {
  try {
    sessionStorage.setItem(TIMES_KEY, JSON.stringify(times));
  } catch {
    /* sesión sin almacenamiento: el demo sigue funcionando, sin histórico */
  }
}
