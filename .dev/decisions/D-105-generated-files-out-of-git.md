# D-105: Generated files out of git

Status: decided and built. The owner ruled that git keeps no generated file unless a reason says it should. The owner left the details to judgement, and the coordinator chose them.

Summary: Git keeps no file that the docs generator or the skills sync writes, and written pages link to the generated pages they need. The install step, the git hooks, CI, the packages and each release build them. Kept in git, the skills copy took edits from 172 of 391 commits on main, and the API pages from 164.

## Question

Branches land on main one after another ([D-157](D-157-direct-pushes-to-main.md)), and each landing can conflict with the branches still open. Most such conflicts come in generated files. Which generated files leave git, how do they get built, and how does a fresh clone still work for people and agents?

## Rule

- No branch conflicts on generated output.
- After `bun install`, a fresh clone has `.claude/skills/`, because Claude Code loads project skills only from there. It also has every docs page that a link points to.
- Readers outside the repository still get every file: the npm packages, the Claude Code plugin, `bunx skills add`, the skill zips and links on GitHub.
- `bun install` never builds Rust, so the Mac's heavy-run limits hold.
- A generated file stays in git only for a reason that this record gives. The owner named three such reasons. The file must exist in a fresh clone before any install or build step. A tool outside the build reads it straight from GitHub. Or generating it needs something that CI lacks.

## Data

| Generated output | Its source | Commits on main that edited it |
| --- | --- | --- |
| `.claude/skills/`, the copy of `skills/` for Claude Code | `skills/` | 172 |
| The API reference on 23 written pages in `docs/api/` | TSDoc comments | 164. Of the page edits in them, 67 changed only the reference and 157 changed the reference and the prose |
| The page list in `docs/index.md` | Each page's front matter | 116, and 110 of them changed only the list |
| The three.js mapping page and the porting skill's 2 copies | `docs/data/threejs-mapping.json` | 86 |
| The error pages in `docs/errors/` | `packages/engine/src/errors/codes.ts` | 65 |
| The 4 tables of `docs/concepts/quality-presets.md` | The quality chooser's constants | 30 |
| The tables of `.dev/tested-devices.md` | The run folders' READMEs | 43, 5 of them in the tables |
| The shader library page | The WGSL library's doc comments | 15 |
| 13 placeholder pages of planned pages | The page inventory in `tools/lib/docs.ts` | few |
| `packages/engine/src/generated/core.ts` and `gpu.ts` | The constants in the Rust crates | 58 and 53 |

Of 5 open pull requests, 4 edited generated output: #408 edited 12 such files, #399 13, #398 6 and #346 13.

How the data was produced: `git log --name-only --since=2026-09-28 origin/main` at b83f603e9, and `gh pr list --json files`. A script compared each written page before and after each commit, with its generated parts removed.

## Options for generated parts of written pages

Four written pages need generated parts: the API pages, the docs index, the quality presets page and the tested devices page.

| Option | Conflicts on generated output | What readers see | Cost |
| --- | --- | --- | --- |
| A. Keep the parts in git | Yes, in most pull requests | The full page | The conflicts this record removes |
| B. A git clean filter empties each part when a page is staged | None | The full page on disk and in the packages. Empty parts on GitHub and in pull request diffs | A filter in each clone's git config. Git also takes a page whose part changed size as modified |
| C. Each part becomes a generated page of its own, and the written page links to it | None | One more link to follow | The written pages change once |

The coordinator chose option C over B. A filter hides content from what git stores, so GitHub and diffs show emptied parts, and people and tools trip over it.

## Decision

Option C, with these generated pages:

| Generated page | It holds | The written page that links to it |
| --- | --- | --- |
| `docs/api/reference/<page>.md` | One API page's reference | The API page, under its "API reference" heading |
| `docs/pages.md` | The list of all pages | `docs/index.md` |
| `docs/concepts/quality-preset-tables.md` | The 4 tables of the quality presets | `docs/concepts/quality-presets.md`, once at each table's place |
| `.dev/tested-device-tables.md` | The tables of tested devices | `.dev/tested-devices.md` |

