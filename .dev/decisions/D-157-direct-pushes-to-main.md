# D-157: Work lands on main by direct push, without pull requests

Status: decided by the owner. The owner also approved the rules for task footers and merge commits, and the check before each push to main. The coordinator ruled that a push that changes no Rust file needs the type check only. Built: the commit-msg hook's task check, the trailer and merge checks, and the check before each push to main with its keepalive test. Task: none (process).

Summary: Work reaches main by direct push, without pull requests: each branch merges main, passes its local checks and the pre-push check, and lands. CI then runs on main, nobody waits for it, and whoever turns main red fixes it at once. A `Task:` footer names a listed task or says `none`, and a merge commit holds only conflict resolutions and mechanical fixes; hooks check both.

## Question

How does finished work reach main: through a pull request that CI must pass first, or by a direct push after local checks?

## Rule

The way of merging must keep main working while letting finished work land within minutes, not hours.

## Data

| Measure | Pull requests |
| --- | --- |
| CI runs that GitHub ran at once | About 1: each run has 10 Mac jobs (Safari and Firefox), and GitHub's Mac machines served about one run at a time |
| Time of one CI run | About 1 hour |
| Pull requests waiting for CI at the same time | Up to 8 |
| Limit on open pull requests | 5 |

How the data was produced: the coordinator's logs of the pull request flow (`gh run list`, queued and in-progress runs).

## Decision

The owner chose direct pushes to main. The rule on main ("main: CI must pass") stays active for others; the owner's account may bypass it, and direct pushes use that bypass. Pull requests are not opened.

Rejected: pull requests that CI must pass first. GitHub's Mac machines serve about one CI run at a time, a run takes about an hour, and up to eight pull requests wait at once, so finished work waits hours.

## Consequences

- A branch lands as follows. Merge `origin/main` into the branch and resolve any clash. Run the local checks: build, `bun run check`, `bun run typecheck`, the unit tests, the browser and image tests of the parts the branch changes (both reference sets when an image changes), the size check, and the GPU check when the branch changes how the GPU draws. Push the branch to its remote branch as you work, to save it. Then `git push origin HEAD:main`. If the push is refused because main moved, merge `origin/main` again, rerun the checks the new commits touch, and push again.
- The commit gates apply to every commit: conventional subjects, the `Docs-Checked:`, `Skills-Checked:`, `Task:`, `Size-Growth:`, `GPU-Checked:` and `Mac-References:` trailers, and the docs checks. Main keeps each branch's commits and merge commits, so subjects of plain commits become changelog lines.
- CI runs on each push to main, and a new push cancels main's running run, by the owner's choice: only the newest main matters. A push that merges a branch counts the same. If pushes come faster than one run (about an hour), no run on main finishes, so the coordinator watches for a run that completes.
- Each branch is still pushed to its own remote branch while it is worked on, to save the work; only finished work goes to main.
- Nobody waits for main's CI before pushing, by the owner's rule: not for a running run, and not for a red one. When a finished run on main is red, whoever's push broke it fixes it at once, while others keep pushing.
- [Branches and parallel work](../pull-requests.md) and [AGENTS.md](../../AGENTS.md) describe this flow. This record supersedes [D-99](D-99-no-merge-queue.md), which merged pull requests when CI passed.

## Task footers and merge commits

The owner approved a rule for each of two faults in how work reaches main (review findings M-56 and M-73).

### Task footers name a listed task or say none

A footer of free text, such as `none (Factory comparison follow-up)`, `build artifact cache` or `main CI repair`, names no task. A footer can also name a task that the commit does not deliver. First-use shader file work can carry `Task: M2-J4` while M2-J4's bump and displacement materials are not built. A milestone count that takes a task as landed from one footer on main then overstates the milestone. Such a count gave M2 as 162 of 171 tasks (94%), while the audited status table gave 138 (81%).

