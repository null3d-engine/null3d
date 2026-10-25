# The develop skill's evaluation

The plan asks for an evaluation of each skill. Its cases run with and without the skill, and the
run records the expectation pass rate, the time and the tokens. A set of trigger queries tests
whether the skill's description finds the requests that it should. This page records the run of
26 October 2026 for `skills/null3d-develop`, on the final form of its feature-intake section and
its "search before you hand-roll" table.

Result: with the skill, 55 of 60 graded expectations passed, 92%. Without it, 44 of 60 passed,
73%. The trigger queries selected the right skill for 20 of 20. The skill therefore meets the
90% expectation and trigger gates that section 12.6 proposes for release 0.3.

## What ran

| Item | Value |
| --- | --- |
| Skill | `skills/null3d-develop/SKILL.md`, SHA-256 `f5f7f480bf56026120e9112ffe3ecd51d3b01a41cf0c7e50b468d6f70871a76b`, 260 lines |
| Cases | 10 cases and 60 expectations, from `evals.json` in the source tree |
| Trigger queries | 20 queries, from `trigger-queries.json` in the source tree |
| Date | 26 October 2026, on the milestone branch after the merge with main's line |
| Model | deepseek-flash[1m] through the Claude Code command line |
| Tools | read, file search and directory listing; no file writes, so every answer is the run's final message |
| Environment | a copy of the repository at the merge commit, with both skills' `evals/` folders and this page removed, and no `.internal` folder |

## Method

Two conditions for every case, one run each:

- **With the skill.** The run reads `skills/null3d-develop/SKILL.md` first and follows it and the
  files that it points to. Every one of the ten runs read the skill file.
- **Without it.** The run is told that the skill is not installed, and that it may read nothing
  under `skills/` or `.claude/skills/`. It keeps the engine's docs under `docs/`. No baseline run
  read a file under either folder.

The repository is the project in both conditions, so both runs see the engine's source and docs.
Case 2's input file was copied to a folder outside the repository that holds only that file.

Neither condition may read evaluation material. The copy the runs used holds no case file and no
evaluation report, and both prompts forbid every evaluation folder and the maintainers' private
folder. Every session's tool calls and tool results were searched for those paths and for the
wording of the expectations. None matched.

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
| 1 | 8 | 7 | 5 | 14 turns, 162 s | 131,671 in, 478,080 cached, 26,547 out | 38 turns, 232 s | 140,915 in, 2,705,280 cached, 37,964 out |
| 2 | 7 | 7 | 5 | 26 turns, 109 s | 66,531 in, 914,176 cached, 16,596 out | 30 turns, 129 s | 68,229 in, 1,166,848 cached, 20,267 out |
| 3 | 7 | 7 | 6 | 22 turns, 116 s | 88,189 in, 1,017,728 cached, 17,981 out | 25 turns, 150 s | 87,950 in, 809,216 cached, 24,957 out |
| 4 | 6 | 6 | 4 | 25 turns, 99 s | 92,391 in, 1,081,344 cached, 15,400 out | 42 turns, 143 s | 57,043 in, 1,057,024 cached, 24,031 out |
| 5 | 6 | 4 | 1 | 15 turns, 53 s | 58,924 in, 343,552 cached, 6,713 out | 54 turns, 155 s | 104,608 in, 2,309,120 cached, 19,918 out |
| 6 | 4 | 4 | 4 | 37 turns, 183 s | 88,939 in, 1,869,056 cached, 29,785 out | 52 turns, 161 s | 89,534 in, 2,270,080 cached, 23,023 out |
| 7 | 4 | 4 | 4 | 17 turns, 64 s | 58,717 in, 498,816 cached, 8,625 out | 15 turns, 49 s | 41,633 in, 312,064 cached, 6,428 out |
| 8 | 6 | 6 | 6 | 19 turns, 52 s | 45,376 in, 385,280 cached, 7,091 out | 14 turns, 36 s | 36,363 in, 208,384 cached, 3,838 out |
| 9 | 6 | 5 | 4 | 10 turns, 36 s | 37,343 in, 150,144 cached, 4,760 out | 13 turns, 40 s | 32,309 in, 165,376 cached, 5,630 out |
| 10 | 6 | 5 | 5 | 26 turns, 120 s | 61,961 in, 812,288 cached, 17,099 out | 16 turns, 84 s | 45,475 in, 351,360 cached, 12,318 out |
| **All** | **60** | **55** | **44** | | | | |

The trigger queries: 20 of 20 selected the right skill. The ten develop queries all chose
`null3d-develop`, the two port queries chose `null3d-port-threejs`, and the eight queries for other
tools and engines chose none.

## What the misses show

- **Case 5, the hosting headers.** The baseline meets one of six. It diagnoses a sub-path base,
  missing build files, the sketch's discovery and a content policy, but not cross-origin isolation.
  The skill names the two headers, but not Safari's missing `credentialless` support or the hosting
  page.
- **Case 1, both conditions.** Both name `bunx @null3d/cli assets optimize` without the (0.2)
  marker that the case asks for. The baseline also clamps the orbit camera above half pi and builds
  no shadow-only floor.
- **Case 2, the baseline.** It gives no before-and-after measurement and never names the Android
  WebGL2 path.
- **Case 4, the baseline.** It sets no layer mask on picking and does not present `scene.raycast`.
- **Case 9, both conditions.** Neither calls the raw-physics approach temporary until the add-on
  ships. The baseline also leaves out the library's own per-call objects.
- **Cases 3 and 10, both conditions.** Neither answer suggests checking the WebGL2 path.

## Limits of this run

- This is one run per case and condition. A model's answers vary between runs, so a one-point
  difference is not a trend.
- Two skill runs ended without a usable answer: case 1 gave a refusal with no code, and case 10
  returned `{"ok": true}`. Both ran again with the same prompt, and the table uses the second
  answers.
- The time and token figures come from the command line's own report. The cache figures cover the
  context that the harness re-reads on each turn, so they are not a price.
- The judge is one model call per case, so a judgement is not cross-checked. Each answer and verdict
  behind the table is kept out of git, in the helper's report folder, for a person who wants to
  re-check one.
- The baseline keeps the engine's docs. The comparison therefore measures what the skill adds on
  top of the docs, not against a model with no material about null3D.
- Case 3's request changed before this run. The old request asked for a water surface, which
  `@null3d/water` now answers. A baseline answer that chose the add-on lost five expectations, and
  the case rewarded a hand-rolled surface that the new table warns against. The request now asks
  for a liquid-mercury surface, which the add-on does not cover.
- An earlier run on the same day was thrown away. Its agents could read the case file under
  `skills/null3d-develop/evals/`, which holds the expectations, and one listed the helper's report
  folder. No figure above comes from it.
