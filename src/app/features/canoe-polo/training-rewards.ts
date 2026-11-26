const CORE = ['winBall', 'usefulPass', 'receivePass', 'saveGoal', 'ignoreLooseBall'] as const;
const ADDITIONAL = [
  'scoreGoal',
  'concedeGoal',
  'matchResult',
  'teamFoul',
  'opponentFoul',
  'throwOut',
  'approachLooseBall',
  'advanceWithBall',
] as const;
export const REWARD_KEYS = [...CORE, ...ADDITIONAL] as const;
export type RewardKey = (typeof REWARD_KEYS)[number];
export type TrainingRewards = Record<RewardKey, number>;
export type SavedRewards = Pick<TrainingRewards, (typeof CORE)[number]> &
  Partial<Pick<TrainingRewards, (typeof ADDITIONAL)[number]>>;

export const DEFAULT_REWARDS: Readonly<TrainingRewards> = {
  winBall: 0.2,
  usefulPass: 0.18,
  receivePass: 0.08,
  saveGoal: 0.35,
  ignoreLooseBall: 0.02,
  scoreGoal: 5,
  concedeGoal: 5,
  matchResult: 3,
  teamFoul: 0.4,
  opponentFoul: 0.1,
  throwOut: 0.22,
  approachLooseBall: 0.2,
  advanceWithBall: 0.12,
};

export function rewardMax(key: RewardKey): number {
  return ['scoreGoal', 'concedeGoal', 'matchResult'].includes(key) ? 10 : 1;
}

export function validRewardValue(key: RewardKey, n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= rewardMax(key);
}

export function validRewards(value: unknown): value is SavedRewards {
  if (!value || typeof value !== 'object') return false;
  const rewards = value as Partial<TrainingRewards>;
  return (
    CORE.every((key) => validRewardValue(key, rewards[key])) &&
    ADDITIONAL.every(
      (key) =>
        !Object.prototype.hasOwnProperty.call(rewards, key) || validRewardValue(key, rewards[key]),
    )
  );
}

export function copySavedRewards(rewards: SavedRewards): SavedRewards {
  const result: SavedRewards = {
    winBall: rewards.winBall,
    usefulPass: rewards.usefulPass,
    receivePass: rewards.receivePass,
    saveGoal: rewards.saveGoal,
    ignoreLooseBall: rewards.ignoreLooseBall,
  };
  for (const key of ADDITIONAL) {
    if (rewards[key] !== undefined) result[key] = rewards[key];
  }
  return result;
}
