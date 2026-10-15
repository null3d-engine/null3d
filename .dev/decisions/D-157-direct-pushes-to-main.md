# D-157: Work lands on main by direct push, without pull requests

Status: decided. Date: 13 October 2026; [addendum](#addendum-2026-10-15-task-footers-and-merge-commits) decided by the owner on 15 October 2026. Task: none (process).

Summary: The owner ruled on 13 October 2026 that work no longer goes through pull requests. Each branch merges main locally, passes its local checks, and is pushed straight to main. CI then runs on main, and a red main is fixed before anything else lands. Since 15 October 2026 a `Task:` footer names a listed task or says `none`. A merge commit holds only conflict resolutions and mechanical fixes. Hooks check both.

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
- [Branches and parallel work](../pull-requests.md) and [AGENTS.md](../../AGENTS.md) describe this flow. [D-99](D-99-no-merge-queue.md), which merged pull requests when CI passed, no longer applies.

## Addendum, 2026-10-15: task footers and merge commits

The review of 15 October 2026 found two faults in how work reaches main, and the owner approved a rule for each that day (review findings M-56 and M-73).

### Task footers name a listed task or say none

Footers carried free text, such as `none (Factory comparison follow-up)`, `build artifact cache` and `main CI repair`. Four commits of first-use shader file work carried `Task: M2-J4`. M2-J4's bump and displacement materials were not built. The coordinator's milestone count took a task as landed from one footer on main. It gave M2 as 162 of 171 tasks (94%), while the audited status table gave 138 (81%).

- A `Task:` footer is `none`, or one or more task IDs from `tools/hooks/task-ids.txt`, separated by commas. The commit-msg hook `tools/hooks/check-task.ts` refuses anything else. `tools/hooks/check-trailers.ts` checks a range of commits the same way. Commits authored before the rule keep their old footers.
- The task IDs live in the milestone plans, which are kept outside git. A hook in a fresh checkout cannot read them. So the maintainers write the list from the plans and commit it. [D-105](D-105-generated-files-out-of-git.md#generated-files-that-git-keeps) records the reason. A new task's ID goes into the list in the commit that first names it, or before.
- A hook cannot tell whether a commit really delivers part of the task it names. So the milestone count no longer reads footers. A task counts as done only when its row in the audited status table says so, and dropped tasks leave the count. On 15 October 2026 it gave 138 of 169, the table's own figure. It lists tasks whose branch reached main while their row is not done, for the next audit, and does not count them.

### Merge commits hold only resolutions

Five merges of 12 to 14 October 2026 held features, tests or shading that no plain commit holds. They are 98d26658c, 2a90c4316, f471f123f, e13b05241 and ef72eae95. They added area lights in scene and reflection passes, and automatic exposure in the two-step output. They also added a new clear coat roughness and a half-precision split of the first-use tables. Four more (f439d7fcd, 21d807002, cfd44ef44 and bc99c4330) held measured figures and the conclusion of D-174. `git log -p`, `git log -S` and a review by commit do not show a merge's own edits.

- A merge commit holds only conflict resolutions and mechanical fixes. Mechanical fixes are files that a generator writes again, renumbered entries, and edits that the other side's change forces. Everything else goes into a plain commit before or after the merge.
- Before a push, `tools/hooks/check-merges.ts` rebuilds each new merge's automatic result with `git merge-tree`, conflict markers included. `git show --remerge-diff` compares against the same result. The check reads the merge's changes from it:
  - Inside a conflict, a resolution line comes from the sides. It is the same line, give or take spacing and numbers, or it has at most two words that neither side holds there.
  - Outside a conflict, an added line is mechanical in two cases: a small edit of a line it replaces, or a line of at most three words. Its new words must be ones that a side added. In shader files, such an edit may not change a number.
  - A line that leaves one place and arrives at another has moved, and counts as nothing.
  - Generated sources and lock files are left out.
- What is left is new work. The check refuses a merge with more than 30 words of new work, or any new line of shader code. It also refuses a binary file that the merge changed outside a conflict. A `Merge-Edit:` trailer on the merge lets it through: it names the edit and says why it belongs in the merge. The check skips merges committed before the rule, and `--all` checks them too.

How the limits were chosen: the check ran over the 117 merges that the review read. It also ran over the 23 merges on main of 15 October 2026 to 12:00. Some are in both, so there are 133 merges. It refused all nine merges named above. Of the 23 merges of 15 October, 20 pass. The three it refuses add D-174 text: 21d807002 and bc99c4330 among the nine, and 63e7337f3, which adds a paragraph of iPhone 17 figures. It refused 21 of the 133 merges in all. Each of the other refused merges also holds edits beyond its resolutions. They added a demo's whole files, a table of measurements, rewritten paragraphs of decision records, and a demo entry written back. Two adapted code that main moved or changed (594cc304e and 1f1f04501), and would now carry a `Merge-Edit:` trailer. The merges that pass hold at most 26 words of new work, such as a comment or an argument passed on. A limit of 30 words lets that glue through and stops any new paragraph, table or function. One changed shader line can change every image, as e13b05241's did, so shader code has no allowance.

The check misses small edits below the limit, such as 7674e8b10, which dropped a line from one side (11 words). A count of the lines that a side added and the merge lost would catch such a drop. But it gives false alarms where a side already holds the other's change, so a reviewer checks for drops.

## Addendum, 15 October 2026: a check before each push to main

The owner approved it on 15 October 2026, through the coordinator: "OWNER APPROVED (15 Oct) the local pre-push check: build it. On every push to main (and only then, so branch saves stay fast)". A code review that day found that nothing checked the commits that reached main. CI's commit check ran only on pull requests. On 14 October a branch landed with five failing tests of a crate whose test files it never changed. Three merged trees held structs and constants that did not compile.

- `tools/hooks/pre-push.ts` runs before each push to main, through the git hooks that `bun install` sets up. A push to another branch runs nothing.
- It runs the commit message and trailer checks over the commits that the push adds to main, the same checks as CI's `commits` job: commitlint, then the trailer check. It also runs the merge check over them, so a merge commit that carries new work is refused. When the push changes Rust code or Cargo settings, it runs `cargo check --workspace`, then the tests of each changed crate with `--no-fail-fast`. It prints each command and the reason, and refuses the push when one fails.
- Where git's `null3d.jobQueue` setting names a job queue script, the steps run through it, so a push does not load a busy machine.
- The bypass is for emergencies only: a `Push-Check-Skipped: <reason>` trailer on a commit of the push, which names the emergency in the commit body.
- CI's `commits` job runs the commit message and trailer checks on each push to main too, over the commits after main's commit before the push.
- [Pull requests and parallel work](../pull-requests.md#commit-messages-and-pushes) gives the details.
