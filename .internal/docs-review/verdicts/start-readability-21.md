# Verdict: start-readability-21

## The finding as given

- Page: getting-started/third-party-notices
- Anchor: ## Each package (lines 17 to 32), ## The engine (40 to 54), ## The tools (62 to 84)
- Category: duplication. Severity: medium.
- Claim: The first table lists every third-party part of the engine, CLI and Vite plugin in one long cell each (13 projects for the engine). The next sections list the same parts again, one per row.
- Evidence: third-party-notices.md line 19 vs 42 to 54; line 20 vs 66 to 71; line 21 vs 77 to 84.
- Proposed edit: In ## Each package, replace those three cells with links to ## The engine and ## The tools. Keep full cells only for packages without a section. Optionally drop the Notices column and say once that each package with third-party code ships THIRD-PARTY-NOTICES.txt.
- Generated source: none (hand-written page).

Verdict: partly

## Evidence

- The duplication is real. Line 19 names the same projects as lines 42 to 54. Line 20 matches lines 66 to 71. Line 21 matches lines 77 to 84. The "Where" cells of line 19 also repeat the "Where" column of lines 42 to 54.
- The page is not only for readers. A repository check reads it: tools/lib/notices.ts.
  - `entriesOf` (notices.ts lines 101 to 118) reads every row of the "## Each package" table. It takes cell 2 as the third-party code, cell 3 as the license, and the LAST cell as the notices file.
  - `noticesProblems` (notices.ts lines 236 to 266) fails when a package that ships THIRD-PARTY-NOTICES.txt has a last cell without that file name. It also fails when a package with only its own code does not have "None" in both the license and the last cell. It fails when the third-party cell starts with "None" for a package that ships notices.
- The first part of the edit passes that check. A cell such as "13 projects, listed in [The engine](#the-engine)" does not start with "None", and the License and Notices cells stay.
- The optional part breaks the check. Without the Notices column, the last cell is "Where" (`vendor/`, `lib/index.js` and so on). The check then reports "the page does not name THIRD-PARTY-NOTICES.txt" for 9 packages, and "ships only its own code, so the page gives it no license and no notices file" for the 4 own-code packages (grass, impostors, particles, water). Line 13 already says once that every such package ships the file, so the column repeats that, but it cannot go without a change to tools/lib/notices.ts and its tests (tools/lib/notices.test.ts).
- The check's header comment (notices.ts lines 1 to 4) and its failure text ("Add its upstream, version and license") show the table row is meant to name the upstream code. A bare link with no names would weaken that. A short summary plus a link keeps the intent.

## Corrected claim

The first table repeats, in one long cell each, the parts that ## The engine and ## The tools list row by row (line 19 vs 42 to 54, line 20 vs 66 to 71, line 21 vs 77 to 84). The fix is right for the third-party cells. The Notices column cannot be dropped: the repository's notices check reads the last cell of each row of that table.

## Corrected edit

In ## Each package, shorten only the "Third-party code" cells of the engine, CLI and Vite plugin rows to a short summary with a link, for example:

- `@null3d/engine`: "13 projects, among them Basis Universal, Draco, meshoptimizer and three.js. See [The engine](#the-engine)."
- `@null3d/cli`: "Basis Universal, ufbx, three.js and the asset module's crates. See [The tools](#the-tools)."
- `@null3d/vite-plugin`: "naga, naga_oil and the shader compiler's crates, and the engine shaders it embeds. See [The tools](#the-tools)."

Optionally shorten the engine's "Where" cell the same way. Keep the License and Notices columns, and keep "None" in every cell of the own-code rows. Do not drop the Notices column unless tools/lib/notices.ts and its tests change with it.
