# porting-shaders-readability-13

Finding as given:

- page: shaders/surface-functions
- anchor: ## Rules, first bullet (line 611) "Do not declare a name that the engine declares."
- category: technical-details-block
- severity: medium
- claim: The bullet lists about 70 reserved names in run-on sentences, with conditions for instance, matrices and lobe mixed in. The rule is one sentence, and the reader needs the list only when the build stops on a clash.
- evidence: surface-functions.md line 611 (about 230 words in one bullet).
- proposedEdit: Keep "Do not declare a name that the engine declares. The build stops at your line when a name clashes." Move the names into a technical details block, "Technical details: the names that the engine declares", as four short lists: always declared; added when the WGSL reads instance or object.id; added when it reads the object's matrices; added when it declares a lobe.

Verdict: partly

## Evidence

- docs/shaders/surface-functions.md:611 is one list item. It holds about 72 names in backticks: 32 that the engine always declares, 21 library items "such as" the standard material imports, 1 added for `instance` or `object.id`, 2 added for the object's matrices, 11 added for a lobe, and 5 names that the user may declare. The structure claim holds.
- The bullet is 149 words (whitespace count), not about 230. The size claim is wrong, but the bullet is still the longest item on the page and much longer than the other four rules (lines 612 to 615).
- stats.json does not list line 611 as a long paragraph, because it counts paragraphs, not list items. So this finding is not a duplicate of a long-paragraph finding.
- The other rules in the list are one or two sentences each. A reader who scans the Rules list for "what must I avoid" meets a wall of names first. The list is reference data that a reader needs only after a clash, and the build error already names the line. A closed block keeps the data and shortens the list. The block holds lists only, with no headings and no nested blocks, so it meets the block rule.
- The skill copy (skills/null3d-develop/references/shaders.md:121) has its own list of names. The docs edit does not change any fact, so the skill does not need a change for sync.

## What does not hold

1. The word count is wrong: 149 words, not about 230.
2. The proposed edit drops the last sentence from the main text: "The names `surface`, `vertexOffset`, `lobe`, `unlit` and `coverage` are yours to declare." That sentence is not reference data. It tells every reader which entry-point names to write, and the page's own examples use them. It must stay in the bullet, outside the block.
3. The library items are an open list ("such as"). The block must keep that wording, or it will claim to be complete.

## Corrected claim

The first Rules bullet packs about 72 names into one 149-word item, with the conditions for `instance`, the object's matrices and lobes mixed in. The rule itself fits in two sentences. The reader needs the full list only when the build stops on a clash.

## Corrected edit

Main bullet:

"Do not declare a name that the engine declares. The build stops at your line when a name clashes. The names `surface`, `vertexOffset`, `lobe`, `unlit` and `coverage` are yours to declare."

Then, directly after the Rules list (a block cannot sit cleanly inside a list item on every renderer), add:

<details>
<summary>Technical details: the names that the engine declares</summary>

Always declared: `SurfaceInput`, `Surface`, ... `scene_depth_texel` (the current 32 names).

Library items that the standard material imports, such as `Material`, `Instance`, ... `sun_shadow` (the current 21 names).

Added when the WGSL reads `instance` or `object.id`: `object_ids`.

Added when the WGSL reads the object's matrices: `affine_matrix`, `affine_normal_matrix`.

Added when the material declares a lobe, because the lobe's loop reads them: `clustered_lobed_light`, `Reflected`, ... `area_terms` (the current 11 names).

</details>
