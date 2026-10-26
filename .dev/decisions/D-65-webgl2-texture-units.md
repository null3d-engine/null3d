# D-65: WebGL2 texture units: the standard material keeps 4 free

Status: decided by the owner. Built with M2-J7: [D-89](D-89-webgl2-texture-units.md) packs the maps, and the stage reads 12 of its 16 units. Task: M2-N1.

Summary: With one unit per map, the standard material's busiest WebGL2 fragment build reads all 16 guaranteed texture units once M2-E2 and M2-J5 add theirs. M2-J7 packs its maps, so the stage uses at most 12 and keeps 4 free.

## Question

WebGL2 guarantees 16 texture units in each shader stage. How many may the standard material's fragment stage use, and what does a feature do that needs one more?

## Rule

Every feature of the standard material must draw on WebGL2 on every device, at the guaranteed limit. A feature must not find, late in its work, that no unit is left.

## Data

The counts are for the standard material's busiest WebGL2 fragment build, with one unit per map: all its maps, with an alpha mask and shadows.

| Features | Fragment texture units used, of 16 |
| --- | --- |
| Without the specular and IOR maps and the environment cube | 13 |
| With M2-J5's specular and IOR maps | 15 |
| With M2-E2's environment cube as well | 16 |

- Each WebGL2 program numbers its own texture units from 0 when it links (M2-J5).
- Sheen, clearcoat maps, iridescence and transmission each read more fragment textures. Each would pass 16.

## Decision

Decided by the owner: the standard material packs its textures on WebGL2, as task M2-J7.

- M2-J7 lets maps that share a size and a format share texture arrays and units ([D-89](D-89-webgl2-texture-units.md) gives the design). The standard material's fragment stage then uses at most 12 units on WebGL2, so 4 stay free.
- The unit test of texture units holds the margin: it fails above 12 units in the standard material's fragment stage.
- WebGPU keeps its own check against the device's per-stage limit.

## Consequences

- M2-J7's image tests are the standard maps, glTF specular and environment tests on all three GPU paths. They run on the cloud Galaxy S25 and on the iPad.
- [Implementation notes](../implementation-notes.md) give the texture unit budget per stage.
