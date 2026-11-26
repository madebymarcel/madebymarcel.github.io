import { DT, PITCH, clamp, type Player } from './model';

export const STROKE_TICKS = 5;

// Local blade contact and force relative to the hull: +x forward, +y starboard.
// Integrating force at the blade gives both translation and yaw, not a heading command.
const strokes = [
  null,
  { fore: 0.7, side: -0.52, forward: 3.8, lateral: 0 },
  { fore: 0.7, side: 0.52, forward: 3.8, lateral: 0 },
  { fore: 0.45, side: -0.85, forward: 1.05, lateral: 1 },
  { fore: 0.45, side: 0.85, forward: 1.05, lateral: -1 },
  { fore: -0.55, side: -0.8, forward: -1.4, lateral: 0.75 },
  { fore: -0.55, side: 0.8, forward: -1.4, lateral: -0.75 },
] as const;

export const PADDLE_ACTIONS = strokes.length;

function strokePhase(ticks: number): number {
  return (STROKE_TICKS - ticks + 0.5) / STROKE_TICKS;
}

export function paddlePose(player: Player): string {
  const stroke = strokes[player.stroke];
  if (!stroke || player.strokeTicks === 0) return 'M0 -0.85V0.85';
  const phase = strokePhase(player.strokeTicks);
  const reach = stroke.fore - phase * Math.sign(stroke.forward) * 0.65;
  const side = 0.75 * Math.sign(stroke.side) + stroke.side * 0.25;
  return `M${-reach * 0.7} ${-side * 0.9} L${reach} ${side}`;
}

export function stepPaddle(player: Player, choice: number): void {
  if (player.strokeTicks === 0) {
    player.stroke = strokes[choice] ? choice : 0;
    player.strokeTicks = player.stroke ? STROKE_TICKS : 0;
  }
  const stroke = strokes[player.stroke];
  const cos = Math.cos(player.heading);
  const sin = Math.sin(player.heading);
  let forward = (cos * player.vx + sin * player.vy) * 0.94;
  let lateral = (cos * player.vy - sin * player.vx) * 0.79;
  player.yawRate *= 0.77;
  if (stroke && player.strokeTicks > 0) {
    const phase = strokePhase(player.strokeTicks);
    const load = Math.sin(Math.PI * phase);
    const fore = stroke.fore - phase * Math.sign(stroke.forward) * 0.65;
    forward += stroke.forward * load * DT;
    lateral += stroke.lateral * load * DT;
    player.yawRate += (fore * stroke.lateral - stroke.side * stroke.forward) * 3.5 * load * DT;
    player.strokeTicks--;
  }
  player.heading = (player.heading + player.yawRate * DT) % (2 * Math.PI);
  const speed = Math.hypot(forward, lateral);
  if (speed > 3.5) {
    forward *= 3.5 / speed;
    lateral *= 3.5 / speed;
  }
  player.vx = cos * forward - sin * lateral;
  player.vy = sin * forward + cos * lateral;
  player.x = clamp(player.x + player.vx * DT, 0.65, PITCH.length - 0.65);
  player.y = clamp(player.y + player.vy * DT, 0.65, PITCH.width - 0.65);
}
