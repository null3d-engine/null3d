# api-2-substance-30

Finding as given:

```json
{
 "page": "api/post",
 "anchor": "## Still views (line 466) against ## Sharpening (line 414)",
 "category": "contradiction",
 "severity": "low",
 "claim": "Still views says bloom, outlines and automatic exposure keep a view drawing every frame. The sharpening section says sharpening does too.",
 "evidence": "docs/api/post.md:414, 466.",
 "proposedEdit": "'Bloom, outlines, automatic exposure and sharpening keep a view drawing every frame.'",
 "generatedSource": "",
 "id": "api-2-substance-30",
 "slice": "api-2",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- docs/api/post.md:414 (Sharpening) says a still view keeps drawing while sharpening is on.
- docs/api/post.md:466 (Still views) lists only bloom, outlines and automatic exposure as the settings that keep a view drawing. A reader who reads only this section, which is the one about still views, misses sharpening.
- The code agrees with line 414. crates/null3d-render/src/frame_graph.rs:4696-4709 (`still_eligible`) needs `self.sharpen.is_none()`. crates/null3d-render/src/still.rs:7-9 says a view that sharpens never blends.
- The same function also rules out custom effects that fold into the final pass (`self.folded.is_none()`), volumetric fog and screen-space reflections. Custom effects and screen-space reflections are set on this same page, so the list at line 466 misses them too. docs/concepts/post-processing.md:398 already names custom effects and sharpening (it does not name screen-space reflections).
- The page is hand-written, so no generated source applies.

## Corrected edit

The proposed edit fixes sharpening but leaves the list short. Name every setting from this page that stops the blend, and point to the full list:

"Bloom, outlines, automatic exposure, screen-space reflections, sharpening and custom effects keep a view drawing every frame. [The post-processing chain](../concepts/post-processing.md#still-camera-accumulation) lists every feature that does."
