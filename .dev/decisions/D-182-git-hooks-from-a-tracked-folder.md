# D-182: The git hooks come from a tracked folder

Status: decided and built. Task: a worktree whose commits run no check.

Summary: The git hooks come from the tracked `.githooks/` folder, which every worktree has, and an installer of the repository's own replaces husky's. A hook folder that `bun install` writes and git ignores is missing in a worktree made by `git worktree add`. Its commits and pushes then run no check, and a commit type that commitlint rejects can reach main (run 38892912324).

## Question

A worktree holds only the files git tracks. Husky writes its hook folder during an install. A worktree made by `git worktree add` therefore has no hooks, and no way to say so: git finds no hook to run, and stays quiet about it. May the hooks live in a folder that git tracks, so that every worktree has them with no install of its own?

## Options

- Keep husky, and require `bun install` in each worktree. Rejected: it relies on every person and agent remembering, and the failure is silent. That is how a commit with a rejected type reached main (run 38892912324).
- Point a user-level `core.hooksPath` at a folder outside the repository. Rejected: that setting covers every repository on the machine, so it would change all of them to fix one.
- Track the hook folder itself, which every worktree checks out. Taken.

## Rule

- `.githooks/` holds one file for each hook git calls. Each of the six forwards to the body in `.husky/`, so the checks stay in one place and the forwarding lives in one script.
- `bun install` runs `tools/hooks/install-hooks.ts`, which sets the repository's `core.hooksPath` to `.githooks`. The repository does not use husky's installer or depend on husky. The hook bodies stay in `.husky/`.
- The install writes husky's folder too, one file for each hook, each forwarding to the same dispatcher. Either hooks path therefore runs the hooks. The shared setting cannot disarm a tree that has been installed in, whichever value it holds.
- `HUSKY=0` installs nothing and runs no hook, which is what CI's jobs and the release job ask.
- A brand-new clone is unguarded until its first install. Git calls no hook when no hooks path is set, so nothing in the repository can report that state. The `commits` job on main covers it.
- A test holds each hook body to a dispatcher. It holds the installer to the path, and to `HUSKY=0`.
