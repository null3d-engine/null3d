---
id: errors/index
title: Error codes
status: generated
since: "0.1"
summary: Every EngineError code with its cause and fix.
---

# Error codes

Every error the engine throws is an `EngineError` with a code. Its message names the call and the object, says what failed and how to fix it, and links to the code's page here. This page is generated from the engine's error table, `packages/engine/src/errors/codes.ts`.

| Code | Error | What happened |
| --- | --- | --- |
| [E1101](E1101.md) | Stale handle | A call used an object after it was destroyed. Its slot may already hold a new object. |
| [E1102](E1102.md) | Too many objects | The scene reached the most objects one engine holds. |
| [E1103](E1103.md) | Object from another engine | A call received an object that this engine did not create. |
| [E1104](E1104.md) | Parent loop | A call would make an object its own ancestor: the new parent is the object itself or one of its descendants. |
| [E1105](E1105.md) | Unknown command | The engine core received a structural change it does not know, so the TypeScript side and the core come from different builds. |
| [E1106](E1106.md) | Object not created yet | A call read world data of an object in the frame that created it. New objects join the scene when the next frame starts. |
| [E1107](E1107.md) | Object created twice | The engine core received a second create command for one object, so the TypeScript side and the core disagree about the scene. |
| [E1108](E1108.md) | Value out of range | A call received a count or an index past its limit, such as a row past the capacity of an instance batch. |
| [E1203](E1203.md) | Invalid number | A call received a number that is not finite, such as NaN or Infinity. |
| [E1204](E1204.md) | Invalid color | A call received a color that is not a hex string, a number from 0 to 0xffffff, or three numbers from 0 to 1. |
| [E1301](E1301.md) | No usable GPU path | The browser offers neither WebGPU nor WebGL2 for the way the engine was asked to draw. |
| [E1401](E1401.md) | Not a game module | The module passed to createEngine as the game does not export a game as its default export. |
| [E1402](E1402.md) | Engine core out of date | The engine core WebAssembly file lacks functions that the TypeScript side calls, so the two come from different builds. |
| [E1403](E1403.md) | Engine core not ready | An engine call ran before the engine core started in this worker, or the core started twice. |
| [E1501](E1501.md) | Render space full | The scene needs more room than the renderer set aside. The full part is the draw list, the mesh buffers, the material table, the upload space or the culling pass. |
