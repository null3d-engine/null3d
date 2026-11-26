# guides-1-readability-04

## Finding as given

- Page: guides/first-use-shaders
- Anchor: row 'taa', line 31
- Category: internal-note. Severity: high
- Claim: The row ends with '(D-206)', a maintainer decision record number, which the docs rules forbid in docs/. 'a prototype for measuring only' gives the reader nothing to act on.
- Evidence: line 31 'when `post.set` turns the temporal resolve on, a prototype for measuring only (D-206)'; tools/lib/first-use-docs.ts line 25.
- Proposed edit: In FIRST_USE_DOWNLOADS.taa write 'when `post.set` turns the temporal resolve on. The resolve is for measurement only, and no preset turns it on.' (check the second sentence against the code). Drop '(D-206)'. Make the docs style check fail on D-\d{3} in generated pages.
- Generated source: tools/lib/first-use-docs.ts

Verdict: survives

## Evidence

- docs/guides/first-use-shaders.md:31 has the text exactly as quoted, ending in "(D-206)".
- tools/lib/first-use-docs.ts:25 is the source string (`taa: '... a prototype for measuring only (D-206)'`).
- .dev/decisions/D-206-temporal-resolve.md exists, so D-206 is a maintainer decision record. The task's rules forbid decision record numbers in docs/.
- The style check does not catch it today. tools/lib/docs-style.ts:85 (BUILD_PROCESS) flags only milestones, checkpoints and task IDs in user docs. DECISION_RECORD_SOURCE (`\bD-\d+\b`, docs-style.ts:147) feeds only internalReferences, which runs on commit subjects (docs-style.ts:491) and release notes (tools/lib/release.ts:9-215), not on docs pages.
- "No preset turns it on" is true. The option is `taa` in packages/engine/src/scene/post.ts:535, off by default (post.ts:607). No other file in packages/engine/src sets it; the other hits are shader and pipeline setup (gpu/device-shaders.ts:43, gpu/webgpu/pipelines.ts:1327-1682).
- The option is `@internal` (post.ts:532-535, with the note "for measuring only"), so the post.set reference page does not list it. The feature name 'taa' is still public: the preload feature union in docs/api/reference/engine.md:515 lists it. The row must stay, but a reader who looks for the option on post.set will not find it.

## Corrected edit

Use the proposed text, with one change: say that the option is not public, so the reader does not look for it. For example, in FIRST_USE_DOWNLOADS.taa:

'when `post.set` turns on the temporal resolve, a test option that is not part of the public settings. No preset turns it on, so a page never downloads these shaders unless it preloads them'

For the check, do not add a new pattern for generated pages only. Run the existing DECISION_RECORD_SOURCE pattern (`\bD-\d+\b`) in tools/lib/docs-style.ts over every page in docs/ for the 'users' audience. A three-digit pattern would miss short record numbers such as D-07.

Severity: the rule break is real, but a stray record number does not mislead a reader or block a newcomer. Medium fits better than high.
