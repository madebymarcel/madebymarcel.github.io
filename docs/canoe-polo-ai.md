# Canoe polo AI: first playable prototype

Route: /projects/canoe-polo/

## Architecture

- Model: fixed-step state, 35 × 23 m pitch, 10 boats and an airborne ball.
- Simulation: shared by spectator matches and worker-based learning. Seeded randomness enables
  reproducibility with the same policies and action stream.
  A deliberate pickup can interrupt a stroke to recover a loose ball within 1.7 m of the seat
  in any direction. Paddle reach applies on the water only; airborne catches still use hand reach.
- Referee: independent deterministic evaluation of match events. The simulation executes rulings.
- Policy: 56 numerical inputs per player, two categorical action heads (paddle strokes and
  hold/catch/throw) and a scalar value head. The linear actor-critic has 2352 weights.
- Learning: discounted returns, policy gradient and value updates in batches; the other team is
  a frozen parent. Reward shaping encourages approach, possession, progress toward the goal,
  scoring, winning and avoiding fouls. It is not PPO and convergence is not established.
- A generation is one training match followed by one independent evaluation against its parent.
  Evaluation scores are descriptive, not a qualification gate or reliable skill rating.
- Generations: immutable versioned JSON envelopes with weights and lineage; IndexedDB persistence.
  Branches have unique IDs. No server or shared training population. Download individual
  generations as JSON. File import accepts v3 snapshots and existing v3 collection backups
  up to 64 MB. Start from scratch clears the current simulator's saved generations from this
  browser after confirmation. Downloaded JSON files are unaffected.
- UI: match, generations, rules, and opt-in background training. The worker terminates when
  leaving the experiment. Only completed generations persist across reloads.
- Team generation selectors change the policy used from the next simulation tick without
  resetting the match. Leave both selections unchanged for a full-match comparison.
- In a spectator match, enable Show player vision to see all ten current fields of view and
  which cones contain the ball. This shows current geometry, not each player's memory.
  Player controls can replace one policy with manual paddle, look, pickup and throw commands.
  Manual controls use the same match physics and do not affect background training.

## Rule coverage

Reference: [ICF rulebooks](https://www.canoeicf.com/rules). The ruleset identifier explicitly
denotes an approximation. The implemented subset covers team size, two halves, side changes,
goal height, boundaries, possession limits, a 60-second shot clock and simplified restarts.
The prototype has one visual referee and textual decisions. Its gesture is not an official
hand signal.

Before claiming ICF compliance, implement and test all applicable rules, including restart
spacing and timing, shot-clock resets, keeper protection, hand/kayak/paddle tackles, obstruction,
advantage, penalties, cards, player exclusion, re-entry, substitutions and official signals.
These require better contact geometry, body/paddle reach, balance and capsizing physics.
No blocked action should silently substitute for a referee decision where the real sport allows
an illegal physical act to occur.

## Validation goals

The first PR establishes the pipeline, not competitive playing quality. Verify worker performance,
reproducibility, import validation, persistence and mobile responsiveness. Compare generations
across many independent matches and both sides of the pitch before concluding that learning
improves performance. Generation 0 is intentionally weak; early matches may be scoreless.

The developer-only drills in `skills-drills.ts` run seeded collection, shooting, and save
scenarios without modifying policies. The unit suite exercises their reproducibility.

The [shooting experiment](canoe-polo-training-experiment.md) compares full matches with short
practice attempts under the same tick budget, then tests both on unseen starts and full matches.
