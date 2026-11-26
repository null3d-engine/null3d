# Verdict: api-2-readability-17

## Finding as given

- Page: api/lights
- Anchor: "## Color, intensity and units", lines 121 and 123
- Category: structure. Severity: medium.
- Claim: Line 121 explains range, decay, angle and penumbra, and line 123 says that setters allocate nothing. Neither is about color or units. A reader who scans for "range" or "cone" will not look here.
- Evidence: line 121 "A point or spot light ends at its `range`, in meters ... Its `penumbra`, from 0 to 1"; line 123 "Every setter allocates nothing".
- Proposed edit: Add "## Range, decay and the spot cone" after "Where a light points", with a table: option | lights | default | meaning. Move line 123 to just after the first example, which already changes lights every frame.

Verdict: survives

## Evidence

- docs/api/lights.md:94 opens "## Color, intensity and units". Lines 96 to 119 are about color, intensity and the intensity units. Line 121 is about `range`, `decay`, `angle` and `penumbra`. Line 123 is about setters that allocate nothing. Neither paragraph is about color or units, so the claim holds.
- No other place on the page explains these options. The table "Kinds of light" (lines 36 to 44) only names them. "Where a light points" (lines 48 to 54) covers direction only. The page's headings (stats.json) have no heading for range or the cone.
- stats.json also lists line 121 (body line 114) as a long paragraph: 87 words and 5 sentences. A table splits it in a natural way.
- The first example (lines 15 to 32) calls `setDirection` and `setPosition` in `onUpdate`. So the setter note fits after it.

## Refinements to the edit (they do not weaken the finding)

1. The page does not give the default for `penumbra`. The source does: it is 0, a sharp edge (packages/engine/src/scene/scene.ts:820-824, the TSDoc of `SpotLightOptions.penumbra`). The `angle` limit is "above 0 and at most π/2" (scene.ts:816-819). The table must put these values in.
2. `range` is also required for rectangle and tube lights (lights.md:43-44 and 157). The "lights" column of the `range` row must name point, spot, rectangle and tube lights. `decay` is for point and spot lights only (lights.md:39-40).
3. Line 123 says "Every setter allocates nothing". But line 158 says "A new picture allocates" for `setImage`, and line 81 says that a new spot light picture takes up to a few tens of milliseconds. When the sentence moves, it must leave out `setMap` and `setImage`.
4. Lines 159 and 179 repeat that setters allocate nothing. After the move, line 159 can keep "take effect in the next frame" and drop the repeat.

## Corrected edit

After "## Where a light points", add:

## Range, decay and the spot cone

| Option | Lights | Default | Meaning |
| --- | --- | --- | --- |
| `range` | Point, spot, rectangle, tube | None: required | Where the light ends, in meters. The engine finds the lights near each surface by their ranges. |
| `decay` | Point, spot | 2, the physical rate | How fast the light fades with distance |
| `angle` | Spot | π/3 | From the light's direction to the edge of its cone, in radians, above 0 and at most π/2 |
| `penumbra` | Spot | 0, a sharp edge | The part of the cone, from 0 to 1, over which the light fades out toward the edge |

Delete line 121. Move line 123 to just after the first example, with this text: "Setters allocate nothing, `setColor` and `setGroundColor` included, so `onUpdate` can call `setIntensity`, `setColor`, `setDirection`, `setRange` and the others in every frame. A new picture from `setMap` or `setImage` is the exception: set it at setup or now and then."
