# porting-shaders-readability-21

## Finding as given

- page: shaders/builtins, shaders/wgsl-rules, shaders/library
- anchor: Blockquote under each H1 (builtins line 11, wgsl-rules line 11, library line 13)
- category: scan-order
- severity: medium
- claim: Each banner starts with the roadmap step, which readers learn to skip, then adds a fact they need: no light values in the built-ins (builtins), no other shader of your own (wgsl-rules), which functions can call the modules (library). These facts get lost.
- evidence: builtins.md line 11 "The built-in values hold no light values. Pass a light's direction or color to a material as a uniform."; wgsl-rules.md line 11 "It draws no other shader of your own."; library.md line 13; tools/lib/shader-library.ts line 263.
- proposedEdit: End each banner after the stability sentence. Move the builtins fact into the first paragraph after the list of the four values, and the wgsl-rules fact into its first paragraph. In tools/lib/shader-library.ts, move the library sentence into INTRO.
- generatedSource: tools/lib/shader-library.ts (library page); builtins and wgsl-rules are written pages

Verdict: refuted

## Evidence

- The generated copy is built from commit 032e60034 (its HEAD is "chore: generated files of 032e6003..."). That commit is an ancestor of the branch under review. Two later commits on this branch, 10aa9fb37 "docs: drop the status and version labels from the docs pages" and 300ae91dd "docs: clear the last references to the removed page labels", remove the roadmap-step and stability sentences from every page. `grep -rn "^> Roadmap" docs` finds 0 matches on the branch, and tools/lib/steps.ts (which made the roadmap sentence) is deleted.
- On the branch, each banner now holds only the fact that the finding wants to keep:
  - docs/shaders/builtins.md line 9: "> The built-in values hold no light values. Pass a light's direction or color to a material as a uniform."
  - docs/shaders/wgsl-rules.md line 9: "> The engine draws custom materials with surface functions and full shaders. It draws no other shader of your own."
  - tools/lib/shader-library.ts line 256: "> A custom material's surface function, vertex offset or full shader can call these modules."
- So the cause the finding names (a roadmap sentence that readers learn to skip, in front of the fact) no longer exists. Each fact is now the first and only text under the H1, which is the best scan position on the page.
- The proposed edit cannot be applied: "End each banner after the stability sentence" refers to a sentence that is gone. Its follow-on moves would also make scan order worse. Moving the builtins light note into the first paragraph puts it after the list of the four values, inside a dense paragraph, where it is less visible than a one-line callout under the title.

## Corrected claim / edit

None. The issue is already fixed on this branch. No edit is needed.
