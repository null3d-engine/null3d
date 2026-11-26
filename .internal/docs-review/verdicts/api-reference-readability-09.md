# api-reference-readability-09

## Finding as given

- page: api/reference/scene, api/reference/engine, api/reference/geometry, api/reference/debug, api/reference/controls
- anchor: scene `Scene` line 365; engine `CapabilityReport` line 13 before `createEngine` line 48
- category: scan-order, severity: medium
- claim: Exports are in name order with no index, so the main object is buried and options sit far from the call that takes them. A 69-export page can only be scrolled.
- evidence: readApi sorts with localeCompare. Scene is at line 365 of 540, after 24 option and sky types. On engine, CapabilityReport comes first and createEngine fourth. geometry BuildLevelsOptions (line 34) is far from MeshGeometry (line 476). controls create* functions (lines 13-53) are far from their classes (69-389).
- proposedEdit: After the intro quote, print an index table (Export, Kind, first sentence) linking each H2. Order sections: entry functions and classes, then their options, then other types and constants. Let each PAGES entry name its main exports so they come first.
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The sort is real. `readApi` ends with `symbols.sort((a, b) => a.name.localeCompare(b.name))` (tools/lib/api-docs.ts:471). `renderReference` (tools/lib/api-docs.ts:505) prints them in that order. `referencePage` (tools/lib/docs.ts:325-339) adds only the title and the one-line intro quote. No page has an index.
- Scene: `## \`Scene\`` is at line 365 of 543 (not 540), the 25th of 35 exports. This part holds.
- Geometry: 68 exports (not 69). `Geometry` is at line 276 and `MeshGeometry` at line 476. This part holds.
- Engine: `Engine` is at line 80 and `createEngine` at line 48, both inside the first screen and a half. "Buried" is too strong here.
- Debug: the main export `Debug` is the second heading, at line 21. The page is listed with no evidence, and the claim does not hold for it.
- Controls: each class already sits next to its options in name order: `DragControls` 69 / `DragControlsOptions` 90, `FirstPersonControls` 128 / `...Options` 158, `FlyControls` 183 / `...Options` 198, `OrbitControls` 270 / `...Options` 326, `TransformControls` 389 / `...Options` 427. Only the `create*` functions are apart. So "options sit far from the call" is wrong for controls, and the proposed order ("classes, then their options") would break this adjacency.
- The options that Scene methods take (MeshOptions, FogOptions and so on) cannot sit next to "the call" under any order, because the call is a member row inside the `Scene` table. The concept page (docs/api/scene.md) teaches those calls and links to the reference at line 606.
- These are lookup pages. Readers reach them from the concept page's link, and name order is the common convention for an API reference. The cost to a reader is real on the long pages (scene, geometry, debug at 43 exports), so a jump list helps, but the cost is closer to low than medium.
- An index table with a first-sentence column repeats every export's summary. On geometry that adds 68 table rows above 68 sections that start with the same sentence.

## Corrected claim

On the long reference pages, exports print in plain name order with no jump list. On scene (35 exports) the main `Scene` interface is at line 365 of 543, and on geometry (68 exports) `Geometry` and `MeshGeometry` are at lines 276 and 476, so a reader must scroll or search to find the main object. Engine and debug already show their main export near the top, and on controls each class already sits next to its options.

## Corrected edit

In `referencePage` (tools/lib/docs.ts:325) or `renderReference` (tools/lib/api-docs.ts:505), print a compact jump list after the intro quote: one line per kind (Functions, Classes, Interfaces, Types, Constants), each a comma-separated list of linked export names. Do not add a first-sentence column. Optionally let a PAGES entry name its main exports, and print those first, each followed by its own `*Options` type. Keep name order for the rest, so pairs such as `OrbitControls` and `OrbitControlsOptions` stay together. Do not move all options into one later block. Severity: low to medium.
