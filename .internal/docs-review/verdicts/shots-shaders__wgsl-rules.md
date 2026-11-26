# Shot and demo verdicts: shaders/wgsl-rules

## Shot: swizzle-build-error (manual) - REJECT

- Wrong source type. "Manual" shots are only for the browser's own developer tools. This shot is a terminal, so it does not fit the contract.
- A picture of text does not help here. The reader needs the message to search for and copy. A picture cannot be searched or copied, and it goes out of date when the wording changes. The custom shaders guide already shows a build error as a `text` code block, so a code block also keeps the pages consistent.
- Wrong source file. The rule and its fix text live in the shader compiler, crates/null3d-shaders/src/features.rs (the swizzle check in the file scan, the fix list, and the message format in feature_problem). packages/vite-plugin/src/wgsl.ts only passes the problems on.
- No scripted shot is possible. No demo or test page holds a broken shader, so nothing can show the error overlay on the page.
- Correction: put a `text` code block under "Language features" with the real message shape:

  ```text
  null3D could not compile the WGSL:
  src/shaders/glow.wgsl:6:10: An assignment to the swizzle `.rgb` uses the WGSL language feature `swizzle_assignment`, which not every browser supports. null3D shaders may use only `packed_4x8_integer_dot_product`, `pointer_composite_access` and `readonly_and_readwrite_storage_textures`. Assign each component on its own, for example `v.x = a.x; v.y = a.y;`, or assign the whole vector. See https://github.com/null3d-engine/null3d/blob/main/docs/shaders/wgsl-rules.md
  ```

  Check the first line and the order of the allowed features against a real build before you publish it.

## Demo links

None were proposed.

## Concepts without a demo

- "Every rule on the page: they are build checks." CONFIRMED. No demo breaks a rule on purpose, and none uses the rules as its subject. The only near match is the custom shader inputs demo (shader-inputs/). Its pool shader calls textureSampleLevel inside a loop, but it does not show the "sampling in branches" rule, so a link to it would mislead.
