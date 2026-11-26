# Verdicts: errors/E1203 (Invalid number)

Page is generated. Source: `packages/engine/src/errors/codes.ts` (title, cause, example) and `fixes.ts` (fix), rendered by `errorPage()` in `tools/lib/docs.ts`.

## Shot `console-e1203` (manual): REJECT

- The "Example" block already gives the whole message as text. A console picture adds only Chrome's frame and a stack trace. The stack trace is not specific to this code.
- The shot says it shows "the code, the detail, the fix, the docs link" as parts. They are not parts. `messageFor()` in `engine-error-core.ts` joins them into one message line: `E1203: <detail> <fix> See https://github.com/null3d-engine/null3d/blob/generated/docs/errors/E1203.md`. A text block shows this better than a picture, and readers can search and copy text.
- The same picture would fit almost all of the 80 or more error codes. If the docs want such a picture, it belongs once on the error index page (errors/index) or on a debugging guide. It does not belong on each code page.
- To add an image to one generated error page, the error table needs a new field for each code, and `errorPage()` needs a change. That is a lot of work for little gain.
- "manual" is the correct type, because the shot shows the browser's developer tools. But "any development-build sketch that calls setPosition(NaN, 0, 0)" is not a source someone can repeat. No demo passes NaN. A person would have to write a throwaway sketch.
- What the shot gets right: in development builds, `setPosition` runs `checkVector` (`scene/scene.ts`, inside `if (DEV)`). The sketch runner then logs the error once with `console.error` (`sketch/runner.ts`, `report()`), so the console really shows it with its stack.

Related content issue (for the page review, not the shot): the Example in `codes.ts` leaves out the " See <docs link>" ending that every real message has.

## Demo links

None were proposed. None are needed.

## Concepts said to have no demo

- "NaN from a zero-length vector": CONFIRMED, no demo shows it. But the engine's own helpers never make this NaN. `vec3.normalize` leaves a zero vector at zero, and `quat.normalize` turns a zero quaternion into the identity (`packages/engine/src/math/vec3.ts`, `quat.ts`). The fix text in `fixes.ts` ("from normalizing a zero-length vector") is true only for code that divides by the length itself. It should say so, for example: "...or from dividing by the length of a zero-length vector in your own code. The engine's vec3.normalize and quat.normalize do not make NaN." The `math` demo uses `vec3.normalize` safely, but it does not show a NaN.
- "checks that run only in development builds": CONFIRMED, no demo shows it. The `hold-mode` demo is about repeatable frames, not about checks. The `hdr-limit-nan*` reference images show NaN in GPU output, which is a different problem.
