# guides-2-substance-26

## Finding as given

- page: guides/multiple-views
- anchor: intro line 13 'Two kinds of work are different:'; no demo link
- category: missing-content
- severity: low
- claim: The multiple-views demo shows exactly this page (a split screen, and a picture in picture after the V key), but the page does not link it. 'Two kinds of work are different' does not say why the list follows.
- evidence: examples/demos.ts:472-480 (multiple-views summary, controls V 'Split view or inset'); stats.json guides/multiple-views exampleLinks: [].
- proposedEdit: Replace the sentence with 'A view is not a render pass:'. Under 'A split screen' add: 'The [multiple views demo](https://github.com/null3d-engine/null3d/tree/main/examples/multiple-views/) draws a split screen, and its V key turns it into a picture in picture.'

Verdict: survives

## Evidence

- docs/guides/multiple-views.md: no link to the demo anywhere on the page, the Related pages list included (lines 116-122). Line 13 ends "Two kinds of work are different:", and the list at lines 15-16 contrasts a view (draws into the canvas) with a pass (draws into a texture). The lead sentence does not name the two things it compares, so "A view is not a render pass:" is clearer.
- examples/demos.ts:472-483: the multiple-views entry has no `code` value, so by the website contract the link is `examples/multiple-views/`, which the proposal uses. The folder exists. Summary and controls match the claim (V: "Split view or inset").
- examples/multiple-views/sketch.ts:101-128: the demo starts in the split layout (`inset = false`, two views over the two halves) and the V key (`KeyV`) switches to one inset view. So "draws a split screen, and its V key turns it into a picture in picture" is correct.
- Other guides link their demos in the same style (custom-passes.md:276 and :583, deterministic-simulation.md:138, car-paint.md:120), so the edit follows the existing pattern.
- Reference images exist for the demo's default view (tests/image/references/chrome-real-gpu/{webgpu,compat,webgl2}/demo-multiple-views.png), so a picture could be added later. The finding does not need one.

No part could be disproved. Low severity fits: the page is usable without the link, but the demo shows the page's two layouts.
