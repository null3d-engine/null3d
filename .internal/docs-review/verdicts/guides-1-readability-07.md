# guides-1-readability-07

## The finding as given

- page: guides/assets-pipeline
- anchor: ## In a Vite project (line 280)
- category: scan-order
- severity: medium
- claim: Most projects use the Vite plugin, and '?optimized' is the easiest way to use the tool. It is H2 number 11, after levels of detail, cluster trees, the budget report and the shader list, about 4,000 words in.
- evidence: stats.json heading list: '## In a Vite project' follows '## The shader list'.
- proposedEdit: Move '## In a Vite project' to right after '## Optimize a model'. Add to the intro: 'Run it as a command, or let the null3D Vite plugin run it when a module imports a model with `?optimized`.'

Verdict: partly

## Evidence

- docs/guides/assets-pipeline.md:280 holds "## In a Vite project". The H2 order is: Optimize a model (25), What it does to meshes (70), What it does to clips (90), Blockers and stored trees (107), Textures (132), Levels of detail (175), The budget report (238), The shader list (266), In a Vite project (280). So it is H2 number 9 of 14, not number 11.
- Lines 1-279 hold about 5,700 words (wc), of a page of 8,386 words (stats.json). The section is later than the finding says, which makes the scan-order problem worse, not better.
- "Most projects use the Vite plugin" holds: docs/getting-started/install.md:21 and :36 make Vite and the plugin the normal setup, first-scene.md:22 needs it, and cdn.md:13 says a project that grows past a trial uses Vite and the plugin.
- The intro (line 23) and the diagram name only the command. No sentence before line 280 says that a `?optimized` import exists. docs/cli/null3d.md:472 sends readers to this page for the Vite route, and the skill (skills/null3d-develop/SKILL.md:105) names both routes side by side, so the page should show both early.
- The move is safe. The Vite section maps its `assets` options to the command's flags, and the options table that explains those flags sits in "Optimize a model" (lines 53-68), right above the new place. No page links to the anchor `#in-a-vite-project`, and the anchor does not change with a move anyway. The section has no forward references to the sections it would jump ahead of.
- The proposed intro sentence breaks no writing rule and names no internal process words.

## Corrected claim

The Vite section is H2 number 9 of 14, after the mesh, clip, blocker, texture, level-of-detail, budget report and shader list sections, about 5,700 words into an 8,400-word page. The intro does not mention the `?optimized` import, which is the usual route for a Vite project.

## Edit

The proposed edit stands: move "## In a Vite project" to right after "## Optimize a model", and add the intro sentence.
