# errors-readability-29

## Finding as given

- page: errors/E1209
- anchor: page line 13: 'A material whose shader reads more textures than a WebGL2 shader stage has units.'
- category: unclear
- severity: low
- claim: The first sentence has no main verb, and it is also the summary and the index cell. The fix repeats the cause's 16-unit explanation in a 37-word sentence.
- evidence: codes.ts line 157; fixes.ts line 44.
- proposedEdit: Cause: 'A material's shader reads more textures than a WebGL2 shader stage has units. WebGL2 gives each stage at least 16, and the engine's lit shader uses most of them.' Fix: 'Give the material fewer textures of its own. Use the standard material's maps where they draw the effect.'
- generatedSource: packages/engine/src/errors/codes.ts (E1209); packages/engine/src/errors/fixes.ts (E1209)

Verdict: partly

## Evidence

- packages/engine/src/errors/codes.ts:157 starts the cause with "A material whose shader reads more textures than a WebGL2 shader stage has units." That is a noun phrase with no main verb. The claim holds.
- tools/lib/docs.ts:442 and :466 put the whole cause into the page summary and the errors index cell. docs/errors/index.md:33 and docs/pages.md:175 show the fragment as the first words of the cell. The claim holds.
- packages/engine/src/errors/fixes.ts:44 repeats "WebGL2 gives each shader stage at least 16 texture units, as many as the device reports, and the engine's lit shader reads most of them". The cause says the same at codes.ts:157. The page shows both, at lines 13 and 17. The claim holds.
- The proposed cause drops two true facts:
  - "or add-on draw". The check in packages/engine/src/gpu/webgl2/programs.ts:192-203 runs on every WebGL2 program in prepareProgram (programs.ts:652-654), not only on materials. A reader who hits the error from an add-on draw would no longer see their case named.
  - "as many as the device reports". programs.ts:178-183 reads the real limit from the device, so 16 is only the floor. The example message (codes.ts:159) prints the device's number.
- The proposed fix is fine. The cause still carries the reason, so the fix does not need to repeat it.
- Related detail already lives in docs/concepts/lighting.md:275 and docs/shaders/surface-functions.md:283, so the cause can stay short. No collapsible block is needed.

## Corrected claim

The first sentence of the cause is a fragment, and the summary and both index tables show it. The fix repeats the cause's unit explanation. The proposed cause, though, drops add-on draws and the fact that the limit comes from the device.

## Corrected edit

codes.ts E1209 cause: "A material's shader, or an add-on draw, reads more textures than a WebGL2 shader stage has units. WebGL2 gives each stage at least 16 units, and the device can report more. The engine's lit shader uses most of them for its maps and shadows, so a custom material's own textures can pass the limit."

fixes.ts E1209: "Give the material fewer textures of its own. Use the standard material's maps where they draw the effect."
