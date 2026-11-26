# concepts-1-substance-06

## Finding as given

- Page: concepts/instances
- Anchor: ## Create a batch, options table lines 49-56
- Category: missing-content
- Severity: medium
- Claim: The table claims to list the options, but it gives 6 of the 10. It leaves out `ranges`, `castShadows`, `receiveShadows` and `occluder`. The page never mentions `ranges` or `occluder`, but the levels-of-detail and culling pages rely on them.
- Evidence: packages/engine/src/scene/scene.ts:542-590 (InstanceOptions); lod.md:211; culling.md:75.
- Proposed edit: Add rows: `castShadows` (false): every row casts shadows. `receiveShadows` (false): every row receives shadows. `occluder` (true): rows may hide others in occlusion culling, linked to culling.md#which-objects-hide-others. `ranges` (false): adds a `ranges` array, one distance band per row, linked to lod.md#distance-bands.

Verdict: partly

## Evidence

- docs/concepts/instances.md:47 says "takes these options", and the table at lines 49-56 has 6 rows: material, dynamic, colors, values, layers, origin.
- packages/engine/src/scene/scene.ts:542-590 (InstanceOptions) has 10 fields. The other four are `ranges`, `castShadows`, `receiveShadows` and `occluder`. So "6 of 10" is correct.
- `ranges` and `occluder` do not appear anywhere on the page (grep). That part of the claim holds.
- docs/concepts/lod.md:211 says a row's own range "in the array that `ranges: true` makes for a batch" overrides the batch's. docs/concepts/culling.md:75 says an instance batch takes `occluder: false`. Both anchors exist: lod.md:202 "## Distance bands", culling.md:70 "### Which objects hide others".
- The shadow options are not missing from the page. docs/concepts/instances.md:198 says: give `castShadows` and `receiveShadows` to `createInstances`, or call the batch setters; both are false by default; it links to shadows.md. The example at line 258 also passes `castShadows: true`. So the claim that the page leaves them out is overstated. They are only absent from the table.
- scene.ts:2834 shows `ranges` is 2 floats per row (start and end distance), so the row-arrays table at lines 62-68 also lacks a `ranges` row.
- The defaults in the proposed edit match the TSDoc: shadows default false; `occluder` left out acts as true; `ranges` default off. The occluder TSDoc adds that rows never block on WebGL2 and the culling is on WebGPU.

## Corrected claim

The options table (lines 49-56) says it lists the options of `createInstances` but gives 6 of 10. `ranges` and `occluder` are not on the page at all, though lod.md and culling.md rely on them. `castShadows` and `receiveShadows` are explained later on the page (line 198) but are missing from the table, so a reader of the table does not see them.

## Corrected edit

Add four rows to the options table:

| `castShadows` | `false` | `true` makes every row cast shadows: [Shadows](shadows.md) |
| `receiveShadows` | `false` | `true` makes shadows fall on every row |
| `occluder` | `true` | `false` keeps rows from hiding what lies behind them in GPU occlusion culling on WebGPU: [Which objects hide others](culling.md#which-objects-hide-others) |
| `ranges` | `false` | `true` adds a `ranges` array: a start and an end distance for each row, so each row draws in a band of its own: [Distance bands](lod.md#distance-bands) |

Also add a row to the row-arrays table (lines 62-68): `ranges` | 2 | A start and an end distance, with `ranges: true` only. Check the new-row default in the engine before writing it.
