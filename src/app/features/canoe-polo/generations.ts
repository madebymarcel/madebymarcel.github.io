import { RULESET } from './model';
import { POLICY_VERSION, WEIGHT_COUNT, initialWeights } from './policy';

export interface Generation {
  id: string;
  parentId: string | null;
  number: number;
  weights: number[];
  matches: number;
  steps: number;
  evaluation: [number, number] | null;
}

export const GENESIS: Generation = {
  id: 'genesis-v1',
  parentId: null,
  number: 0,
  weights: initialWeights(),
  matches: 0,
  steps: 0,
  evaluation: null,
};

const FORMAT = 'canoe-polo-generations-v1';
const MAX_IMPORT = 20_000_000;

export function exportGenerations(generations: readonly Generation[]): string {
  return JSON.stringify({ format: FORMAT, ruleset: RULESET, policy: POLICY_VERSION, generations });
}

function validGeneration(value: unknown): value is Generation {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Partial<Generation>;
  const count = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v);
  return (
    id(g.id) &&
    (g.parentId === null || id(g.parentId)) &&
    count(g.number) &&
    count(g.matches) &&
    count(g.steps) &&
    Array.isArray(g.weights) &&
    g.weights.length === WEIGHT_COUNT &&
    g.weights.every((w) => typeof w === 'number' && Number.isFinite(w) && Math.abs(w) <= 20) &&
    (g.evaluation === null ||
      (Array.isArray(g.evaluation) && g.evaluation.length === 2 && g.evaluation.every(count))) &&
    (g.id !== GENESIS.id || JSON.stringify(g) === JSON.stringify(GENESIS))
  );
}

export function importGenerations(source: string): Generation[] {
  if (source.length > MAX_IMPORT) throw new Error('Generation export is too large.');
  const data: unknown = JSON.parse(source);
  if (typeof data !== 'object' || data === null) throw new Error('Invalid generation export.');
  const envelope = data as {
    format?: unknown;
    ruleset?: unknown;
    policy?: unknown;
    generations?: unknown;
  };
  if (
    envelope.format !== FORMAT ||
    envelope.ruleset !== RULESET ||
    envelope.policy !== POLICY_VERSION ||
    !Array.isArray(envelope.generations) ||
    envelope.generations.length === 0 ||
    !envelope.generations.every(validGeneration)
  ) {
    throw new Error('Invalid or incompatible generation export.');
  }
  const generations = envelope.generations as Generation[];
  if (new Set(generations.map((g) => g.id)).size !== generations.length) {
    throw new Error('Export contains duplicate generation IDs.');
  }
  // Copy only data with an explicitly recognized schema.
  return generations.map((g) => ({
    id: g.id,
    parentId: g.parentId,
    number: g.number,
    weights: [...g.weights],
    matches: g.matches,
    steps: g.steps,
    evaluation: g.evaluation,
  }));
}

export function mergeGenerations(
  existing: readonly Generation[],
  incoming: readonly Generation[],
): Generation[] {
  const result = new Map(existing.map((g) => [g.id, g]));
  for (const generation of incoming) {
    const old = result.get(generation.id);
    if (old && JSON.stringify(old) !== JSON.stringify(generation)) {
      throw new Error('A different generation already uses this ID.');
    }
    result.set(generation.id, old ?? generation);
  }
  return [...result.values()].sort((a, b) => b.number - a.number || a.id.localeCompare(b.id));
}
