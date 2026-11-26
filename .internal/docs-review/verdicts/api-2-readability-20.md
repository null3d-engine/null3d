# api-2-readability-20

## Finding as given

- page: api/materials
- anchor: lines 306, 526, 602, 682, 693, 853
- category: internal-note, severity: medium
- claim: Some sentences compare with an earlier engine instead of stating what holds now. Line 526 names a maintainer benchmark command, and line 682 cites 'both test scenes' without naming the benchmark.
- evidence: 306 'Materials without layers draw as before'; 602 'as it did before'; 693 'draws exactly as it does today'; 853 'in this version'; 526 '`bun run bench:allocation --setters` checks `setUniform`'; 682 'on both test scenes'.
- proposedEdit: 306: 'Materials without layers keep their own shaders and textures.' 602: end the sentence at 'casts its mesh's whole shape.' 693: 'Without the setting, blended surfaces draw in the sorted transparent pass.' 853: 'Standard materials take no reflection.' Delete the command in 526. In 682, name the benchmark scenes or drop the comparison.

Verdict: partly

## Evidence

- The page is hand-written (docs/api/materials.md), so it is the source to edit.
- 306, 602, 693, 853: the quoted phrases are on those lines. AGENTS.md "Writing docs" says a page describes what exists now, states limits as present facts, and makes no promise of a later feature. "as before", "as it did before", "as it does today" and "in this version" break that rule. This part holds.
- 682: "on both test scenes" names no scene. AGENTS.md says "Name the engine's benchmarks when you cite a figure". The figures ("more than twice nearer", "about two and a half times") come from the image test scene in tests/pages/sketches/moment-sketch.ts: five glass panes within a few meters, and a `spread` variant from 1 to 29 meters. This part holds.
- 526: refuted. Naming `bun run bench:allocation` beside an "allocates nothing" claim is the docs' standing pattern: api/raycast.md:23, api/geometry.md:204, api/debug.md:335, api/controls.md:106, api/wind.md:372, api/scene.md:246, 341, 462. The rule asks docs to name the benchmark that backs a claim. The command is in package.json:57. Deleting it on this page alone makes the pages inconsistent. If the command should read as a repository tool, that is a cross-page change: phrase it as guides/start-time.md:320 does ("The engine's repository checks it with ...").
- 693 proposed edit is wrong. Without the setting, blended surfaces do not all draw in the sorted pass. `'weighted'` surfaces draw in the weighted layer without a sort (lines 657 to 678). Additive and multiply need no sort (line 659). Only `'normal'` ones draw farthest first.
- 306 proposed edit drops the cost point. The paragraph is under "Cost of the layers", and the sentence says materials without layers pay nothing extra.

## Corrected claim

Lines 306, 602, 693 and 853 compare with an earlier engine or hint at a later version, against the "what exists now" rule. Line 682 cites figures without naming the scene they come from. Line 526 follows the docs' standing pattern of naming the allocation benchmark, and is not an issue on this page alone.

## Corrected edit

- 306: "Materials without layers cost nothing more: they use the same shaders and bind no extra texture."
- 602: end the sentence at "and it casts its mesh's whole shape."
- 693: "Without the setting, each blended surface draws by its `blending`: `'weighted'` ones in the weighted layer, and `'normal'` ones farthest first."
- 853: "Standard materials take no reflection: give a polished floor a custom material with the floor's values."
- 682: "It is nearer an exact back-to-front blend than the weighted blending in the engine's test of five overlapping glass panes: more than twice nearer when the panes sit within a few meters, and about two and a half times nearer when they spread from 1 to 30 meters."
- 526: keep the command.
