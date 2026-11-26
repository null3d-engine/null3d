# Verdicts: api/reference/objects (shots and demo links)

## Shots

None proposed.

## Demo links

- **setParent and Group -> `objects/`: keep.** The demo exists in examples/demos.ts (name `objects`, no code field, so `objects/` is right). Its sketch makes a group with `scene.createGroup` for the turntable and calls `setParent(off ? null : table, { keepWorld: true })` to move each crate between the table and the stage. That shows both `Group` and `setParent`, including the `keepWorld` option from `ParentOptions`. The `## Object3D` section holds `setParent`, so the place fits.
- **render layers -> `layers/`: keep.** The demo exists (name `layers`, no code field). Its sketch puts roofs and map pins on their own layers through the `layers` create option and calls `camera.setLayers` every 2 seconds to show other sets of layers. It does not call the object's own `setLayers`, but it shows the rule the row explains: a camera draws an object only when their masks share a layer. The place under `## Object3D` (next to `setLayers` and `getLayers`) fits.

## Concepts said to have no demo

- **setOccluder: confirmed, no demo.** No file under examples/ uses `setOccluder`, an occluder, or the `softwareOcclusion` or `gpuOcclusion` settings.
