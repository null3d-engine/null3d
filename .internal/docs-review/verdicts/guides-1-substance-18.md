# guides-1-substance-18

Finding as given:

```json
{
 "page": "guides/custom-shaders",
 "anchor": "note under the title: \"... and full shaders are built, and so is hot reload on the dev server.\" (line 11)",
 "category": "internal-note",
 "severity": "medium",
 "claim": "'are built' reports build progress, like a maintainer's checklist. A page describes what exists.",
 "evidence": "docs/guides/custom-shaders.md:11.",
 "proposedEdit": "Delete the sentence; the body already describes each part.",
 "generatedSource": "",
 "id": "guides-1-substance-18",
 "slice": "guides-1",
 "role": "substance"
}
```

Verdict: survives

Evidence:
- The generated copy, docs/guides/custom-shaders.md:11, has the note: "Roadmap step 0.1, first released in null3D 0.1.0. The API is experimental ... Custom materials with surface functions, vertex offsets, uniforms, textures and full shaders are built, and so is hot reload on the dev server."
- The current branch (docs/no-status-labels), docs/guides/custom-shaders.md:9, already removed the roadmap and version text, but kept this sentence as the only text in the note. So the sentence is a leftover of the status labels that the branch removes.
- The page is hand-written, not generated, so the edit goes in docs/guides/custom-shaders.md.
- The sentence only lists features as done. The body covers each one in its own section: "Custom materials" (line 24), "Full shaders" (45), "What the plugin compiles" (137), "Hot reload" (201), "Typed uniforms" (233). The summary in the front matter also lists them. Deleting the sentence loses nothing.
- AGENTS.md has the same rule for skills: "The skills name only built calls, with no version markers." A docs page that says what "is built" breaks the spirit of that rule and reads like progress notes.
- No docs check or website rule needs a note under the title. The generated pages' notes (tools/lib/docs.ts:270, 322, 508) say what a page is, not what is done.

Corrected claim: none.

Edit note: delete the whole note (the blockquote line), not only the sentence, since on the current branch it is the only sentence. The page then opens with the diagram, then the paragraph "You write each null3D shader once, in WGSL." Optional: move that paragraph above the diagram so the page opens with text.
