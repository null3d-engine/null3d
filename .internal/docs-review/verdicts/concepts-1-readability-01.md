# Verdict: concepts-1-readability-01

## Finding as given

- page: concepts/lighting
- anchor: ### A scene that shows a time of day, lines 162 and 164
- category: unclear
- severity: high
- claim: The text presents demo-harness internals as if they were engine API: 'The island showcase holds its hemisphere light at 0.8...' and 'A demo stage offers the share of a town's lamps as `stage.lamps`'. `stage.lamps` is not an engine API, and the showcase is not linked.
- evidence: lighting.md:162, 164. No lamps API in packages/engine/src. Showcase code is showcase/island/ (examples/demos.ts:186).
- proposedEdit: Rewrite with no harness names: 'Scale the hemisphere light with the hour, and shift its colors cool at night: for example, from 0.8 with warm colors by day to about 0.06 with cool colors at night. Drive it from your own night value, such as the share of lamps that are lit.' Delete the stage.lamps sentence. Link the example as [The island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/).

Verdict: partly

## Evidence

- docs/concepts/lighting.md:162 names "the island showcase" with no link. The example list at lines 586-587 links the environment and time-of-day demos, not the island.
- docs/concepts/lighting.md:164 says "A demo stage offers the share of a town's lamps as `stage.lamps`". `lamps` is a read-only field of the examples' shared stage helper (examples/lib/stage.ts:317, set at :518 and read at :718). No engine package exports it; packages/engine/src has no such field. A reader of the docs has no "demo stage" and the page never explains or links one.
- The numbers are right: examples/showcase/island/sketch.ts:103-104 sets the day hemisphere light to intensity 0.8 with warm colors and the night one to 0.06 with cool colors, and :455 blends them with `stage.lamps`.
- The demo link format is valid: examples/demos.ts gives the island `code: 'showcase/island/'`.
- Deleting the sentence at line 164 leaves the exposure paragraph whole: its first two sentences make the exposure point on their own.

## What does not hold

The page does not present `stage.lamps` as engine API. Line 164 labels it "a demo stage", so a careful reader can tell it is not part of the engine. The real cost is smaller: an unexplained, unlinked demo-only name in code font, and an unlinked showcase. That makes the section harder to use, but it does not mislead a reader about the engine. Medium fits better than high.

## Corrected claim

Lines 162 and 164 lean on the example code without saying where it lives. Line 164 names `stage.lamps`, a field of the examples' own stage helper that a reader's app does not have, and the page neither explains nor links it. Line 162 names the island showcase with no link. Severity: medium.

## Edit

The proposed edit is right. Use it as given: rewrite line 162 with no harness names, keep the 0.8 and 0.06 values, delete the `stage.lamps` sentence at line 164, and link the showcase as [The island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/), either inline or in the example list near line 586.
