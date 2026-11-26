# Verdict for api-1-readability-19

## Finding as given

- Page: api/feature-instances
- Anchor: end of page (line 154)
- Category: structure. Severity: medium.
- Claim: The page has no Errors, Related pages or API reference heading, unlike feature-draws and feature-effects. Its API reference sentence reads as a tenth limit. The errors it raises are not listed.
- Evidence: The stats.json outline ends at '## Limits'. feature-instances.md:154 is the API reference sentence. :151 is the only mention of E1506.
- Proposed edit: Add '## Errors' with E1223 (description), E1506 (a direct-draw device that got the draw after its first frame) and E1406 (adapter download), each linked. Add '## Related pages' with features.md, feature-draws.md, render.md#compute-passes and grass.md. Put '## API reference' above line 154.

Verdict: partly

## Evidence

- The structure claim holds. docs/api/feature-instances.md has no heading after "## Limits" (line 141). The link sentence at line 154 sits under "Limits". docs/api/feature-draws.md has "## Errors" (154), "## Related pages" (163) and "## API reference" (170). docs/api/feature-effects.md has the same three at 119, 128 and 135.
- The missing "API reference" heading also breaks a writing rule. AGENTS.md:216 says the written page links to its reference "under its 'API reference' heading".
- "A tenth limit" is wrong. The Limits list has ten bullets (lines 143-152). Line 154 is a separate paragraph after a blank line, not a bullet. The real cost is that it sits under the Limits heading.
- "Not listed" holds for a table, but two codes are named in the text: E1223 at line 88 and E1506 at line 151.
- The proposed error list is incomplete. The source raises more than three codes:
  - E1223: packages/engine/src/scene/scene.ts maps the adapter's fail() to E1223. packages/engine/src/scene/feature-instances.ts:257-279 throws it for the kind, the frame, the views, and also for a capacity outside 1 to the maximum and a starting count outside 0 to capacity. So "(description)" undersells it.
  - E1108: feature-instances.ts:172-181 and :238 throw it from setInstances() and setCount() for a count outside 0 to capacity, too few floats, or rows the draw does not take.
  - E1406: scene.ts:3207-3216, the instance adapter did not download.
  - E1506: fixes.ts:163-164, a direct-draw device that got the draw after its first frame.
  - The draw also calls materials.shader and geometry.fromArrays (feature-instances.ts:290-296), so E1215, E1216, E1217 and E1206 reach the caller, as feature-draws.md lists them.
  - E1101 follows a call after destroy() (feature-instances.ts:220).
- The proposed related pages exist: docs/api/features.md, feature-draws.md, render.md ("## Compute passes" at line 225) and docs/api/grass.md. The grass package calls addComputeInstances (packages/grass/src/grass.ts:412), so the link is relevant.

## Corrected claim

The page has no Errors, Related pages or API reference heading, unlike feature-draws and feature-effects. The API reference link at line 154 sits under the Limits heading, which also breaks the rule that the link sits under an "API reference" heading. The page names E1223 and E1506 in its text but has no error table.

## Corrected edit

Add these sections after the Limits list, in the order the sibling pages use:

## Errors

| Code | Cause |
| --- | --- |
| [E1223](../errors/E1223.md) | A description or options that the instance adapter cannot place: another kind, frame point or view, a capacity outside 1 to 1,048,576, or a starting count above the capacity. |
| [E1108](../errors/E1108.md) | `setInstances` or `setCount` got a count outside 0 to the capacity, or too few floats for the count. |
| [E1206](../errors/E1206.md) | Vertex data that makes no mesh, as `geometry.fromArrays` reports it. |
| [E1215](../errors/E1215.md), [E1216](../errors/E1216.md), [E1217](../errors/E1217.md) | WGSL that the plugin did not compile, a uniform or a texture that the WGSL does not declare, or an option that the material does not take. |
| [E1406](../errors/E1406.md) | The instance adapter did not download. |
| [E1506](../errors/E1506.md) | A device that draws the scene directly got the draw after its first frame. |

## Related pages

- [Add-on feature descriptions](features.md): the one description shape, its fields and its registry.
- [Add-on feature draws](feature-draws.md): the adapter for a draw of rows that the CPU gives.
- [Compute passes](render.md#compute-passes): the pass that writes the count and the rows.
- [Grass](grass.md): a package that draws its blades with this adapter.

## API reference

(the existing sentence from line 154)
