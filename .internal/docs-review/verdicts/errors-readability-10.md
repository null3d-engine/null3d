# errors-readability-10

## Finding as given

```json
{
 "page": "errors/* (all 80)",
 "anchor": "## Example",
 "category": "example-placement",
 "severity": "medium",
 "claim": "The sample message comes last, but a reader arrives with a message and wants to confirm that the page fits it first. 'Example' does not say it is a message. The real message is detail + fix + 'See <link>'. 13 examples hold part of the fix, which then shows twice on the page, and the other 67 hold none. Applies to all 80 pages.",
 "evidence": "docs.ts lines 456-459. The E1203 example (codes.ts line 115) ends with the fix's first sentence (fixes.ts line 32). The E1224 example (line 251) repeats the fix almost word for word. Others with fix text: E1111, E1112, E1208, E1209, E1219, E1220, E1221, E1222, E1223, E1225, E1435.",
 "proposedEdit": "Print the sample directly under the H1, after 'The message looks like this (the engine adds the fix and a link to this page after it):'. Strip the fix sentences from the 13 examples, so that each example is the detail part only.",
 "generatedSource": "tools/lib/docs.ts (errorPage); packages/engine/src/errors/codes.ts",
 "id": "errors-readability-10",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The message shape claim holds. `messageFor` in packages/engine/src/errors/engine-error-core.ts:19-22 builds `<code>: <detail> <fix> See <docs URL>`. The page renderer `errorPage` in tools/lib/docs.ts prints What happened, How to fix it, then `## Example` with a bare text block and no note that the engine adds the fix and the link.
- The "13 examples hold part of the fix" claim is mostly wrong. In 12 of the 13, the extra sentence is part of the detail text that the engine itself throws, so the example is faithful to the real message:
  - E1111: packages/engine/src/scene/resources.ts:526 ("Destroy the objects and instance batches that use it first.")
  - E1112: packages/engine/src/scene/scene.ts:2705 ("Give a still texture, such as one that assets.loadTexture loaded.")
  - E1208: packages/engine/src/scene/textures.ts:1215 ("give four per texel")
  - E1209: packages/engine/src/gpu/webgl2/programs.ts:201 ("give the material fewer textures")
  - E1219: packages/engine/src/sketch/ui.ts:392 ("Raise createEngine()'s maxLabels option for more.")
  - E1220: packages/engine/src/scene/render.ts ("Give each pass a texture name of its own.")
  - E1221: packages/engine/src/scene/resources.ts:1085 (detail ends "... grow from level to level.")
  - E1222: packages/engine/src/errors/core-failure.ts:160 ("Make the grid's texture with LightProbeGridData.toTexture().")
  - E1223: packages/engine/src/scene/features.ts:1090 ("One feature provides each lighting slot.")
  - E1224: packages/engine/src/scene/scene.ts:5714 ("It takes a material that draws meshes, from ...")
  - E1225: packages/engine/src/scene/namespaces.ts:238 ("Give each add-on a name of its own.")
  - E1435: packages/engine/src/shared/recording.ts ("Save the recording again, or ask for a new one.")
  Where that detail sentence overlaps the fix (E1224, E1223, E1222), the real message repeats it too. Stripping these sentences would make the example differ from what the engine prints, which defeats the purpose of the example.
- E1203 is the one true case. The throw sites (packages/engine/src/errors/checks.ts:65, packages/engine/src/scene/probes.ts:245-270) end the detail after the value and target. The example (codes.ts:115) adds the fix's first sentence (fixes.ts:32) and then stops. It is neither the detail alone nor the full message.
- Placement: a reader reaches the page from the "See <link>" at the end of their own message, so the page already matches the code (the H1 starts with it). Each real message also differs by call and object, so "confirm the page fits" is weak. Moving the example to the top is a matter of taste with small gain. Medium severity is too high; low fits.
- Labelling: "Example" with a bare text block does not say it is an error message, or that the reader's message will be longer. A one-line intro is cheap and accurate.

## Corrected claim

The Example section does not say that it shows an error message, or that the engine adds the fix and a link to this page after the part shown. One example, E1203 (codes.ts:115), ends with the first sentence of its fix (fixes.ts:32), which the engine's real detail text does not hold, so it matches neither the detail nor the full message. The other 12 examples named are faithful: their extra sentence is part of the detail text that the engine throws. Severity: low.

## Corrected edit

1. In `errorPage` (tools/lib/docs.ts), rename `## Example` to `## Example message` and add one line before the text block: "The engine prints the part below, then the fix above and a link to this page." Keep the section where it is (or move it; either is fine).
2. In packages/engine/src/errors/codes.ts, change the E1203 example to the detail alone: `E1203: setPosition() got NaN for x on "Player" (slot 12).`
3. Leave the other 12 examples unchanged, because they match the engine's real detail text.
