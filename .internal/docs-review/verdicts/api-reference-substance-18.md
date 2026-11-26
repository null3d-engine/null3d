# api-reference-substance-18

Finding as given:

- page: api/reference/input
- anchor: input.md:83 `ObjectEventType`
- category: unclear, severity: medium
- claim: "The section on pointer events above says when each one comes." The reference page has no such section; it is on the written api/input.md page.
- evidence: packages/engine/src/scene/pointer-events.ts:37
- proposedEdit: Replace with a link: "[Input](../input.md#pointer-events) says when each one comes." (check the anchor), or state the event order in the comment.
- generatedSource: packages/engine/src/scene/pointer-events.ts

Verdict: survives

Evidence:

- docs/api/reference/input.md:95 prints the sentence word for word. The headings of that page (lines 9, 13, 29, 39, 61, 75, 83, 97) are only export names. No section on pointer events comes above it.
- The sentence comes from the doc comment at packages/engine/src/scene/pointer-events.ts:37-38. It was written for the written page, where "above" made sense.
- The written page docs/api/input.md:108 has "## Pointer events on objects". Its table at lines 124-131 says when each event type comes. So the information exists, but the reference page sends the reader to a place that is not there.
- The reference page header links to ../input.md (line 11), but only in general. A reader at the `ObjectEventType` entry gets a false pointer.
- Doc comments already use relative links to written pages (packages/engine/src/scene/scene.ts:5641), so a link fits the house style.

Corrected edit:

The anchor in the proposal is wrong. The heading "Pointer events on objects" gives the anchor `#pointer-events-on-objects`. Change the doc comment at packages/engine/src/scene/pointer-events.ts:37-38 to:

"The pointer events that objects take, as `object.on` names them. [Pointer events on objects](../input.md#pointer-events-on-objects) says when each one comes."
