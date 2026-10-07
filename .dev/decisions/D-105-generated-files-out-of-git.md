# D-105: Generated files out of git

Status: decided by the owner on 2026-10-08, about 00:36. Two parts wait for the coordinator's answer. One keeps the shared constants in git for now. The other is about links on GitHub to generated pages.

Summary: Git keeps no file that the docs generator or the skills sync writes. Git ignores whole generated files, and a git filter empties the generated sections of written pages when they are staged. The install step and the git hooks write the files, and each release tags a commit that holds them. Of 391 commits on main from 2026-09-28, 172 edited the skills copy and 164 an API page. On 2026-10-08, 4 of the 5 open pull requests edited generated output.

## Question

Main has no merge queue since [D-99](D-99-no-merge-queue.md), so pull requests merge one after another, and each merge can conflict with the pull requests still open. Most of those conflicts were in generated files. How do generated files stop causing conflicts, while a fresh clone still works for people and agents?

## Rule

- No pull request conflicts on a generated file or on a generated section of a page.
- After `bun install`, a fresh clone has `.claude/skills/`, because Claude Code loads project skills only from there. It also has every docs page that a link points to.
- Every reader outside the repository still gets the full files: the npm packages, the Claude Code plugin, `bunx skills add` and the skill zips of each release.
- `bun install` never builds Rust, so the Mac's heavy-run limits still hold.

## Data

| Generated output | Its source | Commits on main that edited it |
| --- | --- | --- |
| `.claude/skills/`, the copy of `skills/` for Claude Code | `skills/` | 172 |
| The API reference on 23 written pages in `docs/api/` | TSDoc comments | 164. Of the page edits in them, 67 changed only the reference and 157 changed the reference and the prose |
| The page list in `docs/index.md` | Each page's front matter | 116: 110 changed only the list |
| The three.js mapping page and the porting skill's 2 copies | `docs/data/threejs-mapping.json` | 86 |
| The error pages in `docs/errors/` | `packages/engine/src/errors/codes.ts` | 65 |
| The 4 tables of `docs/concepts/quality-presets.md` | The quality chooser's constants | 30 |
| The tables of `.dev/tested-devices.md` | The run files | 43, 5 of them in the tables |
| The shader library page | The WGSL library's doc comments | 15 |
| 13 placeholder pages of planned pages | The page inventory in `tools/lib/docs.ts` | few |
| `packages/engine/src/generated/core.ts` and `gpu.ts` | The constants in the Rust crates | 58 and 53 |

On 2026-10-08, 4 of the 5 open pull requests edited generated output. #408 edited 12 such files, #399 13, #398 6 and #346 13.

How the data was produced: `git log --name-only --since=2026-09-28 origin/main` at b83f603e9, and `gh pr list --json files` on 2026-10-08. A script compared each written page before and after each commit, with its generated sections emptied.

## Options

| Option | Conflicts on generated output | Page layout for readers | Cost |
| --- | --- | --- | --- |
| A. Keep them committed, and regenerate after each merge | Yes, in most pull requests | Unchanged | The conflicts this record removes |
| B. Ignore whole files. Move each generated section of a written page to a page of its own | None | Each API page splits in two, the page list leaves the index page, and the preset tables leave their prose | A second read for every API lookup |
| C. Ignore whole files. A git clean filter empties each generated section when a page is staged | None | Unchanged on disk and in the packages | A filter that `bun install` sets up, and a check that refuses a page staged without it |

Git LFS uses the same kind of filter to keep large files out of git. The filter is a Perl one-liner. Git ships Perl on every platform, and Perl starts much faster than a JavaScript runtime for each file that git compares. In a scratch repository, two branches that each changed the API section and different prose of one page merged with no conflict.

## Decision

Option C. The owner decided that git keeps no generated file, and that CI, the packages and `bun install` build them instead.

- Git ignores the whole generated files: `.claude/skills/`, `docs/errors/`, the mapping page and its copies, the shader library page and each placeholder page by name.
- `.gitattributes` gives every docs page and `.dev/tested-devices.md` the filter `null3d-generated`. Its clean step empties the text between each `<!-- null3d:<name>:start -->` marker and its end marker. Git stores the empty markers, and the file on disk keeps the full page.
- `bun install` sets up the filter in the repository's git config, as husky sets up the hooks, and writes every generated file with `bun tools/generate.ts`. The step runs only TypeScript and never builds Rust. Without the shader modules, the engine page's reference lacks the shader features until the next run after `bun run shaders`.
- The git hooks after a checkout, a merge and a rebase write the files again. The pre-commit hook writes them too. It fails on a generator's problems, on a generated file that git would keep, and on a page staged with its generated sections.
- Git takes a file whose size differs from the size in its index as changed, without running the filter. So after it writes the pages, the generator stages each page whose emptied text matches what git stores. That changes no content, and the page no longer shows as modified.
- `bun run docs:check` writes the files first, then checks. CI's docs job checks that the generators change no file that git keeps.
- The engine package's pack step writes the docs before it copies them.
- Release Publish tags a commit that adds every generated file, in full, to the merge commit of the release. Main never holds that commit. Its parent is on main, so the next release's changelog starts after it. The plugin, `bunx skills add` and the zips read the tagged commit.
- The constants that TypeScript shares with Rust stay in git for now. To build them on demand, every TypeScript command would first build the engine's core and renderer for the Mac. That takes 10 to 60 seconds after each Rust change. Their Rust source conflicts in the same pull requests anyway.

## Consequences

- A branch from before this change gets conflicts once when it merges main. [Pull requests](../pull-requests.md#a-branch-from-before-generated-files-left-git) gives the steps.
- On GitHub, a link on main to a generated page finds no file. That covers the README's links to the mapping page and to two error pages, and the link in each engine error message.
- A clone without `bun install` has no filter, so a commit there would store the full sections. The pre-commit hook and CI refuse such a page and name the fix.
- [AGENTS.md](../../AGENTS.md#docs-and-skills-stay-in-sync), [Pull requests](../pull-requests.md#merge-main-into-a-branch) and [Releases](../releases.md) describe the new steps.
