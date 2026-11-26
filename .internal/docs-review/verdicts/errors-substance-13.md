# errors-substance-13

## Finding as given

```json
{
 "page": "errors/E1402,errors/E1421,errors/E1105 (data)",
 "anchor": "When null3D's own dev server serves the engine from a checkout of its repository",
 "category": "internal-note",
 "severity": "medium",
 "claim": "Some error pages carry notes meant only for engine contributors. E1402 describes the repository's own dev server and stamps of the Rust sources. E1421 lists test-only features ('for the engine's own tests'). E1105 and E1402 tell users to run 'bun run build' when they build from source.",
 "evidence": "codes.ts:322 and :467. fixes.ts:17 and :88. AGENTS.md 'Writing docs': 'Write for developers who use the engine... Notes for maintainers belong in code comments'.",
 "proposedEdit": "Cut the checkout and stamp sentences from E1402 and keep them as a code comment. Drop the test-only names from E1421's cause and from its runtime message. Drop the 'from source' sentence, or move it into a details block headed 'Technical details: building the engine yourself'.",
 "generatedSource": "packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts",
 "id": "errors-substance-13",
 "slice": "errors",
 "role": "substance"
}
```

Verdict: partly

## Evidence

E1402 cause (holds, in part). codes.ts E1402 cause has two sentences about "null3D's own dev server" and "the stamp of the Rust sources". The stamp check runs only when a dev server passes the source stamps (packages/engine/src/shared/core.ts:1748-1767, `glueMismatch`; the stamps come from the repository's Vite plugin in tools/lib/core-sources.ts:1-7). A developer who installs the package never meets it. The same four-sentence cause also fills the summary column of docs/errors/index.md:55, so the noise shows twice. The code comments in core.ts and core-sources.ts already hold the full explanation.
But a full cut is wrong. That check throws its own E1402 message ("the ... engine core was built from other Rust sources than this checkout holds", core.ts:1762), and every EngineError message links to its error page. Someone who builds from a checkout (README.md "Development", lines 255-272, documents this path in public) lands on E1402 and needs one line that explains that message.

E1421 (refuted). `instance_index` and `texcoords` are members of the public `ShaderFeature` type (docs/api/reference/engine.md:499 and :516). `checkPreload` builds the real runtime message from the full `SHADER_FEATURES` list (packages/engine/src/page/engine.ts:1887-1896), so the message a user sees names both. The cause tells the reader why two odd names appear in that list. The example string in codes.ts copies the real message; dropping the names from it would make the example false. docs/guides/first-use-shaders.md:22 and :52 describe the two features the same way ("only in the engine's own tests"). To drop them from the message, the code would have to change, and that is out of scope for a docs finding.

E1105 and E1402 fix sentence (refuted). "If you build the engine from source, run bun run build again." is one short, correct sentence. Building from source is a public, documented path (README.md "Development", `bun run build` exists at package.json:27). A mismatch between the TypeScript side and the core is the likeliest cause of these errors for exactly that reader, and "reinstall the package" alone is wrong advice for them. A details block for one sentence adds a toggle with no gain. The sentence breaks no writing rule: it gives a Bun command and names no maintainer process.

## Corrected claim

The E1402 cause carries two contributor-only sentences about the repository's dev server and the Rust source stamp. They also fill the E1402 row of the errors index. The E1421 feature note and the "build from source" fix sentence are correct, short and useful to developers who use the engine, so they stay.

## Corrected edit

In packages/engine/src/errors/codes.ts, E1402 cause: keep the first two sentences. Replace the last two with one sentence, for example: "In a checkout of the engine's repository, the dev server also checks that the core was built from the Rust sources on disk." The full detail stays in the code comments of core.ts and tools/lib/core-sources.ts. Make no change to E1421 or to fixes.ts. Severity: low.
