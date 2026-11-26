# api-1-substance-17

Finding as given:

```json
{
 "page": "api/cameras",
 "anchor": "## Several cameras (line 147)",
 "category": "contradiction",
 "severity": "medium",
 "claim": "'The canvas shows the scene from one camera at a time.' Four lines earlier, scene.createView draws several cameras into rectangles of one canvas.",
 "evidence": "docs/api/cameras.md:143, 147; examples/demos.ts multiple-views ('One scene drawn from two cameras in the same frame').",
 "proposedEdit": "'The active camera fills the canvas. scene.createView draws more cameras into rectangles of it (Multiple views). Until you pick an active camera, ...'",
 "generatedSource": "",
 "id": "api-1-substance-17",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: survives

Evidence:

- docs/api/cameras.md:143 says a view from `scene.createView` draws its camera into a rectangle of the canvas. docs/api/cameras.md:147 then says "The canvas shows the scene from one camera at a time." With a view, the canvas shows two or more cameras in one frame, so the sentence is false as written.
- The engine's own doc comment agrees with line 143, not 147: packages/engine/src/scene/scene.ts:336-341 (`SceneView`) says the active camera draws the whole canvas first and the view's image covers its rectangle.
- docs/guides/multiple-views.md:11 and :38-48 say the same: the camera's view draws the whole canvas, and each view covers its rectangle after it, in the same frame.
- examples/demos.ts:472-478 (multiple-views): "One scene drawn from two cameras in the same frame".
- The Related pages list (cameras.md:153-154) mentions `scene.createView`, but it does not correct the false sentence. A reader who reads the section alone gets a wrong rule.
- The proposed edit matches the source and keeps the existing, unchanged claim about the background. It breaks no writing rule and needs no generated source (cameras.md is hand-written).

Note on severity: line 143 sits just above and states the correct behavior, so the harm is limited. Medium or low are both defensible; the issue itself holds.

Edit (as proposed, with the link written out):

"A scene can have several cameras, and `setActiveCamera` switches between them. The active camera fills the canvas. `scene.createView` draws more cameras into rectangles of it ([Multiple views](../guides/multiple-views.md)). Until you pick an active camera, and after the engine removes it, the canvas shows only the background."
