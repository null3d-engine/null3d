# concepts-2-readability-08

## The finding as given

```json
{
 "page": "concepts/shadows",
 "anchor": "## Bias through ### Grass and other thin surfaces (lines 279-358)",
 "category": "split-page",
 "severity": "medium",
 "claim": "The page is 7,488 words with 30 long paragraphs. The acne, peter-panning and contact-shadow sections are about fixing faults, and they sit between setup topics. A reader who only wants shadows on must scroll past them.",
 "evidence": "stats.json words 7,488, 30 longParagraphs.",
 "proposedEdit": "Move lines 279-358 to a new concepts/shadow-bias page ('Shadow bias and contact shadows'). Keep a short Bias section here: what acne is, the two settings, raise them in small steps, and a link. If the split is refused, use technical details blocks (see the bias finding).",
 "generatedSource": "",
 "id": "concepts-2-readability-08",
 "slice": "concepts-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

What holds:

- stats.json gives 7,488 words and 30 long paragraphs for the page. Nine of those 30 fall in the Bias and Contact shadows range.
- The Bias section holds dense mechanism detail that a newcomer does not need to turn shadows on. Examples: the 16-bit depth step and its floor, the back-face move toward the light with its contact-check measurements, and the plane comparison in "Flat casters". This detail is correct and useful to implementers.

What does not hold:

- "A reader who only wants shadows on must scroll past them" is wrong. The page gives the full setup at the top: the three flags and a complete sketch (docs/concepts/shadows.md, about lines 26-60). A reader who only wants shadows on stops there.
- "They sit between setup topics" is wrong. The sections before Bias are tuning sections: cascade splits, stable cascades, blending, update rates, filtering (lines 187-277). The sections after are features and costs: contact shadows, the hero shadow, the caster rules, cost, the GPU paths (lines 314-439). Bias belongs with the tuning sections, right after Filtering.
- "Contact shadows are about fixing faults" is wrong. Contact shadows are a feature with their own settings: `contactDistance` on the light, the `contactShadowSteps` quality setting, and the `contactShadows` material option (lines 314-358). The page summary in the frontmatter and in tools/lib/docs.ts (line 100) lists them as a topic of this page. A page called "Shadow bias" would hide a feature under a fault name.
- The split breaks inbound anchors that the proposal does not name:
  - docs/guides/testing.md:239 links `shadows.md#bias`.
  - docs/concepts/quality-presets.md:220 links `shadows.md#contact-shadows`.
  - docs/api/materials.md:559 links `shadows.md#grass-and-other-thin-surfaces`.
  - The Bias section itself links `#flat-casters`.
  A split also needs a new entry in PAGES in tools/lib/docs.ts, so docs/pages.md changes.
- The user asked for dense implementer detail to go into collapsible blocks. Moving it to a new page is a heavier edit than the request calls for. The finding gives blocks only as a fallback.

## Corrected claim

The Bias section is hard to read. It mixes the two settings and the advice on them with long paragraphs about how the engine avoids acne and light leaks. A reader who wants to fix acne must read through that mechanism detail. Contact shadows are a feature section, not a fault section, and they can stay where they are. The page needs no split.

## Corrected edit

Keep everything on docs/concepts/shadows.md. Do not make a new page. Keep every heading, so the inbound anchors keep working.

1. In "## Bias", keep the opening paragraph (what acne is), the two settings list, and the final advice paragraph ("Values that are too large ... acts as one texel"). Move the advice paragraph up to come right after the settings list. Then put the remaining paragraphs (bias in meters per cascade, the cap for spot and point lights, and the 16-bit depth step with its floor) into one block:
   `<details><summary>Technical details: how the bias scales with each cascade and the stored depth</summary> ... </details>`
2. In "### Where shadows meet their casters", keep one plain sentence: the engine moves each caster's back faces toward the light by up to one texel, with a cap, so no lit line shows at a box's base. Also keep the last sentence of advice: give a ground that must not cast shadows only `receiveShadows`. Put the rest (the filter reads under the box, the contact-check figures, the floor-thickness cap) into one block:
   `<details><summary>Technical details: why the back faces move, and measured results</summary> ... </details>`
3. In "### Flat casters", keep one plain sentence: the directional light's filter compares each texel with the surface's own plane, so a flat slab does not shadow its own top, and a box that stands on it still does. Put the mechanism and the spot and point light difference into one block:
   `<details><summary>Technical details: how the plane comparison works</summary> ... </details>`
4. In "## Contact shadows", keep the opening, the ray paragraph, the example and the rules list. Put the paragraph about half-resolution rays, the depth prepass copy and the blend into one block:
   `<details><summary>Technical details: how the rays read the depth</summary> ... </details>`
5. Leave "### Grass and other thin surfaces" as it is. It is short and it is advice for the reader.

Every block follows the contract: no headings inside, no nested blocks, and the main text reads correctly with every block closed.
