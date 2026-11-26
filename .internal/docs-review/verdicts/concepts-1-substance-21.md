# concepts-1-substance-21

## Finding as given

- Page: concepts/color-management
- Anchor: Line 25 "The scene therefore draws into a high dynamic range (HDR) target." and the Mermaid diagram
- Category: wrong-claim
- Severity: low
- Claim: The opening says the scene always draws into an HDR target. On the 8-bit path, which compatibility mode with MSAA and some WebGL2 devices take, it does not, and the shaders tone map. A reader of the opening alone gets the wrong picture.
- Evidence: color-management.md:67; backends.md:75-76.
- Proposed edit: 'On most devices the scene therefore draws into a high dynamic range (HDR) target. Devices without a float target draw an 8-bit path ([below](#the-8-bit-path)).'

## Verdict: partly

## Evidence

- color-management.md:25 states the HDR target with no condition. The Mermaid diagram (lines 13-21) also shows only the HDR path, with tone mapping in the final pass.
- color-management.md:65-71 (the 8-bit path section) says WebGPU compatibility mode with MSAA and some WebGL2 devices write into an 8-bit target, and each shader tone maps there. So the core claim holds: the opening's sentence is not true on every device. Low severity is right, because the page corrects it 40 lines down.
- The proposed wording is wrong in one point. "Devices without a float target" does not describe compatibility mode with MSAA. Those devices have float targets; they cannot use them with MSAA (backends.md:76: "Compatibility mode allows no MSAA on 16-bit float targets"; color-management.md:67: "cannot draw a float target in the anti-aliasing mode"). The path also depends on the anti-aliasing mode: the same compatibility device keeps HDR with FXAA or none.
- A sketch can also choose the 8-bit path on purpose: packages/engine/src/page/engine.ts:341 declares the `hdr?: boolean` option, and line 2777 turns HDR off when it is false. color-management.md:77 already documents `createEngine({ hdr: false })`.
- "draw an 8-bit path" is awkward English; a scene draws into a target, or takes a path.
- The anchor `#the-8-bit-path` matches the heading at line 65, so the link works.
- The Mermaid diagram can stay as it is: it shows the main path, and the corrected text points to the other path. No change to the diagram is needed.

## Corrected claim

The opening says the scene always draws into an HDR target. Where the device cannot draw a float target in the chosen anti-aliasing mode (compatibility mode with MSAA, and WebGL2 devices whose float targets fail the engine's test), or where the sketch turns HDR off, the scene draws into an 8-bit target and each shader tone maps. The page explains this later, but the opening does not say it.

## Corrected edit

Replace line 25's third sentence with:

"The scene therefore draws into a high dynamic range (HDR) target. Where the device cannot draw a float target in the anti-aliasing mode, the scene takes an 8-bit path, and each shader tone maps its own color ([The 8-bit path](#the-8-bit-path))."
