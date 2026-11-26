# api-2-substance-08

## Finding as given

- page: api/impostors
- anchor: ## Create the cards, code block (lines 44-66)
- category: unclear
- severity: medium
- claim: The first example loads two atlas PNG files by hand and passes size: 6 with no room or depth. A pair from the bake command needs the bake's room, or the picture fills the card at the wrong height. loadImpostorAtlas gives all of these values, but the page shows it only at line 111. The square size does not match a bake's [width, height], and trees is never used.
- evidence: docs/api/impostors.md:44-66, 107, 111; packages/impostors/src/batch.ts:61-77 (size, room default 1); examples/impostors/sketch.ts:88-101 passes room and depth from the bake.
- proposedEdit: Rewrite the first example with loadImpostorAtlas: const pine = await loadImpostorAtlas(assets, 'trees/pine-impostor.json'); createImpostors({ scene, materials, geometry }, { ...pine, positions, turn: turns }). Keep hand-made textures for ## Bake the atlases.
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/api/impostors.md:48-49: the comment in the example says the atlases come from `bakeImpostorAtlas` or from `bunx @null3d/cli assets impostor`.
- docs/api/impostors.md:51-52: the file names `forest-tree-impostor-color.png` and `forest-tree-impostor-surface.png` follow the exact pattern that the command writes (packages/cli/src/assets/impostor.js:47-48, 116-118: `<name>-impostor-color.png`, `<name>-impostor-surface.png`). So a reader takes these files as command output.
- docs/api/impostors.md:64: the call passes `size: 6` and no `room` and no `depth`.
- packages/impostors/src/batch.ts (ImpostorOptions): `room` defaults to 1, "a picture that fills its card". `size` as one number makes a square card. `depth` defaults to the card's width.
- packages/impostors/src/bake.ts:267: a bake's room is hypot(2 * reach, height) / height, which is always more than 1. So with the default room of 1, a baked picture is squeezed into the card at the wrong height. The bake's size is [width, height] (docs line 107), so a square size of 6 also stretches the card.
- docs/api/impostors.md:107 explains room, and line 111 introduces loadImpostorAtlas, both after the example. Nothing near the first example warns that its values are wrong for a bake.
- packages/impostors/src/load.ts:55-62: loadImpostorAtlas returns color, surface, atlas, size, room and depth, so spreading it into createImpostors fixes every missing value.
- examples/impostors/sketch.ts:88-101: the demo passes room and depth from the bake and sets each card's scale from the bake's size.
- `trees` at line 62 is never used in the example. That part is minor, but true.

I could not disprove any part. The first example is the first code a newcomer copies, and it gives wrong-looking cards with real bake output.

## Refinement to the edit

The proposed first example would be the same as the code block at lines 117-124 under "Load a baked atlas". To avoid two copies:

- In "Create the cards", use loadImpostorAtlas as proposed (keep `bunx @null3d/cli assets impostor models/pine.glb --out public/trees` in the comment so the file path makes sense), and drop the unused `const trees =` or use it (for example `trees.setViews(3)` is not needed; simply call `createImpostors(...)` without the binding, or keep `trees` since lines 71-73 refer to `trees.batch` and `trees.setViews`).
- In "Load a baked atlas", keep the sh command and the loader prose, and cut the ts block, or shorten it to the loader line alone.
- Alternatively, keep hand-loaded textures in the first example but add `room` and `depth` and a `[width, height]` size with a short note that they come from the bake's JSON file. The loader version is simpler and less error-prone, so it is the better choice.

Note: since lines 71-73 talk about `trees.batch`, `trees.markDirty` and `trees.setViews`, keeping the `trees` binding is fine; the "never used" point is a polish item only.
