# concepts-1-substance-09

## Finding as given

- page: concepts/architecture, concepts/backends, concepts/color-management
- anchor: architecture pass list item 14 (line 104); backends ## Color and anti-aliasing on each tier (lines 70-82, 120); color-management ## HDR color and the final pass and ### The 8-bit path (lines 63-71)
- category: duplication; severity: medium
- claim: Three pages describe the order of work in the final pass, the two-step upscale below full render scale, and when the 8-bit path skips the final pass. Their lists of effects that need the final pass differ: architecture names 4 and color-management names 11, so a reader cannot tell which list is complete.
- evidence: architecture.md:104 ('such as color grading, sharpening, outlines or transmission'); color-management.md:67 (adds screen-space reflections, bounce light, soft particles, depth-reading materials, moment transparency, full-screen passes).
- proposedEdit: Make color-management the one home of the final pass and the 8-bit path. In architecture item 14, keep two sentences and a link. In backends, keep the tier table and link to color-management. Put the full list of effects that need the final pass in one <details> block on color-management.

Verdict: partly

## Evidence

The duplication is real:
- The order of work in the final pass and the two-step split appear in architecture.md:104, backends.md:76 ("On every tier, the final pass also scales the image up ... It then runs in two steps ..."), color-management.md:63 ("Below the whole canvas's render scale it runs in two steps ..."), and a fourth time, in full, in post-processing.md:37 and the section "Below the whole canvas's render scale" (post-processing.md:58-71). All three reviewed pages already link to that post-processing section.
- When the 8-bit path skips the final pass appears in architecture.md:104, backends.md:72 (compatibility mode row) and color-management.md:67.
- Wording has started to drift: backends.md:76 says the two steps run "when the render scale is below 1", while architecture, color-management and post-processing say "while the render scale can drop". The code switches on the possibility of a drop, not the current value (crates/null3d-render/src/frame_graph.rs `set_scaling`, about line 2190).

The "reader cannot tell which list is complete" part does not hold:
- architecture.md:104 says "unless an effect needs it, such as color grading, sharpening, outlines or transmission", and links straight to color-management#the-8-bit-path. "Such as" marks the list as examples. It is a correct subset.
- backends.md gives no list at all; it says only "an effect needs the final pass". So the two lists do not conflict.
- The color-management list matches the code. `final_runs` (crates/null3d-render/src/frame_graph.rs:2176-2186) turns the final pass on for: no direct resolve (HDR or not MSAA), a render scale that can drop, color grading, sharpening, a full-screen pass that reads the scene color, the outline (or display-color) mask, the opaque color copy, the moment-transparency edge smoothing, and the opaque depth copy. The color copy is declared for transmission, screen-space reflections and bounce light (frame_graph.rs:3695-3697). The depth copy is declared for soft particles and custom materials that read scene depth (frame_graph.rs:2981-2992, 3716). So color-management's 11 items are the complete set.

The proposed edit picks the wrong home for part of the content:
- The full order of work in the final pass and the two-step upscale already have a home with full detail: post-processing.md ("Below the whole canvas's render scale"). Moving them into color-management would make a fifth copy or move them away from the page that explains them best.
- "In backends, keep the tier table" is too broad if read as cutting the rest of the section. The section also holds the anti-aliasing mode table, the moment-transparency smoothing, the float-target test and the tile-memory notes, which no other reviewed page repeats.
- A `<details>` block for the 11-item list is allowed but adds little. The list is two sentences, and the main text ("while ... no effect needs the final pass") already makes sense without it.

## Corrected claim

The order of work in the final pass and its two-step split below the whole canvas's render scale are written out on architecture, backends and color-management, as well as in full on post-processing, which all three already link to. The wording has started to drift (backends says "when the render scale is below 1"; the others, and the code, say "while it can drop"). The lists of effects that need the final pass do not conflict: architecture gives examples with "such as" and links to the complete list on color-management, which matches the code.

## Corrected edit

- Keep post-processing ("Below the whole canvas's render scale") as the one home of the final pass's order of work and its two steps.
- Architecture item 14: keep what the final pass does in one or two sentences, one sentence on the two steps with the existing post-processing link, and the 8-bit skip with "such as" and the existing color-management link. Drop the step-by-step order of work.
- Backends: keep both tables and the HDR/float-target paragraphs. Cut the paragraph at line 76 to one sentence ("Where the render scale can drop below 1, the final pass runs in two steps and scales the image up with GSR 1") plus the post-processing link and the WebGL2/compatibility note, fixing "is below 1" to "can drop below 1".
- Color-management: keep the 8-bit path section as the home of when the final pass is skipped, with the full list of effects in the text or, if the writer wants, in a `<details>` block "Technical details: effects that need the final pass". Cut the two-step sentences in the "HDR color and the final pass" paragraph to one sentence and the existing link.
