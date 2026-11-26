# api-1-substance-21

Finding as given:

```json
{
 "page": "api/assets",
 "anchor": "## Extensions that add-ons read, example line 138 and table lines 156-169",
 "category": "unclear",
 "severity": "low",
 "claim": "The example names the second argument makers (makers.geometry); the text and table call it context. The type is GltfExtensionContext.",
 "evidence": "docs/api/assets.md:138-140, 156, 168-169; packages/engine/src/scene/assets.ts:170-176, 192-195.",
 "proposedEdit": "Rename makers to context in the example.",
 "generatedSource": "",
 "id": "api-1-substance-21",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: survives

Evidence:

- docs/api/assets.md:138-140. The example writes `load(data, makers)` and calls `makers.geometry.box()` and `makers.materials.unlit(...)`.
- docs/api/assets.md:156. The text says `load` gets `data` and `context`, "which holds the engine's makers".
- docs/api/assets.md:168-169. The table rows are `context.geometry` and `context.materials`.
- packages/engine/src/scene/assets.ts:166-176 and 192-195. The type is `GltfExtensionContext`, and the `load` signature names the parameter `context`.
- The page is hand-written (not under docs/api/reference/), so the fix goes in docs/api/assets.md.

What I tried, to refute it:

- The sentence at line 156 says that `context` holds the engine's makers. This gives a reader a bridge from one name to the other, but the table right after it still uses `context.*`, so the example and the table use different names for one value.
- The page also uses "context" for the sketch context (line 13). Somebody could say that `makers` avoids that clash. But the source signature and the type name both use `context`, so the proposed rename matches the API that a reader sees in the editor.

The issue is real and its cost is small, so low severity is correct. The proposed edit is right. Only the example changes: line 138 becomes `load(data, context) {`, and lines 139-140 become `context.geometry.box()` and `context.materials.unlit(...)`.
