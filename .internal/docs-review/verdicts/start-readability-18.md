# start-readability-18

## Finding as given

- page: cookbook/index
- anchor: # Cookbook (line 9) through ## Hide what walls hide (line 620)
- category: scan-order
- severity: medium
- claim: Thirteen recipes in 3,831 words have no list at the top and no clear order: a crowd sits between a third-person camera and a loading screen.
- evidence: stats.json cookbook/index headings; recipes at lines 23, 60, 140, 225, 270, 305, 333, 388, 433, 480, 540, 586, 620.
- proposedEdit: Add a table under the intro: Recipe | What it shows | Main calls. Order the H2s by task: input (select, walk to click), characters (third-person camera, crowd, morph targets), loading, look (sky and fog, glow, trail, stars), screens (another camera, screens in the world), speed (hide what walls hide). Keep each recipe an H2.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/cookbook/index.md:9-21 holds the title, a roadmap note, a Mermaid chart about the tests and two intro paragraphs. No list of the recipes is there. stats.json gives 3,831 words. The 13 recipe H2s are at lines 23, 60, 140, 225, 270, 305, 333, 388, 433, 480, 540, 586 and 620, then "Related pages" at 658. This part of the claim holds.
- The example in the claim is wrong. The crowd (line 225) sits next to the third-person camera (line 140). Both are about animated characters, so that pair is in a sensible order. The page already runs roughly by task: input first (23, 60), characters (140, 225), and speed last (620).
- The real breaks in the order are two:
  1. "A loading screen for models" (line 270) splits the character recipes. "Morph targets from a model" (line 305) comes after it.
  2. The two screen recipes (lines 433, 480) split the look recipes. Sky (333) and glow (388) come before them, and trail (540) and stars (586) come after.
- A reorder is safe. tests/lib/skill-sketches.ts:104-117 names each sketch from its file and heading, not from its place on the page. Nothing in the tests depends on the order. The only incoming link is docs/pages.md:242, to the page and not to a section.
- No writing rule in AGENTS.md "Writing docs" forbids a table or list at the top.
- The "Main calls" column adds a third place for the API names. Each recipe's first sentence and code already name them, and the names can change while the APIs are experimental (line 11). A two-column list is enough to help a reader scan.

## Corrected claim

The page has no list of its 13 recipes at the top, so a reader looking for one task must scroll through 3,831 words. The order is mostly by task already. Two recipes break it: the loading screen splits the character recipes, and the two screen recipes split the look recipes. The crowd is not out of place.

## Corrected edit

Under the second intro paragraph, add a short list of links grouped by task (or a two-column table: Recipe | What it shows). Leave out a "Main calls" column. Then move two blocks: put "Morph targets from a model" right after "A crowd of animated characters", and put "A trail behind a moving object" and "A field of stars" right after "Glow and a custom effect". The order is then: select, walk to click, third-person camera, crowd, morph targets, loading screen, sky and fog, glow, trail, stars, another camera, screens in the world, hide what walls hide. Keep each recipe an H2 with its present heading text.
