# start-substance-27

## Finding as given

- Page: index
- Anchor: line 30 "Coding agents use only the APIs that these pages and the engine's type declarations show."; line 45 "From version 0.1, the same pages ship..."
- Category: structure. Severity: low.
- Claim: An instruction to agents sits under "Status labels", where it does not belong. "From version 0.1" describes history.
- Evidence: index.md:30, :45.
- Proposed edit: Move the agent sentence into a short "For coding agents" paragraph next to the page-ID sentence, with a link to [For AI agents](guides/agents.md). Change line 45 to "The same pages ship inside the `@null3d/engine` package...".

Verdict: partly

## Evidence

- Generated copy, docs/index.md:20-30: the agent sentence is in the paragraph after the status table, under "## Status labels". In that copy the first claim holds.
- The current branch (docs/no-status-labels, commit 10aa9fb37) already removed the status table and renamed the heading. In docs/index.md:18-20 of the working tree, the heading is "## How the pages work", and the same paragraph sits under it. A rule about which APIs agents may use fits a section on how the pages work. So the first half is stale; moving the sentence is now a matter of taste.
- Line 45 (line 33 on the branch): "From version 0.1, the same pages ship inside the `@null3d/engine` package". The package does ship the docs: packages/engine/package.json lists "docs" in "files" (line 89), and its description says it holds "the docs". The first release is 0.1.0, so every published version already includes the pages. "From version 0.1" adds nothing for a reader and reads as roadmap language. This half holds.
- The link target exists: docs/guides/agents.md, title "Working with AI agents" (not "For AI agents").

## Corrected claim

"From version 0.1" on the page-ID paragraph is roadmap wording with no value to a reader, because every release of the package includes the pages. The agent rule no longer sits under "Status labels" on the current branch; it sits under "How the pages work", where it fits.

## Corrected edit

On the page-ID paragraph, change "From version 0.1, the same pages ship inside the `@null3d/engine` package, so they always match the installed engine." to "The same pages ship inside the `@null3d/engine` package, so they always match the installed engine." Optionally add "[Working with AI agents](guides/agents.md) explains how to set up an agent." Leave the agent sentence under "How the pages work".
