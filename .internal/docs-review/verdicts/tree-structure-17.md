# tree-structure-17

## The finding as given

- page: cli/null3d, guides/assets-pipeline
- anchor: ## mcp / ## assets
- category: split-page, severity: medium
- claim: The command-line tool is one 7,450-word page with ten commands, and the full guide to its assets command sits in Guides.
- evidence: stats.json cli/null3d words=7450, 5 Mermaid, 13 h3; headings create | shot | Replay a recording | Timed scripts | mcp | test | bench | check-addon | assets | upgrade. guides/assets-pipeline title 'The asset pipeline (the `assets` command)', 8386 words.
- proposedEdit: Keep cli/null3d as the overview (install, command list, create, upgrade, check-addon, where the commands draw). Split cli/test NEW (test, shot, replay, timed scripts), cli/bench NEW, cli/mcp NEW. Move guides/assets-pipeline -> cli/assets and merge the assets section into it.
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: partly

## Evidence

- The split of the command page holds. docs/cli/null3d.md has 7,450 words (stats.json). Three of its sections are each a full reference with their own diagram and sub-headings: shot with timed scripts (lines 41-188), mcp (189-241), test (242-333) and bench (334-409). The assets section (444-542) holds six sub-commands with five option tables. The CLI area has only this one page (tools/lib/docs.ts line 189), so a reader who wants the `test` options gets the whole tool.
- The move of guides/assets-pipeline into cli/ does not hold.
  - The guide is a task and concept guide, not a command reference. It explains what the steps do to meshes, clips and textures (lines 70-260), the shader list the engine reads (266), and the Vite plugin route with `?optimized` imports (280), which is not a command at all. Under cli/ that last part would sit in the wrong place.
  - Moved and merged, cli/assets would be about 9,500 words. That is larger than the page the finding wants to shrink.
  - 14 docs pages link to assets-pipeline.md. The skills cite the page ID `guides/assets-pipeline` in skills/null3d-develop/SKILL.md:105, references/recipes.md:113 and :995, and references/performance.md:113-114. A rename must change all of them, under the "Docs and skills stay in sync" rule.
- The real problem on the assets side is duplication, not where the guide sits. The `assets optimize` option table is in docs/cli/null3d.md (from line 452) and again in docs/guides/assets-pipeline.md (lines 56-69, 24 option rows on that page). The two tables already differ: the CLI row for `--lod` gives the 64-triangle threshold and the cluster sorting, and the guide row for `--texture-quality` gives the size cost. A reader can get two different answers.
- Cost of the split: 11 docs pages link to cli/null3d.md, some with anchors that would move. Examples: guides/testing.md:133 (#timed-scripts), :168 (#test), :192 (#references-and-results), and guides/agents.md:67 (#mcp). The skills also cite `cli/null3d` for test and timed scripts (references/e2e-testing.md:3 and :62, references/testing-and-debugging.md:3, :72 and :91). All of these must be pointed at the new pages.

## Corrected claim

The command page is one 7,450-word page for ten commands and should be split. The assets guide is in the right area. On the assets side the defect is that the `assets optimize` options are listed twice, in tables that already differ.

## Corrected edit

- Keep cli/null3d as the overview: install, the command list, create, check-addon, upgrade, and where the commands draw.
- Add cli/test (test, shot, replay a recording, timed scripts), cli/bench and cli/mcp as new entries in PAGES in tools/lib/docs.ts.
- Add cli/assets as the one reference for every `assets` sub-command and its options (optimize, env, convert, pack-orm, normal-from-bump, impostor), moved from cli/null3d lines 444-542.
- Keep guides/assets-pipeline in Guides under its current ID. Delete its duplicate optimize option table (lines 56-69) and link to cli/assets#optimize instead. Move any facts found only in the guide's rows (such as the UASTC size cost) into the cli/assets table.
- Update the inbound links and anchors in docs (guides/testing, guides/agents, and the other pages that link to cli/null3d.md). Update the page IDs cited in skills/null3d-develop (references/e2e-testing.md, references/testing-and-debugging.md) to cli/test or cli/mcp.
