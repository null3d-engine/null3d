# D-178: The owner's rulings on helpers and cloud runs, 15 October 2026

Status: decided. Date: 15 October 2026. Task: none (process).

Summary: On 15 October 2026 the owner moved the helper agents to Claude Code subagents. The coordination works with more than one agent tool: one setting picks Claude Code or opencode, and no script may start an opencode server. Cloud device runs never wait for the owner's go-ahead. They have a one-slot lane in the load limiter, and no longer hold a browser slot for up to 85 minutes.

## Question

1. The model service of the opencode sessions failed for hours. Which agent tool runs the helper agents now, and must the coordination depend on one tool?
2. Must a cloud device run wait for the owner's go-ahead, and which queue slot does it take?

## Rule

Helpers must keep working when one model service fails, and nothing may restart a helper that the coordinator stopped. A cloud run must not wait on a person, and must not keep local runs from a slot while it barely loads the Mac.

## Data

| Measure | Before 15 October 2026 |
| --- | --- |
| Helpers stopped by the model service's failure | Every helper, from about 08:15, with the service "too busy" or past its 900-second limit |
| Old sessions that came back after the stop | Several, at 09:53 and 09:58. One ran `git add -A` and began a commit in a worktree that a new helper owned |
| Why they came back | A check-in script asked opencode for its sessions with no server address. Any such opencode command starts its background server, which resumed the old sessions |
| A cloud run's browser slot | Held for the whole job, up to about 85 minutes |
| Cloud sessions at once on the BrowserStack plan | 1 |

How the data was produced: the coordinator's log of 15 October 2026, the process table, and `git ls-remote` of main and each task branch. No push to main or to a task branch came from the old sessions.

## Decision

1. The helpers moved to Claude Code subagents of the coordinator's session at 09:55. The owner's words: "forget the deepseek model service - run them in this session with claude". At 11:00 the owner added that the setup must not be specific to Claude: "make it tool-neutral". So one setting of the coordinator picks the helpers' tool, Claude Code or opencode, and only one is used at a time. The waits, the load limiter and the check-ins work the same with both. The scripts call opencode only with the address of a server that the coordinator started, and stop when nothing answers there.
2. Cloud device runs never wait for the owner's go-ahead. They get a lane of their own in the load limiter with one slot, which the owner approved on 15 October 2026. A run in that lane takes no browser slot and no CPU slot, and never waits for the load limit or the quiet window.

## Consequences

- A helper waits for its own jobs inside its turn, through a wait that records each job's process and exit status. When a tool call stops before the job ends, the helper waits on the same job again by name ([Coordinating helper agents](../pull-requests.md#coordinating-helper-agents)).
- The check-in gives each job to the copy of the repository that it works in, and counts a task as landed only on firm evidence. Before, a subagent's job looked like the coordinator's, and a `Task:` trailer alone counted a task as landed.
- The coordinator's own test suite checks the waits, the check-in's attribution, the milestone count and the cloud lane. It also runs the helper scripts under both tools, with a stand-in for opencode.
- [Device sessions](../devices.md#browserstack-automate) says that cloud runs need no go-ahead. Runs still happen by hand or on request, never on a timer or in CI.
- The cloud lane went into use at 11:00 the same day. From 10:30 until then, the load limiter had one extra browser slot to make up for the slot that a cloud run held. That extra slot was removed at 11:04.
- The same day, the owner ruled that each copy of the repository builds Rust into a folder of its own. [Builds](../pull-requests.md#builds) and [D-177](D-177-build-cache-module.md) record it.
