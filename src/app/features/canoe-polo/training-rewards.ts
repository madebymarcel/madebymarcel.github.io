export const REWARD_KEYS = [
  'winBall',
  'usefulPass',
  'receivePass',
  'saveGoal',
  'ignoreLooseBall',
] as const;
export type RewardKey = (typeof REWARD_KEYS)[number];
export type TrainingRewards = Record<RewardKey, number>;

export const DEFAULT_REWARDS: Readonly<TrainingRewards> = {
  winBall: 0.2,
  usefulPass: 0.18,
  receivePass: 0.08,
  saveGoal: 0.35,
  ignoreLooseBall: 0.02,
};

export function validRewards(value: unknown): value is TrainingRewards {
  if (!value || typeof value !== 'object') return false;
  const rewards = value as Partial<TrainingRewards>;
  return REWARD_KEYS.every((key) => {
    const n = rewards[key];
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  });
}
