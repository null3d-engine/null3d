# api-reference-readability-14

## Finding as given

- page: api/reference/engine
- anchor: `ErrorCode` line 216; `ShaderFeature` line 476; `HeldFrame` to `HoldScriptStep` lines 303-401
- category: structure
- severity: medium
- claim: An 88-line union of bare error codes, a 45-line feature union and nine hold-mode test types sit in the middle of the page a newcomer reads for createEngine.
- evidence: ErrorCode prints every code on its own line with no link; its summary says each code has a docs page. Hold types come from packages/engine/src/page/hold.ts, all tagged @category api/engine.
- proposedEdit: For a string-literal union over about 12 members, print the first line and put the full union in a details block ('Technical details: every value'). For ErrorCode link the errors index instead. Group hold-mode and replay types under 'Hold mode and replays' in the index.
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The page is a lookup page, not the newcomer page. Its first line sends readers to the written page, docs/api/engine.md, which "explains these exports". The generator sorts every export by name (tools/lib/api-docs.ts:471, renderReference at :504). So `createEngine` sits at line 48, before both long unions (ErrorCode at 216, ShaderFeature at 476). A reader who wants createEngine meets it before the long blocks. The "newcomer reads for createEngine" framing and the medium severity are overstated. Low fits better.
- Counts are a little high. The ErrorCode block runs from line 218 to 298: 79 codes on about 81 lines, not 88. ShaderFeature has 41 members on about 43 lines, not 45. Lines 303-401 hold eight hold-mode types (HeldFrame, HoldDump, HoldFailure, HoldResult, HoldScript, HoldScriptProblem, HoldScriptResult, HoldScriptStep). ReplayResult at line 463 makes nine.
- ErrorCode part holds. The summary (packages/engine/src/errors/fixes.ts:168) says "Each code has a docs page" but links none, and docs/errors/index.md exists. TSDoc summaries can carry relative links: other reference rows already do, for example engine.md:104 and assets.md:31. So the fix is a one-line source edit with no generator change.
- The union part holds in part. The generator prints one member per line once a union passes 100 characters (tools/lib/api-docs.ts:69, aliasOf at :287-310). The proposed edit to "print the first line" would leave a bare `type ShaderFeature =`, which does not make sense with the block closed. That breaks the rule that the main text must stand alone. On a reference page, the values are the content: the `preload` prose in EngineOptions (line 212) names many ShaderFeature values but not all (it leaves out 'motion', 'area_lights', 'clouds', 'dof', 'taa' and more). So the full list must stay reachable. A collapsed block keeps it reachable, which is fine, but the visible text must say what the type is.
- The grouping part does not fit the generator. The page has no index. The generator only sorts by name and has no grouping. "Group under 'Hold mode and replays' in the index" needs a new grouping feature. The hold types are tagged @category api/engine in packages/engine/src/page/hold.ts (lines 28, 75, 85, 101, 115, 134, 183, 199). A simpler fix is to keep them where they are, or retag them to a page about test tools such as api/debug. A sub-heading inside the generated list would need generator work, so this part is a matter of choice, not a defect.

## Corrected claim

The engine reference page prints the error code type as 79 bare codes on about 81 lines with no link to the errors index, and the shader feature type as 41 values on about 43 lines. Eight hold-mode types sit between them, and the replay result type is further down. The page sorts by name and puts `createEngine` near the top (line 48), and its first line links to the written page that newcomers read. So this costs a reader who scans the page, not a newcomer who looks for createEngine. Severity: low.

## Corrected edit

1. packages/engine/src/errors/fixes.ts (ErrorCode TSDoc): link the index in the summary, for example "Each code has a docs page that gives its cause and its fix: [Errors](../../errors/index.md)."
2. tools/lib/api-docs.ts (aliasOf and renderSymbol): when a type alias is a union of more than about 12 string literals, print a short visible line, for example "One of 41 string values." or `type ShaderFeature = 'motion' | 'ao' | ... ;` with the first few values. Then put the full multi-line declaration in a `<details>` block with `<summary>Technical details: every value</summary>`, with a blank line before and after the code fence. Do not leave a bare `type X =` line outside the block.
3. Hold-mode types: optional. Either leave them, or retag them @category to a page about test tools. Do not propose an index grouping that the generator does not have.
