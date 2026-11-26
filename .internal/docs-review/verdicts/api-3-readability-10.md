# Verdict for api-3-readability-10

## The finding as given

- Page: api/water
- Anchor: lines 34, 86, 160, 188, 213, 241, 274, 285, 443, 459
- Category: long-paragraph. Severity: medium.
- Claim: Ten paragraphs or bullets are over the limit. The intro (143 words) lists features in prose. The waterfall description (lines 274 and 285, 160 and 205 words) reads as art direction. The 'The reflection' cost bullet (171 words) mixes cadence, the lowest tier, the governor and the overlay. Parts of the page are hard-wrapped and the rest is not.
- Proposed edit: Line 34: one sentence plus a bullet list of what the surface draws. Lines 274 and 285: one main sentence each, with the shape and lighting description in `<details><summary>Technical details: how the fall is shaped and lit</summary>`. Line 443: sub-bullets for cadence by preset, a moving camera, the lowest tier, the governor and the stats overlay. Line 241: two paragraphs (what attenuation does, then the two examples). Others: break at the fourth sentence. Unwrap the hard-wrapped lines.

Verdict: partly

## Evidence

- stats.json lists ten long paragraphs for api/water at lines 27, 79, 153, 181, 206, 234, 267, 278, 437 and 453. Those numbers count from after the front matter. They map to file lines 34, 86, 160, 188, 213, 241, 274, 285, 443 and 459 of docs/api/water.md (offset of 7). The finding's anchors are the right file lines. The counts hold.
- Intro, line 34: 143 words, 8 sentences, all feature prose. Two of its sentences (the mirror softening where waves are finer than a pixel; the soft bank edge versus glassy near water) are implementation detail. A list plus a details block fits.
- Reflection bullet, line 443: it does mix the preset cadence, the moving camera, the lowest tier, the governor, the stats overlay and memory, the render graph target and `destroy`. Sub-bullets are right.
- Line 241: 163 words, 11 sentences. A split between what attenuation does and the two examples (clear creek, dark slab) is right.
- Waterfall, lines 274 and 285: the claim that this "reads as art direction" is only partly true. Several sentences are facts a user needs to place a fall:
  - line 278: the fall draws in to about a quarter of the lip's width, "so a notch as wide as the lip shows rock beside it";
  - line 288: it is thin under the brink and hangs close to the rock;
  - lines 294 to 295: the column fades where it nears a wall or a ledge behind it;
  - line 285: the fall costs the CPU nothing in a frame. The cost bullet at line 459 does not say this.
  If these move into a closed block, the main text loses facts that change how a reader builds the scene. The particles dependency at line 296 is also stated at line 40 and in the `spray` row (line 347), so that sentence can go into the block.
- Hard wrapping: the page mixes wrapped paragraphs (lines 86, 160, 213, 241, 274, 285, the cost bullets) with unwrapped ones (lines 34, 188). AGENTS.md "Writing docs" has no wrap rule. GitHub Flavored Markdown joins a soft line break into a space, so the rendered page looks the same. This is source tidiness with no cost to a reader. It is low severity, not part of a medium finding.
- Lines 160, 213 and 459: a break at the fourth sentence works. On line 160 the formula sentence already starts a new source line, so a blank line there is the natural break. On line 213 the grid and hash sentence suits a details block better than a bare break.

## Corrected claim

Ten paragraphs or bullets on api/water are over the limit (file lines 34, 86, 160, 188, 213, 241, 274, 285, 443, 459). The intro lists features in prose. The reflection cost bullet mixes six topics. The two waterfall paragraphs mix the look of the fall with placement and cost facts. The mixed hard wrapping is a separate low-severity source issue that does not change the rendered page.

## Corrected edit

- Line 34: one sentence, then a bullet list of what the surface draws. Put the mirror softening and the soft bank edge in `<details><summary>Technical details: how the mirror softens</summary>`.
- Lines 274 and 285: keep in the main text one sentence on what the fall is, plus the placement and cost facts: it narrows to about a quarter of the lip's width (a lip-wide notch shows rock), it hangs close to the rock under the brink, it fades near a wall or ledge behind it, and it costs the CPU nothing in a frame. Move the look (tongue, ropes, lobes, mist width, streak motion, oval section, how white water takes the light) into `<details><summary>Technical details: how the fall is shaped and lit</summary>`.
- Line 443: sub-bullets for cadence by preset, a moving camera, the lowest tier, the governor and the stats overlay. Memory and the render graph target can go in a details block.
- Line 241: two paragraphs, what attenuation does, then the two examples.
- Line 213: put the grid cell and hash sentence in a details block; keep "Rain is off by default" and the skipped work in the main text.
- Lines 86, 160, 188, 459: break at the fourth sentence.
- Unwrapping the hard-wrapped lines is optional source tidiness, low severity.
