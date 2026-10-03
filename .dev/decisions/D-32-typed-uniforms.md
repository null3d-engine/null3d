# D-32: How TypeScript learns the uniforms of custom WGSL

Status: decided. Date: 2026-10-03. Task: M2-J1.

## Question

A custom material declares its uniforms once, as the fields of `struct Uniforms` in its WGSL. Its `uniforms` option and its `set()` should take only those names, each with a value of its type, and a wrong name should fail the type check. TypeScript cannot read WGSL. How does it learn the names and types?

WGSL reaches `materials.shader` in two forms, and each needs an answer:

1. A `.wgsl` file that a module imports. TypeScript sees only the import path.
2. A template literal that a `/* wgsl */` comment tags. TypeScript sees a string, whose literal type is the WGSL text itself when the literal sits in a `const` or in the call.

Effects (M2-F5) take uniforms the same way, so the answer must serve them too.

## Rule

- A wrong uniform name fails the type check in a fixture project, for both forms (the task's done-when).
- No false errors: WGSL whose uniforms TypeScript cannot be sure of takes any name, as JavaScript does. The engine's run-time check (E1216) stays for JavaScript users and catches the rest.
- The types stay current while a developer edits, in the editor and in a `tsc` run with no dev server running, wherever that is possible.
- The type check of a project stays fast: at most a few milliseconds per shader of a realistic size.
- The engine's package does not depend on the plugin's types, and nothing runs in the page for this.

## Data

### Where TypeScript looks for a `.wgsl` file's types

Checked with TypeScript 6.0.3 and `moduleResolution: "bundler"`, with the client types' `declare module '*.wgsl'` in the program:

| Declaration file beside `x.wgsl` | Without `allowArbitraryExtensions` | With it |
| --- | --- | --- |
| `x.wgsl.d.ts` | Used, ahead of the wildcard module | Used |
| `x.d.wgsl.ts` | Not used: the wildcard module's type wins | Used |

So `x.wgsl.d.ts` works in any project, with no compiler option, and the wildcard module stays the fallback for a file whose declaration is not written yet.

### What reading the WGSL text costs the type check

TypeScript's template literal types can match text, so a type can find `struct Uniforms` in the literal type of tagged WGSL and read its fields. Two ways were measured on a file of 20 shaders of 13 KB each. Each shader has 12 uniforms, 75 comment lines and 450 slashes after the struct. The runs used `tsc --extendedDiagnostics` on the MacBook Pro, with other helpers building at the same time:

| Way to read the text | Check time | Memory |
| --- | --- | --- |
| No reading (the literals alone, as a baseline) | 0.23 to 0.24 s | 112 to 162 MB |
| Strip every comment from the whole text, then find the struct | 0.72 s | 222 MB |
| Read up to the struct one slash at a time, skipping comments, and stop at its closing brace | 0.27 s | 178 to 180 MB |

The second way costs about 2 ms per shader of 13 KB, most of which is the literal type itself. The first way costs about 24 ms per shader, because it walks every division in the shader's code. Each step of a type's recursion meets one slash. A shader would need 1,000 slashes before its struct to reach TypeScript's limit on recursion, and real shaders declare the struct near the top.

## Options

1. A generated declaration for each form. `.wgsl` files get one beside them. For tagged literals, the plugin would write a declaration module (the "virtual module"). It would map each literal's text to its uniforms, for the engine's types to look up. Rejected for tagged literals: the types exist only after Vite has compiled the module. A `tsc` run on a fresh checkout sees no types, and an editor that changed the text sees stale ones. The generated file repeats every shader's whole text, and it must sit inside each project's `include`.
2. Read `struct Uniforms` from the literal's type, with template literal types, and write a declaration beside each `.wgsl` file. Chosen.
3. Ask developers to write the types, as in `materials.shader<{ speed: 'f32' }>(...)`. Rejected: it states the uniforms twice, and the copy drifts from the WGSL with nothing to check it.

three.js has no such check. `ShaderMaterial`'s `uniforms` is a record of `{ value: any }` under any name. three.js skips a uniform name that the GLSL does not use without a word, so a misspelled update changes nothing. TSL builds the shader from JavaScript nodes, so each `uniform(0.5)` node has a type, but that design gives up WGSL as the source.

## Decision

Option 2:

- For tagged WGSL, `materials.shader` takes the WGSL's type with a `const` type parameter, and `WgslUniforms` reads the fields of `struct Uniforms` from it with the slash-at-a-time reading above. Comments before the struct and inside it do not count, including one that names the struct. It reads the types that the build takes (`f32`, `i32`, `u32`, `vec2f`, `vec3f`, `vec4f`, and the `vecN<f32>` spellings). A field of any other type, or text it cannot read, gives a record that takes any name: the build stops at such WGSL anyway. WGSL with no `struct Uniforms` takes no uniform name.
- For `.wgsl` files, the plugin writes `x.wgsl.d.ts` beside each file each time it compiles it, in the dev server and in builds. It writes only when the text changes. The declaration types the file's default export as `CompiledMaterial<{ name: type }>` or `CompiledShader`. The engine reads the uniforms from the compiled object's `uniforms` list. Projects commit the declarations, so that `tsc` without Vite sees them. The plugin's `wgslDeclarations: false` turns them off, and files in `node_modules` get none.
- `UniformValueByType` gives each type's value: a number for `f32`, `i32` and `u32`, and tuples of 2 and 4 numbers for `vec2f` and `vec4f`. A `vec3f` takes a `ColorInput`, as the run-time check does. Tuples catch a wrong length in a literal. Their cost is a type on lists of values, where TypeScript widens `[0, 1]` to `number[]`. `UniformValues<typeof wgsl>` and `ShaderValues<typeof wgsl>` type such lists.
- WGSL in a variable of type `string`, and compiled WGSL whose type lists no names, take any name, as before. The run-time check (E1216) is unchanged.

## Consequences

- `packages/engine/src/scene/wgsl-uniforms.ts` holds the types. Nothing in it runs, so the engine's JavaScript does not grow. `ShaderOptions`, `ShaderValues` and `materials.shader` take the WGSL's type. `UniformType`, `UniformValueByType`, `UniformValues` and `WgslUniforms` are public, for effects (M2-F5) to reuse.
- `packages/vite-plugin/src/declarations.ts` writes the declarations; `CompiledMaterial` takes the uniforms as a type parameter.
- `tests/fixtures/typed-uniforms` holds the type tests, which `bun run typecheck` runs. Each wrong use sits under `@ts-expect-error`. `text.ts` asserts what `WgslUniforms` reads from WGSL with comments, odd spacing and fields that the build rejects. The repository commits the declarations of its own `.wgsl` files, and a plugin test checks that they are current.
- Docs: `guides/custom-shaders` (Typed uniforms), `api/materials`, `shaders/surface-functions`, `getting-started/install`, and the `mat-shader` mapping note. Skills: both `shaders.md` references.
