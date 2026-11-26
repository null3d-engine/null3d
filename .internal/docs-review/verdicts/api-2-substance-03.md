# api-2-substance-03

## Finding as given

- Page: api/lines
- Anchor: ## Dashes, "Both count in world units along the line, times dashScale" (line 135); table rows dashSize, dashScale (85, 87)
- Category: wrong-claim. Severity: medium.
- Claim: The shader multiplies the distance along the line by dashScale and then compares it with dashSize and gapSize. So a dash is dashSize/dashScale world units long, and a larger dashScale gives shorter dashes. The page suggests the reverse, and it calls dashSize world units without saying that this holds only at scale 1.
- Evidence: crates/null3d-shaders/wgsl/line.wgsl:123-124, :225; TSDoc packages/engine/src/scene/lines.ts:54.
- Proposed edit: Line 135: "Both are lengths along the line. dashScale multiplies the line's length before the dashes are measured, so a scale of 2 makes each dash and gap half as long in the world. dashOffset counts in the same scaled units." Table: "Multiplies the line's length before the dash and gap sizes measure it. 2 gives dashes half as long." Change the TSDoc at lines.ts:54 to match.
- Generated source: packages/engine/src/scene/lines.ts (LineValues.dashScale, for docs/api/reference/lines.md)

Verdict: partly

## Evidence

- line.wgsl:123-124: `out.distance = dash_scale * (found.row_z.y * TINY_INVERSE + 2.0 * length(half) * t)`. The distance is the world distance along the line (earlier segments plus this segment's world length times t), multiplied by the scale.
- line.wgsl:225: `modulo(in.distance + dash.w, dash.x + dash.y) > dash.x` discards. So a dash covers dashSize / dashScale world units, a gap gapSize / dashScale, and the offset adds in scaled units. A larger scale gives shorter dashes. The code claim holds.
- docs/api/lines.md:85 says dashSize is "in world units". That is true only at scale 1, so this row is wrong in general.
- docs/api/lines.md:135, "Both count in world units along the line, times dashScale", is ambiguous. Read as "measured on the world distance times dashScale", it is correct. Read as "dashSize times dashScale world units", it is wrong. Most readers will take the second reading, so the sentence misleads. But it does not clearly state the reverse.
- docs/api/lines.md:87 and lines.ts:54, "A factor of the line's length, which the dash and gap sizes measure", is correct but hard to parse. It does not state the reverse either.

## Corrected claim

The shader multiplies the world distance along the line by dashScale before it compares it with dashSize and gapSize, so a dash is dashSize/dashScale world units long. The dashSize row (line 85) wrongly says world units without the scale. The Dashes sentence (line 135) is ambiguous and invites the wrong reading (size times scale). The dashScale row (line 87) and its TSDoc (lines.ts:54) are correct but too terse to show the direction of the effect.

## Edit

The proposed edit is sound and fits the writing rules. Also fix the dashSize row: "The length of each dash along the line. At dashScale 1 it is in world units." The dashScale table row on api/lines and the TSDoc at lines.ts:54 (which feeds docs/api/reference/lines.md) should use the same words.
