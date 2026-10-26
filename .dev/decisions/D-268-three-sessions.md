# D-268: Three sessions share the milestone's work, and one of them audits the ticks

Status: decided by the owner on 26 October 2026. Widened by the owner later that day (addendum):
the CI session also makes every build faster and cuts its memory. Date: 2026-10-26. Task: none.

Summary: The milestone's work runs in three agent sessions. The landing session runs the
helpers, merges their branches and keeps the ticks. The CI session checks and pushes each landing,
and improves CI. The PR audit session audits the pull request's task ticks adversarially. A tick that
it refuses goes back to the list of unfinished tasks, with its finding.

## Question

Which session does which part of the milestone's work, and who reads a task's tick after it is given?

## Rule

[D-259](D-259-landing-push-gate.md)'s task rule holds: the agent that checks a task is never its
author, and never the session that pushes its branch.

## Data

Ticks on the milestone's pull request that an audit withdrew on 26 October 2026, by the author times
of the commits:

| Task | Ticked | Withdrawn |
| --- | --- | --- |
| The CSS3D labels | 00:25 | 01:45 |
| The material lobe hook | 01:30 | 03:39 |
| The level-of-detail memory | 02:14 | 03:39 |
| The timed script | 03:20 | 04:39 |
| The wind add-on's first stage | 04:15 | 04:17 |
| The upstream notices | 25 October, 00:23 | 06:50 |
| The grading evidence | 08:07 | 08:09 |

How the data was produced: `git log -p -- tools/pr-status.ts` on the milestone branch, read for each
task that left or joined the tool's list of unfinished tasks.

## Look

The options do not change how anything looks.

## Decision

The owner set up three sessions on 26 October 2026:

- The landing session runs the helpers and merges their branches into the milestone branch, in the
  landing checkout. It keeps the task ticks, the pull request's description (`bun run pr-status`)
  and the status notes.
- The CI session checks each landing range and pushes it, as [D-259](D-259-landing-push-gate.md)
  says. It also improves CI.
- The PR audit session audits the pull request's task ticks adversarially. A tick that it refuses
  goes back to the list of unfinished tasks, with its finding.

The PR audit session gives no tick and pushes no branch, so it meets the task rule for every tick
that it reads. The check that D-259 asks for before a tick still runs. The audit session reads the
ticks again after they are given.

## Consequences

- `AGENTS.md` and `.dev/pull-requests.md` name the three sessions and the audit of the ticks.
- A refused tick goes back into the status tool's list of unfinished tasks (`tools/pr-status.ts`),
  and the finding becomes the task's note there.

## Addendum, 26 October 2026: the build's speed and memory

Later the same day, the owner widened the CI session's work. Besides its work above, the CI
session makes every build faster and cuts the memory that each build needs. That holds in CI and on the machines that
build the milestone. It covers the shader build, the page builds, the type check, the test suites
and the job queue's lanes.

- A task in the milestone plan that makes a build faster or cuts its memory goes to the CI session.
