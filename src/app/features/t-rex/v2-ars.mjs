// ARS-style paired finite differences. No physics or browser dependencies.
export const DIRECTIONS = 12;
export const ELITES = 5;
export const NOISE = 0.08;
export const STEP_SIZE = 0.035;

export function perturb(weights, active, seed) {
  let rng = seed >>> 0 || 1;
  const random = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    rng >>>= 0;
    return rng / 4294967296;
  };
  const directions = Array.from({ length: DIRECTIONS }, () =>
    weights.map((_, index) => (active[index] ? Math.sqrt(12) * (random() - 0.5) : 0)),
  );
  const policies = directions.flatMap((direction) =>
    [1, -1].map((sign) => weights.map((weight, i) => weight + sign * NOISE * direction[i])),
  );
  return { rng, directions, policies };
}

export function updateWeights(weights, directions, rewards) {
  if (
    directions.length !== DIRECTIONS ||
    rewards.length !== 2 * DIRECTIONS ||
    !rewards.every(Number.isFinite)
  ) {
    throw new Error('Incomplete or nonfinite ARS wave.');
  }
  const elite = directions
    .map((direction, i) => ({ direction, positive: rewards[2 * i], negative: rewards[2 * i + 1] }))
    .sort((a, b) => Math.max(b.positive, b.negative) - Math.max(a.positive, a.negative))
    .slice(0, ELITES);
  const scores = elite.flatMap(({ positive, negative }) => [positive, negative]);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length);
  if (sd < 1e-8) return weights.slice();
  return weights.map((weight, i) => {
    const update = elite.reduce(
      (sum, { positive, negative, direction }) => sum + (positive - negative) * direction[i],
      0,
    );
    return Math.max(-8, Math.min(8, weight + (STEP_SIZE * update) / (ELITES * sd)));
  });
}
