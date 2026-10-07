# D-65: WebGL2 texture units: the standard material keeps 4 free

Status: decided by the owner on 2026-10-05; the packing comes with M2-J7. Date: 2026-10-05. Task: M2-N1.

Summary: The standard material's busiest WebGL2 fragment build reaches 16 of the 16 guaranteed units after M2-E2 and M2-J5. M2-J7 packs maps into texture-array layers or atlases, so it uses at most 12.

## Question

WebGL2 guarantees 16 texture units in each shader stage. How many may the standard material's fragment stage use, and what does a feature do that needs one more?

## Rule

Every feature of the standard material must draw on WebGL2 on every device, at the guaranteed limit. A feature must not find, late in its work, that no unit is left.

## Data

The counts are for the standard material's busiest WebGL2 fragment build: all its maps, with an alpha mask and shadows.

| Code | Fragment texture units used, of 16 |
| --- | --- |
| Main before M2-E2 and M2-J5 | 13 |
| With M2-J5's specular and IOR maps | 15 |
| With M2-E2's environment cube as well | 16 |

- M2-J5 gives each WebGL2 program its own texture units, numbered from 0 when it links. A unit test fails when any GLSL stage reads more than 16 textures.
- Sheen, clearcoat maps, iridescence and transmission each read more fragment textures. Each would pass 16.

## Decision

The owner's decision of 5 October 2026: plan the packing now, as task M2-J7.

- M2-J7 moves map families that share a size and a format into layers of texture arrays, or packs small maps into atlases. The standard material's fragment stage then uses at most 12 units on WebGL2, so 4 stay free.
- The 16-per-stage unit test gains the margin: it fails above 12 units in the standard material's fragment stage.
- No new fragment texture joins the standard material before M2-J7.
- WebGPU keeps its own check against the device's per-stage limit.

## Consequences

- M2-J7 depends on M2-J5 and M2-E2. Its image tests are the standard maps, glTF specular and environment tests on all three GPU paths. They run on the cloud Galaxy S25 and on the iPad.
- [Implementation notes](../implementation-notes.md) gain the texture unit budget per stage when M2-J7 lands.
