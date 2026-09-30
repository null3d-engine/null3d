---
id: errors/index
title: Error codes
status: generated
since: "0.1"
summary: Every EngineError code with its cause and fix.
---

# Error codes

Every error the engine throws is an `EngineError` with a code. Its message names the call and the object, says what failed and how to fix it, and links to the code's page here.

| Code | Error | What happened |
| --- | --- | --- |
| [E1101](E1101.md) | Stale handle | A call used an object after it was destroyed. Its slot may already hold a new object. |
| [E1102](E1102.md) | Too many objects | The scene, the table of instance batches or the queue of changes for the next frame is full. The message names which one, and how many it holds. |
| [E1103](E1103.md) | Object from another engine | A call received an object that this engine did not create. |
| [E1104](E1104.md) | Parent loop | A call would make an object its own ancestor: the new parent is the object itself or one of its descendants. |
| [E1105](E1105.md) | Unknown command | The engine core received a structural change it does not know, so the TypeScript side and the core come from different builds. |
| [E1106](E1106.md) | Object never created | A call such as `setVisible` or `setParent` queued a change for an object that the engine never created. The engine creates an object when the next frame starts. When that fails, for example because its parent was destroyed, the object never joins the scene. |
| [E1107](E1107.md) | Object created twice | The engine core received a second create command for one object, so the TypeScript side and the core disagree about the scene. |
| [E1108](E1108.md) | Value out of range | A call received a count or an index past its limit, such as a row past the capacity of an instance batch. |
| [E1109](E1109.md) | Engine memory full | The engine could not create or grow its WebAssembly memory. A page with worker threads gives the engine 1 GiB at most. Each instance row takes about 180 bytes, or about 230 with per-row colors. So about 5 million rows fill it, along with the rest of the scene. A browser can refuse memory sooner, as phones often do. It can also refuse a new engine's memory while the memory of an engine that stopped a moment before is not free yet. The engine then tries again for about 3 seconds before it fails. |
| [E1203](E1203.md) | Invalid number | A call received a number that is not finite, such as NaN or Infinity. |
| [E1204](E1204.md) | Invalid color | A call received a color that is not a hex string, a number from 0 to 0xffffff, or three numbers from 0 to 1. |
| [E1205](E1205.md) | Unknown input name | An input call received a name that no key, button or action has, or `input.actions.define()` received an action name that a key or button already has. Names are case-sensitive: `KeyW` is the W key, and `keyW` names nothing. |
| [E1206](E1206.md) | Invalid mesh arrays | geometry.fromArrays() received arrays that make no mesh. An array can have the wrong length for the vertex count, an index can name no vertex, or a value can be NaN or Infinity. Normals can also be missing, or both given and computed. |
| [E1301](E1301.md) | No usable GPU path | The browser offers neither WebGPU nor WebGL2 for the way the engine was asked to draw. |
| [E1302](E1302.md) | GPU lost | The browser took the GPU away while the engine drew, for example after a driver reset or a GPU crash, and the engine could not carry on. No new GPU device started, or the GPU was lost more than twice within a minute. The engine stopped drawing. |
| [E1303](E1303.md) | WebAssembly SIMD missing | The browser runs WebAssembly without SIMD, which the engine's core needs. |
| [E1401](E1401.md) | Not a sketch module | The module passed to createEngine as the sketch does not export a sketch as its default export. |
| [E1402](E1402.md) | Engine core out of date | The engine core WebAssembly file lacks functions that the TypeScript side calls, so the two come from different builds. |
| [E1403](E1403.md) | Engine core not ready | An engine call ran before the engine core started in this worker, or the core started twice. |
| [E1404](E1404.md) | Engine thread failed | An engine thread hit an error it could not handle after the engine started, so the engine may have stopped. |
| [E1405](E1405.md) | Engine thread did not start | An engine thread failed while the engine started, before the sketch ran. |
| [E1406](E1406.md) | Engine core not downloaded | A file of the engine core did not download whole: the server answered with an error, or the connection broke off. |
| [E1407](E1407.md) | Invalid hold time | The ?hold= switch or the hold option of createEngine gave a hold time that is not a number of seconds from 0 to 600. |
| [E1408](E1408.md) | Hold failed | The sketch or the engine failed in hold mode, before the engine read the held frame back. A live engine logs an error in the sketch and carries on. Hold mode stops at the first one, so a test fails at once. |
| [E1501](E1501.md) | Render space full | The scene needs more room than the renderer set aside. The full part is the draw list, the material table, the upload space or the culling pass. On WebGPU the culling pass covers 2,097,152 objects and instance rows on every device, and more on devices with larger GPU buffers. On WebGL2 the number follows the largest texture the device allows. The number for the device is in engine.capabilities.maxInstances. |
| [E1502](E1502.md) | Pass input missing | A render pass uses a target or buffer that no pass creates, or reads one that no pass running in the frame writes. The render graph checks every pass before the frame draws. |
| [E1503](E1503.md) | Target created twice | Two render passes create the same target, or a pass creates a target that the render graph keeps between frames. Each target has one creator, which sets its format and size. |
| [E1504](E1504.md) | Render pass cycle | Render passes need each other in a loop, so no order runs each pass after the passes whose output it reads. |
| [E1505](E1505.md) | Pass targets do not match | A render pass draws into targets that one GPU render pass cannot hold together. A target can have another size than the pass, or the targets can have different sample counts. The pass can also draw into two depth targets, into a whole texture array instead of one layer, or into no target. A resolve pass fails the same way when it cannot resolve its target into the canvas. That target must be multisampled, in the canvas's format and size, and read by no other running pass. |
