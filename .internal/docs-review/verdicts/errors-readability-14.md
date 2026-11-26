# errors-readability-14

## Finding as given

- Page: errors/E1215
- Anchor: page lines 13 and 17
- Category: wall-of-text
- Severity: medium
- Claim: The cause (96 words, 6 sentences) and the fix (115 words, 6 sentences) both list, in prose, what each call's WGSL must declare. That is a table, written twice.
- Evidence: stats.json E1215: line 6 (96, 6), line 10 (115, 6). codes.ts line 179; fixes.ts line 50.
- Proposed edit: Write the cause in two sentences. Write the fix as numbered steps: 1 add the null3D Vite plugin, 2 write WGSL after /* wgsl */ or import a .wgsl file, 3 declare the function from a table Call | WGSL declares, with rows for materials.shader(), post.addEffect(), post.set({ toneMapping }) and scene.setSkyLayer().
- Generated source: packages/engine/src/errors/codes.ts (E1215); packages/engine/src/errors/fixes.ts (E1215)

Verdict: partly

## Evidence

- The claim holds. Page line 13 (the cause, codes.ts:179) lists what each kind of WGSL declares: surface, vertex offset or lobe, a full shader's @vertex entry with InstanceIn, fn effect, fn toneCurve, fn skyLayer. Page line 17 (the fix, fixes.ts:50) lists the same things again, with full signatures. The cause's last three sentences repeat the fix. Both paragraphs are long (stats.json facts).
- The cause text has three outputs: the "What happened" section, the front-matter `summary`, and a cell of the error index table (tools/lib/docs.ts:436-457 and errorIndexPage). Cutting it to two sentences helps all three. That part of the edit is right.
- The fix part of the edit is wrong in form. The fix string is not docs-only text. packages/engine/src/errors/fixes.ts:1-5 says it is "the text that ends every EngineError message", and engine-error.ts:64 loads ERROR_FIXES at run time and puts it in each error's message (messageFor). A numbered list and a Markdown table in that string would print as raw pipes and line breaks in the browser console, and would add bytes to a file that every page downloads. errorPage (tools/lib/docs.ts:450-452) prints the fix as is; it has no way to turn a fix into steps or a table.
- The proposed table also drops facts. It gives materials.shader() one row, but the fix names five cases for it: fn surface, fn vertexOffset, fn lobe (each with no @vertex or @fragment entry), a full shader whose @vertex entry takes InstanceIn from null3d::mesh, and a draw that makes its own vertices with @builtin(vertex_index) and @builtin(instance_index) and no mesh attribute.

## Corrected claim

The cause repeats the fix's list of what each call's WGSL declares, and both paragraphs are long. The cause can shrink. The fix cannot become Markdown steps or a table, because the same string is the end of the run-time error message.

## Corrected edit

1. codes.ts, E1215 cause: cut it to two sentences and drop the per-call list, for example: "materials.shader(), post.addEffect(), post.set() or scene.setSkyLayer() received WGSL that it cannot draw with. The engine takes only WGSL that the null3D Vite plugin compiled, or WGSL that does not declare the function its call needs."
2. fixes.ts, E1215 fix: keep it as plain sentences, since it prints in the console. Optionally trim words, but keep each signature: a developer reads them in the console.
3. Optional, for the page only: add a docs-only field to the error entries in codes.ts (not fixes.ts), and have errorPage in tools/lib/docs.ts render it after "How to fix it" as a block:

   <details>
   <summary>Technical details: what each call's WGSL declares</summary>

   | Call | WGSL declares |
   | --- | --- |
   | materials.shader(), surface | fn surface(input: SurfaceInput) -> Surface, no @vertex or @fragment entry |
   | materials.shader(), vertex offset | fn vertexOffset(input: VertexInput) -> vec3f |
   | materials.shader(), lobe | fn lobe(input: LobeInput) -> vec3f |
   | materials.shader(), full shader | a @vertex entry that takes an InstanceIn from null3d::mesh |
   | materials.shader(), own vertices | a @vertex entry with @builtin(vertex_index) and @builtin(instance_index), no mesh attribute |
   | post.addEffect() | fn effect(input: EffectInput) -> vec4f |
   | post.set({ toneMapping }) | fn toneCurve(color: vec3f) -> vec3f |
   | scene.setSkyLayer() | fn skyLayer(input: SkyLayerInput) -> SkyLayer |

   </details>

   This is a generator change that touches the error entry type, so it applies to every error page that gets such a field.
