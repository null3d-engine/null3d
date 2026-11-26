# api-3-substance-27

## Finding as given

- page: api/scene
- anchor: line 177 "It draws them only when the page starts with `cloudSteps` above 0"; line 298 "a page that asks for less waits for none of it. A layer of 0 stands still"
- category: unclear, severity: low
- claim: Line 177 does not say which tier a WebGL2 page gets, and "above 0" does not match the table, which shows "flat layer" for Low and Medium. Line 298's second sentence cannot be parsed, and "a layer of 0" means refresh: 0.
- evidence: docs/concepts/quality-preset-tables.md:82 (cloudSteps: flat layer, flat layer, 32, 48).
- proposedEdit: 177: "WebGL2 and compatibility mode use the flat layer on every preset. To draw volumetric clouds there, set quality.set({ cloudSteps: 32 }). The environment map shows volumetric clouds only when the page starts with them, at up to 16 steps." 298: "A fill takes about twenty frames, one stage a frame. `refresh` sets how often a moving layer is captured again; give `refresh: 0` for a layer that stands still."

Verdict: partly

## Evidence

- docs/api/scene.md:177 says "Low and Medium draw the flat layer" and "WebGL2 and compatibility mode stop at Medium". So the WebGL2 tier is stated, in two steps. The first part of the claim is wrong. But "draws the tier" is vague (which tier?), so a plain sentence still helps.
- The value mismatch is real. packages/engine/src/quality/presets.ts:353-356 sets cloudSteps to [0, 0, 32, 48]. packages/engine/src/quality/preset-docs.ts:146-149 prints 0 as "flat layer". The scene page never says that 0 means the flat layer, so "above 0" does not connect to the table's "flat layer".
- The environment map rule is correct: packages/engine/src/render/draw.ts:77 picks the cloud shaders from the start-time cloudSteps.
- docs/api/scene.md:298: "a page that asks for less waits for none of it" cannot be parsed. "A layer of 0" is loose, but the table at docs/api/scene.md:281 already says "Give 0 for a layer that stands still" for `refresh`. The default of 1 second is at packages/engine/src/scene/background.ts:443.
- The proposed edit loses useful facts. At 177 it drops the `cloudSteps` option of `createEngine`. That option is the only way a WebGL2 page gets clouds in the environment map, because the map picks its shaders at the start; `quality.set` alone gives none there. At 298 it drops "a shorter time follows a faster layer", the default rate of about 20 stage draws a second, and "costs one fill per change".

## Corrected claim

Line 177 does say, in two steps, that WebGL2 gets the flat layer. But it never says that `cloudSteps` of 0 is the flat layer, so "above 0" does not match the table's "flat layer". Line 298 has a clause that cannot be parsed, and "a layer of 0" should name `refresh: 0`.

## Corrected edit

177: replace "WebGL2 and compatibility mode stop at Medium, so a page there draws the tier with `quality.set({ cloudSteps })` or the `cloudSteps` option of `createEngine`." with "A `cloudSteps` of 0 draws the flat layer. WebGL2 and compatibility mode stop at Medium, so they draw the flat layer unless the page sets `cloudSteps` above 0, with `quality.set({ cloudSteps: 32 })` or the `cloudSteps` option of `createEngine`." At the end of the paragraph, after "because the map picks the tier's shaders at the page's start", add: "To show clouds in reflections on WebGL2, give the `cloudSteps` option of `createEngine`."

298: replace the first three sentences with "A fill spreads over some twenty frames, one stage a frame. A layer that its clock moves sets `refresh`, in seconds, to tell the map how often to capture it again. The map starts one fill each `refresh` seconds, so a shorter time follows a faster layer. At the default of one second, that is about 20 stage draws a second. A layer with `refresh: 0` stands still and costs one fill for each change." Keep the rest of the paragraph.
