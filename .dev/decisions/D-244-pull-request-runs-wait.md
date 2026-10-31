# D-244: A started CI run is never cancelled, except by a push to main

Status: decided. Built: `cancel-in-progress` holds only for pushes to main, and a workflow test
guards it. [D-249](D-249-milestone-push-runs.md) runs a milestone's quick checks on its branch's
pushes instead of its pull request's runs, under the same rule. Task: none.

Summary: Only a push to main cancels a CI run in progress. A newer push leaves a started run to
finish. GitHub keeps only the newest waiting run in the group, so a burst of landings collapses into
the next run at no cost. A 180-second wait before each run's jobs cost more job-minutes an hour
for fewer results, so it is rejected.

## Question

Pushes come in bursts, and a newer push can cancel the run in progress. How much work do the
cancelled runs cost, and how can CI stop paying for runs that it then cancels?

## Data

### Runs that a newer push cancels

These are 60 runs of `ci.yml` in a row on the milestone branch `m3-start`, over 3.7 hours. In that
window a newer push cancelled the pull request run in progress. A job-minute is a minute of one job's own
time.

| Runs | Count | Job-minutes | Share |
| --- | --- | --- | --- |
| Full runs started by hand | 6 | 6014 | 82% |
| Pull request runs cancelled by a newer push or a full run | 44 | 922 | 13% |
| Pull request runs that ran to their end | 7 | 376 | 5% |

- Landings come in bursts: a merge, then its docs commits. In that time the milestone branch took
  35 merges and 18 docs commits.
- The median gap between two pull request runs was 2.0 minutes; a quarter came within 1.2.
- The median cancelled run lived 2.3 minutes. Of the 44, 8 went within 1 minute, 17 within 2, 27
  within 3, and 41 within 5.
- A cancelled run cost about 21 job-minutes: the run starts about 50 jobs at once, the 16
  `shader-entries` shards and the commit check among them.

### A wait before the jobs start

A wait of 180 seconds ran in the `changes` job on a pull request's `synchronize` event, and every
other job waited for it. Both windows are the milestone branch's pull request runs, at about 14
runs an hour:

| Window | Hours | Runs | Finished | Job-minutes per hour | Results per hour |
| --- | --- | --- | --- | --- | --- |
| 06:14 to 09:54, no wait | 3.7 | 51 | 7 (376 job-minutes) | about 350 | 1.9 |
| 10:01 to 11:25, 180 s wait | 1.4 | 19 | 1 (172 job-minutes) | about 505 | 0.7 |

- With the wait, 17 runs were cancelled, for 489 job-minutes. The 11 cancelled in their wait cost 0
  to 3 job-minutes each, as planned.
- Landings came in bursts about every 8 to 10 minutes, and the wait made each run 3 minutes longer.
  The run that outlived its wait started every job. The next burst cancelled it 6 to 8 minutes
  later, at 43 to 125 job-minutes each: runs 40084466698, 40086717874, 40087624075, 40088214674 and
  40088876596.
- An estimate from the first window put the wait's saving at about 500 job-minutes per 3.7 hours.
  It assumed that runs would be cancelled at the same times as without the wait. They were not,
  because the wait moves the times.

## Decision

- `cancel-in-progress` holds only for pushes to main. A newer push leaves its run in progress, and
  the newer run waits. GitHub keeps only the newest waiting run in the group, and drops an older one
  before it starts any job. So every started run ends with a result, and a burst of landings
  collapses into the next run at no cost.
- No job sleeps before the run's jobs start.
- Only a cancel by hand ends a run early. The landing session cancels the quick run of a commit when
  it starts a full run of the same commit.
- Each landing's quick run tells whether the landing broke the build before the next one lands.

## Options rejected

- **A wait before a pull request run's jobs start.** A wait of 120 s catches 17 of the 44 cancelled
  runs, and 180 s catches 27. A wait of 300 s catches 41, but holds every quick check 5 minutes. At
  180 s the wait made CI do more work for fewer results, as the second table shows. It also held
  every result 3 minutes. The jobs that start beside `changes` had to wait for it, which added 10 to
  20 seconds to full runs.

## Consequences

- A workflow test in `tools/lib/ci-workflow.test.ts` fails when `cancel-in-progress` holds for any
  event but a push to main.
- `.dev/pull-requests.md` lists what CI runs where.
