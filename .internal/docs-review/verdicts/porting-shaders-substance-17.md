# porting-shaders-substance-17

## Finding as given

```json
{
 "page": "porting/threejs-shaders, shaders/wgsl-rules",
 "anchor": "shaders line 58 (mod row) and line 290; wgsl-rules '### The remainder operator'",
 "category": "missing-content",
 "severity": "medium",
 "claim": "Both pages tell the reader to hand-write x - y * floor(x / y). The library already has null3d::math::modulo, 'a modulo that matches GLSL's mod'.",
 "evidence": "docs/shaders/library.md:47 and the modulo entry under null3d::math",
 "proposedEdit": "'mod(x, y) becomes modulo(x, y) from null3d::math, which keeps GLSL's sign. WGSL's % keeps the sign of x.'",
 "generatedSource": "",
 "id": "porting-shaders-substance-17",
 "slice": "porting-shaders",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/porting/threejs-shaders.md:58 maps `mod(x, y)` to `x - y * floor(x / y)`. Line 290 says only "`%` is not `mod`". Neither line names the library helper.
- docs/shaders/wgsl-rules.md:118 says "write `mod(x, y)` as `x - y * floor(x / y)`". The page links to the library page only in Related pages (line 125).
- docs/shaders/library.md:48, 60 and 142-148 list `modulo` in `null3d::math`, "as GLSL's `mod` gives it".
- Source crates/null3d-shaders/wgsl/lib/math.wgsl:46-48: `fn modulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }`. The helper exists, so the main claim holds.
- But the helper takes only `f32`. WGSL has no user overloads, so `modulo` cannot take a `vec2f` or `vec3f`. GLSL `mod` often takes vectors in ported code, for example `mod(uv, 1.0)` or the `mod289(vec3)` step in common noise code. The hand-written formula works for scalars and vectors alike. The proposed edit says "`mod(x, y)` becomes `modulo(x, y)`" for every case. A reader who ports a vector `mod` that way gets a type error. So the blanket replacement is wrong. The current formula is the general answer, and the helper is an option for scalars only.

## Corrected claim

The pages could name `null3d::math::modulo` for scalar `mod`. The hand-written formula must stay, because the helper takes only `f32` and vector `mod` is common in GLSL.

## Corrected edit

- threejs-shaders.md:58 row: "| `mod(x, y)` | `x - y * floor(x / y)`, which works on scalars and vectors. For a scalar, `modulo(x, y)` from `null3d::math` does the same. WGSL's `%` keeps the sign of `x`. |"
- wgsl-rules.md:118: "When you port GLSL, write `mod(x, y)` as `x - y * floor(x / y)`. For `f32` values, `modulo` from [`null3d::math`](library.md#null3dmath) does the same."
- Line 290 needs no change.
