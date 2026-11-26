# errors-readability-16

## Finding as given

- page: errors/E1501
- anchor: page lines 13 and 17
- category: wall-of-text
- severity: medium
- claim: The cause (138 words, 10 sentences) names seven parts that can fill up, with their limits in prose. The fix (80 words, 6 sentences) covers only the material table, the culling limit and skinning. A message that names the upload space, one GPU buffer or the shadow atlas has no fix on the page.
- evidence: stats.json E1501: line 6 (138, 10), line 10 (80, 6). codes.ts line 577; fixes.ts line 154.
- proposedEdit: Cause: 'The scene needs more room than the renderer has. The message names the full part, and a frame that fails draws nothing.' Then a table Full part | Limit | Fix with one row per part, including culling (2,097,152 on WebGPU, engine.capabilities.maxInstances) and skinning (8 buffers, 32 mesh buffers). Fill the missing fixes.
- generatedSource: packages/engine/src/errors/codes.ts (E1501); packages/engine/src/errors/fixes.ts (E1501)

Verdict: partly

## Evidence

- The page matches the claim. Line 13 is the 138-word cause. Line 17 is the 80-word fix. The fix speaks only to shared meshes and materials, instance batches against the culling limit, and skinned crowds. Nothing in the fix speaks to the upload space, one GPU buffer, the draw list or the shadow atlas.
- The problem is larger than the finding says. The cause lists seven parts, but the code throws E1501 for more of them. `packages/engine/src/errors/core-failure.ts` lines 44-64 (the table of render limits) and 146-172 also give these messages: the texture table is full (10), a texture format, sampler or size the engine does not draw (11), the frame's 32 views are all in use (14), too many rectangle lights show images (16), a light image size that is not valid (20), and a texture larger than the device's texture arrays (9). `scene.ts:5448` says `createView` throws E1501 when all 32 views are in use. The page names none of these parts and gives none of them a fix.
- One part of the claim is weaker than stated. The shadow atlas message carries its own fix ("name a smaller heroTileSize or fewer shadowTiles", core-failure.ts:59-60). The reader sees that fix in the thrown error, but not on this page.
- The proposed edit cannot be made in the named sources as written. `tools/lib/docs.ts:436-458` (`errorPage`) puts the cause into three places: the front-matter `summary` (page line 6), the "What happened" section, and a single cell of the error index table (`errorIndexPage`, docs.ts:463-466, which runs the cause through tableCell). A Markdown table in the cause would break both the YAML summary and the index row. The fix goes into every thrown error message (`engine-error-core.ts:19-22` `messageFor`, which joins the detail and the fix). A table of parts in fixes.ts would put pipe-table text into every runtime E1501 message.
- Other pages already cover some limits and fixes, but this page does not link to them: materials (api/materials.md:863), views (guides/multiple-views.md:114), skinning (api/animation.md:449 and "Limits of skinning"), culling rows (concepts/instances.md:200 and guides/performance.md:163). This weakens the "no fix anywhere" reading but leaves the page-level gap.

## Corrected claim

The cause (138 words, 10 sentences) and the fix (80 words, 6 sentences) are walls of text. The fix covers only the material table, the culling limit and skinning. The cause's list of seven parts is also incomplete. E1501 also names the texture table, unsupported texture formats or sizes, the 32 views, rectangle lights that show images, light image sizes, and textures too large for the device's texture arrays. A message about the upload space, one GPU buffer, the draw list, the texture table, the views or the lights finds no fix on the page. The shadow atlas message carries its own fix, so that part is less serious.

## Corrected edit

- codes.ts E1501 cause: keep it short and plain, because it is also the summary and the index cell. For example: "The scene needs more room than the renderer has. The message names the part that is full, such as the material table, the texture table, the culling pass, the views or the shadow atlas. A frame that fails draws nothing, and the canvas keeps the last whole frame." Remove the per-device numbers from the cause.
- fixes.ts E1501 fix: keep it short, because it goes into every thrown message. Give a general line: share meshes, materials and textures, and size instance batches to the rows they use. Then point to the page for each part's fix.
- For the per-part detail, add an optional page-only field to the error entry, for example `details`, and render it in `errorPage` (tools/lib/docs.ts) after "How to fix it". Leave it out of the summary, the index and the thrown message. Wrap it in a collapsible block:

  <details>
  <summary>Technical details: each full part, its limit and its fix</summary>

  | Full part | Limit | Fix |
  | --- | --- | --- |
  | Material table | 1,024 materials | Create materials once and share them ([Materials](../api/materials.md)) |
  | Culling pass | 2,097,152 rows on WebGPU, more on larger devices; follows the largest texture on WebGL2; `engine.capabilities.maxInstances` | Size each batch for the rows it uses ([Instances](../concepts/instances.md)) |
  | Skinning on WebGPU | 8 GPU buffers, about 1 GiB on most devices; 32 mesh pages | Use fewer vertices or fewer copies ([Limits of skinning](../api/animation.md#limits-of-skinning)) |
  | Views | 32, the camera's included | Destroy views you no longer use ([Multiple views](../guides/multiple-views.md)) |
  | Shadow atlas | 1,024 MB | Use a smaller heroTileSize or fewer shadowTiles ([Shadows](../concepts/shadows.md)) |
  | Texture table, upload space, one GPU buffer, draw list, rectangle lights, light image size | from the engine | Write each fix from the engine's behavior; do not guess |

  </details>

- Each fix row must be checked against the code before it is published. The finding gave no fix for the upload space, one GPU buffer or the draw list, and this check found no fix for them in the docs either.
