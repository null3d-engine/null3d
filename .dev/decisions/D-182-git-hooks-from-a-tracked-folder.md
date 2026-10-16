# D-182: The git hooks come from a tracked folder

Status: decided. Date: 2026-10-16. Task: a worktree whose commits run no check, 16 October 2026.

Summary: The hooks came from `.husky/_`, a folder that `bun install` wrote and git ignored. A worktree created by `git worktree add` therefore had none, and its commits and pushes ran no check. A commit with a type commitlint rejects reached main that way (run 38892912324). The hooks now come from the tracked `.githooks/` folder, which every worktree has, and an installer of the repository's own replaces husky's.

## Question

A worktree holds only the files git tracks. Husky writes its hook folder during an install. A worktree made by `git worktree add` therefore has no hooks, and no way to say so: git finds no hook to run, and stays quiet about it. May the hooks live in a folder that git tracks, so that every worktree has them with no install of its own?

## Options

- Keep husky, and require `bun install` in each worktree. Rejected: it relies on every person and agent remembering, and the failure is silent. That is how the commit of 16 October reached main.
- Point a user-level `core.hooksPath` at a folder outside the repository. Rejected: that setting covers every repository on the machine, so it would change all of them to fix one. The owner has not been asked for it.
- Track the hook folder itself, which every worktree checks out. Taken.

## Rule

- `.githooks/` holds one file for each hook git calls. Each of the six forwards to the body in `.husky/`, so the checks stay in one place and the forwarding lives in one script.
- `bun install` runs `tools/hooks/install-hooks.ts`, which sets the repository's `core.hooksPath` to `.githooks`. Husky's installer is retired and its dependency is gone. Its hook bodies stay.
- `HUSKY=0` installs nothing and runs no hook, which is what CI's jobs and the release job ask.
- A branch from before the folder keeps no hooks until it merges main. A brand-new clone is unguarded until its first install. Git calls no hook when no hooks path is set, so nothing in the repository can report that state. The `commits` job on main covers it.
- A test holds each hook body to a dispatcher. It holds the installer to the path, and to `HUSKY=0`.
