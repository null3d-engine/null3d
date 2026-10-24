# The develop skill's evaluation

The plan asks for an evaluation of each skill. Its cases run with and without the skill, and the
run records the expectation pass rate, the time and the tokens. A set of trigger queries tests
whether the skill's description finds the requests that it should. This page records the run of
25 October 2026 for `skills/null3d-develop`, after it gained the feature-intake section and the
"search before you hand-roll" table.

Result: with the skill, 55 of 60 graded expectations passed. Without it, 51 of 60 passed. The
trigger queries selected the right skill for 20 of 20. The skill's advantage is small, and four of
the ten cases scored the same either way.

## What ran

| Item | Value |
| --- | --- |
| Skill | `skills/null3d-develop/SKILL.md`, SHA-256 `668505f56da6a33766dde59fbf76701fe373a15b6896ce3ce720f85b1c67727e`, 256 lines |
| Cases | `skills/null3d-develop/evals/evals.json`, 10 cases and 60 expectations |
| Trigger queries | `skills/null3d-develop/evals/trigger-queries.json`, 20 queries |
| Date | 25 October 2026, on the milestone branch |
| Model | the account's default model through the Claude Code command line (deepseek-flash, one million tokens of context) |
| Tools the runs held | read, file search and directory listing; no file writes, so every answer is the run's final message |

## Method

Two conditions for every case, one run each:

- **With the skill.** The run reads `skills/null3d-develop/SKILL.md` first and follows it and the
  files that it points to. Every one of the ten runs read the skill file.
- **Without it.** The run is told that the skill is not installed, and it may read nothing under
  `skills/` or `.claude/skills/`. It keeps the engine's docs under `docs/`, which a project that
  installs the engine has. No baseline run read a file under `skills/`; the transcripts show it.

The repository is the project in both conditions, so both runs see the engine's source and docs.

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
| 1 | 8 | 7 | 7 | 357 s, 39 turns | 116,019 in, 1,938,944 cached, 22,620 out | 250 s, 37 turns | 107,207 in, 1,633,536 cached, 42,878 out |
| 2 | 7 | 7 | 6 | 129 s, 21 turns | 91,604 in, 1,218,048 cached, 19,570 out | 102 s, 15 turns | 64,278 in, 464,384 cached, 15,845 out |
| 3 | 7 | 6 | 6 | 229 s, 41 turns | 94,130 in, 1,938,048 cached, 35,608 out | 130 s, 28 turns | 75,987 in, 815,872 cached, 21,438 out |
| 4 | 6 | 4 | 5 | 125 s, 35 turns | 80,918 in, 1,471,232 cached, 16,693 out | 241 s, 31 turns | 73,586 in, 1,342,208 cached, 18,050 out |
| 5 | 6 | 5 | 4 | 212 s, 32 turns | 63,239 in, 838,784 cached, 15,071 out | 99 s, 27 turns | 76,115 in, 406,528 cached, 13,951 out |
| 6 | 4 | 4 | 4 | 163 s, 20 turns | 82,802 in, 1,164,160 cached, 24,601 out | 167 s, 32 turns | 99,896 in, 1,609,984 cached, 23,566 out |
| 7 | 4 | 4 | 4 | 108 s, 30 turns | 74,734 in, 1,126,528 cached, 14,483 out | 116 s, 19 turns | 71,980 in, 726,528 cached, 17,754 out |
| 8 | 6 | 6 | 6 | 6 s, 2 turns [^1] | 61,656 in, 1,132,160 cached, 13,596 out | 55 s, 15 turns | 47,159 in, 357,248 cached, 7,432 out |
| 9 | 6 | 6 | 4 | 7 s, 2 turns [^1] | 47,642 in, 479,744 cached, 9,477 out | 7 s, 2 turns [^1] | 47,952 in, 497,280 cached, 9,245 out |
| 10 | 6 | 6 | 5 | 174 s, 26 turns | 67,849 in, 845,696 cached, 25,229 out | 233 s, 42 turns | 83,789 in, 1,937,024 cached, 34,734 out |
| **All** | **60** | **55** | **51** | | | | |

[^1]: Two runs ended with a background step, which the command line reports apart from the main
    turn. Its time and turn count cover the last step only; the run took minutes in wall time. Each
    answer is the full text from its transcript.

The trigger queries: 20 of 20 selected the right skill. The ten develop queries all chose
`null3d-develop`, the two port queries chose `null3d-port-threejs`, and the eight queries for other
tools and engines chose none.

## What the misses show

- **Case 4, selecting a unit, the skill's one loss.** Neither answer limits the pick to a layer
  mask. The skill's answer also uses an object's click handler without showing `scene.raycast`,
  where the baseline shows both paths. The skill's intake table sends ray picking to the engine
  page; that page does not say that a mask keeps the pick off scenery. The skill can close this.
- **Case 1, the shadow catcher, both conditions.** Both answers light the floor and cast the light's
  shadow. The skill's answer only suggests `materials.shadowCatcher` as an option, with no color,
  and the baseline builds no catcher floor.
- **Case 3, the water's bounds, the skill.** The skill's answer does not widen the mesh's bounds, so
  a crest that moves past the original sphere could be culled. The baseline misses a different
  expectation: it does not suggest checking the WebGL2 path.
- **Case 5, Safari's COEP mode, both conditions.** Neither answer says that Safari does not support
  COEP `credentialless`.
- **Case 2, the Android GPU path.** The baseline suggests the WebGL2 switch but does not say that
  many Android phones run that path. The skill's answer gives both.
- **Case 10, the second GPU path.** The baseline does not suggest checking the WebGL2 path at all;
  the skill's answer does.

## Limits of this run

- This is one run per case and condition. A model's answers vary between runs, so a one-point
  difference is not a trend. The plan's 90% gate for skill evaluations is a proposal for release
  0.3, and this run does not reach it.
- The time and token figures come from the command line's own report. The cache figures cover the
  context that the harness re-reads on each turn, so they are not a price.
- The judge is one model call per case, so a judgement is not cross-checked. Every answer and every
  verdict is kept out of git, in the helper's report folder, for a person who wants to re-check one.
- The baseline keeps the engine's docs. The comparison therefore measures what the skill adds on
  top of the docs, not against a model with no material about null3D.
