# concepts-1-substance-30

## Finding as given

- page: concepts/backends
- anchor: ## How each path draws, table row "Occlusion culling" (line 49); ## Choosing a tier for testing, line 168 "`?occlusion=on` or `?occlusion=off` turns GPU occlusion culling on or off"
- category: missing-content
- severity: low
- claim: The table's WebGL2 cell says only 'Not on the GPU'. Software occlusion culling exists on WebGL2, off by default, and the same ?occlusion= switch controls it. Backends says neither.
- evidence: culling.md:159-172 (software occlusion; the switch wins over the option).
- proposedEdit: WebGL2 cell: 'On the job workers, against marked blockers, when softwareOcclusion is on ([Culling](culling.md#software-occlusion-culling-on-webgl2))'. Line 168: '... turns occlusion culling on or off: on the GPU on WebGPU, and on the job workers on WebGL2.'

Verdict: survives

## Evidence

- docs/concepts/backends.md has only two mentions of occlusion: line 49 (table cell "Not on the GPU" for WebGL2) and line 168 ("turns GPU occlusion culling on or off"). Nothing on the page names software occlusion culling or links to its section.
- packages/engine/src/page/switches.ts:479 parses the one `occlusion` switch. packages/engine/src/page/engine.ts:1994 and :1997 apply it to both settings: `gpuOcclusion: switches.occlusion ?? options.gpuOcclusion` and `softwareOcclusion: switches.occlusion ?? options.softwareOcclusion`. So line 168 is incomplete: on WebGL2 the switch turns software occlusion culling on or off.
- docs/concepts/culling.md:119 "Software occlusion culling on WebGL2" exists (the proposed anchor is valid); culling.md:159 says every preset leaves it off and the job workers do the work; culling.md:168 says "The switch wins over the option".
- The table cell "Not on the GPU" is literally true but leaves a reader who scans the table thinking WebGL2 has no occlusion culling at all.

The proposed edit is accurate and short; it keeps within the table and the switch sentence, and links to the existing section. Severity low is fair.
