# api-1-substance-25

## The finding as given

- page: api/feature-instances
- anchor: ## The buffers line 112 vs ## Limits line 147; line 139 vs line 148; line 154
- category: duplication
- severity: low
- claim: Two pairs of statements repeat (two buffers double the memory; shadow views draw the count word). The page has no Related pages or API reference heading, so the reference link reads as a limit.
- evidence: docs/api/feature-instances.md:112, 139, 147, 148, 154; stats.json api/feature-instances headings.
- proposedEdit: Delete the Limits bullets at 147 and 148, or the earlier sentences. Add ## Related pages (feature descriptions, feature draws, render compute passes, the grass page) and an ## API reference heading over line 154.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- Line 112, last sentence: the engine keeps a second buffer of capacity rows, "which doubles the memory that the draw's instances take". Line 147 says the same thing again: two buffers of capacity rows, "twice the instance memory". This pair is a true repeat.
- Line 139, last two sentences: the camera's view and every shadow view draw the word's count, so an instance that the GPU counts casts its shadow. Line 148, second sentence says the same. This pair is a true repeat.
- Line 148, first sentence is NOT a repeat: "The conversion uses the main view's camera, so every view, the shadows included, reads the rows converted for that camera." Nothing else on the page says this (grep for "main view's camera" finds only line 148). Deleting the whole bullet at 148 loses a real limit.
- Headings (stats.json and the file): the page ends with "## Limits", and line 154 (the API reference link) sits under it. It has no "## Related pages" and no "## API reference" heading.
- AGENTS.md "Docs and skills stay in sync", rule 5: "The written page links to it under its 'API reference' heading." So the missing heading breaks a written rule, not only taste. Most api/ pages (feature-draws, feature-effects, features, grass, render and others) have both "## Related pages" and "## API reference".
- The proposed related pages exist and link back here: features.md:287, feature-draws.md:151, render.md:324 (in "## Compute passes", line 225), grass.md:113.

## Corrected claim

Two statements repeat: the doubled instance memory (line 112 and line 147) and the shadow views drawing the count word (line 139 and the second sentence of line 148). The first sentence of line 148 (every view reads rows converted for the main view's camera) is new information and must stay. The page has no "## API reference" heading, which AGENTS.md requires, and no "## Related pages" section, so the reference link at line 154 sits under "## Limits".

## Corrected edit

- Delete the bullet at line 147 (the earlier sentence at line 112 keeps the fact in context). Or keep line 147 and cut the last sentence of line 112; do one, not both.
- At line 148, keep only the first sentence: "The conversion uses the main view's camera, so every view, the shadows included, reads the rows converted for that camera." Delete its second sentence, which line 139 already says.
- Add "## Related pages" after Limits, with links to [Feature descriptions](features.md), [Add-on draws](feature-draws.md), [Compute passes](render.md#compute-passes) and [Grass](grass.md), each with a short reason.
- Add "## API reference" over the link at line 154, as the last section.
