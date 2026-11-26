# concepts-2-substance-14

## Finding as given

```json
{
 "page": "concepts/quality-presets,concepts/shadows,concepts/static-dynamic",
 "anchor": "quality-presets lines 63, 122 (Skyway), 212 (Island showcase), 214 (S1), 222 (S4); shadows 192, 241, 243, 245, 271, 292, 302, 304 (S4); static-dynamic 74 (S2)",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "The pages never say what S1, S2 or S4 are, or that Skyway and Island are showcase demos. The performance guide defines S4.",
 "evidence": "docs/guides/performance.md:82 (\"a town of 5,000 still objects and 200 moving vehicles\"); examples/demos.ts (skyway, island).",
 "proposedEdit": "At first use: \"the S4 benchmark ([a town of 5,000 still objects and 200 vehicles](../guides/performance.md))\". Link Skyway and Island to https://github.com/null3d-engine/null3d/tree/main/examples/showcase/skyway/ and .../showcase/island/.",
 "generatedSource": "",
 "id": "concepts-2-substance-14",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- None of the three pages links the performance guide or says what S1, S2 or S4 hold. A grep for "performance.md" in the three pages finds nothing.
  - quality-presets.md:63, 222 say "the S4 benchmark" with no description. 214 says "the S1 benchmark with its smoke switch"; the smoke switch is the benchmark tool's weighted-transparency option, which no published page names.
  - static-dynamic.md:74 says "the S2 benchmark" with no description.
  - shadows.md:241-304 use bare "S4" and "S4's".
- Two parts of the claim are wrong:
  - shadows.md:192 already says what S4 is in part: "A camera high above a town, as in the S4 benchmark scene 42 m up". The town is named there, but the page does not link to it.
  - quality-presets.md:212 already calls Island "the Island showcase". Only the link is missing. Skyway at quality-presets.md:122 ("while Skyway drew") has no description, so that part holds.
- The definitions are in other pages:
  - S4: guides/performance.md:82, under "Phones and tablets" (anchor #phones-and-tablets), not at the top of the page.
  - S1: guides/performance.md:46 ("S1 has 100,000 boxes, and its onUpdate moves every box in every frame"), under "Where frame time goes".
  - S2: not in the performance guide. Only porting/threejs-overview.md:34 describes it: "a scene graph of 5,096 objects, 6 levels deep".
- The proposed edit fixes only S4, and its link has no anchor. S1 and S2 stay unexplained.
- The demo links match the website contract. examples/demos.ts:186 gives Island the code 'showcase/island/', and examples/demos.ts:207 gives Skyway (title 'Skyway', scene 'A rainy megacity from a hover car') the code 'showcase/skyway/'.
- The cost to a reader is real. A newcomer cannot judge figures such as "38 to 60 frames per second" without knowing what the scene draws. The severity of medium stands.

## Corrected claim

The three pages use S1, S2 and S4 without saying what they are. shadows.md:192 names S4 as a town but gives no link. quality-presets.md:212 already calls Island a showcase but gives no link. Skyway at quality-presets.md:122 has no description. The definitions are in guides/performance.md:46 (S1) and :82 (S4), and in porting/threejs-overview.md:34 (S2).

## Corrected edit

At the first use on each page, describe the scene in plain words and link to where it is defined:
- quality-presets.md:63: "In the S4 benchmark, [a town of 5,000 still objects and 200 moving vehicles with a shadow-casting sun](../guides/performance.md#phones-and-tablets), ..."
- quality-presets.md:214: "In the S1 benchmark ([100,000 boxes that move every frame](../guides/performance.md#where-frame-time-goes)), with a column of see-through smoke added, ..."
- quality-presets.md:122: "while the [Skyway showcase demo](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/skyway/) drew"
- quality-presets.md:212: "on the [Island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/)"
- shadows.md:192: "as in the [S4 benchmark](../guides/performance.md#phones-and-tablets), a town whose camera flies 42 m up". Later bare "S4" uses can stay.
- static-dynamic.md:74: "In the S2 benchmark ([a scene graph of 5,096 objects, 6 levels deep](../porting/threejs-overview.md))". A better long-term fix is to add a one-line description of S2 to the performance guide and link that.
