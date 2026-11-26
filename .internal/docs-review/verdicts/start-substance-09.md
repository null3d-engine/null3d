# start-substance-09

## Finding as given

- page: getting-started/network-use
- anchor: "## What your own code downloads, line 42 \"`preload` downloads the features that you list, when you call it.\""
- category: unclear
- severity: medium
- claim: There are two preloads. createEngine's preload option takes feature names and is not a call. assets.preload takes file addresses. The bullet mixes them, and the list of calls that download your addresses leaves out assets.preload.
- evidence: packages/engine/src/scene/assets.ts:777 (preload(urls)); packages/engine/src/page/engine.ts:459-475 (the preload option takes feature names); cookbook/index.md:284 uses assets.preload.
- proposedEdit: Add `assets.preload` to the first bullet's list of calls. Replace line 42 with "`createEngine`'s `preload` option downloads the shaders of the features that it lists, before the first frame. These are engine files, from the engine's own address."

Verdict: survives

## Evidence

- docs/getting-started/network-use.md:42 says "`preload` downloads the features that you list, when you call it." No public function takes a list of features and is called by the user. The only feature list is the `preload` option of `createEngine` (packages/engine/src/page/engine.ts:460-476, `preload?: readonly ShaderFeature[]`), which is an option, not a call. Its shaders load "before the first frame".
- `assets.preload(urls)` (packages/engine/src/scene/assets.ts:777) is the user-called preload. It takes file addresses. Line 40 of the page lists the `assets.load*` calls but not `assets.preload`. The cookbook (docs/cookbook/index.md:284), guides/loading-screens.md, guides/start-time.md and api/assets.md all use or describe `assets.preload`, so a reader meets it and does not find it in the network page's list.
- Other `preload` methods found (gpu/device-shaders.ts:124, shared/images.ts:261) are internal, not public API.
- A reader who reads line 42 can think features download from their own code, or look for a `preload()` function that takes feature names. Medium is right.

## Better placement for the second half of the edit

The proposed text is correct, but it says "These are engine files" inside the section about what your own code downloads. That is a contradiction of the section's heading. Put the sentence in "What the engine downloads" instead:

- Line 40: "`assets.loadTexture`, `assets.loadGltf`, `assets.loadBinary`, `assets.loadJson`, `assets.loadImageBitmap` and `assets.preload` download the addresses that you pass."
- Delete line 42.
- After line 28, add: "The `preload` option of `createEngine` moves a feature's shader download to before the first frame, for a game that must fetch nothing while it plays."
