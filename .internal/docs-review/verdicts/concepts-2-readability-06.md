# concepts-2-readability-06

## Finding as given

- page: concepts/post-processing
- anchor: whole page
- category: split-page
- severity: high
- claim: The page is 7,853 words and 27 headings. Ambient occlusion, screen-space reflections and bounce light run before the opaque pass and feed its shading. They share a grid, a depth copy and the prepass, so they are not post effects and make one natural page of their own.
- evidence: stats.json words 7,853. Line 301 'Screen-space reflections and ambient occlusion share one grid'. Line 319 'The light draws on ambient occlusion's grid ... reuses that feature's depth copy and normals'.
- proposedEdit: Move the AO, SSR and bounce light sections to a new concepts/screen-space-lighting page ('Ambient occlusion, reflections and bounce light'), with one shared section on the grid, prepass and color copy. Leave a one-paragraph summary and a link here. Add the page in AREAS/PAGES (tools/lib/docs.ts), and update links from shadows.md 343 and quality-presets.md 220.

Verdict: partly

## Evidence

What holds:
- Lines 301 and 319 say what the finding quotes. Line 38 says ambient occlusion and screen-space reflections "run before the scene's opaque objects shade". The bounce light section (line 330) says "The opaque pass adds the light to the ambient light". So all three feed the opaque pass, not the post chain.
- The three sections (lines 221 to 339) hold about 2,300 of the page's 7,853 words, close to a third. They share the prepass, the depth copy, the half-size grid and the copy of the opaque colors. A page of their own with one shared section removes the repeats ("as for ambient occlusion", "as screen-space reflections are").

What does not hold:
- Severity. Nothing here misleads a reader or blocks a newcomer. The page summary, the diagram and line 38 already say these effects run before the scene. The cost is a long page that is harder to scan. That is medium.
- "Not post effects" is too strong. Ambient occlusion and screen-space reflections are `post.set` settings (`post.set({ ao })`, `post.set({ ssr })`; packages/engine/src/scene/post.ts, docs/api/post.md:13). Bounce light is a quality setting (`quality.set({ bounceRays })`). The new page must say this, so a reader who comes from `post.set` finds them.
- The link list is incomplete. Links to these sections' anchors also sit in docs/getting-started/hosting.md:356 (#screen-space-bounce-light), docs/concepts/lighting.md:333 (#screen-space-bounce-light) and docs/shaders/surface-functions.md:168 (#ambient-occlusion). Text that names the page as the home of ambient occlusion or reflections sits in docs/api/post.md:13 and :482, docs/concepts/architecture.md:97, docs/concepts/render-graph.md:68 and docs/porting/threejs-postprocessing.md:253.
- Sources outside docs/ also point here. docs/data/threejs-mapping.json:1741 (the SSAOPass / GTAOPass / N8AO entry, which generates docs/porting/threejs-mapping.md) has `"docs": "concepts/post-processing"`. The develop skill points here for ambient occlusion and reflections: skills/null3d-develop/SKILL.md:200 and :201, and skills/null3d-develop/references/performance.md:179. The "Docs and skills stay in sync" rule needs these to name the new page ID.
- The edit leaves out work on this page itself. The front matter summary and the opening blockquote list ambient occlusion and screen-space reflections. The Mermaid diagram has the prepass, AO, SSR and opaque-color copy nodes. Line 38 explains them. The PAGES entry for this page (tools/lib/docs.ts:107) names ambient occlusion in its summary.
- The new page is a concept page. The writing rules need it to open with a Mermaid diagram and a plain explanation, and to have full front matter (id, title, status, since, summary).

## Corrected claim

The page is 7,853 words, and about 2,300 of them describe ambient occlusion, screen-space reflections and bounce light. These three run before the opaque pass and feed its shading. They share the prepass, the depth copy, the half-size grid and the opaque-color copy. They are turned on with `post.set` (ambient occlusion and reflections) and `quality.set` (bounce light), but they are not part of the chain after the scene. A page of their own makes both pages easier to scan. Severity: medium.

## Corrected edit

1. Make docs/concepts/screen-space-lighting.md, titled "Ambient occlusion, reflections and bounce light", with full front matter. Open it with a Mermaid diagram: depth prepass, then depth copy and grid, then AO, the SSR pyramid and trace, and bounce light, with the frame before's opaque-color copy, all into the opaque pass. Then one shared section on the prepass, the grid (the larger of `aoScale` and `ssrScale`), the depth copy and the color copy, and the float-target need on WebGL2. Say that `post.set` turns ambient occlusion and reflections on, and `quality.set({ bounceRays })` sets bounce light. Link to contact shadows (shadows.md#contact-shadows), which share the same step.
2. Move the three sections there. Keep the headings "Ambient occlusion", "Screen-space reflections" and "Screen-space bounce light" word for word, so the anchor names stay the same.
3. On concepts/post-processing, replace the sections with one short paragraph and a link. Take the prepass, AO, SSR and copy nodes out of the diagram, or make them one node "Screen-space lighting (other page)". Update the front matter summary, the opening blockquote, line 38 and Related pages.
4. In tools/lib/docs.ts, add the new page to PAGES in the concepts area, and take ambient occlusion out of the post-processing summary (line 107).
5. Point these at the new page: shadows.md:343, quality-presets.md:220, hosting.md:356, lighting.md:333, surface-functions.md:168, api/post.md:13 and :482, architecture.md:97, render-graph.md:68, porting/threejs-postprocessing.md:253, docs/data/threejs-mapping.json:1741, skills/null3d-develop/SKILL.md:200 and :201, and skills/null3d-develop/references/performance.md:179.
