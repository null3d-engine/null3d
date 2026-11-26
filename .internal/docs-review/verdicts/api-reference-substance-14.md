# api-reference-substance-14

Finding as given:

```json
{
 "page": "api/reference/math,api/reference/materials,api/reference/objects,api/reference/controls,api/reference/impostors,api/reference/geometry,api/reference/particles",
 "anchor": "impostors.md `LoadedImpostorAtlas` (`Texture`, `OctahedralAtlas`); `Vec3Like` on 17 pages",
 "category": "missing-content",
 "severity": "medium",
 "claim": "Type names in signatures and text are not links. Vec3Like appears on 17 pages but is defined only on math; ColorInput only on materials; Vec3 and Quat only on objects. A reader on the controls page cannot find them.",
 "evidence": "tools/lib/api-docs.ts:486-503 prints signatures in a code block and names as plain code spans; readApi already collects the used type nodes.",
 "proposedEdit": "After all symbols are known, link each inline code span that equals an export name to <page>.md#<anchor>, and add a 'Types:' line under each signature that links the exported types it names.",
 "generatedSource": "tools/lib/api-docs.ts",
 "id": "api-reference-substance-14",
 "slice": "api-reference",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- `Vec3Like` is named on 17 reference pages (grep of docs/api/reference). Its heading exists only in math.md. `ColorInput` has a heading only in materials.md; `Vec3` and `Quat` only in objects.md. `Texture` is defined in textures.md, not impostors.md, and impostors.md lines 278-280 name it with no link. No other docs page explains `Vec3Like` except guides/deterministic-simulation.md, which a reader on controls.md would not know to open. The claim about the pages holds.
- tools/lib/api-docs.ts:486-503 (`renderSymbol`) writes the signature in a ```ts block and each member as a code span in a table cell. It writes no links. Each reference page has exactly one link, the back-link to its guide page (grep for `](`). The claim about the code holds.
- Part that does not hold: "readApi already collects the used type nodes". It does (api-docs.ts:432, `used`), but only to check for unexported types (line 467). The list is thrown away. `ApiSymbol` (line 469) has no field for it, so the edit must add one.
- The proposed edit misses the finding's own example. On controls.md, `Vec3Like` appears only in member-table cells (lines 156, 334, 348), such as `` `target?: Vec3Like` ``. On geometry.md it is the same (lines 66, 131-134), and on impostors.md `Texture` and `OctahedralAtlas` are in member cells of `LoadedImpostorAtlas`. Interfaces and classes print no signature block, so a "Types:" line "under each signature" would not appear for them. The rule "link a code span that equals an export name" also would not fire, because those spans hold the whole member signature, not a bare name.

## Corrected edit

In tools/lib/api-docs.ts, store on each `ApiSymbol` the names of the exported types its signature, bases and members use (resolve the `used` nodes to their exported symbols and drop self-references and built-ins). In `renderSymbol`, after the signature or the member table, write one line such as `Types: [Vec3Like](math.md#vec3like), [Texture](textures.md#texture).` for every symbol that names at least one exported type from any page. Code blocks and code spans cannot hold links, so this line is the only place the links can go. Also link a code span in summary text when it equals an export name exactly. Make the anchor with the same slug rule as the website's heading anchors (headings are `` ## `Name` ``, so the slug is the lower-case name). Use a relative path inside docs/api/reference/. Add a test in tools/lib/api-docs.test.ts that checks an interface whose member names a type from another page.
