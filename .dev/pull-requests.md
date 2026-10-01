# Pull requests and parallel work

This guide covers how to merge main into a branch, and what to do when the merge queue removes a pull request. It also covers several copies of the repository on one machine. [AGENTS.md](../AGENTS.md) holds the commit gates and the rules of the merge queue.

## Merge main into a branch

- Merge main into your branch. Do not rebase a branch that you pushed, because a rebase needs a force push (see [Commit messages and pushes](#commit-messages-and-pushes)).
- Never merge a generated file by hand. Take either side of its conflict, run its generator, and stage what the generator writes:

| Generated files | Generator |
| --- | --- |
| The shader modules, `packages/engine/src/generated/shaders*.ts` | `bun run shaders` |
| The docs generator's output: placeholder pages, the API reference, the error pages, the page list in `docs/index.md`, and the three.js mapping page and copies | `bun run docs` |
| The skills copy, `.claude/skills/` | `bun run skills` |
| The constants that TypeScript shares with Rust, `packages/engine/src/generated/core.ts` and `gpu.ts`, and the render graph's text dump in `crates/null3d-render/tests/snapshots/` | `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-wasm -p null3d-gpu -p null3d-render` |

- Run the generators after every merge of main, also when git reports no conflict. Git can merge the text of a generated file cleanly and still give a result that no generator makes.
- Check the shared numbers after the merge. Two branches can each take the next free number, and git then merges both lines without a conflict. The shared numbers are the error codes (`packages/engine/src/errors/codes.ts`), the scene command numbers (`crates/null3d-wasm/src/constants.rs`), and the draw list's opcodes and pipeline template numbers (`crates/null3d-gpu/src/drawlist.rs`). The bindings and slots that a shader and its bind group layout share are shared numbers too. A unit test catches a clash in some of these lists, such as the opcodes, but not in all of them.
- Build and run the checks again before you push the merge.

## Commit messages and pushes

- A merge commit must pass the commit-message check, as every commit does. A message such as `Merge origin/main into <branch>` passes, and so do git's own merge messages. A message such as `merge origin/main` fails, because the check reads it as a commit without a type.
- Never force push a pull request's branch, so never amend, rebase or squash a commit that you pushed.
- Main squashes each pull request, but CI checks the message of every commit in the pull request until it merges. A pushed commit with a bad message therefore fails CI for as long as the pull request is open.
- To fix a bad message, open a new pull request from a new branch with a clean history. It replaces the old one. For example, `git switch -c <new-branch> origin/main`, then `git merge --squash <old-branch>`, then commit with a good message. Close the old pull request, and link the new one from it.

## The merge queue

[AGENTS.md](../AGENTS.md#releases) says how the queue runs CI on each pull request on top of main and the pull requests ahead of it.

- When the queue's run fails, the queue removes the pull request. It does not join the queue again with the same commit, so fix the cause and push.
- `gh run list --event merge_group` lists the queue's runs. Each run's branch is `gh-readonly-queue/main/pr-<number>-<commit>`, so look for your pull request's number. The pull request's timeline also links the failed run, and `gh run view <run> --log-failed` prints its failed steps.
- The most common cause is two pull requests that change shaders in one queue run. Each one committed shader modules built from its own sources, so the second one's modules lack the first one's change. In the second one's run, the Rust test `the_committed_modules_match_a_fresh_build` fails. The shader compiler test "gives the native build's output for the engine's shaders" (`bun run test:shader-compiler`) fails too.
- To fix that, merge main after the first pull request merges, run the generators, and push.

## Several copies on one machine

People and agents often work in several copies of the repository at once, such as git worktrees.

- Give each copy its own ports with `NULL3D_PORT`, as [AGENTS.md](../AGENTS.md#performance-work) says. Each copy then uses its port and the three ports above it.
- Stop only your own servers. Find the process on your port with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`, and stop that process. Never stop a server or a browser by its name, because that also stops the servers and runs of the other copies.
- Close the browser tabs that you open as soon as each test ends, as [Device sessions](devices.md#the-runner) says.
- The dev server ignores changes in folders named `.claude`. A dev server in a worktree under `.claude/worktrees` therefore serves old files after an edit, until you restart it.
- Agent tools can lock a worktree. `git worktree list` shows "locked", and `git worktree list --porcelain` gives the reason, which can name a process id. When that process no longer runs, the lock is stale, and `git worktree unlock <path>` clears it.
- The size check builds main in a worktree of its own, `target/.size-base/tree`, inside each copy that runs it ([Benchmarks](benchmarks.md#download-size)). `git worktree list` therefore shows one under each such copy. After you delete a copy's folder, `git worktree prune` removes the worktrees whose folders are gone.
