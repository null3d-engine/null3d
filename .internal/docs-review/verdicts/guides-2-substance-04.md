# guides-2-substance-04

## Finding as given

- page: guides/phones, guides/loading-screens
- anchor: phones line 29 "pass it to createEngine with the preset option"; loading-screens "## A change of preset" (lines 221-230)
- category: contradiction
- severity: medium
- claim: The two pages give different answers for a preset that a player picks in a menu. phones says to pass it to createEngine (an engine restart). loading-screens shows quality.setPreset during play with no restart.
- evidence: packages/engine/src/sketch/quality.ts:273 `setPreset(preset: QualityPreset): Promise<void>`; quality.ts:226 (caps a heavier request at the GPU path's highest).
- proposedEdit: phones line 29: "When a player picks one in a menu, call quality.setPreset in the sketch, as [A change of preset](loading-screens.md#a-change-of-preset) shows. Pass the preset option of createEngine to start at a remembered choice."

Verdict: survives

## Evidence

- docs/guides/phones.md:29 says: "When a player picks one in a menu, pass it to `createEngine` with the `preset` option." The page names no other way to change the preset during play.
- docs/guides/loading-screens.md:221-230 ("A change of preset") handles the same case, a player who picks a preset in a menu, with `quality.setPreset` in the sketch, and no new engine.
- docs/api/quality.md:73-85 ("Switching presets") says `setPreset` switches "at a point that the sketch picks, such as a menu". docs/api/quality.md:33 says the `preset` option of `createEngine` names the preset for the start.
- packages/engine/src/sketch/quality.ts: the `setPreset` TSDoc says it switches presets "such as a menu or a loading screen"; `highest` says `setPreset` caps a heavier request at the GPU path's cap.
- packages/engine/src/page/engine.ts:175 `preset?: 'auto' | QualityPreset` is a start option; engine.ts:616 says "`ctx.quality.setPreset` in the sketch changes it later".

So the phones advice is not false (a new engine with the `preset` option does start at that preset), but for a menu choice during play it points to the costly path and hides the API that exists for this case. A reader of the two pages gets two answers. The contradiction holds.

## Corrected edit (small improvement, optional)

The proposed edit is correct. Linking the API section is a little more direct, since it also names `quality.highest` for a menu that greys out presets the device cannot run:

"Do not force a heavier preset on phones. When a player picks one in a menu, switch to it with `quality.setPreset` in the sketch ([Quality API](../api/quality.md#switching-presets)). The GPU path still caps it, and `quality.highest` names the cap. To start at a choice that the page remembers, pass it to `createEngine` with the `preset` option."
