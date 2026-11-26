import {
  attackDirection,
  BALL_RADIUS,
  clamp,
  DT,
  PITCH,
  type Action,
  type MatchState,
  type Player,
} from './model';

export const HOLD = 0;
export const COLLECT = 1;
export const FIRST_PASS = 2;
export const FREE_THROW = 6;
export const BALL_ACTIONS = 7;

export function teammates(state: MatchState, player: Player): Player[] {
  return state.players.filter((p) => p.team === player.team && p.id !== player.id);
}

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  target: number | null;
}

function assistedGoalLaunch(state: MatchState, player: Player, maxSpeed: number): Launch | null {
  const direction = attackDirection(player.team, state.half);
  const goalX = direction === 1 ? PITCH.length + BALL_RADIUS : -BALL_RADIUS;
  const goalZ = (PITCH.goalBottom + PITCH.goalTop) / 2;
  // Search at whole flight ticks because the simulation integrates vertical velocity discretely.
  // Give the ball a legal trajectory, never a goal or possession award.
  for (let ticks = 2; ticks <= 24; ticks++) {
    const time = ticks * DT;
    const vx = (goalX - player.x) / time;
    const vy = (PITCH.width / 2 - player.y) / time;
    const vz = (goalZ - 1.1) / time + (9.81 * (time - DT)) / 2;
    if (Math.hypot(vx - 0.35 * player.vx, vy - 0.35 * player.vy, vz) <= maxSpeed) {
      return { vx, vy, vz, target: null };
    }
  }
  return null;
}

export function launchBall(state: MatchState, player: Player, action: Action): Launch | null {
  const hand = action.hand ?? player.dominantHand;
  const dominant = hand === player.dominantHand;
  const stability = clamp(
    1 - 0.13 * Math.abs(player.yawRate) - 0.04 * Math.hypot(player.vx, player.vy),
    0.58,
    1,
  );
  const maxSpeed = (dominant ? 11 : 9) * stability;
  if (action.ball >= FIRST_PASS && action.ball < FREE_THROW) {
    const receiver = teammates(state, player)[action.ball - FIRST_PASS];
    const target = action.passTo ?? player.seenPlayers[receiver?.id];
    if (!target || !receiver) return null;
    const range = Math.hypot(target.x - player.x, target.y - player.y);
    if (range > maxSpeed * 0.95) return null;
    const time = clamp(range / (maxSpeed * 0.92), 0.28, 0.95);
    const dx = target.x - player.x + target.vx * time * 0.65;
    const dy = target.y - player.y + target.vy * time * 0.65;
    const speed = Math.min(maxSpeed, Math.hypot(dx, dy) / time);
    const aim = Math.atan2(dy, dx);
    return {
      vx: Math.cos(aim) * speed,
      vy: Math.sin(aim) * speed,
      vz: (9.81 * time) / 2,
      target: receiver.id,
    };
  }

  if (action.ball === FREE_THROW && action.goalAssist && state.ball.restrictedThrower === null) {
    const assisted = assistedGoalLaunch(state, player, maxSpeed);
    if (assisted) return assisted;
  }

  // Manual throws and out-of-range assisted attempts use the original hull-relative release.
  const offset = clamp(action.aim ?? 0, -1.3, 1.3);
  const aim = player.heading + offset + player.yawRate * 0.07 + (dominant ? 0 : hand * 0.065);
  const power = clamp(action.power ?? 0.75, 0, 1);
  const loft = clamp(action.loft ?? 0.5, 0.12, 1.05);
  const speed = maxSpeed * power;
  return {
    vx: Math.cos(aim) * speed * Math.cos(loft) + player.vx * 0.35,
    vy: Math.sin(aim) * speed * Math.cos(loft) + player.vy * 0.35,
    vz: Math.sin(loft) * speed,
    target: null,
  };
}
