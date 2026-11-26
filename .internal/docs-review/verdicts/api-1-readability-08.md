# api-1-readability-08

## Finding as given

- Page: api/grass
- Anchor: ## Grass on the ground (line 69)
- Category: wall-of-text
- Severity: medium
- Claim: createGrass takes about a dozen options. They appear in one 149-word, 10-sentence paragraph and are scattered through lines 75, 92, 94 and 100. There is no options table, so a newcomer cannot see the options or their defaults at a glance.
- Evidence: grass.md:69 names height, area, count, seed, mask, maxSlope and where. :75 names blade and color, :92 camera, :94 compute, :100 swayDistance. stats.json line 62 gives 149 words and 10 sentences.
- Proposed edit: After the first example, add '## Options' with a table Option | What it does: height, area, count (tufts at High; Low, Medium and Ultra draw 0.35, 0.6 and 1.25 of it), seed, mask, where, maxSlope, color, blade, wind, camera, swayDistance and compute. Cut line 69 to three sentences: what the call draws, that one seed places the same grass on every device, and 'Await the call in the setup, because WebGPU makes its draw then.' Keep grass.fit(preset) as a short line under the table.

Verdict: partly

## Evidence

- The long paragraph holds. stats.json gives 149 words and 10 sentences for it (stats line 62, page line 69 after the front matter). It mixes three topics: where tufts grow (height, maxSlope, mask, where), how the hash places and tints them, and the preset share plus the await rule.
- The "no options table" claim does not hold. The page links its API reference at grass.md:108. The generated reference, docs/api/reference/grass.md:67-91, already has a `GrassOptions` table with all 17 options, each with its meaning and its default (blades 13, segments 3, shapes 1, maxSlope 0.6, sway 0.04, swayDistance 0, compute true, color "a fresh green").
- The finding undercounts the options. It names 13 and misses `blades`, `segments`, `shapes` and `sway`. The proposed table has no defaults column, so it would not even fix the defaults gap it names.
- The proposed edit breaks a repository rule. AGENTS.md:212 ("One source per fact") says the API reference comes from the TypeScript doc comments. A hand-written options table on the written page copies the generated one, and it drifts the next time an option changes (it is already incomplete).
- Cutting line 69 to three sentences drops useful facts that appear nowhere else on the written page: that `mask` and `where` must both allow a tuft, that steep ground is skipped, and that the tint comes from a hash in the shader.

## Corrected claim

The paragraph at line 69 is too long: 149 words and 10 sentences that cover three topics. The options and their defaults are already in one table, the `GrassOptions` table on the linked API reference page, but the written page does not point a reader to that table.

## Corrected edit

Do not add an options table to the written page. Split line 69 into short paragraphs and point to the generated table:

1. "`await createGrass(ctx, options)` draws tufts of bent blades over a square of ground. Await the call in the sketch's setup, because WebGPU makes its draw then. The [`GrassOptions` table](reference/grass.md#grassoptions) lists every option with its default."
2. "The tufts stand on `height(x, z)` and skip ground steeper than `maxSlope`. They also skip ground that `mask` refuses, such as water or a footprint, and ground that `where` refuses, such as a road. A tuft grows only where both allow it."
3. "`count` is the tufts at the High preset. Low, Medium and Ultra draw 0.35, 0.6 and 1.25 of it. `createGrass` fits the engine's starting preset, and `grass.fit(preset)` takes a new one."
4. Put the hash detail in a collapsible block, so the main text reads well with it closed:

<details>
<summary>Technical details: how the tufts are placed</summary>

Each tuft's turn and size come from integer hashes, so one seed places the same grass on every device. Each tuft's tint comes from a hash of its root's place, in the shader.

</details>

The finding's other lines (75, 92, 94, 100) explain each option where it matters. They do not need to move.
