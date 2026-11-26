# PR 579 check: docs pages without status and version labels

Branch `docs/no-status-labels`, commit 10aa9fb37, on merge base 5b2792e24. The branch also merges cleanly with the newer origin/main (7f9ced939).

I did not edit the worktree. I unpacked the branch and the merge base into scratch folders with `git archive`, ran the generator and checks there, and read the website repository (null3d-engine/website, main e3f085353) through `gh api`.

## Verdict

Inside this repository, the change does what the owner asked. No page carries `status` or `since`. Every generated page carries `generated: true`. The docs check still blocks a planned page and still finds a stale generated page. Each title note that also stated limits keeps them word for word.

I found one real problem outside the repository: the website. I also found three smaller problems in text that the change left behind.

## Problems

### 1. Real, medium: the website uses `status: generated` to pick the source link, and loses it

`null3d-engine/website` `scripts/docs-render.ts:295`:

```ts
const generated = fm.status === 'generated';
const source = generated ? repoUrl(version, page.path) : `${REPO_URL}/edit/main/${page.path}`;
```

Line 306 then labels the link "View the source on GitHub" for a generated page, and "Edit this page on GitHub" for any other page.

After this PR, generated pages carry `generated: true` and no `status`. The site will then treat all 124 generated pages as written pages. These are the error pages, the API reference pages, the All pages list, the three.js mapping, the quality preset tables, the first-use shaders page and the shader library. Each would get "Edit this page on GitHub" with a link to `edit/main/docs/...`. Generated files are not kept on main (D-105), so the link opens a missing file. This starts at the first website sync after a release that holds this PR.

The tags themselves are correct. Line 297 builds tags only from `fm.status` and `fm.since`, so no page shows a tag.

Fix: in the website, test `fm.generated === true`. D-397 says the website reads only `status` and `since` as tags (its "Rule" and "Consequences" sections). It should also say that the website reads the generated mark for the source link, or this PR should name the website change it needs.

### 2. Real, low: the release guide still describes the removed check on planned pages

`.dev/releases.md:194` (exit gate item 6): "Every docs page with `since: "0.1"` is `experimental` or `stable`, or has moved to a later version with a written reason ... the release script prints 0.1.0."

`.dev/releases.md:196`: "it passes only while no docs page with `since: "0.1"` is still `planned`."

The release script no longer reads pages (`tools/lib/release.ts` `releaseProblems` now takes only the version and the README), and pages have no `since`. The Docs-Checked trailer says ".dev/releases.md" was updated. The Versions section was updated, but this gate table was not.

### 3. Real, low: the port skill's evals still ask for version marks that the mapping no longer gives

`skills/null3d-port-threejs/evals/evals.json` lines 17, 19, 20, 21 and 34 each expect "..., marked as 0.2". The mapping's Since column was the only source of those marks, and this PR removes it. The expectations also go against AGENTS.md docs rule 6 ("no version markers"). The Skills-Checked trailer names only `SKILL.md` step 3 and `api-mapping.md`.

`skills/null3d-develop/evals/evals.json:85` ("... or that its docs status must be checked") is a weaker case. Its other half still holds, but pages now have no status to check.

### 4. Real, low: older decision records still say that hook docs are marked experimental

`.dev/decisions/D-173-addon-hooks.md:102-103` (ruling 3): "A new hook is marked experimental in its docs and types ... Experimental hooks stay marked". `D-173:169` and `D-223-plugin-interface-version.md:27` depend on that ruling.

The only "experimental" mark on the hook pages (`api/features`, `api/feature-draws`, `api/feature-effects`, `api/feature-instances`, `api/tasks`) was the note sentence that this PR removes. No public type carries `@experimental` either: I found 0 matches in `packages/*/src`. So D-173 ruling 3 now describes a mark that does not exist. D-397 should name D-173 ruling 3 as replaced for the docs, or the owner should rule on it.

Smaller historical mentions, which I do not count as blockers: `D-30-scene-queries.md:148` says "`docs/api/raycast` is experimental", and `D-91-level-planning.md:153` says "... `docs/concepts/lod.md` (experimental)".

### Minor wording in D-397, not a defect

The D-397 Decision section says "The page list, the three.js mapping and its skill copy lose their Status, Step and Since columns". Only the page list loses Status and Step. The mapping loses only Since, and the next sentence says that it keeps its Status column. The meaning comes through, but a split sentence would be clearer.

## What I checked and found correct

1. Written pages
   - On the branch, no `.md` file anywhere in the tree has `status:` or `since:` front matter.
   - No file under `docs/` or `skills/` contains "Roadmap step", "first released in", "experimental" or "status label". This includes the generated output.
   - For each of the 227 pages (103 written, 124 generated), I took the base note, removed the release sentence and the experimental sentence, and compared it with the branch note. All match.
   - Three pages differ only by their own wording of the experimental sentence: `cookbook/index` ("The APIs that the recipes use are experimental..."), `guides/assets-pipeline` ("The command is experimental...") and `pages.md`. Their removal is correct.
   - The baked light data note keeps "The format is stable: ..." word for word.
   - The only other changes in written docs are the docs home's status table and its matching sentences, and the mapping JSON's `since`, `sinceLegend`, `version` and `about` text.

2. Generators
   - `docs.ts` (reference pages, error pages, error index, page list, preset tables, mapping), `first-use-docs.ts` and `shader-library.ts` all write through the new `generatedFrontMatter` helper (`id`, `title`, `generated: true`, `summary`). None writes a status, a since or a release sentence.
   - `bun tools/gen-docs.ts --check` in the branch copy prints "docs OK (104 inventory pages)". 124 of the 227 pages carry `generated: true`, which is exactly the untracked, generated set.
   - The All pages list has two columns (Page, What it covers). The mapping has five, with no Since column. The skill copy's `threejs-mapping.json` has no `since`.

3. Docs check, tested with extra pages in a scratch copy
   - `status: planned` is refused with the hard rule 19 message.
   - `status: stable` with `since: "1.2"` on a written page is accepted.
   - A `generated: true` page that nothing writes is reported as "marked generated, but nothing generates it any more". This holds whether or not a page links to it.
   - An old-style `status: generated` page is reported too: it fails the status values and the inventory check.
   - The unit tests also cover a bad `generated` value and a bad `since`.

4. Leftover readers
   - Nothing in `tools/`, `packages/cli`, the skill scripts, `.github/workflows` or `tests/` reads `sinceLegend`, `STEPS_NOTE`, `shipsSentence`, `releaseOf`, `pageStatuses`, `PageStatus` or `tools/lib/steps`. The only `steps` imports are the creek showcase's own `./steps` module, which is unrelated.
   - `ErrorEntry.since` has no reader left.
   - The website's fallback menu, built from `pages.md`, parses only the first table cell, so the two-column list still works.

5. Tests and checks in the branch copy
   - All 62 tests pass in `docs`, `first-use-docs`, `shader-library`, `release`, `skills` and `frontmatter`.
   - `bun tools/skills.ts check`, the docs style check (`--all`), the decision records check, the commands check and biome on the changed tool files all pass.
   - The full type check could not run cleanly: the scratch copy lacks the built shader files and Playwright. None of its errors involve the changed files.
   - PR CI was still running when I checked, with no failures so far.

6. Trailers
   - Docs-Checked: accurate, except that `.dev/releases.md` was updated only in part (see problem 2). It does not list the four package READMEs or the AGENTS.md path table row, which the commit also changed. That gap is harmless.
   - Skills-Checked: accurate for what it names, but it misses the port evals (see problem 3).
