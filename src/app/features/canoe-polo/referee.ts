import {
  BALL_RADIUS,
  HALF_TICKS,
  PITCH,
  POSSESSION_TICKS,
  SHOT_TICKS,
  attackDirection,
  clamp,
  other,
  type Ball,
  type Decision,
  type MatchState,
  type Restart,
  type Team,
} from './model';

export interface Ruling {
  decision: Decision;
  restart?: Omit<Restart, 'ticks'>;
  goal?: Team;
}

function teamDefending(state: MatchState, right: boolean): Team {
  return attackDirection(0, state.half) === (right ? 1 : -1) ? 1 : 0;
}

export function assessPlay(state: MatchState, previous: Ball): Ruling | null {
  const ball = state.ball;
  const owner = ball.owner === null ? null : state.players[ball.owner];
  const touched = ball.lastTouch === null ? null : state.players[ball.lastTouch];
  const tick = state.ticks;

  if (owner && state.possessionTicks > POSSESSION_TICKS) {
    return {
      decision: {
        tick,
        kind: 'foul',
        message: 'Individual possession exceeded five seconds.',
        rule: 'Illegal possession',
        player: owner.id,
        team: owner.team,
      },
      restart: { x: ball.x, y: ball.y, team: other(owner.team), kind: 'free-shot' },
    };
  }

  const right = ball.x > PITCH.length + BALL_RADIUS;
  const left = ball.x < -BALL_RADIUS;
  if (right || left) {
    const plane = right ? PITCH.length + BALL_RADIUS : -BALL_RADIUS;
    const fraction = clamp((plane - previous.x) / (ball.x - previous.x || 1), 0, 1);
    const y = previous.y + (ball.y - previous.y) * fraction;
    const z = previous.z + (ball.z - previous.z) * fraction;
    const defending = teamDefending(state, right);
    const attacking = other(defending);
    const inGoal =
      Math.abs(y - PITCH.width / 2) <= PITCH.goalWidth / 2 - BALL_RADIUS &&
      z >= PITCH.goalBottom + BALL_RADIUS &&
      z <= PITCH.goalTop - BALL_RADIUS;

    if (inGoal && ball.owner === null && ball.restrictedThrower === null) {
      return {
        decision: { tick, kind: 'goal', message: 'Goal!', rule: 'Scoring a goal', team: attacking },
        goal: attacking,
        restart: { x: PITCH.length / 2, y: PITCH.width / 2, team: defending, kind: 'centre' },
      };
    }

    const corner = touched?.team === defending && !inGoal;
    return {
      decision: {
        tick,
        kind: 'out',
        message: inGoal
          ? 'Direct goal from restricted restart disallowed.'
          : 'Ball over goal line.',
        rule: 'Goal-line restart',
        team: corner ? attacking : defending,
      },
      restart: {
        x: right ? PITCH.length - 0.8 : 0.8,
        y: clamp(y, 0.8, PITCH.width - 0.8),
        team: corner ? attacking : defending,
        kind: corner ? 'corner' : 'goal-line',
      },
    };
  }

  if (ball.y < -BALL_RADIUS || ball.y > PITCH.width + BALL_RADIUS) {
    const team = touched ? other(touched.team) : 0;
    return {
      decision: { tick, kind: 'out', message: 'Ball over sideline.', rule: 'Throw-in', team },
      restart: {
        x: clamp(ball.x, 0.8, PITCH.length - 0.8),
        y: clamp(ball.y, 0.8, PITCH.width - 0.8),
        team,
        kind: 'free-throw',
      },
    };
  }

  if (state.possessionTeam !== null && state.shotTicks >= SHOT_TICKS) {
    const team = state.possessionTeam;
    return {
      decision: {
        tick,
        kind: 'foul',
        message: 'Team shot clock expired.',
        rule: '17.1.2',
        team,
      },
      restart: { x: ball.x, y: ball.y, team: other(team), kind: 'free-shot' },
    };
  }

  return null;
}

export function halfExpired(state: MatchState): boolean {
  return state.ticks >= state.half * HALF_TICKS;
}
