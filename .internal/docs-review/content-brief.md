# Brief for the docs content pull requests

You add the docs content edits for the areas of the null3D docs to pull request #582 (branch `docs/structure`), from a reviewed report. Read AGENTS.md in the repository first and follow every rule in it. This brief adds the task.

## Inputs

- The review report: `.internal/docs-review/report.md` (15,600 lines; read only the parts for your pages; grep by page id). Sections:
  - section 3 "Ranked edit list for each page" (per area, highest severity first; also "Findings that cross areas" near the top of section 3: take the parts that touch your pages);
  - section 4 "New content needed" (new sections on existing pages only; no new pages);
  - section 5 "Edits to generated pages' sources" (only the ones for your pages);
  - section 6 "Technical details blocks to add, page by page";
  - section 9 "Proposed rules" (the block rules; AGENTS.md "Writing docs" now holds the final form).
- Each finding has an id. Its full text and the verifier's verdict are in `.internal/docs-review/verdicts/<id>.md`. For a "partly" verdict, use the corrected claim and edit.
- The decision records `.dev/decisions/D-397-docs-without-labels.md` and `.dev/decisions/D-398-docs-structure.md` in your branch.

## Scope

Do, for the pages of your area:

1. Apply the edits of section 3, and section 4's new sections on existing pages.
2. Add the technical details blocks of section 6. Move dense, correct detail into blocks; never cut correct detail.
3. Make the generated-source edits of section 5 that belong to your area.
4. On every page you touch, also bring each paragraph to about 4 sentences or 90 words. The page statistics in `.internal/docs-review/stats.json` list the long paragraphs, but they were measured on an older copy, so measure again.

Do not:

- Split pages, add new pages, rename page IDs, or move sections between pages. These wait for a second look after the blocks land.
- Add demo links or screenshots. Separate pull requests do those.
- Add `status:` or `since:` front matter or any version note. Pages carry no labels.
- Edit pages outside your area, except to fix a link or anchor that your change breaks.

## Check every finding before you apply it

The report was written against an older copy of main. Main has moved since. Before each edit:

- Read the page as it is now, and the code the claim depends on.
- Apply the finding only if it still holds. Skip it if main already fixed it. Adjust it if the page changed.
- Some findings sit on pages that main changed after the review: api/debug, api/engine, api/three-compat, porting/threejs-mapping (its data), getting-started/hosting, guides/debugging, guides/deploying, guides/start-time, porting/threejs-overview, porting/threejs-shaders, porting/threejs-unsupported, and the debug and engine reference pages. Check those with extra care, and review their new paragraphs for length and clarity too.
- A claim about engine behavior must match the source code. Cite nothing you have not read.
- Keep a list of findings applied, adjusted and skipped (with the reason). Put it in the pull request body.

## Links and anchors

- Pages keep their IDs. A heading you rename changes its anchor: update every link to the old anchor in `docs/`, `skills/` (then run `bun run skills`), package READMEs and TSDoc. Prefer keeping headings that other pages link to.
- Anchors follow GitHub's slug rules (`slugifyHeading` in `tools/lib/links.ts`).

## Work and landing

- Work on branch `docs/structure` (pull request #582, which sits on #579; both are unmerged) in your own checkout. Run `bun install` in it.
- Fetch with explicit refspecs that update the remote-tracking refs: `git fetch origin +refs/heads/main:refs/remotes/origin/main +refs/heads/docs/structure:refs/remotes/origin/docs/structure +refs/heads/docs/no-status-labels:refs/remotes/origin/docs/no-status-labels`. A plain `git fetch` fails on a stale remote branch, and `git fetch origin main docs/structure` fills only FETCH_HEAD.
- Commit without signing, set per worktree (`git config extensions.worktreeConfig true`, then `git config --worktree commit.gpgsign false`). Author: Ramesh Nair <ram@hiddentao.com>. Push over HTTPS. Never skip hooks.
- Commit and push as you go, page by page or a few pages at a time, so nothing is lost.
- Conventional commit subjects with scope `docs`, no task IDs, record numbers or milestones. Every commit that changes `packages/*/src/`, `skills/` or `tools/` carries a `Docs-Checked:` trailer. One that changes a package's source, `skills/` or `docs/data/threejs-mapping.json` also carries `Skills-Checked:`. Trailer values say what you checked.
- Run the humanizer skill over all prose you write, TSDoc and error text included.
- Before you open the pull request, run: `bun run docs`, `bun run docs:check`, `bun run docs:style`, `bun run skills:check`, and the unit tests of any tool you changed (`bun test --timeout 60000 <files>`). Run `bun run typecheck` when TypeScript changed. Package tests run with `bun test --conditions null3d-source --timeout 60000 <files>`. Read every result.
- Heavy commands share machine-wide locks with other agents working at the same time. Wait for a lock; do not break one that a live process holds.
- Do not open new pull requests. Update #582's title and body as each area lands: what changed, the findings applied, adjusted and skipped, and the checks you ran. Do not merge it, and do not arm auto-merge.

## Return

A short plain summary: the commits pushed, the counts of findings applied, adjusted and skipped, what you could not do and why, and any check that failed.
