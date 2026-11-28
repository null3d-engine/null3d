# Running a null3D task in agent teams

A task that touches more than a couple of files runs best in subagents. This reference gives the workflow. It is not a null3D feature; it is how to run the work.

## A builder and a reviewer

- One builder agent makes the change.
- A separate adversarial reviewer tries to disprove it. It does not share the builder's context, so it reads the diff, the docs and the test output itself.
- Start the reviewer with the builder, not after it. A late reviewer sees a finished thing, and agrees with it.
- The reviewer runs the project's checks and gives its own verdict. A builder's summary is not evidence.

## Check in every five minutes

- The coordinator sets a timer that fires every five minutes while agents run.
- A check-in reads evidence: new commits or files, logs that grow, checks that move, and jobs in the queue.
- An agent's own message is not evidence. A helper can say that it is working while it waits on a job that already ended.
- A stall is recorded and unblocked. Give a stuck agent the next step, or replace it with a fresh one.
- A check-in also removes a finished agent's copy, once its work is merged and nothing is uncommitted.

## What the reviewer checks

- The change meets the request, and nothing more. The docs style rules and the project's checks pass.
- A test covers the fault, and fails without the fix.
- The change keeps the engine's rules: both GPU paths, no per-frame allocation, and the quality preset.
- The pictures and the figures are measured, not asserted.
