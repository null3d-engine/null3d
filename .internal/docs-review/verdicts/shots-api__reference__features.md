# Verdicts: api/reference/features (screenshots and demo links)

## Shots

None proposed. Nothing to check.

## Demo links

### defineFeature with a sky layer -> aurora/ (under "## `defineFeature`"): KEEP

- The aurora demo exists in examples/demos.ts. It has no `code` value, so `aurora/` (its name) is the right code.
- The demo really shows the concept, but one step away. The sketch (examples/aurora/sketch.ts) does not call `defineFeature` itself. It imports `createAurora` from examples/addons/aurora/index.ts, and that file calls `defineFeature({ frame: 'background', kind: 'draw', provides: ['sky'], ... })`.
- Fix for the link text: tell the reader that the feature description lives in the add-on file that the demo imports (examples/addons/aurora/index.ts). Otherwise a reader who opens examples/aurora/ finds no `defineFeature` call.
- Source to edit: this page is generated from the TSDoc comment on `defineFeature` in packages/engine/src/scene/features.ts (tag @category api/features), so the link goes in that comment or in the generator, not in docs/.

## Concepts said to have no demo

### declareAddonNamespace: CONFIRMED, no demo

- No file under examples/ calls `declareAddonNamespace`. The example add-ons in examples/addons/ do not claim a namespace.
- Only the wind and sound packages call it (packages/wind/src/namespace.ts, packages/sound/src/namespace.ts). The vegetation-wind/ and sound/ demos load those packages, but the call is inside the package, not in the demo code, so a reader cannot see it there.

### "draw, effect and instance feature kinds": NOT CONFIRMED, and the concept is misnamed

- The engine has no 'effect' or 'instance' kind. `FeatureKind` is `'draw' | 'compute' | 'fullscreen'` (see the page's `FeatureKind` section). The proposal must use the real names.
- The 'draw' kind has a demo: aurora/ (its add-on, examples/addons/aurora/index.ts, declares `kind: 'draw'` at the 'background' frame point).
- 'compute' has no demo in readable demo code. The ocean/, vegetation-wind/ and grass-using demos run compute features, but the `defineFeature` calls are inside packages/water, packages/wind and packages/grass, not in the demos.
- 'fullscreen' has no user anywhere in the packages or examples.
