# api-1-substance-22

## Finding as given

- Page: api/assets
- Anchor: ## Extensions that add-ons read, lines 147-154
- Category: missing-content
- Severity: low
- Claim: Line 147 says two handlers cannot read one extension (E1213). That holds for assets.registerGltfExtension only. The module-level registerGltfExtension that lines 149-154 recommend lets a later handler replace the earlier one.
- Evidence: docs/api/assets.md:147-154; docs/api/reference/assets.md:335; packages/engine/src/scene/gltf-extensions.ts:61.
- Proposed edit: After line 147 add: 'The engine's own registerGltfExtension, which an add-on calls as its module loads, replaces an earlier handler for the same extension instead, so a development reload works. Two add-ons that read one extension give it to the one that loaded last.'

Verdict: survives

## Evidence

- docs/api/assets.md:147 says "`registerGltfExtension(handler)` ... Two handlers cannot read one extension. The call throws E1213 for that case". It uses the bare name, with no `assets.` prefix. Line 149 then uses the same bare name for the engine's module-level function. A reader can take the "cannot" rule to cover both.
- packages/engine/src/scene/gltf-extensions.ts:61-68: the module-level `registerGltfExtension` calls `table.set(name, handler)` with no check for a held handler. A later handler replaces the earlier one. Its doc comment (lines 51-54) says so, and that a development reload needs it.
- gltf-extensions.ts:77-89: only `GltfExtensions.register` (the `assets.registerGltfExtension` path) throws E1213 when another handler holds the extension.
- docs/api/assets.md:153-154 covers only sketch-over-add-on precedence. Nothing on the page says what happens when two add-ons read one extension. The reference page says it (docs/api/reference/assets.md:335), but the main page links to the reference only once, generically, at line 400.
- Both functions throw E1213 for a missing extension list or missing `load`, so the rest of line 147 stays true for both.

## Corrected edit

The claim holds. Put the new text in a better place. If you add it after line 147, it names the module-level function before the page explains it at line 149. Instead:

1. On line 147, write `assets.registerGltfExtension(handler)` in place of the bare name, so the "cannot" rule clearly covers the sketch call only.
2. At the end of the add-on paragraph (after line 154), add: "A later add-on handler for the same extension replaces the earlier one, so a development reload of the add-on works. When two add-ons read one extension, the one that loaded last reads it."
