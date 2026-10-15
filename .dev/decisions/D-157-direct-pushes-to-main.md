# D-157: Work lands on main by direct push, without pull requests

Status: decided. Date: 13 October 2026. Task: none (process).

Summary: The owner ruled on 13 October 2026 that work no longer goes through pull requests. Each branch merges main locally, passes its local checks, and is pushed straight to main. CI then runs on main, and a red main is fixed before anything else lands.

## Question

How does finished work reach main: through a pull request that CI must pass first, or by a direct push after local checks?

## Rule

The way of merging must keep main working while letting finished work land within minutes, not hours.

## Data

| Measure | Pull requests (12 to 13 October 2026) |
| --- | --- |
| CI runs that GitHub ran at once | About 1: each run has 10 Mac jobs (Safari and Firefox), and GitHub's Mac machines served about one run at a time |
| Time of one CI run | About 1 hour |
| Pull requests waiting for CI at the same time | Up to 8 |
| Limit on open pull requests | 5 |

How the data was produced: the coordinator's logs of 12 to 13 October 2026 (`gh run list`, queued and in-progress runs).

## Decision

The owner chose direct pushes to main. The rule on main ("main: CI must pass") stays active for others; the owner's account may bypass it, and direct pushes use that bypass. Pull requests are no longer opened. Open ones are closed as their branches land on main.

## Consequences

- A branch lands as follows. Merge `origin/main` into the branch and resolve any clash. Run the local checks: build, `bun run check`, `bun run typecheck`, the unit tests, the browser and image tests of the parts the branch changes (both reference sets when an image changes), the size check, and the GPU check when the branch changes how the GPU draws. Push the branch to its remote branch as you work, to save it. Then `git push origin HEAD:main`. If the push is refused because main moved, merge `origin/main` again, rerun the checks the new commits touch, and push again.
- The commit gates still apply to every commit: conventional subjects, the `Docs-Checked:`, `Skills-Checked:`, `Task:`, `Size-Growth:`, `GPU-Checked:` and `Mac-References:` trailers, and the docs checks. Main now keeps each branch's commits and merge commits, so subjects of plain commits become changelog lines.
- CI runs on each push to main, and a new push cancels main's running run, by the owner's choice: only the newest main matters. A push that merges a branch counts the same. If pushes come faster than one run (about an hour), no run on main finishes, so the coordinator watches for a run that completes.
- Each branch is still pushed to its own remote branch while it is worked on, to save the work; only finished work goes to main.
- Nobody waits for main's CI before pushing (owner, 13 October 2026): not for a running run, and not for a red one. When a finished run on main is red, whoever's push broke it fixes it at once, while others keep pushing.
- [Pull requests and parallel work](../pull-requests.md) and [AGENTS.md](../../AGENTS.md) describe this flow. [D-99](D-99-no-merge-queue.md), which merged pull requests when CI passed, no longer applies.

## Addendum, 15 October 2026: a check before each push to main

The owner approved it on 15 October 2026, through the coordinator: "OWNER APPROVED (15 Oct) the local pre-push check: build it. On every push to main (and only then, so branch saves stay fast)". A code review that day found that nothing checked the commits that reached main. CI's commit check ran only on pull requests. On 14 October a branch landed with five failing tests of a crate whose test files it never changed. Three merged trees held structs and constants that did not compile.

- `tools/hooks/pre-push.ts` runs before each push to main, through the git hooks that `bun install` sets up. A push to another branch runs nothing.
- It runs the commit message and trailer checks over the commits that the push adds to main, the same checks as CI's `commits` job: commitlint, then the trailer check. When the push changes Rust code or Cargo settings, it runs `cargo check --workspace`, then the tests of each changed crate with `--no-fail-fast`. It prints each command and the reason, and refuses the push when one fails.
- Where git's `null3d.jobQueue` setting names a job queue script, the steps run through it, so a push does not load a busy machine.
- The bypass is for emergencies only: a `Push-Check-Skipped: <reason>` trailer on a commit of the push, which names the emergency in the commit body.
- CI's `commits` job runs the commit message and trailer checks on each push to main too, over the commits after main's commit before the push.
- [Pull requests and parallel work](../pull-requests.md#commit-messages-and-pushes) gives the details.
