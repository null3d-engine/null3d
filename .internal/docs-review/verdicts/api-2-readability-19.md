# api-2-readability-19

## The finding as given

```json
{
 "page": "api/materials",
 "anchor": "### Mirrors, polished floors and water, line 855",
 "category": "structure",
 "severity": "medium",
 "claim": "Line 855 covers masks in custom materials, shared shaders, texture coordinates and the E1215 and E1216 errors. None of it is about mirrors, so a reader who looks up why E1215 is thrown will not find it here.",
 "evidence": "line 855 'With `alphaMode: 'mask'`, the pixels where the surface function's `alpha` falls below `alphaCutoff` draw nothing ... WGSL as plain text ... throws E1215.'",
 "proposedEdit": "Move line 855 into the main '## Custom materials' section, after the first example (line 725). Make it a list: masks, shared shaders, texture coordinates, errors.",
 "generatedSource": "",
 "id": "api-2-readability-19",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: survives

## Evidence

- docs/api/materials.md:851 opens "### Mirrors, polished floors and water". Line 853 is about reflection passes. Line 855 is the last paragraph before "## Ranges" (line 857), so it sits under the mirrors heading.
- Line 855 covers the mask cutoff, shared shaders, the need for texture coordinates, E1215 (WGSL the plugin did not compile, or a full shader that is not a material's), E1216 (an unknown uniform or texture, or a value of the wrong kind) and vertex offsets. None of it is about reflections. The claim is correct.
- This is the only place on the page that names E1215 and E1216. No other paragraph covers the same points, so the misplacement is not made up for elsewhere on the page.
- Two sentences repeat other parts of the page. The mask rule is already given at lines 71 and 577. Vertex offsets are covered under "### Values per row of a batch" (lines 824-845). The closing link to Surface functions is also in "## Related pages".
- The page is hand-written, so there is no generated source to name. The proposed list breaks no writing rule. No heading or details block is needed.

## Better edit

The claim holds. A better place for the moved text is the end of the main "## Custom materials" text, after line 767 ("A texture samples as white until its image is on the GPU.") and before "### The scene behind a surface". Line 725 is a weaker spot. The mask sentence belongs next to the masked example (lines 751-763), and a list placed after the first example would cut the run from that example into the lobe and uniforms paragraphs.

As a list:

- A material made with `alphaMode: 'mask'` draws nothing where the surface function's `alpha` is below `alphaCutoff`.
- Materials made from the same WGSL share one shader. Each one has its own uniforms.
- A mesh needs texture coordinates to draw with a custom material.
- WGSL as plain text, which the plugin did not compile, throws E1215. So does a whole shader that is not a [full shader](../guides/custom-shaders.md#full-shaders) of a material.
- A uniform or a texture that the WGSL does not declare, or a value of the wrong kind, throws E1216.

Cut "The WGSL can also move the mesh's vertices with a vertex offset." because the batch-rows section already covers it. Cut the trailing Surface functions link because Related pages already has it. The mirrors section then holds only line 853.
