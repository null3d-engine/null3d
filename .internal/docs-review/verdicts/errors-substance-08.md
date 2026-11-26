# errors-substance-08

## Finding as given

- page: errors/E1209
- anchor: "A material whose shader reads more textures than a WebGL2 shader stage has units."
- category: unclear, severity: medium
- claim: The cause opens with a sentence that has no main verb. Cause and fix repeat the same 16-units sentence. 'The lit shader reads most of them' is vague. Other pages give exact numbers and say that WebGPU has no such limit. This page gives neither.
- evidence: docs/concepts/lighting.md:275 says lighting uses up to 13 units with 3 free, and 'WebGPU has no such limit.' docs/shaders/surface-functions.md:283 says lighting takes 7 units, a material's maps take 6, and 3 stay free. gpu/webgl2/programs.ts:186-203 shows the check runs on WebGL2 only.
- proposedEdit: Cause: 'On WebGL2, a material's shader reads more textures than one shader stage has units. The engine refuses it before the device fails to link the shader.' Fix: 'Give the material fewer textures. On a device with 16 units, the lighting takes 7 and the material's maps share 6, so a custom material has 3 of its own. WebGPU has no such limit.' Link concepts/lighting.
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts

Verdict: partly

## Evidence

- The problem holds. docs/errors/E1209.md (and codes.ts:157) opens "A material whose shader reads more textures than a WebGL2 shader stage has units." The subject has no main verb. The second sentence of the cause and the second sentence of the fix (fixes.ts:44) both say "WebGL2 gives ... at least 16 units, as many as the device reports" and "the lit shader reads most of them". The page gives no count and does not say that WebGPU is not affected.
- The other pages do give numbers. concepts/lighting.md:275 says the standard material uses at most 13 of 16 units, a material's maps share six, three stay free, and "WebGPU has no such limit". shaders/surface-functions.md:283 says the lighting takes 7, a custom material samples up to 6 textures, and "a lit material with all 6 textures thus leaves 3 units free on a device with 16".
- The check is WebGL2 only. checkStageUnits in gpu/webgl2/programs.ts:191-203 is in the WebGL2 backend. stageTextureUnits caps the device's count at the upload unit (31), so the limit is the device's own count up to 31.
- The proposed fix text is wrong. It says "the material's maps share 6, so a custom material has 3 of its own", which reads as 7 + 6 + 3. A custom material's own textures ARE the six map units, not three extra ones. tests/pages/sketches/unit-limit-sketch.ts makes a custom material with six textures of its own, and tests/image/program-units.spec.ts:20-21 counts "six of the engine's lighting, six of its own" = 12 units. The three free units stay free, and a custom material cannot declare more than six textures (surface-functions.md:283). So on a device with 16 units a lit custom material alone does not reach the limit. E1209 fires on a device that reports fewer units (the test makes its context report 10), or for an add-on draw with its own textures.
- The proposed cause also drops "add-on draw", which is a real trigger the current text names.
- "Link concepts/lighting": no cause or fix string in codes.ts or fixes.ts holds a Markdown link (zero matches for "]("). These strings also go into the runtime error text. A link needs a change to the error page renderer in tools/lib/docs.ts, or plain text such as "The Lighting page lists the units that the lighting takes."

## Corrected claim

The cause's first sentence has no main verb, and the cause and the fix repeat the same 16-units sentence. "The lit shader reads most of them" is vague. The page gives no count and does not say that WebGPU is not affected, but concepts/lighting.md and shaders/surface-functions.md give both.

## Corrected edit

Cause (codes.ts): "On WebGL2, a program's shader stage reads more textures than the device gives that stage. Each stage has at least 16 texture units. The engine counts the units first and throws this error, so the device does not fail to link the shader. A custom material or an add-on draw can reach the limit with its own textures, which add to the units of the lighting and the shadows. WebGPU has no such limit."

Fix (fixes.ts): "Give the material or the draw fewer textures. On a device with 16 units, the lighting takes up to 7 and a material's maps share 6, so 3 stay free. A custom material's own textures use those 6 map units. Use the standard material's own maps where they draw the effect. The Lighting page lists the units that the lighting takes."

Put no Markdown link in these strings unless the error page renderer in tools/lib/docs.ts is changed to add a related-pages line.
