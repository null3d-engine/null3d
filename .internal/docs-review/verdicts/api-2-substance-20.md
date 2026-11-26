# api-2-substance-20

Finding as given:

```json
{
 "page": "api/post",
 "anchor": "## Automatic exposure, 'multiplies the scene's color, bloom's glow and folded effects ... Custom effects and depth of field see the camera's exposure' (line 109)",
 "category": "unclear",
 "severity": "medium",
 "claim": "'Folded effects' is not explained. They are custom effects that the engine joins into the final pass, so the bullet says custom effects get the adapted exposure and then says they get the camera's exposure.",
 "evidence": "docs/api/post.md:109; docs/concepts/post-processing.md:70, 177, 217.",
 "proposedEdit": "'The final pass multiplies the scene's color and bloom's glow by the adapted exposure. A custom effect that runs in a pass of its own, and depth of field, see the camera's exposure. An effect that the engine joins into the final pass takes the adapted exposure with the rest of that pass.' Link the concept page's cost section.",
 "generatedSource": "",
 "id": "api-2-substance-20",
 "slice": "api-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/post.md:109 uses "folded effects" with no explanation. The page does not define the term anywhere. A reader can take the two sentences as a contradiction. That part holds.
- The code shows no real contradiction. crates/null3d-shaders/wgsl/final.wgsl:61-63 says the pass multiplies "the scene's texels, the folded effects' output and bloom's glow" by the meter's texel. At final.wgsl:338-339 a folded effect reads `scene_color` as it is, at the camera's exposure. At final.wgsl:422-423 the multiply by `eye_factor` comes after `effect_chain` returns. So a folded effect also *sees* the camera's exposure. Only its *output* is multiplied.
- An effect in a pass of its own writes the scene color, and the final pass then multiplies that color (final.wgsl:452). Every custom effect's result gets the adapted exposure, folded or not. The page's sentence "Custom effects and depth of field see the camera's exposure" is correct for all custom effects. docs/concepts/post-processing.md:177 says the same.
- The proposed edit is wrong. It says that an effect joined into the final pass "takes the adapted exposure". A reader will take this to mean that such an effect reads adapted color. It does not. The edit also suggests that an effect in its own pass escapes the adapted exposure. It does not.

## Corrected claim

"Folded effects" is jargon that the page does not explain, and the bullet reads like a contradiction. But the behavior is the same for every custom effect. It reads color at the camera's exposure, and the final pass multiplies its result by the adapted exposure.

## Corrected edit

"The final pass multiplies the color it reads by the adapted exposure: the scene's color, with the result of any custom effects, and bloom's glow. It does this before FXAA, the vignette and the tone curve. Custom effects and depth of field read the color at the camera's exposure. This is also true when the engine joins an effect into the final pass. Bloom's `threshold` keeps its meaning in the scene's units."
