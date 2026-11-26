# concepts-2-readability-04

## Finding as given

- page: concepts/render-graph
- anchor: ## The engine's passes (line 39) before ## Why passes are declarations (116)
- category: scan-order
- severity: high
- claim: Before the core idea (passes are declarations, and order follows from reads and writes) the newcomer meets a 26-row pass table and six dense paragraphs. The page has no render.addPass example, although a concept page should show an example after its explanation.
- evidence: Heading outline in stats.json. The only code block is the DOT dump at line 191.
- proposedEdit: Reorder: intro (33-37), 'Why passes are declarations', 'How the graph orders passes', a short render.addPass scene-pass example (as in the security-camera demo), 'Targets and memory', 'Phone GPUs', 'Switching passes on and off', 'Passes that nothing uses', 'Checks', 'The text dump'. Then 'The engine's passes' as reference, followed by 'Scene inputs' and 'Motion vectors'.

Verdict: partly

## Evidence

- The page (docs/concepts/render-graph.md) puts "The engine's passes" (line 39), "Scene inputs" (82) and "Motion vectors" (102) before "Why passes are declarations" (116) and "How the graph orders passes" (129). The scan-order problem is real.
- The pass table has 24 rows (lines 43 to 66), not 26.
- After the table come seven paragraphs (lines 68, 70, 72, 74, 76, 78, 80), not six. Two more sections (Scene inputs, Motion vectors) also come before the "why". stats.json lists five of these seven as long (112, 211, 175 and 131 words, and 78).
- The core idea is not missing from the top. The intro at line 33 says: "Each pass declares what it reads and what it writes. The render graph reads these declarations before a frame draws. It puts the passes in order." What comes late is the reason for declarations (the render worker never runs sketch code, line 118) and the two ordering rules (lines 131 to 136).
- No usage example: true. The only code block is the DOT output at line 191. AGENTS.md "Writing docs": "A concept page opens with a Mermaid diagram and a plain explanation, followed by examples." The page breaks this rule. Line 35 names `render.addPass` but shows no call.
- The proposed example is real code: examples/security-camera/sketch.ts:99-100 calls `render.addPass({ kind: 'scene', camera: security, writes: 'security', size })` and `textures.fromPass(feed)`. docs/api/render.md:31-32 has the same shape (minimap). The demo's code value in examples/demos.ts:702 is `security-camera/`, so the link at line 222 already fits the website contract.
- The reorder breaks no reference. The later sections lean on the opaque, culling, resolve and final passes. The Mermaid diagram and the paragraph at line 37 already introduce all four.

## Corrected claim

The core idea (passes declare reads and writes, and the graph orders them) is in the intro at line 33. But the reason for declarations and the ordering rules come only after a 24-row pass table, seven dense paragraphs and two more reference sections (Scene inputs, Motion vectors). The page has no `render.addPass` usage example, which breaks the rule that a concept page follows its explanation with examples. Severity: medium, not high. The page misleads no one, and the intro gives the idea. The order makes the page clearly harder to read.

## Corrected edit

Keep the proposed order. Put the example right after "How the graph orders passes". Take it from the security camera demo (`render.addPass` with kind 'scene', then `textures.fromPass` into a material). Add one sentence saying that the graph runs the scene pass before the camera's passes because a material reads its texture, and link the demo. Keep the reference part in this order: "The engine's passes", "Scene inputs", "Motion vectors". Then "Related pages" comes last. The dense paragraphs after the pass table (lines 74 to 80) can move into `<details>` blocks inside that reference section. That is a separate long-paragraph finding.
