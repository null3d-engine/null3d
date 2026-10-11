---
id: api/reference/time
title: "Time: API reference"
status: generated
since: "0.1"
summary: "Every export of the Time API, from the engine's doc comments."
---

# Time: API reference

> [Time](../time.md) explains these exports. The engine's doc comments make this page.

## `SketchTime`

Interface `SketchTime`.

The sketch's clock. The engine updates it at the start of each frame, before it calls `onFixedUpdate`.

| Member | Description |
| --- | --- |
| `readonly now: number` | Sketch time in seconds: the sum of every frame's step, so paused and hidden time do not count. It is 0 during the setup function. In hold mode, the last frame's time is the held time exactly. |
| `readonly dt: number` | The frame's step in seconds, which `onUpdate` and `onLateUpdate` also get. 0 during the setup function. |
| `readonly frame: number` | The frame number: 0 during the setup function, 1 in the first frame, and one more in each frame after it. |
