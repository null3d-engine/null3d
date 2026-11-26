# Verdicts: api/reference/impostors (shots and demo links)

## Shots

None proposed. Nothing to disprove. (A reference picture of the demo exists for each tier at tests/image/references/chrome-real-gpu/{webgpu,compat,webgl2}/demo-impostors.png. A reference page lists exports, so leaving it without a picture is fine.)

## Demo links

- `impostors/` at "## `createImpostors`": KEEP.
  - The code exists: the `impostors` demo in examples/demos.ts has `code: 'impostors/'`.
  - The sketch shows the concept. examples/impostors/forest.ts calls `bakeImpostorAtlas` to make the atlas in code. examples/impostors/sketch.ts calls `farCellGroups` and `mergeFarGeometry` for the middle band, `createImpostors` for the far cards, and `handOverToCards` to hand the near meshes over to the cards. The L key switches the far band between meshes and cards.
  - The anchor under `createImpostors` is the right place: it is the main export, and the demo uses it directly.

## Concepts said to have no demo

- `loadImpostorAtlas`: CONFIRMED, no demo shows it. No file under examples/ or tests/ calls it or loads an impostor atlas file. The impostors demo bakes its atlas in code with `bakeImpostorAtlas` and never loads a file. Only the package's own unit test and the CLI asset code use it.
