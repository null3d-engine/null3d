# errors-substance-22

## Finding as given

```json
{
 "page": "errors/E1107,errors/E1105,errors/E1402",
 "anchor": "so the TypeScript side and the core disagree about the scene",
 "category": "term-before-definition",
 "severity": "low",
 "claim": "'The TypeScript side' is not a term that the user docs define. The page gives no workaround while the bug stands.",
 "evidence": "codes.ts:56, :70 and :109. docs/concepts/architecture.md calls these parts the engine's JavaScript and its core.",
 "proposedEdit": "Write: \"the engine's JavaScript and its WebAssembly core disagree about the scene\". Link concepts/architecture. Add: 'Reload the page to start from a clean scene.'",
 "generatedSource": "packages/engine/src/errors/codes.ts",
 "id": "errors-substance-22",
 "slice": "errors",
 "role": "substance"
}
```

Verdict: partly

## Evidence

The term part holds.

- "the TypeScript side" appears only in three error causes: codes.ts:56 (E1105), codes.ts:70 (E1107) and codes.ts:322 (E1402, not :109 as the finding says). The same text reaches errors/index.md (lines 19, 21, 55) and pages.md (lines 161, 163, 197). No user page defines the term.
- Other pages name this part "the engine's JavaScript": api/engine.md:70 (in its own E1402 row), getting-started/cdn.md:24, getting-started/hosting.md:201, guides/deploying.md:92. So the error pages are out of step with the rest of the docs.
- The term can mislead. The diagram in concepts/architecture.md (lines 19-20) labels "Your sketch code (TypeScript)" beside "Engine core (Rust, WebAssembly)". A reader can take "the TypeScript side" to mean their own code. On E1107, an engine bug, that points them at the wrong code.

The finding's evidence about architecture.md is wrong. That page does not say "the engine's JavaScript". It says "Engine core" and labels the user's sketch code as TypeScript. The right wording comes from api/engine.md:70 and the getting-started pages.

The workaround part is refuted.

- When a second create arrives, the core skips that one command, applies the rest and returns the first failure (crates/null3d-core/src/scene.rs:1310-1312 doc comment; the check is at scene.rs:1411-1412). The sketch runner reports it and keeps running frames (packages/engine/src/sketch/runner.ts:2313 and its report method at 1358-1368). The scene is not broken, so there is nothing to reset.
- "Reload the page" runs the same code again, so it would most likely hit the same bug. It is untested advice. The existing fix, "This is an engine bug. Report it with the code that created the object." (fixes.ts:20), is the right action.
- The link to concepts/architecture is not worth adding. The cause text also fills the front-matter summary and the table cells in errors/index.md and pages.md. A Markdown link there is noise, and other causes in codes.ts carry no links.

## Corrected claim

The three error causes use "the TypeScript side", which no page defines. Other pages call it "the engine's JavaScript", and the architecture diagram uses "TypeScript" for the reader's own sketch code, so a reader can think the fault is in their code. The E1107 page needs no extra workaround: the engine skips the duplicate create and keeps running, and reporting the bug is the right fix.

## Corrected edit

Edit packages/engine/src/errors/codes.ts. The pages, errors/index.md and pages.md are generated from it.

- Line 56 (E1105): "The engine core received a structural change it does not know, so the engine's JavaScript and its core come from different builds."
- Line 70 (E1107): "The engine core received a second create command for one object, so the engine's JavaScript and its core disagree about the scene. The core skips that command, and the scene keeps running."
- Line 322 (E1402), first sentence: "The engine core's WebAssembly file lacks functions that the engine's JavaScript calls, so the two come from different builds." Leave the rest unchanged.

Do not add "Reload the page" and do not add a link in the cause text.
