# Pull requests and parallel work

This guide covers how to merge main into a branch, and what to do when the merge queue removes a pull request. It also covers why CI's jobs are split as they are, and several copies of the repository on one machine. [AGENTS.md](../AGENTS.md) holds the commit gates and the rules of the merge queue.

## Before you open a pull request

Record the reasons for the change in `.dev/`, in the same pull request, as [AGENTS.md](../AGENTS.md#record-the-reasons) says. Each kind of reason has its place:

| Kind | Place | Example |
| --- | --- | --- |
| A design choice or an owner's ruling | A decision record, new or an addendum: the problem, the figures, the options rejected and why, and who decided and when | [D-92](decisions/D-92-safari-removed-frames.md) gives the memory that Safari kept on CI, the options, and the owner's confirmation on 7 October 2026 |
| A bug fix | The cause and why the fix is right, in the record or guide that owns the area | The framebuffer fault on the Pixel 10: [D-71](decisions/D-71-custom-effects.md) gives the cause, the per-call timings and the unit test |
| A device or benchmark run | A row in [tested devices](tested-devices.md) or in the [benchmark results](benchmark-results.md) | The iPad's custom effects run of 7 October 2026, in the iPad Pro's row |
| A process or tooling lesson | The guide that covers it | Take a pull request out of the queue as soon as a job fails, in [The merge queue](#the-merge-queue) |

The `Docs-Checked:` trailer names the page that holds the reason, or says why the change has no new reason.

## Merge main into a branch

- Merge main into your branch. Do not rebase a branch that you pushed, because a rebase needs a force push (see [Commit messages and pushes](#commit-messages-and-pushes)).
- Never merge a generated file by hand. Take either side of its conflict, run its generator, and stage what the generator writes:

| Generated files | Generator |
| --- | --- |
| The docs generator's output: placeholder pages, the API reference, the error pages, the page list in `docs/index.md`, and the three.js mapping page and copies | `bun run docs` |
| The skills copy, `.claude/skills/` | `bun run skills` |
| The constants that TypeScript shares with Rust, `packages/engine/src/generated/core.ts` and `gpu.ts`, and the render graph's text dump in `crates/null3d-render/tests/snapshots/` | `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-wasm -p null3d-gpu -p null3d-render` |

- Git does not keep the shader modules, `packages/engine/src/generated/shaders*.ts`, so a merge never touches them. The build, the type check, the unit tests, the dev server and the browser tests read them. Each of these builds them first when they are missing or out of date. `bun run shaders` does the same on its own.
- A branch from before git stopped keeping the shader modules gets a conflict on each module that it changed when it merges main. Resolve them all with `git rm --cached packages/engine/src/generated/shaders*.ts`, which keeps the files for the next build to replace.
- Run the generators after every merge of main, also when git reports no conflict. Git can merge the text of a generated file cleanly and still give a result that no generator makes.
- Check the shared numbers after the merge. Two branches can each take the next free number, and git then merges both lines without a conflict. The shared numbers are the error codes (`packages/engine/src/errors/codes.ts`) and the scene command numbers (`crates/null3d-wasm/src/constants.rs`). They are also the draw list's opcodes and pipeline template numbers (`crates/null3d-gpu/src/drawlist.rs`), and the decision record numbers. The bindings and slots that a shader and its bind group layout share are shared numbers too. A unit test catches a clash in some of these lists, such as the opcodes, but not in all of them. The docs check, `bun run docs:check`, refuses two decision records with one number.
- Build and run the quick checks again before you push the merge: lint, types, docs, skills and unit tests. Then rerun the browser and image tests only of the areas that the merge's conflicts touched. The queue runs every test on top of main.
- `bun run docs` reads the engine's types, and they import the shader modules. Build the modules first, with `bun run shaders` or `bun run build`. Without them, the generator leaves generated sections out of `docs/api/engine.md`.
- Run a branch's own copy of a hook's tool, such as `tools/hooks/check-trailers.ts`, from that branch's checkout. Another checkout's copy can be older, and refuse a valid `Size-Growth:` name.

## Commit messages and pushes

- A merge commit must pass the commit-message check, as every commit does. A message such as `Merge origin/main into <branch>` passes, and so do git's own merge messages. A message such as `merge origin/main` fails, because the check reads it as a commit without a type.
- Never force push a pull request's branch, so never amend, rebase or squash a commit that you pushed.
- Main squashes each pull request, but CI checks the message of every commit in the pull request until it merges. A pushed commit with a bad message therefore fails CI for as long as the pull request is open.
- To fix a bad message, open a new pull request from a new branch with a clean history. It replaces the old one. For example, `git switch -c <new-branch> origin/main`, then `git merge --squash <old-branch>`, then commit with a good message. Close the old pull request, and link the new one from it.

## The merge queue

[AGENTS.md](../AGENTS.md#releases) says how the queue runs CI on each pull request on top of main and the pull requests ahead of it.

- CI's last job, `ci-passed`, waits for every other CI job, and it passes only when each one passed. Outside the queue, it also accepts a job that its own condition skipped, such as a job that runs only in the queue. In the queue, every job must pass.
- The queue requires two checks: `ci-passed`, and `squash-title` from the PR title workflow. So a CI job can split into more shards and change its name with no change to the queue's rules.
- `gh pr merge <number> --auto --squash` adds the pull request to the merge queue, and so does a plain `gh pr merge <number>`. It joins at once when its checks have passed, or as soon as they pass. So run it only when the pull request is ready to merge.
- The message "the merge strategy for main is set by the merge queue" means that the pull request joined the queue. It was not refused.
- A queued pull request shows no automatic merge request: `gh pr view <number> --json autoMergeRequest` gives null. Read its place in the queue from `mergeQueueEntry` instead, with `gh api graphql -f query='{repository(owner:"null3d-engine",name:"null3d"){pullRequest(number:<number>){mergeQueueEntry{position state}}}}'`, or on the queue's page.
- When the queue's run fails, the queue removes the pull request. It does not join the queue again with the same commit, so fix the cause and push.
- Take a pull request out of the queue as soon as one job of its run fails, as the owner ruled on 6 October 2026. The check `ci-passed` fails only when every job has ended, so the queue keeps the pull request for the rest of the run. The pull requests behind it build on top of it meanwhile. Take it out with `gh api graphql -f query='mutation{dequeuePullRequest(input:{id:"<id>"}){mergeQueueEntry{id}}}'`. The pull request's id comes from `gh pr view <number> --json id -q .id`.
- Then read the failed job's log, and find whether the pull request caused the failure. A test that fails only under load, or a run that GitHub cancelled when a runner shut down, says nothing about the pull request. Put such a pull request back in the queue with the same commit. Otherwise fix the cause and push.
- Two tests are known to fail only on a loaded machine. One is the GPU loss test "draws on after a GPU loss" on SwiftShader. It got no frame in its fixed recovery wait, in full local runs while the Mac's load was 21 to 30. The other is the benchmark page test of S4 on SwiftShader. It drew no frame in its short run, in merge queue runs 37289400132 and 37578361814. Both passed when they ran again. In each, the slow software GPU took longer than the test's fixed window to draw the first frame after a start or a loss. A rerun alone shows whether a failure is this ([Image tests](image-tests.md#tests-on-slow-machines)).
- Run `bun run build:check-size` on the branch, with current main merged, just before the pull request joins the queue. The pull request's own size check compared with main as it was at the last push. On 6 October 2026 the queue removed a pull request for two files that had grown 2.0% against the newer main.
- Two pull requests that add text at one place of a file clash after the first one's squash. A row of the [tested devices](tested-devices.md) record is an example. This happens even when one pull request already contains the other's text. Queue the second only after the first merges, and merge main into it first.
- `gh run list --event merge_group` lists the queue's runs. Each run's branch is `gh-readonly-queue/main/pr-<number>-<commit>`, so look for your pull request's number. The pull request's timeline also links the failed run, and `gh run view <run> --log-failed` prints its failed steps.
- Each run builds the shader modules from the sources that it tests, so pull requests that change shaders can share a queue run.
- The size check of a queue run compares with the commit that the group builds on, which holds the pull requests ahead. A pull request's own run compares with main. So a file's growth counts only against the pull request that makes it. When the check compared with main instead, a pull request ahead added its growth to the one behind it. The queue then removed the second ([Benchmarks](benchmarks.md#download-size)).
- When a pull request fails because of one that merged just before it, merge main, run the generators, and push.
- The browser, benchmark page, Safari and Firefox jobs run only in the queue ([What CI runs where](#what-ci-runs-where)). The Safari and Firefox jobs compare the image tests with the Mac's `chrome-real-gpu` references. A test without one of these references, or without its SwiftShader reference, fails `bun run check` in the pull request's own run ([Image tests](image-tests.md#references)).

## What CI runs where

Each event runs its own share of CI's jobs, by the owner's decision of 6 October 2026 ([D-86](decisions/D-86-ci-runs-per-event.md)).

| Event | Jobs |
| --- | --- |
| Pull request | The quick checks: `build`, `docs-and-tools`, `rust-lint`, `rust-tests`, `size-base`, `wasm-checks`, `shader-compiler` and `packages` |
| Merge queue | Every job: the quick checks, the 7 `browser` shards, the 2 `bench` shards and the `real-browsers` shards in Safari and Firefox |
| Push to main | Only what later runs restore from main. `build` and `main-keep` keep the commit's sizes and the caches. The Rust jobs keep their Rust caches, and skip their checks when the cache is current |
| Started by hand | Every job, as in the queue, on the branch that the run names: `gh workflow run ci.yml --ref main` |

- Main gets the exact commit that the queue tested, so a run on main would only repeat the queue's checks.
- The owner may merge a pull request by hand when it is urgent, its checks are green, and it is up to date with main. Nothing else may be merging then. Main's run does not test it again. Before such a commit serves as a gate or release commit, start a full run on main with `gh workflow run ci.yml --ref main`, before anything else merges. The exit gate and the Release workflow accept that run as they accept the queue's.
- This split holds until the 1.0 release. After 1.0, pull requests run the browser tests on each push again ([D-86](decisions/D-86-ci-runs-per-event.md#until-10)).
- A pull request's run no longer shows whether the browser tests pass. The queue runs Chrome's browser and image tests on SwiftShader only. The Mac's real GPU gets no run in CI, apart from the queue's Safari and Firefox jobs. So before a pull request joins the queue, run the browser and image tests of the areas that it touches. Run them once on the Mac's GPU. Run `bun run test:browser` with Playwright's `--grep` or a spec file, and `bun run test:images` with `--grep`. The SwiftShader runs, `CI=1 bun run test:images`, may wait for the queue. A change that Safari or Firefox may treat differently also runs `bun run test:real-browsers Safari Firefox` ([Device sessions](devices.md)). A failure in the queue removes the pull request and makes every pull request behind it build again.
- Before 6 October 2026, every pull request and every push to main ran the full suite, about 100 runner minutes each. GitHub Free runs 20 Linux jobs at once, so the queue's runs waited for runners for about half of their 32 minutes.

## CI's jobs

- One `build` job builds the WebAssembly files and the shader modules, and every browser, benchmark and macOS job downloads them. Before, each browser shard built them again, which took 1.5 minutes.
- The browser tests run in 7 shards and the benchmark page tests in 2, so each takes about 5 minutes or less. Before the split, in the 25 runs up to 1 October 2026, the two browser shards took 10 and 12 minutes. A whole merge queue run took 16.5 minutes. After it, a pull request's run took 6.9 minutes.
- Playwright splits the browser tests by count, so the `browser` job weights its shards. [Image tests](image-tests.md#ci) says how to retune the weights.
- The size check's job, `wasm-checks`, measures the `build` job's files against the base's sizes. The `size-base` job builds those sizes beside the `build` job, or finds them in the Actions cache ([Benchmarks](benchmarks.md#download-size)). The shader compiler test runs in a job of its own, `shader-compiler`. Before, `wasm-checks` built the head, then the base, then ran that test. That took 11.1 minutes of its 15-minute limit in merge queue run 37248715227 on 5 October 2026. After the split, `wasm-checks` took 0.8 minutes.
- Formatting and Clippy run in `rust-lint`, and the tests in `rust-tests`. `rust-tests` runs the tests through cargo-nextest, which runs the tests of every test file at once. Then `cargo test --doc` runs the documentation tests, since nextest runs none. Before, `cargo test` ran the test files one after another, for 6.2 of the Rust job's 6.7 minutes in that run. Locally, `cargo nextest run --workspace` runs them the same way.
- `.config/nextest.toml` runs each test of the 5 test files that count allocations with the machine to itself, as `cargo test` did. These tests count the job workers' allocations too. Under the load of the other tests, the light grid's allocation test failed once in CI. It counted frees from job workers that an earlier case had stopped. The counter now stops counting a worker when its work returns ([Implementation notes](implementation-notes.md)).
- Those tests run first, and the shader build's slow tests next. A test that needs the whole machine waits until every running test ends. In the default order, it held the run back behind the slow tests each time. The tests then took 8.2 minutes in CI, against 2.8 minutes without the isolation. The new order took 2.5 minutes on 4 threads of a MacBook Pro.
- Only main's runs save caches, and every run restores main's. These are the Rust builds, the packages, Playwright's Chromium, the sample content and the base sizes. The workflows' `SAVE_CACHES` decides it. A merge queue run has a branch of its own, and a run restores only the caches of its own branch and of main. So a cache that a queue run saved would serve no pull request. So main's run keeps saving them: the Rust jobs their own, and `main-keep` the rest. On 5 October 2026, the repository's caches held 10.7 GB against GitHub's limit of 10 GB. Past the limit, GitHub drops the oldest caches. Pull requests and merge queue runs each saved copies that only their own later runs could restore. The package install with its cache is the action `.github/actions/bun-install`.
- The merge queue requires `ci-passed`, not each job, because a job that splits into more shards changes its name. Without that job, a new shard would strand every open pull request.
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
