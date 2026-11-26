# Verdict for api-2-substance-06

## The finding as given

- Page: api/impostors
- Anchor: "## Make a card read as its mesh" (151-156) and "## Bake several views, not one side" (173-187)
- Category: duplication. Severity: medium.
- Claim: Both sections give the same grid angles (53, 42.5 and 23 degrees) and the same texel rule (80 pixels wants 32 to 64 texels). Both also say that the bake stores per-texel normals and that cards blend three views. Both are hard-wrapped mid-sentence.
- Evidence: docs/api/impostors.md:151-156 against 182-187; 159-162 against 173-178.
- Proposed edit: Merge them into one section, "Bake a card that reads as its mesh": a list of rules, a table of grid size against worst angle and card pixels against texels per cell (80: 32-64; 215: 128-256), then the code example. Remove the hard wraps.

Verdict: partly

## Evidence

- The duplication is real. docs/api/impostors.md:151-154 gives 53 degrees (four by four), 42.5 (five by five), 23 (ten by ten) and "a far crown needs about five by five". Lines 182-184 give the same numbers and the same advice. Lines 155-156 and 185-186 both say that an 80-pixel card wants 32 to 64 texels a cell. Lines 149-150 and 159-161 say that the bake stores a normal for every texel and that the card blends the nearest views. Lines 173-178 say it again, with "three views". The numbers agree, so nothing misleads. The page is only longer than it needs to be.
- The merge under a new heading breaks two inbound links. docs/concepts/lod.md:233 links to `impostors.md#bake-several-views-not-one-side`. docs/api/geometry.md:282 links to `impostors.md#make-a-card-read-as-its-mesh`, and its link text says that this section covers "which mesh to bake, the color space, the views and texels, the normal bake, and the matched-crop check". The proposed edit does not mention these links.
- One table for two unrelated mappings (grid size against angle, and card pixels against texels) is hard to read. They need two tables, or they can stay as the two short bullets at 182-187, which already read well.
- The hard wraps exist. Lines 135-191 wrap at about 100 characters, while the rest of the page puts each paragraph on one line. GitHub Flavored Markdown joins wrapped lines into one paragraph, so a reader of the rendered page sees no difference. This is a source-consistency nit, not a reader cost.
- Severity: the sections repeat each other but do not conflict, and together they are about 12 lines of a page of 280 lines. Low fits better than medium.

## Corrected claim

The two sections repeat the grid angles, the texel rule, the per-texel normal bake and the blend of the nearest views. The numbers agree, so the cost is length, not confusion. Severity is low. The hard wraps (lines 135-191, unlike the rest of the page) do not change the rendered page.

## Corrected edit

Keep both headings, because other pages link to both anchors (concepts/lod.md:233, api/geometry.md:282).
- In "Make a card read as its mesh", cut the views bullet (151-154) and the texels bullet (155-156) down to one rule each: "Store enough views that no direction lies far from one, and choose the texels in a cell against the card's apparent size. [Bake several views, not one side](#bake-several-views-not-one-side) gives the numbers." Cut the baker bullet (159-166) to the rule and its exception: bake with `bakeImpostorAtlas` unless the card never covers more than a few tens of pixels. A hand-painted side view shows the same picture from every side.
- Keep the angles, the texel figures and the explanation of the normals and the three-view blend only in "Bake several views, not one side" (173-187).
- Optionally join the hard-wrapped lines in 135-191 so that each paragraph and bullet is on one line, like the rest of the page.
