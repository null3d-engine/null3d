# D-190: Hold bump, displacement and parallax until the shader tables split

Status: decided by the owner. The hold has ended: the split of [D-191](D-191-shared-text-split-by-feature-family.md) is built, and the relief materials are merged. Task: M2-J4.

Summary: The displacement feature makes 3.33 times the standard material's builds, which would grow every WebGL2 page's shared table from 30 to 70 KB after Brotli. The owner held the feature, with no size limit raised, until the shader build split its shared tables and combination loaders. With the split, the growth stays out of a page's start.

## Question

May bump, displacement and parallax materials ship with the shader set as it stands, or must the shader build split its shared tables first?

## Rule

A feature may not pass a size limit by raising it when the growth comes from shader variants that every page downloads ([D-14](D-14-js-budget.md)). A shared table that a page downloads must hold the text that page's modules use, not the text of every combination the set can build.

## Data

| Measure | Without the relief bits | With the relief bits | Limit |
| --- | --- | --- | --- |
| `standard_maps` builds, one WebGPU kind | 816 | 2,720 (3.33 times) | - |
| `shader-paragraphs-glsl*.js`, after Brotli | 29,878 to 32,318 B | 69,151 to 72,743 B | 49 KB |
| combos loaders, raw | 56,692 to 57,109 B | 218,700 to 227,927 B | 64 KB |
| combos loaders, after Brotli | 4,696 to 5,281 B | 16,446 to 17,361 B | 16 KB |
| start, pipelined WebGL2 | 167,351 B | 169,311 B | 168,960 B |

Measured from the branch `feat/m2-j4-displacement`'s own size report, against a report of main from the same machine, both without the split. The six relief sets are none, bump, displacement, displacement with parallax, bump with displacement, and all three; casters double the displaced ones.

## Decision

The owner held the feature until the split landed. The split is tooling work in the Rust shader build: write a shared paragraph table for each device kind and feature family, and keep each combination loader to the combinations a page can ask for. [D-181](D-181-shared-shader-paragraphs.md) owns the shared-table design, and D-191 the split.

With the split, a page downloads only the combinations it can ask for. The build count still grows with the relief bits, as measured above: the merged manifest makes 53,762 GLSL builds and 19,227 WGSL builds, and `BUILD_BUDGET` records those figures. The growth stays out of a page's start, so the hold has ended and the relief materials are merged.

## Consequences

- Every feature that adds permutation bits depends on the split.
- No size limit changed for the relief materials.
