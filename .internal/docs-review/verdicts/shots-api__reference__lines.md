# Verdicts: api/reference/lines

## Shots

None proposed.

## Demo links

- LineBatch -> `sprites-lines/` (under `## LineBatch`): KEEP.
  The demo "Sprites and lines" exists in examples/demos.ts and has no `code` value, so `sprites-lines/` is the right form.
  Its sketch makes two line batches with `scene.createLines`: a helix of wide lines in world units with colors per point, and a dashed loop on the pool rim whose dash offset moves each frame through the material's `set`.
  That covers `LineBatch`, `LineOptions` (mode, width, worldUnits, dashed, colors) and `LineMaterial.set`.

## Concepts said to have no demo

None listed.
