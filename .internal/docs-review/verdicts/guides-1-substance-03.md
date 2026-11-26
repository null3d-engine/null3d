# Verdict for guides-1-substance-03

## The finding as given

- Page: guides/baked-light-data
- Anchor: light map table row `direction` (line 90) and "Each curve of the map's ranges from -1 to 1, then divided by 127" (line 94)
- Category: wrong-claim. Severity: high.
- Claim: The format reference says each stored byte is the axis divided by 127. A bake tool that follows it stores values near 0. The writer must multiply each axis by 127 and round to a signed byte; the reader divides by 127. Line 94 is also garbled.
- Evidence given: packages/engine/src/scene/baked-light.ts:77, :56; the page is the reference for third-party writers (line 21).
- Proposed edit: Row: "Optional. Base64 of three signed bytes per texel: each axis of the unit direction, from -1 to 1, times 127 and rounded. A reader divides each byte by 127." Line 94: "The direction is a unit vector in world space, from the surface toward the light." Fix the TSDoc at baked-light.ts:56 and :77 the same way.

Verdict: survives

## Evidence

- The page's own example proves the bytes are the axis times 127. The `direction` value `AH8AfwAAAAB/gQAA` (page line 81) decodes to bytes 00 7f 00 | 7f 00 00 | 00 00 7f | 81 00 00. As signed bytes these are (0, 127, 0), (127, 0, 0), (0, 0, 127), (-127, 0, 0): unit axes times 127.
- The reader divides by 127. packages/engine/src/scene/assets.ts:697 builds the half-float texture from `byte / 127 / 2 + 0.5`. assets.ts:671 offsets the byte by 127 and clamps it to 0..254 for the 8-bit texture. Both treat the byte as axis times 127.
- The unit test agrees: packages/engine/src/scene/baked-light.test.ts:67 expects [0, 127, 0, 127, 0, 0, 0, 0, 127, -127, 0, 0].
- The page (line 21) says it is the format's reference for bake tools in any language. A writer that reads "each axis divided by 127" literally stores bytes that round to 0. So the wording misleads its main reader. High severity is right.
- Line 94's second sentence ("Each curve of the map's ranges from -1 to 1, then divided by 127") is garbled and repeats the same wrong direction of the scale.
- Nothing else on the page or a linked page corrects it. docs/api/reference/assets.md:179 repeats the same wording, from the TSDoc at baked-light.ts:77.

## Corrections to the finding

- The finding left the generated source empty. The page itself is hand-written, so that is right for the page. But the same wrong wording is also on the generated page docs/api/reference/assets.md:179, whose source is the TSDoc on `LightMapData.direction` at packages/engine/src/scene/baked-light.ts:77 (@category api/assets). The TSDoc at baked-light.ts:56 is on an internal interface and is not published, but it should match.
- The test comment at packages/engine/src/scene/baked-light.test.ts:66 has the same wrong wording. Fix it too so the source stays consistent.

## Corrected edit

- Page line 90, `direction` row: "Optional. Base64 of three signed bytes per texel, from -127 to 127: each axis of the unit direction times 127, rounded. A reader divides each byte by 127."
- Page line 94: "The direction is a unit vector in world space, and it points from the surface toward the light." Keep the sentence about the direction texture as it is.
- baked-light.ts:77 (published as docs/api/reference/assets.md:179): "Three signed bytes per texel, from -127 to 127: each axis of the direction times 127. It runs from the same first texel as the radiance, and it is undefined for a light map without a direction."
- baked-light.ts:56 and baked-light.test.ts:66: "each axis times 127".
