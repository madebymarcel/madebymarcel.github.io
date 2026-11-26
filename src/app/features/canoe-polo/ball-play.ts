import { PITCH, attackDirection, clamp, type Action, type MatchState, type Player } from './model';

export const HOLD = 0;
export const COLLECT = 1;
export const FIRST_PASS = 2;
export const FIRST_SHOT = 6;
export const FREE_THROW = 11;
export const BALL_ACTIONS = 12;

export function teammates(state: MatchState, player: Player): Player[] {
  return state.players.filter((p) => p.team === player.team && p.id !== player.id);
}

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  target: number | null;
}

export function launchBall(state: MatchState, player: Player, action: Action): Launch {
  const direction = attackDirection(player.team, state.half);
  if (action.ball >= FIRST_PASS && action.ball < FIRST_SHOT) {
    const target = teammates(state, player)[action.ball - FIRST_PASS];
    const time = clamp(Math.hypot(target.x - player.x, target.y - player.y) / 9, 0.28, 0.9);
    const dx = target.x - player.x + target.vx * time * 0.65;
    const dy = target.y - player.y + target.vy * time * 0.65;
    const speed = Math.min(11, Math.hypot(dx, dy) / time);
    const aim = Math.atan2(dy, dx);
    return {
      vx: Math.cos(aim) * speed,
      vy: Math.sin(aim) * speed,
      vz: (9.81 * time) / 2,
      target: target.id,
    };
  }

  if (action.ball >= FIRST_SHOT && action.ball < FREE_THROW) {
    const dx = (direction === 1 ? PITCH.length : 0) - player.x + direction * 0.12;
    const dy = PITCH.width / 2 + (action.ball - FIRST_SHOT - 2) * 0.22 - player.y;
    const aim = Math.atan2(dy, dx);
    const time = Math.max(0.25, Math.hypot(dx, dy) / 11);
    // Shots remain limited by throw strength and by the actual goal-crossing check.
    const lift = clamp(1.4 / time + (9.81 * time) / 2 - 0.49, 0, 6.8);
    return { vx: Math.cos(aim) * 11, vy: Math.sin(aim) * 11, vz: lift, target: null };
  }

  const aim = action.aim !== undefined && Number.isFinite(action.aim) ? action.aim : player.heading;
  const power = action.power !== undefined && Number.isFinite(action.power) ? action.power : 0.7;
  const speed = clamp(power, 0, 1) * 11;
  return { vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed, vz: 4, target: null };
}
