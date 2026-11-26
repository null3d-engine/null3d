# tree-structure-12

## Finding as given

- page: concepts/instances
- anchor: ## Create a batch
- category: structure
- severity: medium
- claim: concepts/instances is an API page in the concepts area. Its outline matches api/sprites, api/points and api/lines, but it has no API reference link like they do.
- evidence: concepts/instances headings: Create a batch | The row arrays | Static and dynamic batches | ... | Per-row colors | Per-row values. api/sprites: Create a batch | The row arrays | Static and dynamic batches. No 'API reference' heading on concepts/instances.
- proposedEdit: Move concepts/instances -> api/instances in the 'Many copies' group, tag its symbols @category api/instances. Keep a short 'Automatic batching' model there or move it into concepts/static-dynamic.
- generatedSource: tools/lib/docs.ts (PAGES); @category tags in packages/engine/src

Verdict: partly

## Evidence

- True: concepts/instances has no "## API reference" heading. api/sprites.md:167, api/lines.md:161, api/points.md:128 and api/scene.md:604 each have one. The first three headings of concepts/instances (lines 26, 60, 109) match api/sprites.
- But the reference is already reachable. The Related pages list (concepts/instances.md:280) says "[Scene](../api/scene.md): `createInstances` and the reference of instance batches". The `InstanceBatch` class and `InstanceOptions` are documented in docs/api/reference/scene.md:185 and :216, because their symbols are tagged for the Scene page. api/scene.md:581 "Instance batches" summarizes batches and sends the reader to concepts/instances for the full story. So the reader is not blocked; the cost is one extra hop.
- The page is not only an API page. "Culling" (line 178), "Automatic batching" (line 182) and "Limits" (line 196) explain engine behavior that covers objects from `scene.createMesh` too, which is concept material. The split between concept and API is a fair one.
- The proposed edit is wrong in its details:
  - There is no "Many copies" group. docs/pages.md groups pages only by area (AREAS in tools/lib/docs.ts:59): Getting started, Concepts, API reference, Guides, and so on.
  - Moving the page changes its id. 23 files under docs/ and skills/ link to concepts/instances, so all would need edits, for a small gain.
  - Retagging the batch symbols to a new api/instances category would pull `InstanceBatch` and `InstanceOptions` out of the Scene reference, where `createInstances` lives. The reader would then need two reference pages for one call.
- Severity: low (polish), not medium. A newcomer finds the reference through the Scene link already given on the page.

## Corrected claim

concepts/instances has no direct link to the API reference of instance batches. It reaches it only through the Scene page. The page itself is correctly placed in concepts: it mixes API use with engine behavior that covers all objects.

## Corrected edit

Keep the page id and area. In "Related pages" (concepts/instances.md:280), make the reference one hop away, for example:

- [Scene](../api/scene.md): `createInstances`. [The API reference of instance batches](../api/reference/scene.md#instancebatch) lists every member of `InstanceBatch` and every option of `createInstances`.

(Confirm the anchor that the website gives to the heading "`InstanceBatch`".) No change to PAGES or to @category tags.
