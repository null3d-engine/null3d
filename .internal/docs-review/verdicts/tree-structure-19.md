# tree-structure-19

## Finding as given

- Page: cookbook/index
- Anchor: # Cookbook
- Category: split-page
- Severity: medium
- Claim: The cookbook is one page of 13 recipes, so no recipe can be found by ID or in navigation, and the area comes last, after Errors.
- Evidence: stats.json cookbook/index words=3831 with 13 recipe headings. AREAS order ends with ['errors'], ['cookbook']. tests/lib/skill-sketches.ts reads the folder 'docs/cookbook', so a split needs no test change.
- Proposed edit: One page per recipe: cookbook/select-objects, click-to-walk, third-person-camera, crowd, model-loading-screen, morph-targets, sun-and-fog, glow-effect, camera-screen, world-screens, trail, star-field, hidden-by-walls (all NEW from the split); cookbook/index becomes the list. Move the area right after Guides.
- Generated source: tools/lib/docs.ts (AREAS, PAGES)

Verdict: partly

## Evidence

- What holds: `AREAS` in tools/lib/docs.ts (lines 59-69) puts `cookbook` last, after `errors`. In docs/pages.md the Errors section (from line 153) lists about a hundred generated error pages, and the single Cookbook row comes after them (line 242). A newcomer who looks for worked examples finds them last, behind the error catalogue.
- What holds: the page has no list of its recipes. Lines 9-22 hold the title, a status note, a diagram and two intro paragraphs, then the first recipe starts. The pages.md row says only "Short recipes; each is also a tested example." So nothing outside the page body names the 13 tasks.
- What does not hold: "no recipe can be found by ID". Each recipe is an H2 with a stable anchor, such as `cookbook/index#walk-to-the-point-that-the-user-clicks`. The skills already cite docs as id plus anchor (skills/null3d-develop/references/recipes.md:539 cites `api/textures#canvases` and `cookbook/index`).
- Length is not the problem. stats.json gives 3831 words, and much of that is code. At least 15 pages are about twice as long or longer (for example guides/performance 8423, concepts/lighting 9783, api/materials 13672). One page of short recipes with headings is a common cookbook form.
- The split has costs that the finding leaves out. The intro (copy into sketch.ts, files served from `public`, the test note) is shared by every recipe, so each of 13 pages must repeat it or link back. Each new page needs its own PAGES entry. The skill link at skills/null3d-develop/references/recipes.md:539 must change. The test claim is right: tests/lib/skill-sketches.ts:81 walks the whole `docs/cookbook` folder, and no file keys on the sketch names (no match for "cookbook-index" in the repository), so the renamed sketches need no test change.

## Corrected claim

The cookbook's 13 recipes are hard to discover. The Cookbook area comes last in the page list, after about a hundred error pages, and the page has no list of its recipes at the top. Each recipe already has a heading anchor that other pages can link to, and the page is not unusually long.

## Corrected edit

1. In tools/lib/docs.ts, move `['cookbook', 'Cookbook']` in `AREAS` to right after `['guides', 'Guides']`.
2. In docs/cookbook/index.md, under the intro, add a short linked list of the 13 recipes (one line each, linking to the heading anchors).
3. Optionally, make the cookbook's summary in `PAGES` name the kinds of task it covers (selection, cameras, characters, loading, effects, screens), so the page list says what is inside.

A split into one page per recipe is optional, not required. If it is done, keep the shared intro on cookbook/index, link back to it from each recipe page, add a `PAGES` entry for each new page, and update the link at skills/null3d-develop/references/recipes.md:539.