- A `Task:` footer is `none`, or one or more task IDs from `tools/hooks/task-ids.txt`, separated by commas. The commit-msg hook `tools/hooks/check-task.ts` refuses anything else. `tools/hooks/check-trailers.ts` checks a range of commits the same way. Both skip commits made before the rule took effect (`TASK_RULE_SINCE`).
- The task IDs live in the milestone plans, which are kept outside git. A hook in a fresh checkout cannot read them. So the maintainers write the list from the plans and commit it. [D-105](D-105-generated-files-out-of-git.md#generated-files-that-git-keeps) records the reason. A new task's ID goes into the list in the commit that first names it, or before.
- A hook cannot tell whether a commit really delivers part of the task it names. So the milestone count reads no footers. A task counts as done only when its row in the audited status table says so, and dropped tasks leave the count. It lists tasks whose branch reached main while their row is not done, for the next audit, and does not count them.

### Merge commits hold only resolutions

`git log -p`, `git log -S` and a review by commit do not show a merge's own edits, so work inside a merge escapes review. Five merges (98d26658c, 2a90c4316, f471f123f, e13b05241 and ef72eae95) held features, tests or shading that no plain commit holds. They added area lights in scene and reflection passes, and automatic exposure in the two-step output. They also added a clear coat roughness and a half-precision split of the first-use tables. Four more (f439d7fcd, 21d807002, cfd44ef44 and bc99c4330) held measured figures and the conclusion of D-174.

- A merge commit holds only conflict resolutions and mechanical fixes. Mechanical fixes are files that a generator writes again, renumbered entries, and edits that the other side's change forces. Everything else goes into a plain commit before or after the merge.
- Before a push, `tools/hooks/check-merges.ts` rebuilds each new merge's automatic result with `git merge-tree`, conflict markers included. `git show --remerge-diff` compares against the same result. The check reads the merge's changes from it:
  - Inside a conflict, a resolution line comes from the sides. It is the same line, give or take spacing and numbers, or it has at most two words that neither side holds there.
  - Outside a conflict, an added line is mechanical in two cases: a small edit of a line it replaces, or a line of at most three words. Its new words must be ones that a side added. In shader files, such an edit may not change a number.
  - A line that leaves one place and arrives at another has moved, and counts as nothing.
  - Generated sources and lock files are left out.
- What is left is new work. The check refuses a merge with more than 30 words of new work, or any new line of shader code. It also refuses a binary file that the merge changed outside a conflict. A `Merge-Edit:` trailer on the merge lets it through: it names the edit and says why it belongs in the merge. The check skips merges committed before the rule took effect (`MERGE_RULE_SINCE`), and `--all` checks them too.

How the limits were chosen: the check ran over the 117 merges that the review read, and over 23 merges on main beside them. Some are in both, so there are 133 merges. It refused all nine merges named above. Of the 23 merges on main, 20 pass. The three it refuses add D-174 text: 21d807002 and bc99c4330 among the nine, and 63e7337f3, which adds a paragraph of iPhone 17 figures. It refused 21 of the 133 merges in all. Each of the other refused merges also holds edits beyond its resolutions. They added a demo's whole files, a table of measurements, rewritten paragraphs of decision records, and a demo entry written back. Two adapted code that main moved or changed (594cc304e and 1f1f04501), and would carry a `Merge-Edit:` trailer. The merges that pass hold at most 26 words of new work, such as a comment or an argument passed on. A limit of 30 words lets that glue through and stops any new paragraph, table or function. One changed shader line can change every image, as e13b05241's did, so shader code has no allowance.

The check misses small edits below the limit, such as 7674e8b10, which dropped a line from one side (11 words). A count of the lines that a side added and the merge lost would catch such a drop. But it gives false alarms where a side already holds the other's change, so a reviewer checks for drops.

## A check before each push to main

The owner approved a local check on every push to main, and only then, so branch saves stay fast. Without it, nothing checks the commits that reach main before they land: CI's `commits` job runs only after the push. A branch can then land with failing tests of a crate whose test files it never changed, and a merged tree can hold structs and constants that do not compile.

- `tools/hooks/pre-push.ts` runs before each push to main, through the git hooks that `bun install` sets up. A push to a branch that only saves work runs nothing.
- It runs the commit message and trailer checks over the commits that the push adds to main, the same checks as CI's `commits` job: commitlint, then the trailer check. It also runs the merge check over them, so a merge commit that carries new work is refused. When the push changes Rust code or Cargo settings, it runs `cargo check --workspace`, then the tests of each changed crate with `--no-fail-fast`. It prints each command and the reason, and refuses the push when one fails.
- Where git's `null3d.jobQueue` setting names a job queue script, the steps run through it, so a push does not load a busy machine.
- The bypass is for emergencies only: a `Push-Check-Skipped: <reason>` trailer on a commit of the push, which names the emergency in the commit body.
- CI's `commits` job runs the commit message and trailer checks on each push to main too, over the commits after main's commit before the push.
- [Pull requests and parallel work](../pull-requests.md#commit-messages-and-pushes) gives the details.

## A Rust-free push needs the type check only

The coordinator ruled this path. A branch that changes no Rust file can wait hours in the machine's CPU queue for a compile that cannot tell it anything.

- The pre-push check runs `cargo check --workspace` and the changed crates' tests only when the diff between main's commit before the push and the pushed commit holds a Rust or Cargo file. That diff covers the merge too, so a resolution that changes Rust shows there.
- A helper that lands by hand follows the same rule. `bun run typecheck` gates the push, and `cargo check --workspace` runs as its own queued job straight after. A failure there is fixed by the next push.
- The criterion is equality of the two Rust trees: `git diff HEAD origin/main` over `*.rs`, `Cargo.toml`, `Cargo.lock` and `rust-toolchain.toml` prints nothing. Both halves must hold, with no Rust file in the branch's own diff and none in the merge that it just resolved. The Rust bytes are then main's own, which main's CI has compiled already, so a local compile repeats a known result at a cost that every helper behind it pays in the queue.
- The type check still gates the push because it reads the merged tree, merge resolutions included. It catches a merged tree whose pages import a package, such as `@null3d/impostors`, before that package is installed.
- A push that takes this path names, in its report, the commit that main held before it, so a failed cargo check costs one revert.

## The push holds a connection that must be kept alive

A push to main can die with nothing printed by git. The cause is measured, and it lies in the connection, not in the code being pushed.

- `git push` opens the connection to the remote before it runs the hook. It holds it, saying nothing, until the hook returns, because the hook reads the ref list that the negotiation produced. A trace that git writes on such a push puts the connection four seconds before the hook.
- A connection that says nothing is closed by the far end after about six minutes. A held session to `github.com` that writes nothing ends after 365.6 seconds, and the ssh client exits 255. It is authenticated and has asked for `git-receive-pack`. It sends no ref and no pack, so nothing on the remote changes.
- A push through the job queue fails this way, and the same push without it lands. The queue's CPU lane runs its steps at background priority, so the check takes about three times as long. The same cargo test step takes 389.9 and 395.1 seconds of test time through the queue, against 134.7 seconds run directly. The longer check outlives its connection, and the shorter one does not.
- When the connection has gone, git writes the push into a socket that has gone. The hook prints `every check passed`, git prints nothing, and nothing is pushed. The status is 141, which is a write to a closed socket. The minutes that the check spent are lost.
- So the check refuses a push to main whose remote it reaches over ssh, when nothing keeps that connection alive, and it names the setting. A machine that pushes to main names `ServerAliveInterval` for the host. It goes under `Host <host>` in `~/.ssh/config`, or on the ssh command through `core.sshCommand`.
- Rejected: running the check's cargo steps as a job after the push. It would trade a guarantee of the check before each push, that a merged tree compiles before it lands, for a shorter check. Keeping the connection alive costs one line of machine setup and keeps the guarantee.

How to recognize it: a push to main that prints `pre-push: every check passed` did not fail its checks. It prints nothing from git, and exits 141. Its connection went quiet for too long. Push again, and add the keepalive setting.
