# api-3-substance-16

## Finding as given

```json
{
 "page": "api/render",
 "anchor": "## Compute passes, option row line 292 \"The feature description that places the pass\"; lines 338-340 frame points",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "The compute example needs defineFeature, which the page neither explains nor links. Lines 338-340 use the frame points 'background', 'opaque', 'transparent', 'resolve' and 'post' without saying what each means.",
 "evidence": "docs/api/render.md:271-282, 292, 338-340; docs/api/features.md holds feature descriptions (api/scene:252 links it).",
 "proposedEdit": "Row: \"A [feature description](features.md) from `defineFeature`. Its `frame` sets where the pass runs in the frame, and its one output names the texture.\" Link \"frame point\" at line 340 to the frame points section of features.md.",
 "generatedSource": "",
 "id": "api-3-substance-16",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- docs/api/render.md has no link to features.md anywhere. A search for "features.md" and "](features" finds nothing. The Related pages list (lines 486-495) does not name it either. The only feature link is feature-instances.md at line 324.
- `defineFeature` appears only in code: the import at line 230, the example at 274 and the history example at 367. The prose never says what it is or where it is documented.
- Line 292 ("The feature description that places the pass") uses the term with no link.
- Lines 338-340 name five frame points. Line 338 says 'background' and 'opaque' run before the camera's passes, and line 339 says 'resolve' and 'post' draw after the scene. These lines give the order only. 'transparent' gets no meaning at all, and the page never says these are values of the description's `frame` field.
- docs/api/features.md:68-71 defines the `frame` field, and features.md:93-104 has a "Frame points" table with each point, what runs there, and the kinds it takes. So the target of the proposed links exists and answers the question.
- api/scene.md:252 already links "feature description" to features.md, so the proposed link follows the pattern other pages use.
- The proposed edit breaks no writing rule. It is a link and a short sentence, not a heading or a block.

Small caveat: the page explains the ordering of some frame points in part, so the second sentence of the claim is slightly overstated. But the reader still cannot learn what the points are, or see the full list, without leaving the page unaided. The cost to a reader is real.

## Corrected edit

The proposed edit is correct. One refinement: a pass with `buffers` publishes no output (line 324), so the row can say so.

Row 292: "A [feature description](features.md) from `defineFeature`. Its `frame` sets the [frame point](features.md#frame-points) where the pass runs. Its one output names the texture that the pass writes. A pass with `buffers` publishes none."

Line 340: link "frame point" to `features.md#frame-points`.
