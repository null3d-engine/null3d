# D-178: The owner's rulings on helpers and cloud runs

Status: decided by the owner, and built. Task: none (process).

Summary: The helper agents run as Claude Code subagents or opencode sessions: one setting picks the tool, and no script may start an opencode server. Cloud device runs never wait for the owner's go-ahead, and they take a one-slot lane of their own in the load limiter. Short jobs take a quick lane, and a check runs before each push to main.

## Question

1. The model service of the opencode sessions can fail for hours. Which agent tool runs the helper agents, and must the coordination depend on one tool?
2. Must a cloud device run wait for the owner's go-ahead, and which queue slot does it take?

## Rule

Helpers must keep working when one model service fails, and nothing may restart a helper that the coordinator stopped. A cloud run must not wait on a person, and must not keep local runs from a slot while it barely loads the Mac.

## Data

| Measure | Value |
| --- | --- |
| Helpers stopped by the model service's failure | Every helper, with the service "too busy" or past its 900-second limit |
| Old sessions that came back after the stop | Several. One ran `git add -A` and began a commit in a worktree that a new helper owned |
| Why they came back | A check-in script asked opencode for its sessions with no server address. Any such opencode command starts its background server, which resumed the old sessions |
| A cloud run's browser slot, without a lane of its own | Held for the whole job, up to about 85 minutes |
| Cloud sessions at once on the BrowserStack plan | 1 |

How the data was produced: the coordinator's log, the process table, and `git ls-remote` of main and each task branch. No push to main or to a task branch came from the old sessions.

## Decision

1. The helpers run as Claude Code subagents of the coordinator's session, by the owner's ruling. The setup is tool-neutral, also by the owner's ruling. One setting of the coordinator picks the helpers' tool, Claude Code or opencode, and only one is used at a time. The waits, the load limiter and the check-ins work the same with both. The scripts call opencode only with the address of a server that the coordinator started, and stop when nothing answers there.
2. Cloud device runs never wait for the owner's go-ahead. They get a lane of their own in the load limiter with one slot, which the owner approved. A run in that lane takes no browser slot and no CPU slot, and never waits for the load limit or the quiet window.
3. A quick lane in the load limiter takes short jobs: installs, lint, docs checks, and unit tests that build nothing. It has 2 slots, does not wait for a low load, and stops a job after 5 minutes. Without it, a docs check of a few seconds can wait about 2 hours behind 30 builds.
4. A check runs before each push to main: the trailers, `cargo check --workspace`, and the tests of the Rust crates that the push changes. Its heavy steps run through the load limiter. A merged tree can fail to compile even when both of its sides compile.
5. CI has higher time limits and keeps built shaders in the Actions cache. It runs the test that builds every shader in a job of its own, and runs Rust tests with `--no-fail-fast` ([CI's jobs](../pull-requests.md#cis-jobs)).
6. The shader build compiles its builds on every core. With over 21,000 shader builds, a build on one core passes CI's time limit.
7. Each copy of the repository builds Rust into a folder of its own, and shares compiled dependencies through a compiler cache. [Builds](../pull-requests.md#builds) and [D-177](D-177-build-cache-module.md) record it.

## Consequences

- A helper waits for its own jobs inside its turn, through a wait that records each job's process and exit status. When a tool call stops before the job ends, the helper waits on the same job again by name ([Coordinating helper agents](../pull-requests.md#coordinating-helper-agents)).
- The check-in gives each job to the copy of the repository that it works in. It counts a task as landed only when its audit says done. Without that, a subagent's job looks like the coordinator's, and a `Task:` trailer alone counts a task as landed.
- The coordinator's own test suite checks the waits, the check-in's attribution, the milestone count and the cloud lane. It also runs the helper scripts under both tools, with a stand-in for opencode.
- [Device sessions](../devices.md#browserstack-automate) says that cloud runs need no go-ahead. Runs still happen by hand or on request, never on a timer or in CI.
- [Coordinating helper agents](../pull-requests.md#coordinating-helper-agents) gives the rules for the lanes and the check before a push.
