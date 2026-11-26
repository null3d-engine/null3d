# porting-shaders-readability-11

## Finding as given

- Page: porting/react-three-fiber
- Anchor: "## A view component" (line 33); line 107 "A simpler component also works."
- Category: example-placement. Severity: medium.
- Claim: The first code on the page is a 63-line component with an engine cache, a timer and StrictMode handling. The simple component that a newcomer needs (a canvas, createEngine in an effect, destroy() in the cleanup) is given only as prose after it.
- Evidence: react-three-fiber.md lines 33-107.
- Proposed edit: Open the section with the simple component as a short code block of about 15 lines. Then add "### A view that keeps its engine" for apps that switch views, with the long component and its bullets. Move the StrictMode and per-mount handler bullets into a technical details block under that code.
- Generated source: none (written page).

Verdict: survives

## Evidence

- docs/porting/react-three-fiber.md:37-100: the first code block on the page is the kept-engine component (module-level cache, a 60-second destroy timer, a mounted flag, a handler ref). It is about 63 lines.
- docs/porting/react-three-fiber.md:107: the simple component is prose only: "renders a `<canvas>`, creates the engine in its effect, and calls `destroy()` in the cleanup".
- The page itself says the simple form is the right one for a view the app shows once (line 105), so a newcomer who needs it gets no code to copy.
- The simple form really works, so a code block for it is correct. packages/engine/src/page/ownership.ts:1-12 and `takeWhenFree` (lines 57-80): a new engine on the same canvas waits for the old one to stop. packages/engine/src/page/engine.ts:2989-2996: a canvas already moved to a worker is not transferred again. docs/api/engine.md:179 says the same.
- The StrictMode detail is already in docs/api/engine.md:179 and docs/guides/debugging.md:228. So moving the page's StrictMode bullet into a closed block costs the main text nothing.
- stats.json lists no long paragraphs for this page, so this is not a paragraph-length issue. It is about the order of the examples.
- I could not refute it: the page does say what the finding claims, and the proposed order breaks no writing rule or website contract.

## Refinements to the edit

1. The section "State between React and the sketch" (lines 113-140) uses `<SceneView sketch onReady onMessage>`. Give the short component the same name and the same `onReady` and `onMessage` props, or say that the later examples work with either component. Otherwise the reader cannot tell which component those examples need.
2. The short component's cleanup must destroy the engine that the effect's promise gives, and remove the sketch message handler. Say in one sentence that under StrictMode it starts the engine twice in development, and that the second start waits for the first to stop. The skill copy says this (skills/null3d-port-threejs/references/react-three-fiber.md:97); the page's line 107 leaves out the double start.
3. Keep two bullets in the main text, outside the block, because they help the reader choose a component: "Make the sketch's address once, at module level" (line 102, true for both components) and "A kept engine holds its memory and GPU buffers" (line 105). Only the StrictMode bullet (line 103) and the per-mount handler bullet (line 104) go into the block. Use the summary "Technical details: StrictMode and message handlers", with no headings inside.
4. Make the same change in skills/null3d-port-threejs/references/react-three-fiber.md (lines 41-97), which has the same structure, so the docs and the skill do not drift apart.
