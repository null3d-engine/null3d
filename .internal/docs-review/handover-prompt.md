Continue the null3D docs improvement work in the engine repository, in pull request #582 (branch `docs/structure`, https://github.com/null3d-engine/null3d/pull/582). Read AGENTS.md first and follow every rule in it: the writing rules, the commit trailers, the docs checks, recording reasons in `.dev/`, and the independent check before a pull request merges.

## Where things stand

- **#579** (`docs/no-status-labels`): removes the `status`/`since` front matter and the "Roadmap step 0.x ... The API is experimental" note from every page. Generated pages carry `generated: true`. Record: `.dev/decisions/D-397-docs-without-labels.md`. Open, checked, up to date with main. The website's matching change (null3d-engine/website #4) is merged.
- **#582** (`docs/structure`, stacked on #579, base branch `docs/no-status-labels`): areas reordered, groups in getting started, concepts, guides and the API, one inventory `PAGES` in `tools/lib/docs.ts` that holds every navigation page (generated ones marked), `docs/nav.json` generated for the website, `docs/moves.json` committed (`{}`), the technical details block rule in AGENTS.md and its check in `tools/lib/docs-style.ts`. Record: `.dev/decisions/D-398-docs-structure.md`. Open, independently checked, its findings fixed, up to date with main. Merge order: #579, then #582 (retarget #582 to main after #579 merges).
- Main's CI had version test failures after the 0.1.0 release; main has fixed them.

## The owner's decisions

- No page ID changes; groups instead of moves. The larger moves (deploy and extend areas, agents guide or custom shaders moved) are rejected.
- Technical details blocks land first. Page splits and the 20 new pages from the review wait for a second look at page length. When `api/materials` splits, the material layers leave it.
- Generated pages are placed in the inventory with `generated: true`.
- Pictures that the review placed on generated pages go on the related written pages only.
- Screenshots (a later pull request): the new capture tool `tools/docs-screenshots.ts` captures every shot at about 1,600 pixels wide, demo default views included, because the image test references are only 320 x 180. Each shot lists the demo's folder and its reference image among its source files, so a reference change flags the shot for a redraw.

## Your task: the docs content, in #582

Add the content edits to branch `docs/structure` (pull request #582), area by area, committing and pushing after each area. Open no new pull requests. Update #582's title and body as the content lands.

The review's files are on the helper branch `docs/review-handover`, which never merges. It holds them under `.internal/docs-review/`, a folder that git ignores in every other branch. Check out `docs/structure`, then copy the files into your checkout without staging them:

```sh
git fetch origin +refs/heads/docs/review-handover:refs/remotes/origin/docs/review-handover
git restore --source=origin/docs/review-handover --worktree -- .internal/docs-review
```

Then read `.internal/docs-review/content-brief.md`, which gives the scope and the rules. The other files:
- `report.md`: section 3 has the ranked edits per page (each finding has an id), section 4 the new content, section 5 the generated-source edits, section 6 the technical details blocks, section 9 the block rules and open questions. Sections 7 and 8 (shots and demo links) are for later pull requests.
- `verdicts/<finding-id>.md`: each finding with the verdict of an agent that tried to disprove it. For "partly", use the corrected claim.
- `findings/`: each reviewer's full review, including findings below its top 30 that nobody verified.
- `stats.json`: per-page paragraph and heading statistics, from an older copy of main.
- `partial-start.patch`: a first, unreviewed rewrite of `docs/getting-started/install.md`. Use it or ignore it.
- `pr-579-check.md` and `pr-582-check.md`: the independent checks of #579 and #582. Their findings are fixed, except that the moves guard runs in the docs check and CI, not in the commit hooks.

Areas, in this order: getting started with the home page, cookbook and the command-line page; concepts; guides; the written API pages; the generated API reference (`tools/lib/api-docs.ts` and the TSDoc in `packages/*/src`); shaders and porting (with `docs/data/threejs-mapping.json` and the shader library); the error pages (`packages/engine/src/errors/codes.ts`, `fixes.ts` and the error page code in `tools/lib/docs.ts`).

For every area:
- Check each finding against the current page and the source code before you apply it. The review read an older main. Apply, adjust or skip each one, and keep the list for the pull request body. These pages changed on main after the review: api/debug, api/engine, api/three-compat, the three.js mapping data, getting-started/hosting, guides/debugging, guides/deploying, guides/start-time, porting/threejs-overview, porting/threejs-shaders, porting/threejs-unsupported.
- Fix verified wrong claims first. Then add the technical details blocks, and bring every paragraph you touch to about 4 sentences or 90 words. Never cut correct detail; move it into a block.
- Do not split pages, add pages, change page IDs, add demo links or add screenshots.
- Two Mermaid diagrams cannot be drawn on the website: `api/feature-instances` and `api/vertex-draws` each name a node `call`, a Mermaid keyword. Rename those nodes.
- Run `bun run docs`, `bun run docs:check`, `bun run docs:style`, `bun run skills:check`, the tests of any tool you change (`bun test --timeout 60000 <files>`; package tests with `--conditions null3d-source`) and `bun run typecheck` when TypeScript changes. Run the humanizer skill over the prose you write.
- Before you report the work done, have a fresh agent that did not write it try to disprove it, and fix what it finds.

## Gotchas

- A plain `git fetch` fails on a stale remote branch, and `git fetch origin main docs/structure` fills only FETCH_HEAD. Use explicit refspecs: `git fetch origin +refs/heads/main:refs/remotes/origin/main +refs/heads/docs/structure:refs/remotes/origin/docs/structure +refs/heads/docs/no-status-labels:refs/remotes/origin/docs/no-status-labels`.
- To catch up with main: merge main into `docs/no-status-labels` first, push, then merge that branch into `docs/structure`. In `PAGES`, written pages carry no title or summary; keep that when you resolve conflicts, and put main's new titles and summaries in the pages' front matter.
- Commit without signing, set per worktree (`git config extensions.worktreeConfig true`, `git config --worktree commit.gpgsign false`), as Ramesh Nair <ram@hiddentao.com>, and push over HTTPS. Never skip hooks. `bun install` may change `bun.lock`; do not commit that.
- Commit subjects name no task IDs, record numbers or milestones. Commits that change `tools/`, `packages/*/src/` or `skills/` need `Docs-Checked:`; package source, `skills/` and the mapping data also need `Skills-Checked:`.
- Do not merge any pull request. Tell the owner when one merges, so they can sync the website.

## After the content

The remaining pull requests, each its own, in order: demo links on each concept, guide and API page (report section 8, links in the form `https://github.com/null3d-engine/null3d/tree/main/examples/<code>`, plus the list of concepts with no demo); screenshots (report section 7, the capture tool, `docs/images/shots.json`, the new hard rule beside rule 34, the guide, a decision record, and the docs:check, hook and trailer checks); and a `long_paragraph` warning in `tools/lib/docs-style.ts`. Ask the owner before you start them.
