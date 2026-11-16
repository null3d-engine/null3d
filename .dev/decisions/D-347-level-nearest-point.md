# D-347: A level measured by error measures the nearest surface

Status: decided and built: the capped level distance in `levels.rs` and `cull.wgsl`, its tests, and the LOD page's correction. Task: none.

Summary: A level given by an error measures to the bounding sphere's center less half its radius. The measure is capped at twice the distance to the nearest point (`LEVEL_NEAREST_SHARE`). A camera beside a ground two kilometers across then measures the surface below it, not a fraction of the ground's size.

## Question

How does a level given by an error switch when the camera stands beside a very large mesh? Its bounds can put the center hundreds of meters away from the surface.

## Rule

A level whose error the view measures must not switch in too early. The surface below the camera must stay within two pixels of the full mesh. A camera anywhere beside a mesh must measure a distance that follows the surface below it. A small mesh must keep the switch that its data chose.

## Data

The ground probe is a square ground of 2 km a side. Code makes it with a low relief, and it draws at 480 by 270 on the WebGL2 path. Each level has a color: the base mesh red and the first lower level green. The camera stands 60 m above the ground, 1,000 m from its center. The sphere's radius is about 1,414 m, and the surface below the camera is 60 m away.

| Rule | Level distance | Level drawn under the camera | Level 1 (green) share | Base (red) share |
| --- | --- | --- | --- | --- |
| Half the radius alone | 294.7 m | 1 | 51.15% | 0% |
| Capped at twice the nearest point | 2 mm | base | 0% | 51.16% |

How the figure was produced: a 480 by 270 WebGL2 drawing through the image harness. The wasm was built from the tree before and after the cap. The shares count pixels by their dominant color channel in the saved image.

## Look

Before the cap, every part of the ground that the camera sees draws the first lower level. The rule compares its error at 294.7 m, while the surface below the camera is 60 m away. It therefore lets a level whose error covers up to about 4.9 pixels there pass. After the cap, the ground draws the base mesh. A flat ground hides this, since its planned levels have almost no error. A ground with relief does not.

## Decision

Cap the half-radius measure at twice the nearest point. The nearest point alone would keep about 14% more triangles than the half-radius measure in the desert's held frames (D-137). It would also change a small object's switch. The cap leaves every sphere whose half radius is under twice its nearest point unchanged, so the small objects that D-137 measured keep their switches. It binds only where the camera stands beside a large one. The factor of two is the review's lower bound. A larger factor would bind only nearer the surface, and a smaller one would change a small object's switch sooner.

## Consequences

- `LEVEL_NEAREST_SHARE` in `crates/null3d-core/src/levels.rs` and `crates/null3d-shaders/wgsl/cull.wgsl`, pinned by the level-rule test.
- The LOD page says that the distance is capped at twice the nearest point, and that the near side may show two pixels of error.
- A level given by an error, and the hide rule, compare the error at the nearest surface. This holds for a camera beside a large mesh.
