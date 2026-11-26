# concepts-1-substance-08

## Finding as given

- Page: concepts/architecture, concepts/culling, concepts/large-worlds, concepts/lighting
- Anchor: architecture ## Precision far from the origin; culling ## Grid cells and ## What this means for your sketch; large-worlds ## Grid cells and ## Limits; lighting ## Lights far from the origin
- Category: duplication. Severity: medium.
- Claim: Four pages explain grid cells: their size, which cell an object takes, the 64-bit offsets and the limit of 512 cells. The precision figures also change form. Architecture gives the step size ('about 8 mm at 100 km'), culling gives the rounding error ('within about 4 mm'), and large-worlds gives the step again. A reader can take the two as a contradiction.
- Evidence: architecture.md:110-112; culling.md:174-183, :214, :217; large-worlds.md:22, :28-36, :74, :115; lighting.md:168.
- Proposed edit: Keep the full explanation on large-worlds. Keep one sentence and a link on architecture and lighting. On culling, keep only 'Skipping cells out of view', shrink '## Grid cells' to two sentences and a link, and move the precision bullets to large-worlds. Use step size for precision on every page.

Verdict: partly

## Evidence

- The duplication is real. Cell size, the cell a root object, child and instance row takes, and the 64-bit camera-to-cell offsets appear in architecture.md:110-112, culling.md:174-183 and large-worlds.md:28-34. The limit of 512 cells appears in culling.md:217 and large-worlds.md:115. The vertex rule appears in culling.md:215 and large-worlds.md "Floating-origin geometry". The rule about 64-bit world getters and Float32Array (culling.md:216) already appears in api/objects.md:65.
- Architecture links to Culling for "the cells and their limits" (architecture.md:112), not to large-worlds, which holds the full text. Lighting (lighting.md:168) has no link to large-worlds.
- The figures do not contradict. They are consistent. A 32-bit float near 100 km has a step of 2^-7 m, about 7.8 mm, so its rounding error is half that, about 3.9 mm. Near 1,000 km the step is 2^-4 m, 6.25 cm, and the error is about 3.1 cm. Architecture's "8 mm" and large-worlds' "6 cm at 1,000 km" are steps. Culling's "4 mm" and "3 cm" are errors. The finding is right that the forms differ and a reader can be puzzled. "Contradiction" is too strong: no figure is wrong.
- The proposed edit goes too far on lighting. lighting.md:168 is one paragraph of four sentences. Its main point is specific to lights: each point and spot light's position relative to the camera, and a lamp 1,000 km out stays precise. large-worlds.md:36 gives that fact only in a list. One sentence and a link would cut the fact that a lighting reader looks for.
- On culling, "move the precision bullets to large-worlds" is mostly a delete. Large-worlds already has the vertex rule, the 512-cell limit and the 1,000 km step. api/objects.md:65 already has the world-getter rule. Only the 100 km figure is new to large-worlds, and its "Large-world mode" section already says "steps of 8 mm or more" beyond about 100 km.
- The culling section "Skipping cells out of view" needs the reader to know which cell an object takes (culling.md:191 "moves into another cell") and that a scene inside one cell uses only one cell (culling.md:194). The two short sentences on culling must keep both facts.

## Corrected claim

Grid cells are explained in full three times (architecture, culling, large-worlds), and the 512-cell limit and the vertex rule twice (culling, large-worlds). Lighting gives a short summary that is specific to lights, but has no link to large-worlds. The precision figures are consistent: culling gives rounding errors, half the step sizes that architecture and large-worlds give. The change in form can puzzle a reader, but no figure is wrong.

## Corrected edit

- large-worlds: keep it as the full source for cells. No new content is needed.
- architecture ## Precision far from the origin: cut to two or three sentences: 32-bit positions are coarse far from the origin, the engine stores matrices relative to cells about 1 km wide, and each frame it adds 64-bit camera-to-cell offsets so the GPU draws relative to the camera. Change the link to [Large worlds and precision](large-worlds.md).
- culling ## Grid cells: cut to two sentences and a link. Keep: cells are cubes 1,024 m wide, and a scene within 512 m of the origin uses one cell. A root object and its children take the cell of the root's position, and an instance row takes the cell of its own position. Then link to large-worlds.
- culling ## What this means for your sketch: drop the list of limits. Keep one sentence that you write world positions as usual, and link to [Large worlds and precision](large-worlds.md) for the precision figures and limits, and to [Objects and transforms](../api/objects.md) for the world getters. The code example can stay or go; it adds little to a culling page.
- lighting ## Lights far from the origin: keep the lights-specific sentences. Cut the general cell explanation to one clause, and add a link to large-worlds.
- Where a page gives a precision figure, give it as a step size, as large-worlds does.
