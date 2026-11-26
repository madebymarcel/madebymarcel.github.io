import { DT, distance, clamp, type Ball, type MatchState, type Player, type Point } from './model';

const MAX_HEAD_TURN = 1.25;
const HALF_FOV = 1.18;
const VISION_RANGE = 24;
const MEMORY_TICKS = 10;

export function turnHead(player: Player, look: number): void {
  const target = clamp(look, -1, 1) * MAX_HEAD_TURN;
  player.headTurn += clamp(target - player.headTurn, -3.5 * DT, 3.5 * DT);
}

function sightCone(player: Player): (target: Point) => boolean {
  const direction = player.heading + player.headTurn;
  const cos = Math.cos(direction);
  const sin = Math.sin(direction);
  const limit = Math.cos(HALF_FOV);
  return (target: Point) => {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const range = Math.hypot(dx, dy);
    return range <= VISION_RANGE && dx * cos + dy * sin >= range * limit;
  };
}

export function canSee(player: Player, target: Point): boolean {
  return sightCone(player)(target);
}

export function remember(state: MatchState, viewer: Player): void {
  const visible = sightCone(viewer);
  const tick = state.ticks;
  const ball = state.ball;
  if (ball.owner === viewer.id || visible(ball)) {
    viewer.seenBall = {
      x: ball.x,
      y: ball.y,
      z: ball.z,
      vx: ball.vx,
      vy: ball.vy,
      tick,
      owner: ball.owner,
    };
  } else if (viewer.seenBall && tick - viewer.seenBall.tick > MEMORY_TICKS) viewer.seenBall = null;
  for (const player of state.players) {
    if (player.id === viewer.id) continue;
    if (visible(player)) {
      viewer.seenPlayers[player.id] = {
        x: player.x,
        y: player.y,
        z: 0,
        vx: player.vx,
        vy: player.vy,
        tick,
        owner: null,
      };
    } else if (
      viewer.seenPlayers[player.id] &&
      tick - viewer.seenPlayers[player.id]!.tick > MEMORY_TICKS
    ) {
      viewer.seenPlayers[player.id] = null;
    }
  }
}

export function reachableBall(player: Player, ball: Ball): boolean {
  if (player.strokeTicks > 0 || ball.z > 2.85) return false;
  const bearing = Math.atan2(ball.y - player.y, ball.x - player.x) - player.heading;
  const side = Math.sin(bearing) >= 0 ? 1 : -1;
  const reach = side === player.dominantHand ? 1.3 : 1.1;
  return distance(player, ball) <= reach && Math.cos(bearing) >= -0.6;
}
