# start-readability-08

## Finding as given

- page: cli/null3d
- anchor: ## assets (lines 444 to 541)
- category: heading-depth
- severity: medium
- claim: Six assets commands (optimize, env, convert, pack-orm, normal-from-bump, impostor), each with its own command and option table, sit under one H2 with no H3. The outline shows only 'assets', so a reader cannot jump to assets env.
- evidence: stats.json headings: ## assets has no child heading. Commands start at lines 446, 474, 488, 500, 513, 527.
- proposedEdit: Give each command an H3 (### assets optimize, ### assets env, ...). Open ## assets with a 6-row table: Command | What it makes. On a split cli/assets page these become H2s.
- generatedSource: (none; the page is hand-written)

Verdict: survives

## Evidence

- docs/cli/null3d.md:444 is `## assets`. The next heading is `## upgrade` at line 543. The stats.json outline confirms no H3 between them.
- The six commands open at lines 446, 474, 488, 500, 513 and 527, as the finding says. Each has its own example block and its own option table.
- The section is about 100 lines with six option tables. A reader who wants `assets env` or `assets impostor` must scroll through the 13-row `assets optimize` table and its notes. The site outline gives no way in.
- The rest of the page already uses H3s under an H2 (`## shot`, `## mcp`, `## test`, `## bench`), so H3s here match the page's own pattern.
- No page links into the middle of the section. One link points to `null3d.md#assets`. Adding H3s keeps that anchor working.
- The headings `### assets optimize` and so on use sentence case, as the "Writing docs" rule asks.
- The page is not generated, so there is no generated source to name.

## Correction to the edit

The edit is right but leaves one gap. Line 525, "Both exit with 1 when an image cannot be read", covers `pack-orm` and `normal-from-bump` together. With an H3 for each command, "Both" would sit under `### assets normal-from-bump` and point back across a heading. Give each of the two H3s its own exit sentence, or put the two commands under one H3 ("### assets pack-orm and normal-from-bump"). Keep the link to the asset pipeline guide in both places, or in the shared H3.
