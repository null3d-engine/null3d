# porting-shaders-substance-02

## Finding as given

- Page: porting/threejs-shaders
- Anchor: Mermaid edge "replaces the lighting" (line 20); table row "Replaces three.js's lighting" (line 35); onBeforeCompile row "Replaces a lighting chunk" (line 133)
- Category: wrong-claim. Severity: high.
- Claim: The page sends a shader that replaces three.js's lighting to "a full shader with the null3d::lighting helpers". A full shader gets no lights, no uniforms and no textures, and the built-in values hold no light values. So it cannot learn where the lights are or take a light direction. The lobe function is the tool that reads each light.
- Evidence given: docs/guides/custom-shaders.md Full shaders rules; docs/shaders/builtins.md:11; docs/shaders/surface-functions.md "A material's own lobe".
- Proposed edit: Row: "Changes how each light lights the surface, such as toon bands or a rim: a lobe function, fn lobe(input: LobeInput) -> vec3f (link). A full shader gets no lights, uniforms or textures, so use one only for a look with no scene light." Same change in the onBeforeCompile table, and a "changes each light's response" edge to a "Lobe function" node in the diagram.

Verdict: partly

## Evidence

The core claim holds:
- docs/guides/custom-shaders.md:47 "The engine gives a full shader its meshes, its instances and the frame's values, but no lighting, shadows or fog."
- docs/guides/custom-shaders.md:96 "The standard values, uniforms and textures do not reach a full shader ... The build stops at a texture that a full shader declares."
- docs/shaders/builtins.md:11 "The built-in values hold no light values. Pass a light's direction or color to a material as a uniform." A full shader cannot take that uniform.
- docs/shaders/library.md:584 `null3d::lighting` holds formulas only (Lambert, GGX) that take `to_light` and a light color as arguments. Nothing in it gives the scene's lights.
- The page itself, line 39, says a full shader "gets no lighting, shadows, fog, uniforms or standard values". So lines 20, 35 and 133 point a reader at a form that, by the docs, cannot see any scene light. A port that follows them stalls. High severity is fair.
- Source agrees: the frame's light values (sun direction and color, fill lights, light clusters) live in the engine's internal frame struct (crates/null3d-shaders/wgsl/lib/globals.wgsl:16-33) and the internal `null3d::lights` module. Neither is in the documented library, and the documented `null3d::builtins` values hold no lights.

What does not hold, or is missing:
1. "Cannot take a light direction" is too strong. A full shader can still light itself with `null3d::lighting` and a light direction and color fixed as WGSL constants. It cannot follow the scene's lights or change them at run time. The proposed "use one only for a look with no scene light" is also too strong for the same reason.
2. A lobe does not replace three.js's lighting. surface-functions.md:185 and :209: it adds its color to one light's specular, for the main directional light and each point and spot light only. The base lighting, the ambient, hemisphere and environment light, the fill directional lights and the area lights stay. Toon bands through a lobe are a documented recipe (porting/threejs-materials.md:86, porting/threejs-mapping.md:143), but they need `s.baseColor` black and `s.roughness` 1. The row must say the base lighting stays beside the lobe and link that recipe.
3. The finding misses a fourth place on the same page: line 97, "The lighting chunks and light uniforms | The engine lights a surface function. A full shader imports `null3d::lighting`." It carries the same wrong pointer.
4. The rule "Docs and skills stay in sync" (AGENTS.md:210) means the port skill must change too. skills/null3d-port-threejs/references/shaders.md:31, :93 and :126 hold the same three claims ("Full shader with `null3d::lighting` helpers").
5. Related contradiction to note: docs/guides/custom-shaders.md:94 says "The engine exposes the frame's lights already. So a shader that adds their light writes that sum through `finish_exposed`." That suggests a full shader can add the frame's lights, but no page says how. Either document the way or drop that sentence, so the two pages agree.

## Corrected claim

The page sends "replaces three.js's lighting" (lines 20, 35, 133, and line 97) to a full shader with the `null3d::lighting` helpers. A full shader gets no scene lights, no uniforms and no textures, so it can only light itself with light values fixed in its WGSL. To change how each scene light lights a surface, the documented tool is a lobe function, which adds to each main, point and spot light's specular beside the base lighting. The port skill repeats the same claim.

## Corrected edit

Table "Choose the target form", replace the row at line 35 with two rows:

| Changes how each light lights the surface, such as toon bands or a rim | A lobe function, `fn lobe(input: LobeInput) -> vec3f`, called for the main directional light and each point and spot light. It adds to that light's specular, and the base lighting stays, so a toon look sets `s.baseColor` to black and `s.roughness` to 1 ([A material's own lobe](../shaders/surface-functions.md#a-materials-own-lobe), [toon recipe](threejs-materials.md)) |
| Lights the surface its own way with fixed lights | A full shader with the `null3d::lighting` helpers. It gets no scene lights and no uniforms, so its light directions and colors are constants in the WGSL |

onBeforeCompile table, line 133: "Replaces a lighting chunk | A lobe function, beside the base lighting; a full shader only when its lights can be fixed in the WGSL".

Built-ins table, line 97: "The lighting chunks and light uniforms | The engine lights a surface function. A lobe function reads each main, point and spot light."

Diagram: change the edge at line 20 to `pick -- "changes each light's response" --> lobe["Lobe function"]`, and keep a full-shader edge only as `pick -- "draws its own fixed light" --> full["Full shader"]`.

Make the same changes in skills/null3d-port-threejs/references/shaders.md lines 31, 93 and 126. Resolve docs/guides/custom-shaders.md:94 so it does not suggest a full shader can read the frame's lights.
