# D-244: A push to a pull request waits 3 minutes before its jobs start

Status: decided on 24 October 2026, landed in ci/pr-debounce (03008ecce). Date: 2026-10-24.
Task: none.

Summary: On a push to a pull request, the `changes` job first sleeps 180 seconds. Every other
job of the run waits for it. A newer push in that time cancels the run at the cost of that one
job. Pushes to a milestone's pull request come in bursts. Before the wait, most runs that a
newer push cancelled had already started about 50 jobs. They cost 922 job-minutes in under four
hours, 13% of all CI work, for results that nobody read.

## Question

Each push to a pull request starts a CI run, and a newer push cancels the run in progress. How
much work do the cancelled runs cost, and how can CI stop paying for runs that a push is about to
cancel?

## Data

These are the last 60 runs of `ci.yml` on the milestone branch `m3-start`, from 06:14 to 09:54
UTC on 24 October 2026. A job-minute is a minute of one job's own time.

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

## Decision

- The `changes` job's first step runs `sleep 180` on a pull request's `synchronize` event alone.
- `shader-entries` and `commits`, the only jobs that did not wait for `changes`, now do, so no job
  but `changes` starts in the wait.
- A workflow test in `tools/lib/ci-workflow.test.ts` fails when any job can start before
  `changes`, or when the sleep runs on another event.
- The wait is 180 seconds rather than 120. A wait of 120 catches 17 of the 44 runs, and 180
  catches 27, for 1 more minute on each quick check. A wait of 300 catches 41, but holds every
  quick check 5 minutes.

## Consequences

- From the 60 runs, the wait saves about 500 job-minutes per 3.7 hours. That is about 40% of the
  pull request runs' work, and 7% of all CI work. A cancelled run costs one waiting job, about 3
  job-minutes, in place of about 21.
- Every pull request run's results come 3 minutes later.
- Full runs started by hand and pushes to main do not sleep. Their `shader-entries` shards now
  start after `changes`, though, and that job's start adds about 10 to 20 seconds to their
  length.
- Shorten the wait only when landings stop coming in bursts. Measure the gaps between pull request
  runs first, and the share of cancelled runs that went within the wait, as above.
- `.dev/pull-requests.md` describes the wait where it lists what CI runs where.
