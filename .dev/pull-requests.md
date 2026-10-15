# Pull requests and parallel work

Since 13 October 2026, work lands on main by direct push, without pull requests ([D-157](decisions/D-157-direct-pushes-to-main.md)): merge `origin/main` into the branch, run the local checks that D-157 lists, push the branch's commits to main without waiting for main's CI, and fix main at once if your push turned it red. Where this guide says "pull request" below, read "branch": the trailers, records and checks are the same.

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

### Builds

A build compiles the Rust crates for two WebAssembly variants and the build tools, writes the shader
modules for every feature, and then builds the test page for the size report. It is the longest step
in a landing, so keep the count down. Every build cache lives under one root, `~/.cache/null3d` by
default, each in a named subfolder: `shader-modules`, `shader-cache`, `wasm-artifacts` and, when
sccache is installed, `sccache`. `NULL3D_BUILD_CACHE` names another root, and the older per-cache
variables still name one folder. Clearing the root is always safe, because every entry is a pure
function of its inputs, so re-checking a branch on a moved main is cheap.
[D-176](decisions/D-176-wasm-artifact-cache.md) and
[D-177](decisions/D-177-build-cache-module.md) give the keys, and
[Benchmarks](benchmarks.md#build-caches) the figures.

- `bun run build --pages-only` while developing and looking at a scene; the full `bun run build` when a
  landing needs the size check. `NULL3D_NO_CACHE=1`, or `--no-cache`, builds every file again.
- A cache is used only when its entry is whole. The shader modules cache, for example, requires every
  module that `shaders.ts` loads, from its imports and the device module names its tables hold. A set
  that misses one is a miss, so the build runs again rather than reporting "up to date" while a file is
  absent.
- Never a build beside a browser or image run of the same worktree. A half-written core makes a page
  fail for no reason (`E1402`, `E1406`). Builds themselves may run at the same time: each stages its
  output in a folder of its own, named for the build's process, and Cargo locks a target folder while
  it writes. A size check takes the checkout's own lock, `target/build.lock`. The base commit is built
  with that commit's own build script, in a base tree under this checkout's target folder. Size checks
  of two checkouts therefore run at the same time.
- Each checkout builds Rust into its own `target` folder. Never point two checkouts at one Rust build
  folder, with `CARGO_TARGET_DIR` or `NULL3D_CARGO_TARGET`. Cargo finds the engine's crates at the
  same workspace paths in every checkout and judges them fresh by file times. So a shared folder lets
  one checkout compile or link against another checkout's build of `null3d-gpu`, `null3d-render` or
  the shader compiler. The caches above then store that output under the right key, and the bad entry
  outlives the build. On 14 and 15 October 2026 this gave branches a stale shader compiler, another
  branch's GPU constants, and a core without its own feature.
  [D-177](decisions/D-177-build-cache-module.md#addendum-15-october-2026-one-rust-build-folder-per-checkout)
  gives the reasons.
- sccache, when installed, compiles the dependency crates once for every checkout. The build uses it
  through `RUSTC_WRAPPER` when it finds `sccache` on the `PATH` and no wrapper is set; an empty
  `RUSTC_WRAPPER` turns it off. sccache keys each compile by the contents of its sources, flags and
  dependencies, never by file times, so sharing it across checkouts is safe. Without sccache the
  build runs as before, as in CI.
- When a core change seems to be ignored, build with `NULL3D_NO_CACHE=1`, and check the flags word
  that a material row holds before looking anywhere else.

A project that the Vite plugin builds has a shader cache of its own. The plugin keeps every compiled
shader in that project's `node_modules/.cache/null3d-shaders`. The key is the WGSL, the path, the
variant spec and the compiler's version. A game's second `vite build` therefore compiles only the
shaders that changed. On a small project of eight shaders a cold build took 2.87 s and the next took
0.30 s. The plugin cannot load repository tooling. So it repeats
[D-177](decisions/D-177-build-cache-module.md)'s three rules on its own: an atomic write, a miss when
an input changes, and one opt-out. `NULL3D_NO_CACHE=1`, or Vite's `--force`, ignores it.
[D-175](decisions/D-175-vite-plugin-shader-cache.md) gives the figures and the key.

The engine's own shader build has a per-entry cache too. `bun run shaders`, and every command that
runs it, passes `--cache ~/.cache/null3d/shader-cache/<stamp>` to `shader-build`, where the stamp
hashes the compiler's sources. The build keeps each entry's compiled output under that folder. A
change to one shader then compiles only that shader, and a change to a library module compiles only
the entries that import it. On the Mac on 14 October 2026, all 54 entries from cold took 442 s. A
second run with nothing changed took 10.6 s and compiled none. A change to the one file that the two
cull entries share took 10.4 s and compiled 2 entries. A change to `lib/math.wgsl` compiled the 31
entries that import it, through `null3d::lighting` and `null3d::area_lights`, and took 356 s.
`--no-cache`, or `NULL3D_NO_SHADER_CACHE=1`, compiles every entry again.
[D-56](decisions/D-56-first-use-shader-files.md) gives the reasons and the key. CI keeps the same two
shader folders in the Actions cache, under the same keys ([CI's jobs](#cis-jobs)).

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
- The lock files and the sample content's manifest
- The list of milestone task IDs that a `Task:` footer may name

A new kind of generated file goes into `.gitignore`, unless its pull request adds its reason to D-105.

## Merge main into a branch

- Merge main into your branch. Do not rebase a branch that you pushed, because a rebase needs a force push (see [Commit messages and pushes](#commit-messages-and-pushes)).
- Never merge a generated file by hand. [Generated files](#generated-files) says how to resolve a clash on one.
- A merge commit holds only the resolution of its conflicts and mechanical fixes. Mechanical fixes are files that a generator writes again, renumbered entries, and edits that the other side's change forces, such as a renamed import. Write anything else in a normal commit before or after the merge: a feature, a test, a shading change or docs text. Five merges of 12 to 14 October 2026 held features: area lights in reflection passes, automatic exposure in the two-step output, and a new clear coat roughness. Four more held measured figures of D-174. No history search finds them.
- Before a push, `bun tools/hooks/check-merges.ts <base>..HEAD` reads each new merge against git's automatic merge, as `git show --remerge-diff` does. It refuses a merge with more than 30 words of new work, or any new shader code. It also refuses a binary file that the merge changed itself. To fix a refused merge before you push it, undo the new work with `git commit --amend`, then commit it again on top. When the check cannot tell that an edit is mechanical, add a `Merge-Edit:` trailer to the merge's message. It names the edit and says why, such as `Merge-Edit: lit.wgsl passes main's new finish() argument`.
- A branch from before git stopped keeping the shader modules gets a conflict on each module that it changed when it merges main. Resolve them all with `git rm --cached packages/engine/src/generated/shaders*.ts`, which keeps the files for the next build to replace.
- Check the shared numbers after the merge. Two branches can each take the next free number, and git then merges both lines without a conflict. The shared numbers are the error codes (`packages/engine/src/errors/codes.ts`) and the scene command numbers (`crates/null3d-wasm/src/constants.rs`). They are also the draw list's opcodes and pipeline template numbers (`crates/null3d-gpu/src/drawlist.rs`), and the decision record numbers. The engine's own templates take numbers below 128, the first custom template. Custom materials, effects and tone curves take numbers from 128 up, which the sketch gives out at run time. The first custom template was 64 until 11 October 2026. The techniques of [D-142](decisions/D-142-more-techniques-before-1-0.md) used nearly every number below it, so it moved to 128. A unit test checks that each engine template has its own number below 128. The bindings and slots that a shader and its bind group layout share are shared numbers too. A unit test catches a clash in some of these lists, such as the opcodes, but not in all of them. The docs check, `bun run docs:check`, refuses two decision records with one number.
- Build and run the quick checks again before you push the merge: lint, types, docs, skills and unit tests. Then rerun the browser and image tests only of the areas that the merge's conflicts touched. CI runs every test on the pull request merged into main.
- Run a branch's own copy of a hook's tool, such as `tools/hooks/check-trailers.ts`, from that branch's checkout. Another checkout's copy can be older, and refuse a valid `Size-Growth:` name.

## A branch from before generated files left git

Git kept the generated files until 8 October 2026 ([D-105](decisions/D-105-generated-files-out-of-git.md)). A branch from before then conflicts with main once, when it merges main. Fetch main, then run main's merge script from the branch's copy:

```sh
sh -c "$(git show origin/main:tools/merge-main.sh)"
```

The script merges main. A generated file that main deleted stays deleted, and the file stays on disk. Where a written page conflicts on its old generated part, such as an API reference, the page list or a table, it keeps main's side. Then it runs `bun install`, which writes every generated file, and commits the merge. It stops and lists any other conflict. Resolve those by hand, then run `git commit --no-edit`. Last, check that `bun run docs:check` passes.

A test on 8 October 2026 used a branch that edited a skill, its copy, an API page's prose and reference, an error page, the page list and a preset table. After the script, the branch differed from main only in its edits to sources: the skill and the prose.

## A branch that edited the old table of tested devices

The record of [tested devices](tested-devices.md) was one table until 7 October 2026, and each run added text to a cell of its row. Now each run is a file of its own ([D-97](decisions/D-97-tested-devices-per-file.md)). A branch that edited the old table conflicts with main on `.dev/tested-devices.md`. Move its edits into the new files in one step:

1. Note the branch's last commit before the merge: `tip=$(git rev-parse HEAD)`.
2. Fetch and merge main. Take main's page for the conflict: `git checkout --theirs .dev/tested-devices.md`.
3. Run `bun tools/tested-devices.ts --branch $tip`. It compares the branch's table with the table where the branch started, its merge base with `origin/main`. It writes a run file for each row's new plans and results, and a new folder for each new row. It puts changed facts and new known issues in each README.
4. Read its notes. A note names each cell that the branch changed in place rather than added to, and each fact that it changed. Check those files by hand.
5. Run `bun run docs`. Stage the page and the new files, and commit the merge.

## Commit messages and pushes

- A push to main runs a check first, `tools/hooks/pre-push.ts`, which the owner approved on 15 October 2026 ([D-157](decisions/D-157-direct-pushes-to-main.md)). A push to any other branch runs nothing, so saving a branch stays fast. The check prints each command it runs and why. It runs the commit message and trailer checks (commitlint, then the trailer check) over every commit that the push adds to main, as CI's `commits` job does, and the merge check over the merges among them. So a bad message, a bad trailer or a merge that carries new work is caught before the push, not by a red main after it. When the push changes Rust code or Cargo settings, it also runs `cargo check --workspace` and the tests of each changed crate. The tests run through cargo-nextest's `ci` profile with `--no-fail-fast`, or through `cargo test` where nextest is missing. A changed workspace `Cargo.toml`, `Cargo.lock` or Rust setting tests every crate. The test that builds every shader runs in CI only, as it takes half an hour or more.
- The check compares with the commit that git reports for main before the push. When that commit is not in this checkout and no local main ref meets the pushed commit, it refuses the push and asks for a `git fetch origin main`, since it cannot say which commits the push adds.
- The cargo steps compile the working tree, so push from a clean checkout of the commit that you push. They use the checkout's own Rust folder, or `CARGO_TARGET_DIR` when it is set.
- On the Mac that runs the helpers, the git setting `null3d.jobQueue` names the job queue script. The check then runs the message and trailer checks in the queue's quick lane and the cargo steps in its CPU lane. So a push does not load the Mac outside the queue. A push may therefore wait for a slot. The environment's `NULL3D_JOB_QUEUE` names the script too. Elsewhere the steps run directly.
- Only in an emergency, skip the check with a `Push-Check-Skipped: <reason>` trailer on a commit of the push. The reason names the emergency, such as a red main that this push fixes while the job queue is stopped. The check prints the reason and runs nothing. `git push --no-verify` skips every hook, so never use it.

- A merge commit must pass the commit-message check, as every commit does. A message such as `Merge origin/main into <branch>` passes, and so do git's own merge messages. A message such as `merge origin/main` fails, because the check reads it as a commit without a type.
- Never force push a pull request's branch, so never amend, rebase or squash a commit that you pushed.
- A `Task:` footer names a listed milestone task that the commit delivers part of, or says `none`. The commit-msg hook (`tools/hooks/check-task.ts`) refuses free text and IDs that are not in `tools/hooks/task-ids.txt`. Before 15 October 2026, footers carried text such as `main CI repair`. Four shader commits carried `Task: M2-J4`, though they delivered none of its materials. The milestone count read those footers and counted tasks that were not done. Now it counts only each task's audited status.
- Main squashes each pull request, but CI checks the message of every commit in the pull request until it merges. A pushed commit with a bad message therefore fails CI for as long as the pull request is open.
- Put each trailer on a plain commit, never on a merge commit; an empty commit can carry it. The one exception is `Merge-Edit:`, which explains an edit in the merge itself (see [Merge main into a branch](#merge-main-into-a-branch)). Main's squash keeps the messages of the pull request's plain commits and drops the merge commits' messages. CI's trailer check and size check therefore read only the plain commits, so a trailer on a merge commit fails on the pull request. On 7 October 2026, #397's `Size-Growth:` trailer sat on a merge commit. Its own size check passed, and the merge queue's check of the squash failed ([Benchmarks](benchmarks.md#download-size)).
- To fix a bad message, open a new pull request from a new branch with a clean history. It replaces the old one. For example, `git switch -c <new-branch> origin/main`, then `git merge --squash <old-branch>`, then commit with a good message. Close the old pull request, and link the new one from it.
- The same applies when a branch carries copies of commits that main already holds, and a commit gate rejects one of the copies. Put the branch's files in one clean commit on a new branch from main, and open a new pull request. Close the old one with a link to the new one. Do not force push the old branch, and do not loosen the gate. On 8 October 2026, #417's branch held old copies of the commits of M2-K1 and the S25 skinning fix. The trailer check failed on one of them, because its `Size-Growth:` trailer named shader files by their names before a rename. Pull request #424 held the same files as #417's last commit, in one commit merged with main, and replaced it. The owner approved this way on 8 October 2026.

## Merging

Main does not use a merge queue from 7 October 2026 ([D-99](decisions/D-99-no-merge-queue.md)). A pull request merges by squash once its full CI run passes, and [AGENTS.md](../AGENTS.md#releases) gives the rules.

- CI's last job, `ci-passed`, waits for every other CI job, and it passes only when each one passed. A job may skip only when the first job, `changes`, passed and said that the job does not run. That is so for the heavy jobs of a draft or a [docs-only pull request](#docs-only-pull-requests), and for the jobs that run only on some changes. In every other run, every job must pass.
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

### The GPU check

CI's benchmark job has no GPU timer, so it cannot see a change that slows only the GPU. On the Mac's GPU, pull request 389 made S4 and S6 on WebGPU 5 to 33 times slower. Yet it passed every CI job ([D-109](decisions/D-109-gpu-time-guard.md)). So a pull request that can change the GPU's work runs the GPU check, and records the result. The check needs a computer with a GPU of its own.

- It must run when the pull request changes `crates/null3d-shaders/src/`, `crates/null3d-shaders/wgsl/` or `crates/null3d-shaders/shaders.toml`. It must also run when the pull request changes `packages/engine/src/gpu/`, `packages/engine/src/render/` or `packages/engine/src/quality/`. Changes to tests there do not count.
- Run the check in two steps once the branch's code is final. First run `bun run bench:gpu-check --prepare`, which uses only the CPU. It builds the branch and its benchmark pages. It also makes sure that a shared cache holds a build of the branch's merge base with origin/main. Then run `bun run bench:gpu-check --measure` on a Mac whose load is low. It builds nothing. It runs S4 and S6 on WebGPU at Medium and at High, in turns, in Chrome. With neither option, the check runs both steps in turn. [Benchmarks](benchmarks.md#the-gpu-checks-two-steps) says how the cache works and what each step costs. Set `NULL3D_PORT` to a port of your own: the check takes that port and the next.
- It prints one line, such as `GPU-Checked: 061177262..a0a7c1777 passed: s4 medium 1.86 to 1.90 ms (+2.2%); ...`. Put that line on a plain commit, an empty one if need be, such as `test: record the GPU check`. The commit must be the last one that changes the files above, or come after it. A later change to those files needs a new run.
- CI cannot run the check, since its machines have no GPU timer. So the trailer is the author's record that the check ran, and what it measured. CI's trailer check only fails the pull request when the trailer is missing or says nothing. It cannot check the figures.
- `failed`: a page's GPU time grew more than 25% and 0.3 ms. Find the cause and fix it. A slowdown on purpose needs a `Bench-Expected:` trailer that names it, such as `Bench-Expected: s4/null3d-webgpu/gpu-time: a second shadow pass`, and then a new run.
- `not measured`: the browser gave no GPU times, as on a machine without a GPU timer. Run it on a computer with one.
- `not judged`: the benchmark pages changed between the two commits, so the builds drew different work. The line still gives the figures, and the reviewer judges them.
- A change that cannot change the GPU's work, such as a comment in those folders, still needs the trailer. It then says why no check ran, such as `GPU-Checked: not run; only comments change in packages/engine/src/gpu/`.
- Each night, the owner's Mac runs the same check on main against the night before. That catches what slips past a pull request, within a day.

## What CI runs where

Each event runs every job, apart from a draft or a docs-only pull request, by the owner's decision of 7 October 2026 ([D-99](decisions/D-99-no-merge-queue.md)).

| Event | Jobs |
| --- | --- |
| Draft pull request | The quick checks: `build`, `docs-and-tools`, `rust-lint`, the two parts of `rust-tests`, `size-base`, `wasm-checks`, `shader-compiler` and `packages` |
| Docs-only pull request | `build` and `docs-and-tools`, and `skill-sketches` when the pull request changes the skills' or the cookbook's Markdown and is no draft ([Docs-only pull requests](#docs-only-pull-requests)) |
| Pull request ready for review: opened, pushed, reopened, or marked ready | Every job: the quick checks, the 7 `browser` shards and the job of the tests that run alone, the 2 `bench` shards, and the `real-browsers` shards in Safari and Firefox |
| Push to main | Every job, on the code that the merge made. Main's jobs also keep the caches, and `wasm-checks` keeps the commit's sizes |
| Started by hand | Every job, on the branch that the run names: `gh workflow run ci.yml --ref main` |
| Merge queue | Every job, only while main's rules still use the queue |

- A new push to a pull request cancels the run of its older push. Runs on main each have a group of their own, so a merge never cancels main's run of the merge before.
- CI's Chrome tests draw on SwiftShader only, and Firefox on Linux draws with a software renderer. The Mac's real GPU gets no run in CI, apart from Safari. So run the browser and image tests of the areas that a pull request touches once on the Mac's GPU, before it is ready for review. Run `bun run test:browser` with Playwright's `--grep` or a spec file, and `bun run test:images` with `--grep`. A change that Safari or Firefox may treat differently also runs `bun run test:real-browsers Safari Firefox` ([Device sessions](devices.md)).
- Before 6 October 2026, every pull request and every push to main ran the full suite, about 100 runner minutes each. GitHub Free runs 20 Linux jobs at once, so the queue's runs waited for runners for about half of their 32 minutes. From 6 to 7 October 2026, pull requests ran only the quick checks, and the queue ran the rest ([D-86](decisions/D-86-ci-runs-per-event.md)).

### Docs-only pull requests

A pull request that changes only docs files runs only the checks that read them. CI's first job, `changes`, decides it from the diff of the merge commit with main. A renamed file counts as its old path and its new path.

- Docs files are Markdown files anywhere, and every file in `.dev/`, `docs/` and `skills/`. Only the `docs-and-tools` job reads them, in its docs, style, skills and type checks, the skill validator and the unit tests. Nothing in the engine, the Rust crates, the benchmarks or the test pages reads them. That holds for `docs/data/threejs-mapping.json` too: only the docs generator, the skills check and their unit tests read it.
- `build` still runs, because `docs-and-tools` needs its shader modules.
- The browser tests draw each complete sketch in the skills' and the cookbook's Markdown (`tests/image/skill-sketches.spec.ts`). So when a docs-only pull request that is no draft changes Markdown in `skills/` or `docs/cookbook/`, the `skill-sketches` job runs that one test file. In a full run, the `browser` shards draw the sketches, and `skill-sketches` skips.
- Every other job skips. That is the Rust jobs, the size check, the shader compiler and the packages test. It is also the browser, benchmark page, allocation, Safari and Firefox jobs.
- A pull request that changes any other file runs every job. That includes `.github/`, `package.json` and the tools.
- Each push to main runs every job, so main's run still tests the docs change with everything else.
- The reason: a full run takes about 30 jobs. GitHub Free runs 20 Linux jobs at once, and few macOS jobs. On 11 October 2026, with 6 or more pull requests open, main's own run waited over 90 minutes for runners. A docs-only run takes 4 short jobs, `ci-passed` among them, or 5 with the sketches.
- A new test that reads a docs file must run in `docs-and-tools`. If it cannot, add the file's path to the `changes` job as a code path. Otherwise a docs-only pull request skips the test, and only main's run finds a failure.
- The `changes` job's log lists the pull request's files and its four answers: `code`, `full`, `allocation` and `sketches`. `ci-passed` prints them too.

## CI's jobs

- Every CI job should take at most 15 minutes, and its limit stops it at 20, the owner's rules of 12 October 2026. A job should take at most about 12, so that a slow runner still fits. The limit was 15 until the evening of 12 October; jobs on busy runners then hit it before they failed or passed, and cancelled jobs failed pull requests that had no fault. On that day, `rust-tests` took 5.0 to 9.0 minutes in 46 passing runs, and the benchmark workflow's `build` 4.5 to 7.7 in main's last 5. Their limits went from 25 and 20 minutes to 15, and then to 20 with every other job. The weekly newest-nightly Rust job took 2.0 and 15.1 minutes in its two runs, with 10 of the 15.1 in `cargo test`. It now runs the tests through cargo-nextest as `rust-tests` does, with a Rust cache of its own, under the 20-minute limit. The cache's key holds the compiler's version, so each new nightly still builds the dependencies once. The release workflow's jobs keep 30 minutes, as [Releases](releases.md#making-a-release) says why. On 15 October 2026 `build`, `size-base` and `rust-tests` hit the 20-minute limit on every run of main. CI compiled every shader from scratch, and the build's shader step grew from about 10 to more than 19 minutes in a day. The owner raised those three limits to 35 minutes. `shader-compiler` builds every shader too and stopped at 20 on 14 October, so its limit went to 35 as well. The benchmark workflow's `build` and the newest-nightly jobs build every shader too, so they stop at 35 as well. A cold shader build then took longer than 35 minutes, and one entry, the textured standard material, cannot finish inside a 35-minute job. So `build`, `size-base`, the whole shader build part of `rust-tests` and `shader-compiler` stop at 90 minutes, until the shader build runs on every core. The other limits stay at 35 until the shader cache and the split shader test keep these jobs under 15.
- One `build` job builds the WebAssembly files and the shader modules, and every browser, benchmark and macOS job downloads them. Before, each browser shard built them again, which took 1.5 minutes.
- CI keeps the built shaders in the Actions cache between runs, through the action `.github/actions/shaders`. It keeps the same two folders as a local build ([Builds](#builds)). One holds the module sets, by the hash of their inputs. The other is the per-entry cache, under the compiler's stamp. `bun tools/shaders.ts --cache-keys` prints the folders, the input hash and the stamp, and the Actions key holds the stamp and the hash. A run whose inputs match restores the module set and compiles no shader. A run with the same compiler restores that stamp's entries and compiles only the entries whose own key changed. A new compiler restores nothing. The tools check each entry's key themselves, so a restored entry never serves other inputs. Before a save, the action deletes every other stamp and module set, so the cache does not grow. A failed or cancelled build still saves the entries it finished, under a key of its own. That matters on main, where each push cancels the run before it. The `build` and `size-base` jobs and the benchmark workflow's `build` use the action. The newest-nightly job restores the cache but never saves it. A size check base or a benchmark baseline from before the action builds every shader.
- The browser tests run in 11 shards and the benchmark page tests in 2, so that no shard nears 15 minutes, the most a job should take. Before the first split, in the 25 runs up to 1 October 2026, the two browser shards took 10 and 12 minutes. A whole merge queue run took 16.5 minutes. After it, a pull request's run took 6.9 minutes.
- Playwright splits the browser tests by count, so the `browser` job weights its shards. [Image tests](image-tests.md#ci) says how to retune the weights and when to add a shard.
- The size check's job, `wasm-checks`, measures the `build` job's files against the base's sizes. The `size-base` job builds those sizes beside the `build` job, or finds them in the Actions cache ([Benchmarks](benchmarks.md#download-size)). The shader compiler test runs in a job of its own, `shader-compiler`. Before, `wasm-checks` built the head, then the base, then ran that test. That took 11.1 minutes of its 15-minute limit in merge queue run 37248715227 on 5 October 2026. After the split, `wasm-checks` took 0.8 minutes.
- The `allocation` job runs the per-frame allocation check, `bun run bench:allocation`, on S1. WebGPU and WebGL2 each get a machine of their own. The owner ruled on 9 October 2026 to add it: "yes add it". Before, the check ran only by hand and in the Mac's gate. So when #457 moved the drawing step to new files, the check failed on main and nobody saw it. The job runs on every push to main. On a pull request it runs only when the pull request changes what the check covers. That is the engine's `render/`, `gpu/`, `sketch/`, `scene/` or `shared/` code, an add-on's source, the core's crates, the benchmark pages, the check and the files it uses, or `.github/workflows/ci.yml`. The scene, shared, add-on, core and page paths joined on 15 October 2026: per-frame allocations in the scene API had reached main without the job. The `changes` job compares the merge commit with main to decide. On SwiftShader the check draws 1,000 boxes and keeps budgets of its own for a few places ([Benchmarks](benchmarks.md#allocation-and-profiling)). Its job takes about 4 minutes there, less than a browser shard ([D-125](decisions/D-125-allocation-check-in-ci.md)).
- Formatting and Clippy run in `rust-lint`, and the tests in `rust-tests`. `rust-tests` runs the tests through cargo-nextest, which runs the tests of every test file at once. Then `cargo test --doc` runs the documentation tests, since nextest runs none. Before, `cargo test` ran the test files one after another, for 6.2 of the Rust job's 6.7 minutes in that run. Locally, `cargo nextest run --workspace` runs them the same way.
- `rust-tests` runs in two parts at once. One runs the test that builds every shader, and the other runs every other test. The profiles `ci` and `whole-shader-build` in `.config/nextest.toml` split them, so the test's name is written in one place. Both parts run with `--no-fail-fast`, so a run reports every failing test, not only the first. Before the split, that one test took about 29.5 minutes in CI on 15 October 2026 (run 38673968972). With a 20-minute limit, the job stopped before the other tests could report. In main's first run after the split, every other test took 11.3 minutes and the whole shader build 26.5 (run 38679915189).
- `.config/nextest.toml` runs each test of the 5 test files that count allocations with the machine to itself, as `cargo test` did. These tests count the job workers' allocations too. Under the load of the other tests, the light grid's allocation test failed once in CI. It counted frees from job workers that an earlier case had stopped. The counter now stops counting a worker when its work returns ([Implementation notes](implementation-notes.md)).
- Those tests run first, and the one test that builds every shader next. A test that needs the whole machine waits until every running test ends. In the default order, it held the run back behind the slow tests each time. The tests then took 8.2 minutes in CI, against 2.8 minutes without the isolation. The new order took 2.5 minutes on 4 threads of a MacBook Pro.
- No test runs a full shader build of its own. One test in the shader crate's `build` tests builds every shader. Every check that reads the whole output runs on that build. A second build runs at the same time on another thread, for the check that two builds write the same modules. Other tests build only the shaders that they read, through the tests' `subset` module: the command line tests run the command on 4 shaders, and the effect tests build only their 2 hosts. nextest runs each test in a process of its own, so a cache in one test's process never serves another test. Before this rule, 17 tests each built every shader, for 280 to 590 seconds each on a 4-core runner. As the shaders' variants grew, the `rust-tests` job grew from 14 minutes to past its 25-minute limit. CI cancelled it on main and on #484 on 11 October 2026 (run 38096978506). A new check of the whole output goes into the one test, and does not add a build. The test runs in its own part of `rust-tests`, and again in `shader-compiler`, where each of its builds also runs through the shader compiler.
- Only main's runs save caches, and every run restores main's. These are the Rust builds, the packages, Playwright's Chromium, the sample content, the built shaders and the base sizes. The workflows' `SAVE_CACHES` decides it. A merge queue run has a branch of its own, and a run restores only the caches of its own branch and of main. So a cache that a queue run saved would serve no pull request. So main's runs save them: each job its own, and `wasm-checks` the commit's sizes. On 5 October 2026, the repository's caches held 10.7 GB against GitHub's limit of 10 GB. Past the limit, GitHub drops the oldest caches. Pull requests and merge queue runs each saved copies that only their own later runs could restore. The package install with its cache is the action `.github/actions/bun-install`.
- The `commits` job checks the commit messages with commitlint and the trailers with `tools/hooks/check-trailers.ts`. On a push to main it reads every plain commit after main's commit before the push. Before 15 October 2026 it ran only on pull requests, so after the move to direct pushes no CI check read a message or a trailer.
- The `ci-passed` job tells a time-out from a cancel. GitHub calls both "cancelled". `ci-passed` reads each cancelled job's messages and marks a job that hit its time limit as an error: a time-out is a failure of that job. A job that a newer push cancelled gets a warning.
- Each nextest profile of CI gives every test a time limit: 15 minutes in `ci`, and 85 in `whole-shader-build` while the shader build runs on one core. nextest stops a test past its limit and reports it as failed. Before, on 913613695, one test failed and nextest waited on two long tests until the job's limit, so the job read "cancelled" and showed no result.
- The shader cache action writes each run's shader build into the job summary: the minutes it took, the cache it restored, how many entries it compiled and reused, and the entry and module counts and sizes. From run to run, the build's growth shows. A run whose inputs match the restored module set compiles nothing, and prints no compiled-and-reused line; the record names that case. The record only reports the log. The build step has already decided the job, so a missing line shows in the summary instead of failing the build. Until 15 October 2026 the step read a missing line as an error, because a search that found nothing ended it under the shell's `-e` and `pipefail`. Main's run 96b955566 failed its `build` job that way, on a restored module set, and a failed `build` skips every job that needs it. `tests/lib/shaders-action.test.ts` runs the record step over each shape of log, so a missing line cannot fail a job again.
- Main's rules require `ci-passed`, not each job, because a job that splits into more shards changes its name. Without that job, a new shard would strand every open pull request.
- Playwright's Chromium and its Ubuntu packages stay in the Actions cache. Ubuntu's package mirror stalls for 30 to 110 seconds on some files, and the install once took 11.5 minutes of a 4-minute shard.
- The Rust caches are keyed by the workspace's `Cargo.toml`, because the cache's own key leaves out the build profiles. After a profile change, each run restored the old cache and compiled the dependencies again, for about 3 minutes.
- Development builds optimize the dependencies (`[profile.dev.package."*"]`), so the shader tools' tests and `bun run shaders` parse and validate WGSL about 4 times faster.

## Several copies on one machine

People and agents often work in several copies of the repository at once, such as git worktrees.

- Give each copy its own ports with `NULL3D_PORT`, as [AGENTS.md](../AGENTS.md#performance-work) says. Each copy then uses its port and the three ports above it.
- Stop only your own servers. Find the process on your port with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`, and stop that process. Never stop a server or a browser by its name, because that also stops the servers and runs of the other copies.
- Close the browser tabs that you open as soon as each test ends, as [Device sessions](devices.md#the-runner) says.
- Never let two copies share one Rust build folder. Cargo judges the engine's own crates fresh by their files' times. So one copy's build can reuse crates that another copy compiled from other sources. On 14 and 15 October 2026 this gave branches a stale shader compiler and another branch's GPU constants. The owner ruled on 15 October that each copy builds Rust into a folder of its own. The copies share only the compiled dependencies, through a compiler cache. [Builds](#builds) says how.
- The dev server skips the repository's own `.claude`, `.dev` and `.internal` folders, anchored to the folder it runs in (`tools/lib/watch-ignored.ts`). A dev server in a worktree under `.claude/worktrees` therefore sees its own edits. Until October 2026 the patterns matched a `.claude` folder anywhere in the path, so such a server served old files after every edit until it restarted. Pictures taken against it showed the code from its start. A unit test now checks that a worktree's own files are watched.
- Agent tools can lock a worktree. `git worktree list` shows "locked", and `git worktree list --porcelain` gives the reason, which can name a process id. When that process no longer runs, the lock is stale, and `git worktree unlock <path>` clears it.
- The size check builds main in a worktree of its own, `target/.size-base/tree`, inside each copy that runs it ([Benchmarks](benchmarks.md#download-size)). `git worktree list` therefore shows one under each such copy. After you delete a copy's folder, `git worktree prune` removes the worktrees whose folders are gone.

## Coordinating helper agents

One coordinator session often runs several helper agents at once, each in its own copy of the repository. These rules keep their work moving.

- **One agent tool for the helpers.** The coordination works with more than one agent tool. A helper is a subagent of the coordinator's Claude Code session, or a session of the opencode agent tool. One setting of the coordinator picks which ([D-178](decisions/D-178-process-rulings-2026-10-15.md)). Never use both at once, because two helpers must never work in one copy. The waits, the load limiter and the check-ins are shared scripts, and they work the same with either tool. Only the way that the coordinator reaches a helper differs. The rules that differ by tool, such as how long one tool call may run, sit in the helpers' brief. It has a part for each tool. A Claude Code helper that ends its turn tells the coordinator, which answers it directly. An opencode helper gets a prompt from a wake service when its job ends. Since 15 October 2026 the helpers are Claude Code subagents. That morning, the model service of the opencode sessions stopped answering, and every helper stopped mid-step.
- **Never start an opencode server by accident.** Any opencode command without a server address starts the tool's background server, and that server resumes the sessions that it held. On 15 October 2026 a check-in script asked opencode for its sessions in this way. The old sessions came back, and one of them began a commit in a copy that a new helper owned. So the scripts call opencode only with the address of a server that the coordinator started, and they stop when nothing answers there.
- **Wait inside the turn.** A helper never ends its turn while one of its jobs runs or waits in the queue. An ended turn sits idle until something wakes the helper, and a landing has four to six such waits. The helper starts each long job detached, through a wait command that records the job's process and its exit status. A tool call can stop before the job ends, as Claude Code stops one after 10 minutes. The job runs on. The helper then waits on the same job again by its name, until the job ends. It then reads the exit status and the end of the log.
- **Check every 5 minutes.** The coordinator checks each running helper every 5 minutes, on a timer, also at night. The owner set 10 minutes on 10 October 2026, and 5 on 13 October. It judges progress by evidence: new commits, logs that grow, CI checks that move, jobs in the queue. A helper's own message is not evidence. Sometimes a helper waits on a run or a CI job that has already ended. The coordinator then gives it the next step at once. A helper that stays stuck is replaced by a fresh one. Earlier gaps had cost hours. On 7 October a finished CI run waited 4.5 hours for its helper. On 10 October a quiet window stayed idle for 3.5 hours after its run ended.
- **Find each job's real copy.** The check-in gives each job to the copy of the repository that the job works in. It first reads the folders that the job's command changes into. Then it reads the folders of the job's running processes, and last the folder that the job started in. A helper's shell can start in the coordinator's copy, as a Claude Code subagent's does. So before this rule, every such helper's job looked like the coordinator's. On 15 October that flagged three busy helpers as idle.
- **Count a task as landed only when its audit says done.** The milestone count takes a task as landed only when the task's audit marks it done. A `Task:` trailer on some commit is not enough. On 15 October four shader commits on main carried M2-J4's trailer, while M2-J4's feature was still on its branch. A branch on main is not enough either, because the task's whole definition of done may not be met yet. With this rule, the count went from 160 of 171 tasks to 138 of 169 on 15 October 2026.
- **Keep notes for a restart.** Each helper keeps a notes file current as it works. The notes give its branch, its commits and whether they are pushed. They also give the runs in flight, the figures and what is left. Another session must be able to resume from the notes alone.
- **Use the right queue lane.** The load limiter has four lanes, each with its own slots. Browser, image, benchmark and GPU runs take the browser lane, which waits for a low load and for the quiet window. Builds, cargo commands and the full type check take the CPU lane, at background priority. Short jobs take the quick lane: installs, lint, docs checks, and unit tests that build nothing. Cloud device runs take the cloud lane (below).
- **Short jobs never wait behind builds.** The quick lane has 2 slots. A job there starts without waiting for a low load, and the lane stops any job that runs past 5 minutes. Such a job goes back to the CPU lane. On 15 October 2026 a docs check of a few seconds waited about 2 hours behind 30 builds in the CPU lane. The owner approved the quick lane that day, and it has run since then.
- **Compile after a merge, and check before a push.** After a branch merges `origin/main`, compile the merged tree before anything else: `cargo check --workspace` and `bun run typecheck`. A merge that keeps both sides of a struct or a constant is often valid syntax, so only a compile finds it. On 15 October 2026 three branches held merged trees that did not compile. The owner also approved a check that runs before each push to main. It checks the trailers, runs `cargo check --workspace` and the tests of the Rust crates that the push changes, and sends its heavy steps through the load limiter. That check is being built.
- **Time on a quiet machine.** Timing figures need a machine whose load stays below 8. Every browser, image, benchmark or Rust suite runs through the load limiter, which caps how many run at once. For a timing run, the coordinator turns on the limiter's quiet window, which lets only that helper's runs start. The helper reports the moment its timing runs end. At each check, the coordinator also looks at the window's runs itself, and passes the window on or ends it once they are done.
- **Run cloud devices without waiting.** A run on [BrowserStack Automate](devices.md#browserstack-automate) never waits for the owner's go-ahead. The owner ruled so on 15 October 2026 ([D-178](decisions/D-178-process-rulings-2026-10-15.md)). Such a run barely loads the Mac. Yet it held a browser slot of the load limiter for the whole job, up to about 85 minutes. Local browser runs waited meanwhile. So from 15 October 2026, with the owner's approval, cloud runs have a lane of their own. It has one slot, because the BrowserStack plan allows one session at a time. A cloud run in that lane never takes a browser slot or a CPU slot. It never waits for the load limit or the quiet window. Cloud runs queue in their lane in turn.
- **Pause before the usage limit.** At 95% of the usage limit, each helper writes its state into its notes, commits and pushes its work, and stops. Work resumes with fresh helpers once the limit's reset time has passed. A low reading of the usage figure alone is not enough: on 9 October such a reading was wrong.
