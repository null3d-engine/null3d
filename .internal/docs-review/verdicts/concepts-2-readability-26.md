# concepts-2-readability-26

## Finding as given

- page: concepts/shadows
- anchor: ## Bias line 292; ### Where shadows meet their casters 300-304; ### Flat casters 308-312
- category: technical-details-block
- severity: medium
- claim: 16-bit depth step sizes, the 1.5-step floor, contact-check pixel figures and per-texel plane comparison are correct implementer detail. They hide what a user needs: shadows meet casters, slabs do not shadow themselves, raise biases in small steps.
- evidence: stats.json lines 285, 293, 297, 301, 303.
- proposedEdit: Keep in the main text: line 294's advice, 'the engine moves back faces toward the light, so no lit line shows at a box's base', 'a low flat caster does not shadow its own top', and the 20 cm floor advice. Move 292, 302 and the mechanism of 308-312 into <details><summary>Technical details: depth precision, back-face offset and plane comparison</summary>.

Verdict: partly

## Evidence

Line numbers are those of the generated page (stats.json lines run 7 lower: stats 285 = page 292, 293 = 300, 297 = 304, 301 = 308, 303 = 310).

- The core claim holds. stats.json lists page 292 (133 words, 9 sentences), 300 (109, 6), 308 (86, 5) and 310 (161, 10 sentences) as long. Page 292 gives 16-bit step arithmetic and a benchmark figure. Page 302 gives measured pixel figures from an internal contact check in one benchmark scene. Page 310 explains the per-texel plane comparison and the four-texel read count. A reader who wants to fix acne or a lit line at a box's base must read through all of it. A block is the right tool.
- One block cannot cover all three places. Page 292 is under "## Bias", 302 under "### Where shadows meet their casters" and 308-312 under "### Flat casters". The block rule forbids headings inside a block, so one block spanning these sections would break the rule, or move content away from its section. It needs one block per section.
- Page 292 has a user-visible effect that must stay in the main text: in far cascades, a `bias` below the floor acts as the floor, so lowering it there does nothing. Cutting the whole paragraph into a block hides why a lowered bias has no effect.
- Page 304 starts "The 5 cm cap protects floors...". The cap and the one-texel limit come from page 300. If page 300's mechanism goes into a block, the main text must still state "up to one texel, and at most 5 cm", or page 304 does not make sense with the block closed. The proposal keeps only a summary of page 300 without the cap.
- Page 312 says spot and point lights do not use the plane comparison. That is a user-facing limit (a flat caster lit by a spot or point light does not get this protection). The proposal does not say where it goes; it must stay in the main text.
- Page 310 refers back to "one and a half steps of the map's stored depth" from page 292. Both can sit in blocks, but the main text must not depend on that term.

## Corrected claim

The depth-precision arithmetic (292), the measured contact-check figures (302) and the plane-comparison mechanism (310) are correct implementer detail that hides user advice, and should move into collapsible blocks. They need three blocks, one per section, and some user-facing results must stay in the main text: the bias floor in far cascades, the one-texel and 5 cm limits of the back-face move, and the fact that spot and point lights do not use the plane comparison.

## Corrected edit

- ## Bias: keep one main-text sentence: "In far cascades, the engine raises `bias` to a floor set by the map's depth precision, so a smaller setting has no effect there." Move the rest of 292 into `<details><summary>Technical details: depth precision and the bias floor</summary>`. Keep 294 as is.
- ### Where shadows meet their casters: keep 298. Keep from 300: "So the engine moves each caster's faces that point away from the light toward the light before it draws them, by up to one texel and at most 5 cm. A double-sided material's faces stay in place. Spot and point lights do the same with texels of their tiles." Move the rest of 300 (which faces move most and why) and all of 302 into `<details><summary>Technical details: how far faces move, and measured results</summary>`. Keep 304.
- ### Flat casters: keep in the main text: "A low flat caster, such as a pavement slab, does not shadow its own top under the directional light. A caster that stands on it, such as a box, still shadows it, so the shadow meets the box's base. Spot and point lights do not have this protection: their tiles compare each read with the depth at the surface's own point." Move the mechanism of 308 and 310, and the reason in 312, into `<details><summary>Technical details: plane comparison in the filter</summary>`.
