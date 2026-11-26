# api-1-readability-26

## Finding as given

```json
{
 "page": "api/controls",
 "anchor": "line 21 (opening); line 281 (gizmo layers)",
 "category": "long-paragraph",
 "severity": "low",
 "claim": "Line 21 (97 words, 6 sentences) lists five kinds of control in prose. Line 281 (119 words, 8 sentences) explains raycast layers that most users never change.",
 "evidence": "stats.json lines 14 and 274.",
 "proposedEdit": "Line 21: a table Controls | Call | Moves like (orbit, map, fly, first-person, gizmos, drag). Line 281: keep two sentences ('The handles draw over the scene and answer the pointer before any scene object. They use layers 30 and 29; give layers and pickLayers another pair when your camera draws those.') and put the rest in <details><summary>Technical details: the gizmo's layers</summary>.",
 "generatedSource": "",
 "id": "api-1-readability-26",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: survives

## Evidence

- The page is hand-written (docs/api/controls.md, not under docs/api/reference), so no generated source is needed. The empty generatedSource field is right.
- stats.json gives the two long paragraphs: body line 14 (97 words, 6 sentences) and body line 274 (119 words, 8 sentences). In the file they are at lines 21 and 281, after the front matter. The counts are facts.
- Line 21 lists orbit, map, fly, first-person and gizmos in prose. It does not name drag controls, but the page has a "Drag controls" section and the front-matter summary names drag. A table with a drag row fixes that gap, so the table does more than polish. The page already uses tables for gestures, options and keys, so a table fits its style.
- Line 281 matches the code. packages/controls/src/transform-controls.ts:104-107 sets the draw layer to 1 << 30 and the pick layer to 1 << 29. Lines 386-388 add the draw layer to the camera, and destroy gives the camera back its layers. A camera draws layer 0 alone by default (packages/engine/src/scene/queries.ts:39, scene.ts:209), so most users never change these options. Moving the detail into a collapsible block is right.
- Severity low is fair. Both paragraphs read clearly. Neither one misleads.

## Corrections to the proposed edit

- The options take a layer mask in the form `setLayers` takes (transform-controls.ts:92-101), not a layer number. "They use layers 30 and 29" can make a reader pass `layers: 28`. Say that they take masks, for example `1 << 28`.
- "When your camera draws those" is vaguer than the page's own condition. Keep the real condition: a camera that draws every layer would show the pick handles.
- Keep the section links ([Fly controls](#fly-controls), [First-person controls](#first-person-controls), [Gizmos](#gizmos)) in the table, and add a link to [Drag controls](#drag-controls). Keep the package's one-line summary as a sentence above the table.

Corrected text for line 281:

> The handles draw over the scene and answer the pointer before any scene object, so a click on a handle never reaches an object behind it. By default they use layers 30 and 29. When a camera draws every layer, set `layers` and `pickLayers` to two other layers, as masks such as `1 << 28`.
>
> <details>
> <summary>Technical details: the gizmo's layers</summary>
>
> (The rest of the current paragraph: the raycast tests the gizmo alone, a click reaches the handle and its parents alone, `layers` joins the camera's layers and leaves at `destroy`, and no camera draws `pickLayers`.)
>
> </details>
