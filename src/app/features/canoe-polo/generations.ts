import { RULESET } from './model';
import { POLICY_VERSION, WEIGHT_COUNT, initialWeights } from './policy';
import { copySavedRewards, validRewards, type SavedRewards } from './training-rewards';

export interface Generation {
  id: string;
  parentId: string | null;
  number: number;
  weights: number[];
  matches: number;
  steps: number;
  rewards?: SavedRewards;
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
export const MAX_GENERATION_IMPORT_BYTES = 64_000_000;

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
    (g.rewards === undefined || validRewards(g.rewards)) &&
    Array.isArray(g.weights) &&
    g.weights.length === WEIGHT_COUNT &&
    g.weights.every((w) => typeof w === 'number' && Number.isFinite(w) && Math.abs(w) <= 20) &&
    (g.evaluation === null ||
      (Array.isArray(g.evaluation) && g.evaluation.length === 2 && g.evaluation.every(count))) &&
    (g.id !== GENESIS.id || JSON.stringify(g) === JSON.stringify(GENESIS))
  );
}

export function importGenerations(source: string): Generation[] {
  if (source.length > MAX_GENERATION_IMPORT_BYTES) {
    throw new Error('Generation data exceeds the 64 MB import limit.');
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('The generation file is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('This is not a Canoe Polo generation export.');
  }
  const envelope = data as {
    format?: unknown;
    ruleset?: unknown;
    policy?: unknown;
    generations?: unknown;
  };
  if (
    envelope.format !== FORMAT ||
    !Array.isArray(envelope.generations) ||
    envelope.generations.length === 0
  ) {
    throw new Error('This is not a Canoe Polo generation export.');
  }
  if (envelope.ruleset !== RULESET || envelope.policy !== POLICY_VERSION) {
    throw new Error('This simulator imports v3 generation exports only.');
  }
  if (!envelope.generations.every(validGeneration)) {
    throw new Error('The export contains invalid generation data.');
  }
  const generations: Generation[] = envelope.generations;
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
    ...(g.rewards && { rewards: copySavedRewards(g.rewards) }),
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
