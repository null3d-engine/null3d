# Pull requests and parallel work

This guide covers generated files, how to merge main into a branch, and how a pull request merges. It also covers what CI runs on each event and why its jobs are split as they are. Last, it covers several copies of the repository on one machine. [AGENTS.md](../AGENTS.md) holds the commit gates and the rules of merging.

## Before you open a pull request

Record the reasons for the change in `.dev/`, in the same pull request, as [AGENTS.md](../AGENTS.md#record-the-reasons) says. Each kind of reason has its place:

| Kind | Place | Example |
| --- | --- | --- |
| A design choice or an owner's ruling | A decision record, new or an addendum: the problem, the figures, the options rejected and why, and who decided and when | [D-92](decisions/D-92-safari-removed-frames.md) gives the memory that Safari kept on CI, the options, and the owner's confirmation on 7 October 2026 |
| A bug fix | The cause and why the fix is right, in the record or guide that owns the area | The framebuffer fault on the Pixel 10: [D-71](decisions/D-71-custom-effects.md) gives the cause, the per-call timings and the unit test |
| A device or benchmark run | A new run file in [tested devices](tested-devices.md), or a row in the [benchmark results](benchmark-results.md) | The iPad's custom effects run of 7 October 2026, in the iPad Pro's folder |
| A process or tooling lesson | The guide that covers it | Put each trailer on a plain commit, because the squash drops merge commits' messages, in [Commit messages and pushes](#commit-messages-and-pushes) |

The `Docs-Checked:` trailer names the page that holds the reason, or says why the change has no new reason.

## Generated files

Never commit a generated file, unless [D-105](decisions/D-105-generated-files-out-of-git.md) gives the reason to keep it. A generated file changes in every pull request that changes its source, so it clashes between them. Git can also merge its text cleanly into a result that no generator makes. So git ignores each generated file, and these steps build it.

| Generated files | Source | Generator |
| --- | --- | --- |
| The skills copy for Claude Code, `.claude/skills/` | `skills/`, without each skill's evals | `bun run skills` |
| The API reference pages, `docs/api/reference/` | The doc comments on the engine's exports | `bun run docs` |
| The list of all pages, `docs/pages.md` | Each page's front matter | `bun run docs` |
| The error pages, `docs/errors/` | The engine's error table | `bun run docs` |
| The quality preset tables, `docs/concepts/quality-preset-tables.md` | The quality chooser's constants and the preset table | `bun run docs` |
| The shader library page, `docs/shaders/library.md` | The WGSL library's doc comments | `bun run docs` |
| The three.js mapping page and the porting skill's 2 copies of the mapping | `docs/data/threejs-mapping.json` | `bun run docs` |
| The placeholder pages of planned pages | The page inventory in `tools/lib/docs.ts` | `bun run docs` |
| The tested device tables, `.dev/tested-device-tables.md` | The README of each folder in `.dev/tested-devices/` | `bun run docs` |
| The shader modules in `packages/engine/src/generated/` | The shader crate | `bun run shaders` |
| The WebAssembly files, and each package's built JavaScript | The Rust crates and the packages' TypeScript | `bun run build`, and each package's pack step |

`bun run docs` writes every file of the docs generator and the skills copy, with `bun tools/generate.ts`. These steps run it:

- The install step, `bun install`. A fresh clone therefore has `.claude/skills/` and every docs page after it. The step runs no Rust build.
- The git hooks after each checkout, merge, pull or rebase, and the pre-commit hook.
- In CI: the docs job, which then checks that the generators wrote no file that git keeps. The engine package's pack step writes the docs that the package holds.
- After each full run on main passes, CI pushes main's commit with every generated file to the `generated` branch. Links that must work on GitHub point there, such as the docs link in each engine error message.
- Each release tags a commit that holds every generated file, for the Claude Code plugin, `bunx skills add` and the skill zips.

Every command that reads the shader modules builds them first: the build, the type check, the unit tests, the dev server and the browser tests. The docs generator reads the engine's types, which import the shader modules. Without them, the engine's API reference leaves out the shader features, and `bun tools/generate.ts` says so. Run it again after `bun run shaders` or `bun run build`.

After you clone, run `bun install`. After a branch switch or a pull, the hooks write the generated files again. When a hook did not run, as in a worktree before its first `bun install`, run `bun install`.

### A clash on a generated file

Never merge a generated file by hand. Take main's side, run the file's generator, and commit what the generator writes.

- For a file that git does not keep, main's side is its deletion: `git rm --cached <path>`. The file stays on disk, and the generator writes it again.
- Git keeps the constants that TypeScript shares with Rust, `packages/engine/src/generated/core.ts` and `gpu.ts`, and the render graph's text dump in `crates/null3d-render/tests/snapshots/`. Take either side, then run `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-wasm -p null3d-gpu -p null3d-render`, and stage what it writes. Run it after every merge of main, also when git reports no conflict.

### Generated files that git keeps

[D-105](decisions/D-105-generated-files-out-of-git.md) gives the reason for each. They are:

- The constants shared with Rust, and the Rust tests' snapshots
- The three.js test fixtures, the meshopt test files and the image references
- The vendored Basis and meshopt builds
- The benchmark records and the README's animation
- What a release writes: the version numbers, `CHANGELOG.md` and the plugin's marketplace file
- The lock files and the sample content's manifest A new kind of generated file goes into `.gitignore`, unless its pull request adds its reason to D-105.

## Merge main into a branch

- Merge main into your branch. Do not rebase a branch that you pushed, because a rebase needs a force push (see [Commit messages and pushes](#commit-messages-and-pushes)).
- Never merge a generated file by hand. [Generated files](#generated-files) says how to resolve a clash on one.
- A branch from before git stopped keeping the shader modules gets a conflict on each module that it changed when it merges main. Resolve them all with `git rm --cached packages/engine/src/generated/shaders*.ts`, which keeps the files for the next build to replace.
- Check the shared numbers after the merge. Two branches can each take the next free number, and git then merges both lines without a conflict. The shared numbers are the error codes (`packages/engine/src/errors/codes.ts`) and the scene command numbers (`crates/null3d-wasm/src/constants.rs`). They are also the draw list's opcodes and pipeline template numbers (`crates/null3d-gpu/src/drawlist.rs`), and the decision record numbers. The bindings and slots that a shader and its bind group layout share are shared numbers too. A unit test catches a clash in some of these lists, such as the opcodes, but not in all of them. The docs check, `bun run docs:check`, refuses two decision records with one number.
- Build and run the quick checks again before you push the merge: lint, types, docs, skills and unit tests. Then rerun the browser and image tests only of the areas that the merge's conflicts touched. CI runs every test on the pull request merged into main.
- Run a branch's own copy of a hook's tool, such as `tools/hooks/check-trailers.ts`, from that branch's checkout. Another checkout's copy can be older, and refuse a valid `Size-Growth:` name.

## A branch from before generated files left git

Git kept the generated files until 8 October 2026 ([D-105](decisions/D-105-generated-files-out-of-git.md)). A branch from before then conflicts with main once, when it merges main. Merge main, and for each conflict on a generated file that main deleted, take the deletion with `git rm --cached <path>`. Where a written page conflicts on its old generated part (an API reference, the page list or a table), take main's side. Then run `bun install`, check that `bun run docs:check` passes, and commit the merge.

## A branch that edited the old table of tested devices

The record of [tested devices](tested-devices.md) was one table until 7 October 2026, and each run added text to a cell of its row. Now each run is a file of its own ([D-97](decisions/D-97-tested-devices-per-file.md)). A branch that edited the old table conflicts with main on `.dev/tested-devices.md`. Move its edits into the new files in one step:

1. Note the branch's last commit before the merge: `tip=$(git rev-parse HEAD)`.
2. Fetch and merge main. Take main's page for the conflict: `git checkout --theirs .dev/tested-devices.md`.
3. Run `bun tools/tested-devices.ts --branch $tip`. It compares the branch's table with the table where the branch started, its merge base with `origin/main`. It writes a run file for each row's new plans and results, and a new folder for each new row. It puts changed facts and new known issues in each README.
4. Read its notes. A note names each cell that the branch changed in place rather than added to, and each fact that it changed. Check those files by hand.
5. Run `bun run docs`. Stage the page and the new files, and commit the merge.

## Commit messages and pushes

- A merge commit must pass the commit-message check, as every commit does. A message such as `Merge origin/main into <branch>` passes, and so do git's own merge messages. A message such as `merge origin/main` fails, because the check reads it as a commit without a type.
- Never force push a pull request's branch, so never amend, rebase or squash a commit that you pushed.
- Main squashes each pull request, but CI checks the message of every commit in the pull request until it merges. A pushed commit with a bad message therefore fails CI for as long as the pull request is open.
- Put each trailer on a plain commit, never on a merge commit; an empty commit can carry it. Main's squash keeps the messages of the pull request's plain commits and drops the merge commits' messages. CI's trailer check and size check therefore read only the plain commits, so a trailer on a merge commit fails on the pull request. On 7 October 2026, #397's `Size-Growth:` trailer sat on a merge commit. Its own size check passed, and the merge queue's check of the squash failed ([Benchmarks](benchmarks.md#download-size)).
- To fix a bad message, open a new pull request from a new branch with a clean history. It replaces the old one. For example, `git switch -c <new-branch> origin/main`, then `git merge --squash <old-branch>`, then commit with a good message. Close the old pull request, and link the new one from it.

## Merging

Main does not use a merge queue from 7 October 2026 ([D-99](decisions/D-99-no-merge-queue.md)). A pull request merges by squash once its full CI run passes, and [AGENTS.md](../AGENTS.md#releases) gives the rules.

- CI's last job, `ci-passed`, waits for every other CI job, and it passes only when each one passed. On a draft pull request it also accepts the browser, benchmark page and real-browser jobs, which skip a draft by their own condition. In every other run, every job must pass.
- Main's rules require two checks: `ci-passed`, and `squash-title` from the PR title workflow. So a CI job can split into more shards and change its name with no change to the rules.
- Mark a pull request ready for review only when its work is complete, with `gh pr ready <number>`. That starts its full run, and so does each later push. A full run takes about 100 runner minutes and 2 macOS jobs.
- Merge with `gh pr merge <number> --squash` once the checks pass, or add `--auto` to merge as soon as they pass. Do the steps of [Before a merge](#before-a-merge) first.
- When a job fails, read its log, and find whether the pull request caused the failure. `gh run view <run> --log-failed` prints the failed steps. A test that fails only under load, or a run that GitHub cancelled when a runner shut down, says nothing about the pull request. Run the failed jobs again with `gh run rerun <run> --failed`. Otherwise fix the cause and push. Record the cause in `.dev/` either way.
- Two tests are known to fail only on a loaded machine. One is the GPU loss test "draws on after a GPU loss" on SwiftShader. It got no frame in its fixed recovery wait, in full local runs while the Mac's load was 21 to 30. The other is the benchmark page test of S4 on SwiftShader. It drew no frame in its short run, in CI runs 37289400132 and 37578361814. Both passed when they ran again. In each, the slow software GPU took longer than the test's fixed window to draw the first frame after a start or a loss. A rerun alone shows whether a failure is this ([Image tests](image-tests.md#tests-on-slow-machines)).
- The Safari and Firefox jobs compare the image tests with the Mac's `chrome-real-gpu` references. A test without one of these references, or without its SwiftShader reference, fails `bun run check` in the quick checks. So a draft's run shows it too ([Image tests](image-tests.md#references)).
- When main's run fails, nothing merges until a fix lands. Find the cause as for a pull request. A fault of the combined code gets a fix pull request at once, which merges first. A failure that says nothing about the code is run again.

### Before a merge

Main has no merge queue, so pull requests that change the same code files merge one after another. The smaller or readier one merges first. Each later one merges main again, passes its checks, and only then merges.

A pull request's run tests GitHub's merge of it into main as main was at the push. It does not hold the pull requests that merged since, or those that will merge before it. So before a pull request merges, its author tests it against main and the pull requests about to merge:

- Merge current main into the branch, run the generators, and push. Run the quick checks, and the browser and image tests of the areas that the merge touched.
- Test it combined with each pull request that will merge before it too. Merge them all into a scratch branch on top of current main, and build it. Then run the quick checks and the tests of the areas that they share.
- Run `bun run build:check-size` with current main merged. The pull request's own size check compared with main as it was at the last push. On 6 October 2026 a pull request failed its size check for two files that had grown 2.0% against the newer main.
- Two pull requests that add text at one place of a file clash after the first one's squash. This happens even when one pull request already contains the other's text. Merge the second only after the first merges, and merge main into it first. The record of [tested devices](tested-devices.md) had many of these clashes, so each run there is now a file of its own ([D-97](decisions/D-97-tested-devices-per-file.md)).
- Main's full run after the merge is the last check of the combined code. The size check of a run on main compares with the commit before. So a file's growth counts only against the pull request that makes it.

## What CI runs where

Each event runs every job, apart from a draft pull request, by the owner's decision of 7 October 2026 ([D-99](decisions/D-99-no-merge-queue.md)).

| Event | Jobs |
| --- | --- |
| Draft pull request | The quick checks: `build`, `docs-and-tools`, `rust-lint`, `rust-tests`, `size-base`, `wasm-checks`, `shader-compiler` and `packages` |
| Pull request ready for review: opened, pushed, reopened, or marked ready | Every job: the quick checks, the 7 `browser` shards and the job of the tests that run alone, the 2 `bench` shards, and the `real-browsers` shards in Safari and Firefox |
| Push to main | Every job, on the code that the merge made. Main's jobs also keep the caches, and `wasm-checks` keeps the commit's sizes |
| Started by hand | Every job, on the branch that the run names: `gh workflow run ci.yml --ref main` |
| Merge queue | Every job, only while main's rules still use the queue |

- A new push to a pull request cancels the run of its older push. Runs on main each have a group of their own, so a merge never cancels main's run of the merge before.
- CI's Chrome tests draw on SwiftShader only, and Firefox on Linux draws with a software renderer. The Mac's real GPU gets no run in CI, apart from Safari. So run the browser and image tests of the areas that a pull request touches once on the Mac's GPU, before it is ready for review. Run `bun run test:browser` with Playwright's `--grep` or a spec file, and `bun run test:images` with `--grep`. A change that Safari or Firefox may treat differently also runs `bun run test:real-browsers Safari Firefox` ([Device sessions](devices.md)).
- Before 6 October 2026, every pull request and every push to main ran the full suite, about 100 runner minutes each. GitHub Free runs 20 Linux jobs at once, so the queue's runs waited for runners for about half of their 32 minutes. From 6 to 7 October 2026, pull requests ran only the quick checks, and the queue ran the rest ([D-86](decisions/D-86-ci-runs-per-event.md)).

## CI's jobs

- One `build` job builds the WebAssembly files and the shader modules, and every browser, benchmark and macOS job downloads them. Before, each browser shard built them again, which took 1.5 minutes.
- The browser tests run in 7 shards and the benchmark page tests in 2, so each takes about 5 minutes or less. Before the split, in the 25 runs up to 1 October 2026, the two browser shards took 10 and 12 minutes. A whole merge queue run took 16.5 minutes. After it, a pull request's run took 6.9 minutes.
- Playwright splits the browser tests by count, so the `browser` job weights its shards. [Image tests](image-tests.md#ci) says how to retune the weights.
- The size check's job, `wasm-checks`, measures the `build` job's files against the base's sizes. The `size-base` job builds those sizes beside the `build` job, or finds them in the Actions cache ([Benchmarks](benchmarks.md#download-size)). The shader compiler test runs in a job of its own, `shader-compiler`. Before, `wasm-checks` built the head, then the base, then ran that test. That took 11.1 minutes of its 15-minute limit in merge queue run 37248715227 on 5 October 2026. After the split, `wasm-checks` took 0.8 minutes.
- Formatting and Clippy run in `rust-lint`, and the tests in `rust-tests`. `rust-tests` runs the tests through cargo-nextest, which runs the tests of every test file at once. Then `cargo test --doc` runs the documentation tests, since nextest runs none. Before, `cargo test` ran the test files one after another, for 6.2 of the Rust job's 6.7 minutes in that run. Locally, `cargo nextest run --workspace` runs them the same way.
- `.config/nextest.toml` runs each test of the 5 test files that count allocations with the machine to itself, as `cargo test` did. These tests count the job workers' allocations too. Under the load of the other tests, the light grid's allocation test failed once in CI. It counted frees from job workers that an earlier case had stopped. The counter now stops counting a worker when its work returns ([Implementation notes](implementation-notes.md)).
- Those tests run first, and the shader build's slow tests next. A test that needs the whole machine waits until every running test ends. In the default order, it held the run back behind the slow tests each time. The tests then took 8.2 minutes in CI, against 2.8 minutes without the isolation. The new order took 2.5 minutes on 4 threads of a MacBook Pro.
- Only main's runs save caches, and every run restores main's. These are the Rust builds, the packages, Playwright's Chromium, the sample content and the base sizes. The workflows' `SAVE_CACHES` decides it. A merge queue run has a branch of its own, and a run restores only the caches of its own branch and of main. So a cache that a queue run saved would serve no pull request. So main's runs save them: each job its own, and `wasm-checks` the commit's sizes. On 5 October 2026, the repository's caches held 10.7 GB against GitHub's limit of 10 GB. Past the limit, GitHub drops the oldest caches. Pull requests and merge queue runs each saved copies that only their own later runs could restore. The package install with its cache is the action `.github/actions/bun-install`.
- Main's rules require `ci-passed`, not each job, because a job that splits into more shards changes its name. Without that job, a new shard would strand every open pull request.
- Playwright's Chromium and its Ubuntu packages stay in the Actions cache. Ubuntu's package mirror stalls for 30 to 110 seconds on some files, and the install once took 11.5 minutes of a 4-minute shard.
- The Rust caches are keyed by the workspace's `Cargo.toml`, because the cache's own key leaves out the build profiles. After a profile change, each run restored the old cache and compiled the dependencies again, for about 3 minutes.
- Development builds optimize the dependencies (`[profile.dev.package."*"]`), so the shader tools' tests and `bun run shaders` parse and validate WGSL about 4 times faster.

## Several copies on one machine

People and agents often work in several copies of the repository at once, such as git worktrees.

- Give each copy its own ports with `NULL3D_PORT`, as [AGENTS.md](../AGENTS.md#performance-work) says. Each copy then uses its port and the three ports above it.
- Stop only your own servers. Find the process on your port with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`, and stop that process. Never stop a server or a browser by its name, because that also stops the servers and runs of the other copies.
- Close the browser tabs that you open as soon as each test ends, as [Device sessions](devices.md#the-runner) says.
- The dev server ignores changes in folders named `.claude`. A dev server in a worktree under `.claude/worktrees` therefore serves old files after an edit, until you restart it.
- Agent tools can lock a worktree. `git worktree list` shows "locked", and `git worktree list --porcelain` gives the reason, which can name a process id. When that process no longer runs, the lock is stale, and `git worktree unlock <path>` clears it.
- The size check builds main in a worktree of its own, `target/.size-base/tree`, inside each copy that runs it ([Benchmarks](benchmarks.md#download-size)). `git worktree list` therefore shows one under each such copy. After you delete a copy's folder, `git worktree prune` removes the worktrees whose folders are gone.
