# porting-shaders-substance-26

Finding as given:

```json
{
 "page": "porting/threejs-shaders",
 "anchor": "line 297 '... material, shade or finish'",
 "category": "wrong-claim",
 "severity": "low",
 "claim": "The engine's reserved names hold finish_material and finish_exposed_material, not finish, which is a null3d::mesh item for full shaders.",
 "evidence": "docs/shaders/surface-functions.md:611",
 "proposedEdit": "'such as frame, camera, object, material, shade or fs ([Rules](../shaders/surface-functions.md#rules) lists every name).'",
 "generatedSource": "",
 "id": "porting-shaders-substance-26",
 "slice": "porting-shaders",
 "role": "substance"
}
```

Verdict: survives

Evidence:

- docs/porting/threejs-shaders.md:297 names `finish` as a name that clashes with the engine's template, and links to the WGSL rules page.
- docs/shaders/surface-functions.md:611 (Rules) lists every reserved name. It holds `finish_material` and `finish_exposed_material`, and `fs`, `shade`, `frame`, `camera`, `object`, `material`. It does not hold `finish`.
- The code agrees. The standard material template, crates/null3d-shaders/wgsl/lit.wgsl:167, imports `finish_exposed_material` and `finish_material` from `null3d::mesh` by name. No line imports `finish`.
- `finish` is a separate function at crates/null3d-shaders/wgsl/lib/mesh.wgsl:856. `finish_material` (line 876) calls `finish_exposed_material`, not `finish`, so `finish` does not come into the file as a dependency either.
- Full shaders import `finish` themselves (docs/guides/custom-shaders.md:53, docs/api/vertex-draws.md:33), which matches the finding's description.
- The link target is also weak. docs/shaders/wgsl-rules.md has no list of template names and says nothing about clashes with the template. The list is in surface-functions.md#rules, so the proposed link is the better target.

Corrected edit: the proposed edit is correct. Keep the sentence's opening and replace the end:

"A surface function shares its file with the engine's template. Rename GLSL helpers whose names clash with it, such as `frame`, `camera`, `object`, `material`, `shade` or `fs` ([Rules](../shaders/surface-functions.md#rules) lists every name)."
