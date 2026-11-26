# concepts-1-substance-05

## Finding as given

- page: concepts/lighting
- anchor: ### A scene that shows a time of day, lines 162 and 164 "The island showcase ...", "A demo stage offers ... `stage.lamps`"
- category: internal-note
- severity: medium
- claim: `stage.lamps` comes from the demos' shared helper code, not the engine, so a developer cannot use it. 'The island showcase' has no link, so a reader cannot find it.
- evidence: examples/lib/stage.ts defines the lamps share; examples/showcase/island/sketch.ts:103-104 and :455 use it; packages/engine/src has no lamps API.
- proposedEdit: Link the showcase: '[The island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/) holds its hemisphere light...'. Replace the stage.lamps sentence: 'Drive the light from a value of your own, such as the share of the town's lamps that are lit, from 0 by day to 1 at night.'

Verdict: survives

## Evidence

- docs/concepts/lighting.md:164 says "A demo stage offers the share of a town's lamps as `stage.lamps`". No other docs page mentions a demo stage or `stage.lamps`, and no page explains how a developer gets a stage.
- examples/lib/stage.ts:317 declares `readonly lamps: number`, and :518 sets it from the sun's height (`lampShare(sunHeight)`, with the limits at :148-153). The file lives in the examples' shared code, not in a package.
- A search of packages/*/src finds no lamps API. No package imports examples/lib/stage.
- examples/showcase/island/sketch.ts:103-104 holds the day ambient at 0.8 and the night one at 0.06, and :455 drives it by `stage.lamps`. So the page's numbers are right, but the value it names is not one a developer can reach.
- lighting.md:162 names "The island showcase" with no link. examples/demos.ts:183-186 gives the island demo the code `showcase/island/`, so the proposed link matches the website contract. The page's demo list (:586-587) does not hold it either.
- Severity medium holds: a reader who looks for `stage.lamps` in the engine finds nothing.

## Corrected edit (small change)

The proposed sentence repeats line 162, which already says the light is "driven by the share of a town's lamps that are lit". Say instead where such a value comes from:

"Drive the light from a value of your own that follows the sun's height, from 0 by day to 1 at night. The showcase uses the share of the town's lamps that are lit."

Do not link examples/lib/stage.ts. It is not a demo code, so the website contract does not allow the link.
