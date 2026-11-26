# Verdict: api-2-readability-08

## The finding as given

- Page: api/materials
- Anchor: ### Cost of transmission (172), ### Cost of light through thin surfaces (215), ### Cost of light under the surface (248), ### Cost of the layers (304), ### Cost of iridescence and anisotropy (358), ### Cost of decals (416), ### Cost of weighted blending (676)
- Category: technical-details-block
- Severity: medium
- Claim: Seven H3s hold dense pass, memory and download detail. Implementers need it, but newcomers do not, and the extra headings make the outline harder to scan. Four of them open with the same sentence.
- Evidence: lines 174, 217, 250 and 418 start 'Nothing of it runs, and none of its ... download'; line 250 '36 bytes per pixel'; line 678 '10 bytes per pixel together'.
- Proposed edit: Replace each H3 with one main-text sentence ('Its shaders load on first use; list 'transmission' in createEngine's preload to load them before the first frame') plus `<details><summary>Technical details: what transmission costs</summary>`. Do the same for the 'How it draws', 'How the layers draw' and 'How the film and the stretch draw' lists where they only describe the method.
- Generated source: none (docs/api/materials.md is hand-written)

Verdict: partly

## Evidence

- The seven H3s are at the lines given (docs/api/materials.md:172, 215, 248, 304, 358, 416, 676). The four openings match: 174 "Nothing of it runs, and none of its code or shaders download, until...", 217, 250 and 418 "Nothing of it runs, and none of its shaders download, ...". 250 ends "36 bytes per pixel of the render size". 678 says "10 bytes per pixel together". The claim about the Cost sections holds.
- No page, skill or TSDoc comment links to a `#cost-of-...`, `#how-it-draws`, `#how-decals-draw` or `#how-the-...` anchor. Removing these H3s breaks no links.
- No rule in the "Writing docs" section of AGENTS.md asks for a "Cost" heading per feature. The block would break no rule.
- The Cost sections are the right fit for a block. Each one mixes one fact that every user needs (the shaders load on first use; list a name in `createEngine`'s `preload` option to load them early) with pass counts, samples per pixel and bytes per pixel. The proposed one-line main sentence keeps the fact everyone needs. The block keeps the rest.
- The extension to the "How ..." lists is wrong as written. Most of their bullets are rules and limits that a user runs into, not a description of the method:
  - How it draws (159-170): `hash` throws E1217 (167); views other than the camera's have no copy and show the environment (168); the map/array clashes that throw E1217 in development builds (169, 170); `thickness` is in mesh units and scale multiplies it (166); only opaque objects show through (162).
  - How decals draw (405-414): decals mark opaque surfaces only (409); a decal cannot only darken the surface, so give a puddle its own color (410); `setRenderOrder` orders decals (412); scene and reflection passes show none (413); raycasts hit the box, so put decals on their own layer (414).
  - How the layers draw (298-302): emitted light lies under the coat, so a coat dims a glowing surface (302).
  - How the film and the stretch draw (350-356): rectangle and tube lights shade without the stretch (356).
  The main text must make sense with every block closed. These bullets state errors and limits, and a closed block would hide them.
- Only part of each list describes the method: the opening paragraphs at 160 and 407 (the blurred colour copy, the depth read per pixel), 163-165 (depth kept in the copy, the volume model, the three rays), 299-300 (the GGX coat, the Charlie sheen and its curve fit), and 352-355 (the film's Fresnel term, the stretched lobe, the bent reflection).

## Corrected claim

Seven Cost H3s hold dense pass, memory and download detail. Four of them open with nearly the same sentence. Each can become one main-text sentence about loading on first use and `preload`, plus a block. The "How ..." lists are mostly rules and limits that users need. Only their method paragraphs and method bullets belong in a block.

## Corrected edit

1. For each of the seven Cost H3s, remove the heading. At the end of the feature's section, put one sentence in the main text, such as: "Its shaders load the first time a surface uses it. To load them before the first frame, list `'transmission'` in `createEngine`'s `preload` option." Follow it with `<details><summary>Technical details: what transmission costs</summary>` and the passes, samples, targets and bytes per pixel. Keep the main sentence different from one feature to the next, so the page does not repeat one stock opening seven times.
2. Keep the "How it draws", "How decals draw", "How the layers draw" and "How the film and the stretch draw" headings, and keep their rule and limit bullets in the main text (lines 162, 166-170, 409-414, 302, 356). Move only the method text into a block below them, `<details><summary>Technical details: how transmission draws</summary>`: lines 160 and 163-165; 407; 299-300; 352-355. If what is left is short, rename the heading to "Limits of transmission" (and so on) instead.
3. Change "Materials without layers draw as before" (306) to "Materials without layers draw with no extra texture and their shaders do not change", because "as before" describes a change, not the behaviour.
