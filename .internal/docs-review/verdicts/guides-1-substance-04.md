# guides-1-substance-04

## Finding as given

- page: guides/assets-pipeline
- anchor: "Without it, the build narrows to the list that a recorded run wrote." (line 483) vs "Without the variable, the build compiles every permutation, as before." (line 495)
- category: contradiction
- severity: high
- claim: Two sentences give opposite results for a build without NULL3D_SHADER_PERMUTATIONS. They hold for different commands (the examples build reads the repository list by default; bun run build does not), and the page does not say so.
- evidence: examples/vite.build.config.ts:37-38; tools/lib/shader-modules.ts:319-322 treats unset or empty as a full build.
- proposedEdit: State one rule when the section moves: "Leave NULL3D_SHADER_PERMUTATIONS unset or empty for the full set. Set it to a list file to narrow the set." Remove the examples-build default from user docs.

Verdict: partly

## Evidence

- The code claim holds. examples/vite.build.config.ts:37-38 sets the variable to examples/shader-permutations.txt when that file exists and the variable is unset. The file exists in the tree. tools/lib/shader-modules.ts:319-322 treats unset or empty as a full build. package.json:27 `build` is `bun tools/build-wasm.ts`, which has no such default; package.json:66 `examples:build` uses the examples config.
- The page does partly say which command each sentence is about. Line 483 sits right after the code block that runs `bun run examples:build` (lines 475-479), and line 485 says "`bun run examples:build` reads it". Line 495 sits right after the `bun run build` block (lines 491-493). So "the page does not say so" is too strong. A careful reader can work it out. That makes this medium, not high.
- The real defect is wording: line 483 says "the build" and "Without it" with no command name, and line 469 states a general rule ("A build without the list stays a full build, as before") that is false for `examples:build` when the list file exists. Lines 469 and 483 then disagree outright.
- The proposed edit is wrong in part. The empty variable in the recording command (line 476) is load-bearing: without it, `examples:build` narrows to the old list and the recording cannot see new words. Removing the examples-build default from the docs would leave that command unexplained and would make the reader record against a narrowed build. "One rule" for all commands is also false for `examples:build`.

## Corrected claim

Lines 469 and 483 disagree, and 483 vs 495 look like a contradiction because neither 469, 483 nor 495 names its command. `bun run build` is a full build unless the variable names a list; `bun run examples:build` narrows to examples/shader-permutations.txt by default, and an empty variable forces a full build. The page shows this only through code-block placement and line 485. Severity medium.

## Corrected edit

Name the command in each sentence and keep the examples default:
- Line 469: "`bun run build` without a list is a full build."
- Line 483: "The empty variable makes `bun run examples:build` compile the full set, so the recording sees every word that the pages ask for. Without the variable, `examples:build` reads `examples/shader-permutations.txt` when that file exists."
- Line 495: "Without the variable, or with it empty, `bun run build` compiles every permutation. With it, ..." (drop "as before").
