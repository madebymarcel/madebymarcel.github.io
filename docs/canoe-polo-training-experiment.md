# Canoe Polo shooting experiment

Run from the repository root with the project's Node 24 version:

```sh
npm run --silent experiment:canoe-polo -- 24000 > canoe-polo-results.jsonl
```

Each output line is JSON. The argument is the learning tick budget per trained policy and
initialization seed (24,000 by default). This uses the real policy actions, ball flight, and
referee. It doesn't write weights or change the deployed simulator.

## What it compares

- Three fixed, initially random policies, with the same initialization for all arms of a seed.
- Untrained; current full-match learning; full-match learning with only goal and out-of-bounds
  feedback; short possession-to-shot practice with that same feedback; practice that widens the
  start distribution after half its tick budget.
- Short attempts begin with the ball in hand. The learner chooses when and how to throw.
  The attempt ends on a ruling, a landed throw, or an eight-second cap. There is no action advice
  from the enumerator, and no scripted shot, auto-aim, or changed physics.
- Count active simulation ticks, including shot flight. The match learner acts for five players,
  not one, so this is an equal tick budget, not an equal decision budget. Full-match learning uses
  its existing batch value estimates, while short attempts can use their terminal outcome
  directly. Thus this tests a training setup, not episode duration in isolation.
- Evaluate without updates: 64 new close-range poses (2–4 m) and 64 harder poses (4–8 m with wider
  angles and some coasting) per policy, plus four full matches against that seed's frozen starting
  policy on two new match seeds with sides swapped. The same evaluation starts are reused for
  comparisons; 192 attempts means 64 poses across three trained policies, not 192 unique poses.

## First run

| Training arm                             | Close-range goals / 192 | Harder goals / 192 | Full-match goals / 12 games |
| ---------------------------------------- | ----------------------: | -----------------: | --------------------------: |
| Untrained                                |                       7 |                  3 |                           0 |
| Full matches, current rewards            |                       7 |                  3 |                           0 |
| Full matches, only goal and out feedback |                       7 |                  3 |                           0 |
| Short shooting practice                  |                     154 |                  8 |                           0 |
| Widened shooting practice                |                     159 |                  7 |                           0 |

In a centered, stationary pose facing goal, the 440 available throw combinations include 49
scoring throws at 2 m, 21 at 4 m, 8 at 6 m, and 1 at 8 m. Neither sampled 12 m pose has a
scoring release. At the initial pose, an immediately scoring throw exists in all 64 close-range
test starts and 50 of 64 harder starts. This is not a bound on what a player might achieve after
coasting. Increasing the score reward cannot create a physically unreachable action.

The close-range skill is learnable; it does not yet transfer to games. The first widened mix
does not improve the harder set, so don't promote either practice policy as an upgrade. Next,
set up short episodes that begin before possession: reach or receive a ball, get into position,
and shoot. Record collections, time in possession, arrivals in a viable shooting pose, shot
attempts, and goals separately. Keep sides-swapped matches against fixed policies as the
transfer check. Evaluate an expanded shot action space or a physically plausible way to turn
with the ball as separate experiments, not simultaneous changes.
