# Verdict for api-3-readability-23

## The finding as given

```json
{
 "page": "api/water",
 "anchor": "## The water object, update() row, line 224",
 "category": "unclear",
 "severity": "medium",
 "claim": "The row says update() 'Keeps the sketch's frame loop. The reflection pass carries its own cadence now, so the call changes nothing'. 'Now' reads as a change note, and every example calls it each frame, so the reader cannot tell whether to call it.",
 "evidence": "line 224; calls at lines 74, 179, 324; 'now' also in reflectionEvery rows at lines 226 and 427.",
 "proposedEdit": "'update() | Does no work. The reflection keeps its own cadence. Calling it once a frame is harmless.' (or state its real purpose). Change the reflectionEvery rows to 'The frames between two draws of the reflection, as the preset and the governor set it.'",
 "generatedSource": "",
 "id": "api-3-readability-23",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The row at docs/api/water.md:224 says what the finding quotes. The examples call `water.update()` every frame (lines 74, 179, 324).
- The row is not only unclear. It is false. `update()` in packages/water/src/water.ts:585-603 does real work in each frame:
  - With a wind field, it sets the wind layer uniform and uploads a gust that the page sent (lines 587-596).
  - It reads the lowest quality tier and sets the reflection to every 16th frame at rest (`cadence.lowest`, line 600).
  - It follows the camera (`cadence.follow`, line 601). While the camera moves or turns, the reflection draws in every frame (packages/water/src/cadence.ts:59-60, 84-87). The test packages/water/src/cadence.test.ts:257-299 checks this through `water.update()` calls.
  - It draws the water-bounds debug view when that view is on (lines 603-606).
- The page itself contradicts the row. Line 38 says the reflection redraws "while the camera that `update()` follows moves or turns". Line 141 (the `camera` option) says the reflection draws in every frame while the camera moves. Line 179 calls `update()` after `wind.update()` so the water reads the wind.
- So the proposed main edit, "Does no work ... Calling it once a frame is harmless", is wrong. A reader who skips the call loses the camera-follow reflection, the lowest-tier cadence, gusts from the wind field, and the debug view. The finding's fallback, "state its real purpose", is the right fix. The severity should be high, because the row misleads.
- The same false text is in the TSDoc at packages/water/src/water.ts:214-217. It generates docs/api/reference/water.md:272. Both need the fix.
- `reflectionEvery` rows (lines 226, 427): here "now" means "the current value" of a live getter, not a change note. But it reads ambiguously, and the proposed wording is accurate. The getter returns the value that the preset and the governor set (water.ts:544, 582-583). It does not include the camera-follow or lowest-tier override. So that part of the edit holds, at low cost. The same text is in the TSDoc at water.ts:212 and in ocean.ts:121, which feed the reference page.

## Corrected claim

The update() row on api/water (line 224) is false, not only unclear. It says the call changes nothing. In fact update() follows the camera so the reflection draws every frame while the view moves, applies the lowest tier's reflection cadence, passes wind gusts and the wind layer to the surface, and draws the bounds debug view. The page's own lines 38 and 141 depend on it. Severity: high. The same text is in the TSDoc of `Water.update` in packages/water/src/water.ts, which generates docs/api/reference/water.md:272. The "now" in the reflectionEvery rows is ambiguous, and the proposed rewording is fine.

## Corrected edit

docs/api/water.md:224:

| `update()` | Call it once in each frame. It follows the camera, so the reflection draws in every frame while the view moves or turns. It applies the lowest quality tier's reflection cadence, and passes the wind field's gusts to the surface. Call it after the wind's `update()` |

TSDoc of `Water.update` in packages/water/src/water.ts:214-217 (source of docs/api/reference/water.md:272): "Call once in each frame, after the wind's field steps. It follows the camera, so the reflection draws in every frame while the view moves or turns, applies the lowest quality tier's reflection cadence, and passes the wind field's gusts to the surface."

reflectionEvery rows (docs/api/water.md:226 and 427, and the TSDoc at water.ts:212 and ocean.ts:121): "The frames between two draws of the reflection, as the preset and the governor set it. A moving camera draws in every frame, whatever this says."
