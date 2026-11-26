# porting-shaders-substance-03

## Finding as given

- page: porting/threejs-shaders
- anchor: line 65 "Only Chrome allows assignment to a swizzle."; line 291 "WGSL has no assignment to a swizzle in most browsers."
- category: contradiction
- severity: high
- claim: The page implies v.xy = w works in Chrome. The null3D build rejects every swizzle assignment in every browser.
- evidence: docs/shaders/wgsl-rules.md:29 (swizzle_assignment: the build rejects 'An assignment to a swizzle, such as color.rgb *= 2.0;')
- proposedEdit: Line 65: '`v = vec3f(w, v.z);`. The null3D build rejects an assignment to a swizzle ([WGSL rules](../shaders/wgsl-rules.md#language-features)).' Line 291: 'The build rejects an assignment to a swizzle. Write the whole vector.'

Verdict: survives

## Evidence

- docs/porting/threejs-shaders.md:65 says "Only Chrome allows assignment to a swizzle." and line 291 says "WGSL has no assignment to a swizzle in most browsers." Both present swizzle assignment as a browser limit, so a reader who targets Chrome can think it is allowed.
- docs/shaders/wgsl-rules.md:19-29: null3D shaders may use only three language features (packed_4x8_integer_dot_product, pointer_composite_access, readonly_and_readwrite_storage_textures). The build looks for code that each other feature allows and rejects it; the table row for swizzle_assignment rejects "An assignment to a swizzle, such as color.rgb *= 2.0;".
- packages/vite-plugin/src/shader-compiler.test.ts:237-256: a shader with `color.rgb = ...` gives one problem with feature 'swizzle_assignment' at the line and column, and the message links to docs/shaders/wgsl-rules.md. So the build rejects it whatever the browser.
- The anchor #language-features exists (heading "## Language features" in wgsl-rules.md). The proposed link fits in the table cell and keeps the "write the whole vector" fix.

## Note on severity

Both lines already tell the reader to write the whole vector, and the build error names the rule page, so a reader who follows the page does the right thing. The harm is a wrong mental model and a surprise build failure for a Chrome-only developer. Medium fits better than high. The factual claim and the proposed edit hold as given.