- Git ignores every generated file: those pages, `.claude/skills/`, `docs/errors/`, the mapping page and its copies, the shader library page and each placeholder page by name.
- `bun install` writes them all with `bun tools/generate.ts`. The step runs only TypeScript and never builds Rust. Without the shader modules, the engine's API reference lacks the shader features, and the step says so.
- The git hooks after a checkout, a merge and a rebase write them again. The pre-commit hook writes them too. It fails on a generator's problems and on a generated file that git would keep.
- `bun run docs:check` writes the files first, then checks. It also refuses a written API page without its link to the reference page. CI's docs job checks that the generators wrote no file that git keeps.
- The engine package's pack step writes the docs before it copies them.
- After each full run on main passes, the CI job `generated-branch` pushes main's commit with every generated file to the `generated` branch. Only that job has write access to the repository's contents, and main's rules cover only main. Engine error messages and the README link to the error pages and the mapping page there.
- The Release workflow tags a commit that holds the version numbers, the changelog section and every generated file, built on top of the released commit. Main holds the same version numbers and changelog section, and no generated file. Only the tag points to the tagged commit, and its history ends at the released commit. So the next release's notes list every commit that main gained after the release. The plugin, `bunx skills add` and the zips read the tagged commit.

### Generated files that git keeps

| Files | Reason |
| --- | --- |
| `packages/engine/src/generated/core.ts` and `gpu.ts`, the constants that TypeScript shares with Rust | The Rust tests write them. Each TypeScript command would first need a Rust build of the engine's core and renderer, 10 to 60 seconds after each Rust change. Their Rust source conflicts in the same branches anyway |
| The render graph's text dump and the light grid's snapshot in `crates/null3d-render/tests/` | They are the tests' expected output, and reviewers read their diffs |
| The three.js fixtures in `crates/*/tests/fixtures/` | `cargo test` must run in a fresh clone, with no JavaScript step first. They change only when the pinned three.js changes: 6 of the 391 commits above |
| The vendored Basis transcoder and encoder, and the meshopt decoder, in `packages/*/vendor/` | The Basis build needs Emscripten, which CI lacks. The meshopt file comes from a pinned package. Both ship in the packages as they are |
| The asset tool's FBX and OBJ reader, `packages/cli/vendor/ufbx/ufbx.wasm` | Its build needs Emscripten too, which CI lacks. `bun tools/build-ufbx.ts` makes the same bytes from pinned sources, and a unit test pins its SHA-256 ([D-111](D-111-asset-conversions.md)) |
| The test files and outputs of `assets convert` in `tests/pages/assets/models/` | Blender made the FBX and OBJ files. The image test draws the outputs, and the unit test checks that the tool still writes the same bytes |
| The meshopt test files | Building them needs the downloaded sample content and gltfpack |
| The image references, the benchmark records in `bench/results/` and `.dev/benchmark-results.md`, and the README's animation | They are accepted outputs and measurements. Making them needs a real GPU and a person's review |
| The version numbers, `CHANGELOG.md` and `.claude-plugin/marketplace.json` | The release writes them. Claude Code reads the marketplace file straight from GitHub |
| `bun.lock`, `Cargo.lock` and the sample content's manifest in `tools/samples/` | They must exist before any install or download |
| The list of milestone task IDs, `tools/hooks/task-ids.txt` | The commit-msg hook reads it, and its source, the milestone plans, is kept outside git. The maintainers write it from the plans and commit it ([D-157](D-157-direct-pushes-to-main.md#task-footers-and-merge-commits)) |

## Consequences

- On GitHub, main has no generated page, so a relative link to one finds no file there. The `generated` branch and each release tag have every page.
- [AGENTS.md](../../AGENTS.md#docs-and-skills-stay-in-sync), [Branches and parallel work](../pull-requests.md#generated-files) and [Releases](../releases.md) describe the steps.
