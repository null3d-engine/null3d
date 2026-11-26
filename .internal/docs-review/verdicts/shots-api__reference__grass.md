# Verdicts: api/reference/grass (shots and demo links)

## Shots

None proposed. Nothing to check.

## Demo links

- `createGrass` -> `vegetation-wind/` (under "## `createGrass`"): KEEP.
  The code exists in examples/demos.ts (name `vegetation-wind`, code `vegetation-wind/`).
  Its sketch imports `createGrass` from `@null3d/grass` and calls it with height, area, count,
  seed, blades, `where` (keeps tufts clear of trunks), `wind`, `camera` and `swayDistance`,
  then calls `grass.setWindLayer(wind.field)` each frame. It shows the function and the frame
  call that the page describes.
  Side note: `contact-shadows/` (contact-shadows/garden.ts) also calls `createGrass`, with
  `swayDistanceFor` and `grass.fit(preset)`. It could serve as a second link for
  `swayDistanceFor` and `Grass.fit`, which the proposal did not cover.

## Concepts said to have no demo

- `hashAt`, `pcg`, `unitAt`: CONFIRMED no demo. No example imports them. The only `pcg` in
  examples is a separate shader copy in examples/lib/lens-three.ts, not the grass export.
- `GrassBladeShape`: CONFIRMED no demo. No example passes the `blade` option to `createGrass`
  (vegetation-wind, contact-shadows/garden.ts and showcase/island/trees.ts all leave it out).
