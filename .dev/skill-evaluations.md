# The develop skill's evaluation

The plan asks for an evaluation of each skill. Its cases run with and without the skill, and the
run records the expectation pass rate, the time and the tokens. A set of trigger queries tests
whether the skill's description finds the requests that it should. This page records the run of
26 October 2026 for `skills/null3d-develop`, on the final form of its feature-intake section and
its "search before you hand-roll" table.

Result: with the skill, 55 of 60 graded expectations passed, 92%. Without it, 49 of 60 passed,
82%. The trigger queries selected the right skill for 20 of 20. The skill therefore meets the
90% expectation and trigger gates that section 12.6 proposes for release 0.3.

## What ran

| Item | Value |
| --- | --- |
| Skill | `skills/null3d-develop/SKILL.md`, SHA-256 `8a46af24c8205da19ccc0248b0c7e0746c71f617cf2f7c0f809f19acf28f663e`, 260 lines |
| Cases | `skills/null3d-develop/evals/evals.json`, 10 cases and 60 expectations |
| Trigger queries | `skills/null3d-develop/evals/trigger-queries.json`, 20 queries |
| Date | 26 October 2026, on the milestone branch |
| Model | deepseek-flash[1m] through the Claude Code command line |
| Tools | read, file search and directory listing; no file writes, so every answer is the run's final message |

## Method

Two conditions for every case, one run each:

- **With the skill.** The run reads `skills/null3d-develop/SKILL.md` first and follows it and the
  files that it points to. Every one of the ten runs read the skill file, and each read 1 to 10
  more files under `skills/`.
- **Without it.** The run is told that the skill is not installed, and that it may read nothing
  under `skills/` or `.claude/skills/`. It keeps the engine's docs under `docs/`. No baseline run
  read a file under either folder; the session transcripts show it.

The repository is the project in both conditions, so both runs see the engine's source and docs.
Case 2's input file was copied outside `skills/` for both conditions, so the baseline could read it
without breaking the rule above.

Grading is blind per case. A separate model call receives the case's request, its expectations and
both answers as A and B. The order swaps by case, and the judge is told to ignore any sentence about
which sources the author used. It answers "pass" or "not pass" for each expectation, with a short
reason. This page maps each side back through the recorded order.

The trigger test gives a model the two skills' names and descriptions, and the 20 queries, and asks
which skill applies to each. Two queries ask for a three.js port, and the port skill is the right
answer for them; the other eight are for no skill.

## Results

Each row gives the expectations met, then the run's own figures: the command line's wall time and
turn count, and the tokens it reported. "In" counts the fresh input of each request; "cached"
counts the context that the harness read from its cache.

| Case | Expectations | With the skill | Without it | With: run | With: tokens | Without: run | Without: tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 7 | 8 | 18 turns, 111 s | 143,925 in, 917,888 cached, 16,921 out | 35 turns, 189 s | 110,239 in, 1,500,928 cached, 31,985 out |
| 2 | 7 | 7 | 6 | 23 turns, 123 s | 75,471 in, 772,992 cached, 18,261 out | 29 turns, 118 s | 65,535 in, 866,816 cached, 18,335 out |
| 3 | 7 | 7 | 6 | 35 turns, 199 s | 88,993 in, 1,652,096 cached, 32,026 out | 26 turns, 144 s | 77,426 in, 753,280 cached, 24,752 out |
| 4 | 6 | 5 | 3 | 37 turns, 96 s | 66,305 in, 1,254,528 cached, 13,404 out | 33 turns, 101 s | 98,298 in, 1,526,656 cached, 15,098 out |
| 5 | 6 | 4 | 3 | 30 turns, 85 s | 90,064 in, 1,079,040 cached, 11,982 out | 19 turns, 65 s | 57,721 in, 541,056 cached, 8,230 out |
| 6 | 4 | 4 | 3 | 27 turns, 130 s | 79,084 in, 979,712 cached, 20,191 out | 32 turns, 77 s | 62,595 in, 1,031,808 cached, 9,247 out |
| 7 | 4 | 4 | 4 | 30 turns, 118 s | 63,223 in, 1,116,544 cached, 18,065 out | 18 turns, 66 s | 51,576 in, 430,720 cached, 9,917 out |
| 8 | 6 | 6 | 6 | 23 turns, 62 s | 74,410 in, 806,912 cached, 8,461 out | 12 turns, 35 s | 70,602 in, 244,992 cached, 4,195 out |
| 9 | 6 | 5 | 5 | 27 turns, 90 s | 43,467 in, 865,792 cached, 13,028 out | 17 turns, 55 s | 40,968 in, 360,320 cached, 7,428 out |
| 10 | 6 | 6 | 5 | 19 turns, 105 s | 90,877 in, 764,928 cached, 14,226 out | 31 turns, 174 s | 60,618 in, 816,896 cached, 25,836 out |
| **All** | **60** | **55** | **49** | | | | |

The trigger queries: 20 of 20 selected the right skill. The ten develop queries all chose
`null3d-develop`, the two port queries chose `null3d-port-threejs`, and the eight queries for other
tools and engines chose none.

## What the misses show

- **Cases 2 and 10, the baseline.** Neither answer suggests checking the WebGL2 path, and the
  skill's answers do.
- **Case 4, the pick mask, both conditions.** Neither answer limits picking to a layer mask. The
  skill gives the mask only as an aside on the raycast path. The baseline offers `scene.pick`
  instead of `scene.raycast`, and sends health on every call.
- **Case 5, Safari's COEP mode, both conditions.** Neither answer says that Safari does not support
  COEP `credentialless`. Neither points to `getting-started/hosting`; both name error and debugging
  pages instead.
- **Case 1, the skill's one loss.** The answer names `bunx @null3d/cli assets optimize` without the
  (0.2) marker that the case asks for. The baseline marks it.
- **Case 6, the baseline.** It weighs the tap count of a wide blur, but gives no phone cost.
- **Case 9, the skill.** It names the physics add-on as planned for 0.3. It does not call its
  sketch-worker physics a temporary workaround. The baseline leaves out the library's own per-call
  allocations.

## Limits of this run

- This is one run per case and condition. A model's answers vary between runs, so a one-point
  difference is not a trend.
- The time and token figures come from the command line's own report. The cache figures cover the
  context that the harness re-reads on each turn, so they are not a price.
- The judge is one model call per case, so a judgement is not cross-checked. Every answer and every
  verdict is kept out of git, in the helper's report folder, for a person who wants to re-check one.
- The baseline keeps the engine's docs. The comparison therefore measures what the skill adds on
  top of the docs, not against a model with no material about null3D.
- Case 3 changed before the run above. Its old request asked for a water surface, which
  `@null3d/water` now answers. A baseline answer that chose the add-on therefore lost five
  expectations, and the case rewarded a hand-rolled surface that the new table warns against. The
  request now asks for a liquid-mercury surface, which the add-on does not cover. The first pass
  gave 7 of 7 with the skill and 2 of 7 without it. The second gave 7 of 7 and 6 of 7. The result
  above uses the second run.
