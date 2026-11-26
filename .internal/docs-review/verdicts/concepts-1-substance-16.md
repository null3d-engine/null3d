# concepts-1-substance-16

## Finding as given

- page: concepts/lighting
- anchor: Line 33 vs line 76 (which directional light casts shadows); line 271 vs lines 409-410 (20-step sky refresh); line 37 vs ## Lights in scene passes (line 574)
- category: duplication
- severity: medium
- claim: Three facts each appear twice on the page in different words. Line 33 says 'The first one created that remains casts the shadows'. Line 76 says 'The first one created that remains in the view'. A directional light is not 'in the view', so the reader cannot tell which rule holds.
- evidence: lighting.md:33, :76, :271, :409-410, :37, :574.
- proposedEdit: Keep line 76 as 'The first directional light created that still exists casts the shadows, when it has castShadows'. In step 2 at line 33, write only 'Standard materials reflect up to four directional lights'. Keep the refresh steps at 409-410, and cut line 271 down to its GPU cost. Keep either line 37 or the final section, not both.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

All three overlaps exist. But the code shows the proposed wording for the shadow light is wrong, and two of the proposed cuts would lose facts that appear only once.

1. Shadow light (lines 33 and 76). Both lines state the same rule twice. "remains" in step 2 means "remains after step 1". Step 1 drops a light that is hidden, or whose layers share no bit with the camera's. The code agrees. `LightTable::gather` skips a hidden light or one that shares no layer with the view before it calls `keep_directional` (crates/null3d-core/src/lights.rs:834, :858). The module docs say the same (lights.rs:19-25). So the two lines do not give different rules. "remains in the view" at line 76 is loose wording for the same rule: the light's layers reach the view and it is not hidden. It does not mean frustum culling. The duplication and the vague "in the view" are real. The proposed new text, "the first directional light created that still exists", is **wrong**. A first light that is hidden, or on a layer the camera does not show, does not get the main slot. The next directional light that remains gets it. Line 33 also leaves out the `castShadows` condition, and line 76 states it (scene.ts:2378 says the default is false).

2. Sky refresh (line 271 vs lines 409-410). Both give the 20 steps, one a frame, and "draws with the old map". The duplication holds. But line 271 alone gives the 2% color threshold, the clouds' changes that add up, the final exact capture, and the 1 ms cost per step. Line 410 gives only "a smaller turn waits". If line 271 is cut "down to its GPU cost", the color and cloud thresholds are lost. Those facts must move to the Sky section first.

3. Scene passes (line 37 vs line 574). They overlap on one sentence only: the pass lists the point, spot and area lights its camera sees. Line 37 alone says the pass culls and clusters again with a light grid of its own, and that its point and spot lights cast shadows. Line 574 alone gives the sun, ambient, hemisphere, environment, fog, sun cascades, background and `clearColor`. "Keep one, not both" would delete facts that are correct and useful.

Severity: medium is fair for item 1, because of the vague wording. Items 2 and 3 are closer to low.

## Corrected claim

The page states three facts twice. Lines 33 and 76 give the same shadow-light rule in two forms. Line 76's "remains in the view" is vague, and line 33 leaves out the `castShadows` condition. Lines 271 and 409-410 both describe the 20-step sky refresh. Lines 37 and 574 both say that a scene pass lists the point, spot and area lights its camera sees. Each pair also holds facts that appear in only one of the two places.

## Corrected edit

- Line 76: "Up to four directional lights light a frame. The first one created that is not hidden and shares a layer with the camera casts the shadows, when it has `castShadows`. The next three ..." (keep the rest).
- Line 33 (step 2): "Standard materials reflect up to four of the remaining directional lights, as [Kinds of light and their units](#kinds-of-light-and-their-units) explains, plus the sum of the ambient and hemisphere lights and the scene's environment."
- Line 271: keep the first-build cost (14 ms) and the per-step cost (about 1 ms). Replace the refresh description with a link to the sky section, for example "After a change of the sky, it makes the map again over 20 frames, as [the sky's environment](#...) explains." Move the 2% color threshold and the clouds' changes that add up into the bullet at line 410, beside "A smaller turn waits".
- Line 37: shorten to "A scene pass does steps 3 and 4 again for its own camera and layers, with a light grid of its own. [Lights in scene passes](#lights-in-scene-passes) says what it lights." Move "its point and spot lights cast shadows where the camera's view gives them shadows" into the section at line 574. Keep that section.
