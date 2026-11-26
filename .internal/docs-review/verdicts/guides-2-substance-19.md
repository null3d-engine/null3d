# guides-2-substance-19

## Finding as given

- page: guides/start-time
- anchor: line 162 (sideEffects), line 284 (demo page dropped a worker), line 232 (?grown), line 320 (bun run bench:startup)
- category: internal-note, severity: medium
- claim: These lines describe the engine repository's own choices and tools. "The engine's package keeps no sideEffects list: one was measured, and it made the start slower." and "The engine's demo page dropped such a worker" are maintainer history. ?grown is a switch of the demos, not of the engine.
- evidence: AGENTS.md Writing docs: "Notes for maintainers belong in code comments, in this file or in the guides in .dev/."
- proposedEdit: Delete line 162's last sentence. Rewrite line 284 as "A worker that caches a large build at load can send over a thousand requests during the start." Replace the ?grown sentence with "a sketch can take a switch of its own that does the same on a live page". Say that line 320 applies to the engine repository, or delete it.

Verdict: partly

## Evidence

- Line 284 holds. "The engine's demo page dropped such a worker" tells of a past change. AGENTS.md Writing docs says "Give a fault or a figure as a present fact with its reason. Leave when it happened to git." The figure itself is useful, and the same section says "Name the engine's benchmarks when you cite a figure". The proposed rewrite drops both the source and the exact figure, so it breaks that rule.
- Line 162 partly holds. "Keeps no sideEffects list" is a present fact, and "one was measured" is close to history. The sentence is a design reason about the engine's own package, not an action for the reader. It is not a process word, so it is not banned. It is correct, dense detail for an implementer who asks why the engine does not declare the field. The task asks to move such detail into a collapsible block, not delete it.
- Line 232 is refuted. `?grown` is real code in public demos: examples/showcase/creek/sketch.ts:16 and :152, examples/splats/sketch.ts:7 and :33. The page already says it is a switch of "the engine's showcase demos", not of the engine. Pointing at a working example is not maintainer history. The proposed vague wording removes a pointer that a reader can follow.
- Line 320 is refuted as an internal note. The sentence already says "The engine's repository times the engine's own start". The edit asks for something the page already does. `bench:startup` exists (package.json:59), and the rule asks docs to name the benchmarks behind figures. The sentence does little for a developer who uses the engine, so a collapsible block fits better than the main text. That is polish.
- Severity should be low. No line misleads a reader or blocks a newcomer.

## Corrected claim

Line 284 states a past change ("dropped") where the rules want a present fact. Line 162's last sentence is a design reason about the engine's own package, and line 320 describes a repository tool. Both are correct detail that a user seldom needs. The `?grown` sentence is a valid pointer to public demo code and needs no change. Severity low.

## Corrected edit

- Line 284: replace the last sentence with "On the engine's demo page, a worker that cached every file sent about 1,570 requests and 820 MB over the start's connections."
- Line 162: move the last sentence into a block after the paragraph:

  <details>
  <summary>Technical details: the engine package's sideEffects field</summary>

  The engine's package declares no `sideEffects` list. A build with one started more slowly.

  </details>

- Line 320: move the paragraph into a block at the end of "Measure a start", with the summary "Technical details: how the engine times its own start".
- Line 232: no change. If a link helps, add one to https://github.com/null3d-engine/null3d/tree/main/examples/showcase/creek/ (check the demo's code value in examples/demos.ts first).
