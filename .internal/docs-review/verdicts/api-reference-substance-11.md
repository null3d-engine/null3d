# api-reference-substance-11

## Finding as given

- Page: api/reference/impostors, api/reference/grass, api/reference/engine, api/reference/geometry
- Anchor: impostors.md `loadImpostorAtlas`, `handOverToCards`, `bakeImpostorAtlas`; grass.md `createGrass`, `hashAt`; engine.md `checkAddonVersion`; geometry.md `levelAt`
- Category: missing-content. Severity: medium.
- Claim: @param, @returns and @throws text is dropped. 13 public exports describe their parameters, results or errors only in tags, so levelAt's scale, radius and distance, and loadImpostorAtlas's throw condition, appear nowhere.
- Evidence given: tools/lib/api-docs.ts:99 knows the tags but summaryOf (:120-124) reads only the documentation comment.
- Proposed edit: render the tags under the summary (Parameters table, Returns line, Throws line), or make the docs check refuse @param on public exports. Pick one rule for all 13.
- Generated source: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The mechanism holds. tools/lib/api-docs.ts:99 lists `param` and `returns` in DOC_TAGS only so that `misreadTags` (:106-118) stops at them. `summaryOf` (:120-124) renders `getDocumentationComment` plus misread text. The only `tag()` call (:89, used at :427) reads `category`. Nothing renders @param, @returns or @throws.
- The count holds. A scan of packages/*/src for comments that carry both `@category api/` and a @param, @returns or @throws tag finds exactly 13 exports: loadImpostorAtlas (impostors/src/load.ts), handOverToCards (hand-over.ts), bakeImpostorAtlas (bake.ts), swayDistanceFor (grass/src/sway.ts), createGrass (grass.ts), pcg, hashAt, unitAt (hash.ts), checkAddonVersion, checkPluginInterface (engine/src/shared/version.ts), levelSwitchDistance, levelDistances, levelAt (engine/src/scene/level-rule.ts).
- levelAt holds. docs/api/reference/geometry.md:344-350 shows only the signature and the summary. The facts that `scale` is the largest axis scale of the world matrix, that `radius` is the world bounds' radius in meters, and what the two forms of `distance` mean appear in no docs page (no other page names levelAt, levelDistances or levelSwitchDistance). The same holds for levelDistances ("centre relative to the camera", "in meters").
- loadImpostorAtlas's throw condition is wrong as an example. docs/api/impostors.md:127 says: "The loader throws when the JSON file is not an impostor atlas file. It also throws for a version of the format that the package does not read. Bake the model again with the command of the same version." The reference page links to that guide page by area, so the fact is on the site.
- Most of the 13 lose little. hashAt, unitAt and pcg tags say "The seed.", "The first key.", "The value to hash."; createGrass says "The sketch's context."; bakeImpostorAtlas and loadImpostorAtlas @returns repeat the summary or the result type. checkAddonVersion's summary at engine.md:38 already says what name and version are. The real loss is in the level-rule functions (units and frames of reference), handOverToCards `start` (what 0 means), and swayDistanceFor's link to PLANT_SWAY_DISTANCE.

## Corrected claim

The reference generator drops @param, @returns and @throws text for all 13 public exports that use them. For most, the tags only repeat the signature or summary. The loss that matters is the level-rule functions on geometry.md (levelAt, levelSwitchDistance, levelDistances: what scale and radius measure, that distances are in meters, that the bounds' centre is relative to the camera) and handOverToCards `start` on impostors.md. loadImpostorAtlas's throw condition is not lost: docs/api/impostors.md:127 states it. Severity medium for geometry.md; low elsewhere.

## Corrected edit

In tools/lib/api-docs.ts, render @param, @returns and @throws for a function under its summary, inside a collapsible block so the main text stays short:

<details>
<summary>Technical details: parameters and result</summary>

| Parameter | Description |
| --- | --- |
| `scale` | The largest axis scale of the source's world matrix. |

Returns: ...

Throws: ...

</details>

Render a parameter row only when its text adds to the name and type. Before that, delete the tags that only restate the name (hashAt, unitAt, pcg, createGrass `ctx`, both @returns of the impostor loaders), so the block does not pad pages with "The seed." Add `throws` to DOC_TAGS so a comment that starts its tags with @throws is not misread as summary text.
