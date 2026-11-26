# concepts-2-readability-21

## Finding as given

- page: concepts/shadows
- anchor: ### A fixed distance and a camera that zooms (lines 159-185)
- category: structure
- severity: medium
- claim: After the zoom example, line 183 (a new cascade count or map size remakes the map) and line 185 (the shadow options of spot and point lights) are general settings facts. The outline files them under the zoom case, so a reader who looks for spot light settings will not find them.
- evidence: Line 183 'A new cascade count or map size makes the shadow map again, so set them at setup.' Line 185 'The shadow option and setShadow of spot and point lights take bias, normalBias and intensity alone'.
- proposedEdit: Move 183 to directly after the settings table (after line 153). Move 185 into 'Spot and point light shadows', or into a new H3 'Spot and point light settings' under Settings.

Verdict: survives

## Evidence

- docs/concepts/shadows.md:159 opens the H3 "A fixed distance and a camera that zooms". Lines 161-181 are about the zoom case and its code. Line 183 (when a cascade count or map size change remakes the map) and line 185 (which options spot and point lights take) have nothing to do with zooming, yet the outline puts them under that H3.
- The "Spot and point light shadows" section (lines 62-135) never says which shadow options spot and point lights take, and it never names `setShadow`. Line 185 is the only place on the page that says so. The "Bias" section (line 293) covers only how their biases are capped, not which options exist. So a reader who scans the outline for spot or point light settings does not find them.
- The claim matches the code: `LightShadowOptions` in packages/engine/src/scene/scene.ts:781-800 holds only `bias` (default 0.01), `normalBias` (default 0.02) and `intensity` (default 1). Moving the text keeps it correct.
- No writing rule or website rule stops the move.

## Refinement of the edit

- Line 183: add it to the end of the paragraph at line 153. That paragraph already talks about the cascade count and map size, so the sentence fits there.
- Line 185: it says "with the same defaults", and that phrase points back to the settings table at lines 141-151. The "Spot and point light shadows" section comes before the table, so if the line moves there, give the defaults outright (0.01, 0.02, 1) and link to #settings. The simpler fix is to keep it under "## Settings" as a short paragraph after line 153, before the H3. It can then keep its present wording, and no new H3 is needed. A new H3 for one short paragraph is optional.
