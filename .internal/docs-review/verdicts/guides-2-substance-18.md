# guides-2-substance-18

## Finding as given

- page: guides/testing
- anchor: ## Hold mode, line 78 (218 words), step 4 line 71, line 76
- category: unclear
- severity: medium
- claim: Line 78 packs task waits, level-of-detail plan waits, E1408 after five minutes, levels: false and the plan hand-over order into one paragraph. 'The levels of detail that meshes made in code plan are different.' does not parse. Line 71 (motion vectors draw the frame before; mirrors and probes draw one more frame) and line 76 (bounce light draws one more frame after the held one) give two rules for 'reads the frame before', and the reader cannot tell which applies to which effect.
- evidence: testing.md:71,76,78; stats.json guides/testing longParagraphs (body lines 69, 71).
- proposedEdit: Main text: 'Before the held frame, hold mode waits for the sketch's tasks on the job workers (up to 10 seconds each) and for the levels of detail that meshes plan (up to five minutes, then E1408).' Move the rest into <details><summary>Technical details: what hold mode waits for</summary>. Rewrite: 'Meshes made in code plan their levels of detail on the job workers.' Merge the frame-before rules into one list: motion vectors, mirrors and light probes, screen-space bounce light, each with the extra frame it draws.

Verdict: partly

## Evidence

- docs/guides/testing.md:78 is the 218-word, 13-sentence paragraph (stats.json body line 71). It holds task waits, plan waits, the five-minute E1408 stop, `levels: false`, the setup-time wait and the plan hand-over order. The claim holds.
- testing.md:78 "The levels of detail that meshes made in code plan are different." reads as a garden path ("meshes made in code plan"). The claim holds.
- testing.md:71 says motion vectors "read the frame before" and get the frame before the last one drawn. testing.md:76 says a pass that "reads the frame before it, as screen-space bounce light does" gets one more frame after the held one. The same phrase leads to two different results. The confusion is real.
- The code shows only two mechanisms (packages/engine/src/sketch/runner.ts:1823-1826 and 1842-1857):
  1. Motion passes (`holdsFrameBefore`): the frame BEFORE the last step is drawn too.
  2. One shared settle frame at the held time, AFTER the last step. It runs when a pass reads the last frame's output (bounce light, screen-space reflections), a probe still waits for its capture, a light's copied picture waits, or tasks are still pending. It runs no sketch code and keeps the held frame's number (runner.ts:1853-1856).
  So the "one more frame" in line 71 (mirrors, probes), line 76 (bounce light) and line 78 (tasks) is one and the same frame. The page presents it as three separate rules. The finding does not see this, and its proposed list "each with the extra frame it draws" would keep the three rules apart.
- The proposed main text says tasks wait "up to 10 seconds each". That is wrong. `settleTasks` measures one limit from the start of the wait for all non-plan tasks together (`now - start >= TASK_SETTLE_LIMIT_MS`, runner.ts:1950-1957, constant at runner.ts:160). The five-minute plan limit is also measured from the start of the wait (runner.ts:1966, 168).
- Order of the waits: hold mode waits once before the first step for what the setup started (runner.ts:1810-1811), then waits again after the last step and before the settle frame (runner.ts:1848-1849). It does not wait before the last step. "Before the held frame" in the proposed main text keeps the page's own loose wording; with the settle-frame model it should say "before the frame it publishes".

## Corrected claim

Line 78 is one overlong paragraph with one sentence that does not parse. Lines 71, 76 and 78 also describe one shared extra frame at the held time (for mirrors, light probes, bounce light and late tasks) as three separate rules, and use "reads the frame before" for both motion vectors and bounce light although they get different treatment. Only motion vectors make the engine draw the frame before the last.

## Corrected edit

Main text (step 4 and the paragraphs after it), kept short:

- "Motion vectors need the frame before the last one, so with them the engine draws that frame too."
- "Some effects show their result one frame late: screen-space bounce light, mirrors and light probes. Tasks on the job workers can also answer after the last step. In these cases the engine draws one more frame at the held time. That frame runs none of the sketch's code, so the hold still reports the last step's frame number."
- "Hold mode waits for the sketch's tasks on the job workers, and for the levels of detail that meshes made in code plan. It waits up to 10 seconds in total for the tasks, then warns and draws anyway. It waits up to five minutes for the plans, then stops with [E1408](../errors/E1408.md). Give a mesh `levels: false` when a test should draw it without levels."

Then one block, with no headings inside:

<details>
<summary>Technical details: what hold mode waits for</summary>

- Hold mode waits twice: once after the setup and before the first step, and once after the last step, before the extra frame. A task that never answers delays the hold twice.
- While plans are still running, the console says every 10 seconds which meshes still plan.
- The plans hand over their levels one at a time, in the order they started, whatever order the job workers answer in. So the steps find the same scene on every run, and the levels' meshes take the same places in engine memory.
- The extra frame draws the debug lines of the last `onUpdate` again, so the picture shows the same lines as the frame before it.

</details>
