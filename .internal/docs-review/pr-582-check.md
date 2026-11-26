# PR 582 independent check (docs/structure, commit 3143d8f3d)

Reviewed: `git diff origin/docs/no-status-labels...origin/docs/structure` (one commit, 18 files).
Scratch copy: a detached worktree of origin/docs/structure, `bun install`, then the runs below.

## Verdict

No blocking problem. The finish line holds. The findings below are small gaps and stale text. None breaks a check, a build or the website contract.

## What I ran, and the results

| Run | Result |
| --- | --- |
| `bun run docs` | exit 0, 0 files changed after install |
| `bun run docs:check` | exit 0, "docs OK (108 inventory pages)", decision records OK (315) |
| `bun run docs:style` | exit 0, 0 `details_block` findings, warnings only |
| `bun run skills:check` | exit 0, 2 skills, 95 docs pages referenced |
| The 5 named unit test files | 64 pass, 0 fail |
| `bun test tools/` (every tool test) | 708 pass, 0 fail, 2 skipped, 53 files |
| Biome on the 9 changed code files | clean |
| `tsc -p tsconfig.json` | only errors from shader modules that the scratch copy did not build; none in the changed files |

## Finish line, item by item

- Area order: `tools/lib/docs.ts:74-118` gives getting-started, concepts, guides, cookbook, shaders, porting, api, cli, errors. Groups exist only on getting started, concepts, guides and api. Holds.
- No page ID changes: the base and branch inventories differ only by the four generated pages that were added (concepts/quality-preset-tables, guides/first-use-shaders, porting/threejs-mapping, errors/index). No file under `docs/` was renamed or deleted. Holds.
- PAGES lists every page the navigation shows, with generated pages marked `generated: true` (`docs.ts:153,168,195,199,251`). Generated pages take title and summary from PAGES through `generatedText` (`docs.ts:566-571`). Written pages read front matter only (`collectPages`, `docs.ts:574-589`; `referencePage` takes the written page's front matter title, `docs.ts:635-643`). Holds.
- `docs/nav.json` matches the contract exactly: top key `areas`; each area has keys `id`, `title`, `groups`; each group has `title` (null for cookbook, shaders, porting, cli, errors) and `pages`. 107 pages, all unique, every one exists on disk. No `api/reference/*` and no `errors/E*`. Holds.
- `docs/pages.md` shows the same 9 areas and the same `###` groups, 107 rows. Holds.
- `docs/moves.json` is committed as `{}`. End to end through `checkDocs` (simulated main): a removed entry, an old ID that is a page again, a dead end and a loop are refused; a kept entry and a chain pass. Holds.
- `docs:style` refuses a broken block (`docs-style.ts:266-335`, reported as `error` at `docs-style.ts:399-400`, and the hook exits 1 on errors at `tools/hooks/check-docs-style.ts:87-96`). Holds, with the gaps in finding 3.
- AGENTS.md states the inventory rule (`AGENTS.md:214`) and the block rule (`AGENTS.md:230`). Holds.
- Nothing else in the repository used the old shapes: the only outside users of `tools/lib/docs.ts` are `tools/gen-docs.ts` (PAGES.length), `tools/lib/skills.ts:95` (DOC_AREAS, same area IDs) and `tools/lib/generated.ts` / `tools/lib/pack.ts` (generateDocs). The CLI and the skills read docs pages by ID only. `nav.json` reaches the `generated` branch, because `tools/generate.ts --stage` stages every file that `generateDocs` returns (`tools/generate.ts:25-26`). The engine tarball now also carries `docs/nav.json` and `docs/moves.json` (`tools/lib/pack.ts:44` copies the whole folder); harmless.

## Findings

### 1. The "never remove a move" guard runs in docs:check and CI, but in no git hook (real if the plan requires the hooks; D-398 does not)

- The guard lives only in `tools/gen-docs.ts:16-24` (`git show origin/main:docs/moves.json`), which only `bun run docs:check` runs (`package.json:21`).
- CI runs it: `.github/workflows/ci.yml:124`, and that job checks out with `fetch-depth: 0` (`ci.yml:90-98`), so `origin/main` exists there. Good.
- No hook runs it: pre-commit runs `tools/hooks/check-generated.ts`, which calls `writeGenerated` and `gitProblems` only (`tools/hooks/check-generated.ts:10-11`); commit-msg runs the links and style checks; pre-push checks trailers only. The same is true of the new inventory and placement checks: none run in a hook.
- D-398's Consequences (`.dev/decisions/D-398-docs-structure.md:50`) promise this only for `docs:check`, so the commit matches its own record. If the owner's plan says "the hooks" too, this is a real gap.
- When `origin/main` is missing (a remote with another name, a shallow clone), the guard is skipped with no message (`gen-docs.ts:24`). Locally it reads whatever `origin/main` was last fetched.

### 2. A broken moves file on main crashes the check (real, low)

`tools/lib/docs.ts:767-768` parses `previous` with an unguarded `JSON.parse`. With invalid JSON on main, `docs:check` dies with a stack trace (reproduced) instead of a problem line. The current file's parse is guarded (`docs.ts:747-751`). Main's file passes CI, so this needs a bad merge to happen.

### 3. Block check gaps (real, low; none of these shapes is in the docs today)

No page or skill holds a `<details>` block yet, so "no false positives on the current docs and skills" is true but tests nothing. Probing `detailsBlockProblems` directly:

- Not refused: an empty body (`<details>`, summary, blank, `</details>`); a setext heading (`Title` over `=====`) or an HTML `<h2>` inside a block; a four-backtick ` ````mermaid ` fence inside a block (the fence regex at `docs-style.ts:281` reads its info string as `` `mermaid ``).
- False error: a four-backtick fence that holds an inner three-backtick fence; the inner opening line closes the outer fence (`docs-style.ts:282-284` closes on any fence of the same character), so the inner code is read as prose. A 4-space indented code block that shows `<details>` is also flagged. Inline code with double backticks around `<details>` passes, which is right.
- A one-character summary ("Technical details: x") is refused by `docs-style.ts:267`. Harmless.
- Everything the finish line names is refused: wrong summary, final period, no blank after the summary, no blank before `</details>`, heading, nested block, Mermaid, unclosed block, stray `</details>`, `<details open>`, a block in a list item, a table, a blockquote, CRLF.

### 4. A stray title on a written inventory entry is silently ignored (real, low)

`PageEntry` (`docs.ts:49-62`) is an intersection with a union, so TypeScript's excess property check accepts `{ id: 'concepts/x', title: 'T', summary: 'S' }` (checked with `tsc -p tsconfig.json`). The generator then ignores that title. "Written pages take theirs from front matter only" holds in output, but nothing refuses the stray fields.

### 5. Old link text for the two renamed pages (real, low, docs only)

The commit renames `api/ui` to "Labels that follow objects" and `guides/ui-overlays` to "HTML UI around the scene", but links still use the old titles:

- "UI overlays and labels" for `api/ui`: `docs/api/engine.md:108`, `docs/api/engine.md:170`, `docs/api/sketch.md:125`, `docs/guides/ui-overlays.md:46`, `docs/guides/ui-overlays.md:174`.
- "UI, HTML overlays and labels" for `guides/ui-overlays`: `docs/api/ui.md:121`, `docs/cookbook/index.md:659`, `docs/porting/react-three-fiber.md:232`, `docs/porting/threejs-loop-and-threads.md:224`.

The rename exists to tell the two pages apart, and these links keep the old, near-identical names.

### 6. "Every page" wording on the page list (real, low)

`docs/pages.md` now leaves out the error code pages and the reference pages, but its summary says "Every docs page by area and group." (`docs.ts:616`) and `docs/index.md:37` says "lists every page by area". The page's own note names the error index (`docs.ts:620`), so a reader is not lost.

### 7. Test name promises more than it checks (real, low)

`tools/lib/docs.test.ts` "finds no problem with the inventory, and reports a page with no group" only asserts `inventoryProblems()` is empty. No test feeds it a page with no group, a wrong group, a page in no area, or an empty group.

## Not problems

- `docs/nav.json` is git-ignored like every other generated file (D-105), listed in `.gitignore:51` and in `.dev/pull-requests.md:41`. The website gets it from the `generated` branch.
- D-398 is unique across all 257 remote branches; D-105's table is a dated record and needs no new row.
- The `bun.lock` change after `bun install` in the scratch copy is a version-number drift that main already has; this branch does not touch `bun.lock`.
