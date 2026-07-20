import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { Scenario } from './schema.js';

/** Carga un escenario declarativo en JSON o YAML (por extensión de fichero). */
export function loadScenario(path: string): Scenario {
  const raw = readFileSync(path, 'utf-8');
  const data = path.endsWith('.yaml') || path.endsWith('.yml') ? yaml.load(raw) : JSON.parse(raw);
  return data as Scenario;
}

export function parseScenario(text: string, format: 'json' | 'yaml' = 'json'): Scenario {
  const data = format === 'yaml' ? yaml.load(text) : JSON.parse(text);
  return data as Scenario;
}
