# D-190: Hold bump, displacement and parallax until the shader tables split

Status: decided by the owner, 2026-10-18. Task: M2-J4.

Summary: The displacement feature makes 3.33 times the standard material's shader builds, which grows the shared shader table every WebGL2 page downloads from about 30 KB to 70 KB after Brotli. The owner holds the feature until the shader build splits its shared paragraph tables and combination loaders. No size limit is raised for it.

## Question

May bump, displacement and parallax materials ship with the shader set as it stands, or must the shader build split its shared tables first?

## Rule

A feature may not pass a size limit by raising it when the growth comes from shader variants that every page downloads ([D-14](D-14-js-budget.md)). A shared table that a page downloads must hold the text that page's modules use, not the text of every combination the set can build.

## Data

| Measure | Main | With the relief bits | Limit |
| --- | --- | --- | --- |
| `standard_maps` builds, one WebGPU kind | 816 | 2,720 (3.33 times) | - |
| `shader-paragraphs-glsl*.js`, after Brotli | 29,878 to 32,318 B | 69,151 to 72,743 B | 49 KB |
| combos loaders, raw | 56,692 to 57,109 B | 218,700 to 227,927 B | 64 KB |
| combos loaders, after Brotli | 4,696 to 5,281 B | 16,446 to 17,361 B | 16 KB |
| start, pipelined WebGL2 | 167,351 B | 169,311 B | 168,960 B |

Measured on 17 and 18 October 2026 from the branch's own size report, against a plain-main report from the same machine. The six relief sets are none, bump, displacement, displacement with parallax, bump with displacement, and all three; casters double the displaced ones.

## Decision

The owner held the feature on 2026-10-18 until the split lands. The branch `feat/m2-j4-displacement` at `4416e3387` keeps its demo, its redrawn references and its passing checks, and waits. The split is tooling work in the Rust shader build: write a shared paragraph table for each device kind and feature family, and keep each combination loader to the combinations a page can ask for. [D-181](D-181-shared-shader-paragraphs.md) owns the shared-table design.

## Consequences

- M2-J4 stays paused after its content is finished; its task row records the ruling and this record.
- The shader build's split is a task of its own, and every later feature that adds permutation bits depends on it.
- No size limit changes. A page's start weight stays as measured on main.
