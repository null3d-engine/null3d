# Shot and demo-link verdicts: api/reference/points

## Shots

None proposed. Nothing to check.

## Demo links

- PointBatch -> `galaxy/`: KEEP.
  - The galaxy demo in examples/demos.ts has no code value, so the contract form "<name>/" applies: https://github.com/null3d-engine/null3d/tree/main/examples/galaxy/. The folder examples/galaxy exists.
  - Its sketch calls `scene.createPoints` twice: a dynamic batch of colored stars whose positions it rewrites each frame, and that it trims with `setActiveCount` on phones; and a sky batch with `sizeAttenuation: false`. That covers the main members of PointBatch and PointOptions.
  - It is the only demo that uses points.
  - The page is generated. The link goes into the TSDoc comment on `PointBatch` in packages/engine/src/scene/sprites.ts (tag `@category api/points`), not into the docs page.

## Concepts said to have no demo

None listed.
