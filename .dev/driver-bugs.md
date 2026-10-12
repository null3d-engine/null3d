# Driver bug reports

Faults of GPU drivers and browsers that the engine works around, written up to report upstream. Each report names the device, the driver and the browser, and gives the smallest known case. It also says where the engine's workaround and evidence are. [Browser faults](implementation-notes.md#browser-faults) holds the full story of each.

## Safari 27.0: `atomicCompareExchangeWeak` does not compile

Status: fixed in WebKit on 13 September 2026 (commit 4f56cc248e8a, 321006@main, inside bug 323873), not yet in a Safari release. No bug names the fault. Not reported by null3D: a draft waits for the owner. Found 8 October 2026.

- Device: iPad in BrowserStack's device cloud, Safari 27.0, WebGPU. Any Apple device whose Metal compiler comes from the 27 releases should fail the same way.
- Seen in: null3D's culling compute shader, `crates/null3d-shaders/wgsl/cull.wgsl` at commit 2ed8971bc, which called `atomicCompareExchangeWeak` on an `array<atomic<u32>, 128>` in workgroup memory.

What happens: pipeline creation fails. The Metal compiler rejects WebKit's translation: "field may not be qualified with an address space ... in instantiation of template class `__atomic_compare_exchange_result<thread unsigned int>`". WebKit's helper for the call (`MetalFunctionWriter.cpp`, `emitNecessaryHelpers`) returns `__atomic_compare_exchange_result<decltype(compare)>`, and the newer compiler gives the by-value parameter `compare` the type `thread unsigned int`. So storage-buffer atomics fail too. WebKit's fix names the deduced template type instead.

Smallest known case: any compute shader with one `atomicCompareExchangeWeak` call.

Workaround in the engine: no engine shader calls it, and the engine's shader build fails on it. Users' shaders build with a warning ([D-100](decisions/D-100-workgroup-counters.md), [Browser faults](implementation-notes.md#browser-faults)).

## Adreno 619: the floats of a struct keep only half precision on WebGL2

Status: not reported yet. Found 13 October 2026.

- Device: Samsung Galaxy Tab A9+ (SM-X216B), Qualcomm Adreno 619, Android 14, in BrowserStack's device cloud.
- Browser: Chrome 152.0.7977.54, WebGL2. WebGPU and compatibility mode on the same tablet are right.
- Seen in: null3D's sky (`crates/null3d-shaders/wgsl/sky.wgsl` and `null3d::atmosphere`) at commit 3ed5e6c61. On WebGL2, 62% of the background-sky image's pixels differed, and 90% of S6's.

What happens: a fragment shader that keeps a float in a struct reads it back at half precision. Values below the smallest normal half-precision float read as zero. In a struct, the value 1234.567 read 1234. The value 0.123456 read 0.1234131. The value 1.0001 read 1, 70000 read 65504, and 1e-5 read 0. Writing `highp` on the member changes nothing. Nor does `highp` on every float declaration of the shader. These kinds of struct all lose precision:
- a struct local;
- a struct that a function returns or takes;
- a struct of scalars, and a struct with a whole number or an array in it;
- a stage's inputs gathered into a struct;
- a uniform block's struct copied into a local.

Plain locals, plain arrays, function results that are not structs, and values passed between the stages keep all 32 bits. So does a uniform block's struct read in place. In the vertex stage, a struct in `main` kept all 32 bits, but a struct that a function returned did not. The sky's scattering coefficients per metre, about 1e-5, read as zero, except blue's Rayleigh coefficient. Red and green light then divided zero by zero, and the sky drew yellow-white.

Smallest known case, a fragment shader over an `RGBA32UI` target:

```glsl
#version 300 es
precision highp float;
precision highp int;
struct Held { highp vec4 value; };
uniform highp vec4 probe;
uniform highp float one;
layout(location = 0) out highp uvec4 color;
Held hold(highp vec4 value) { Held held; held.value = value * one; return held; }
void main() { color = floatBitsToUint(hold(probe).value); }
```

With `probe` (1234.567, 0.123456, 1e-5, 70000) and `one` 1, the bits read back as (1234, 0.1234131, 0, 65504).

Workaround in the engine: the sky keeps its scattering coefficients per million metres, within half precision's range (`null3d::atmosphere`). The shader library check page runs the case above and reports the fault as `structFault` ([Browser faults](implementation-notes.md#browser-faults)). The GLSL build still keeps each fragment shader's inputs and most of its values in structs, so on this driver they hold only half precision.

To report: Qualcomm, through Chromium's issue tracker (component Internals>GPU>ANGLE), with the shader above.

## Adreno 830: a uniform array read at a per-thread index returns one thread's entry

Status: not reported yet. Found 7 October 2026.

- Device: Samsung Galaxy S25 (SM-S931B), Qualcomm Adreno 830, Android 15, in BrowserStack's device cloud.
- Browser: Chrome 149.0.7827.160, WebGPU and WebGPU compatibility mode. Both run on Vulkan: the compatibility adapter has `core-features-and-limits`. WebGL2 on the same phone is right.
- Seen in: null3D's culling compute shader, `crates/null3d-shaders/wgsl/cull.wgsl` at commit 74d5f4956.

What happens: the shader reads `params.cell_offsets[entry >> 23u]`. `params` is a uniform buffer of 12,416 bytes, and `entry` comes from a storage buffer at the thread's own index. Every thread of a group gets the same element: the one that the group's first thread asked for. Reads of storage buffers at an index from the same `entry` are right.

Smallest known case: the culling shader alone, with plain WebGPU, on 512 synthetic sources in 4 cells. Each source's cell differs from its neighbour's. 384 of 512 output rows held another cell's offset. The case differs from main's shader only in its inputs. A smaller uniform struct was right in the compute, vertex and fragment stages. It held an array of 512 `vec4f` after one `vec4f`, read at a per-thread index. So the fault needs more of the culling shader's shape. These changes did not help: a clamped index, the offset read before the first early return, and a plane loop with no early return. These did: the parameters in a storage buffer, and a copy of the whole array into a local variable before the read.

Workaround in the engine: the offsets moved into a float texture read with `textureLoad` ([D-95](decisions/D-95-culling-cell-offsets.md)). The vertex shaders that read their instances by index read that texture too. They would otherwise index a table in the same uniform parameters per vertex, which is the shape of this fault.

To report: Qualcomm, through Chromium's issue tracker (component Internals>GPU>Dawn), with the culling shader and the probe page's inputs.

## Adreno 830: a multisampled texture first resolved into the canvas resolves nothing into other textures

Status: not reported yet. Found 7 October 2026.

- Device, driver and browser: as above, WebGPU and compatibility mode alike.
- Seen in: null3D's 8-bit path with MSAA, when the scene's render pass resolves its multisampled color straight into the canvas from the first frame.

What happens: take a multisampled color texture whose first render pass resolved into the canvas's current texture. A later render pass that resolves it into any other texture leaves that texture as it was. A texture cleared to green before the pass stayed green, and a new one stayed zero. The same pass with a new multisampled texture of the same descriptor resolves right. A new depth texture alone did not help. The canvas itself keeps showing the right frame. Then the engine moved the scene to its final pass, which resolves into a texture of its own and copies that into the canvas. The canvas read black. A texture whose first resolve went into another texture resolves into the canvas and into others alike. No GPU error or device loss was reported.

Smallest known case, not yet written as a page of its own:

1. Create a 4-sample `rgba8unorm` texture with `RENDER_ATTACHMENT` usage, and a canvas context of `rgba8unorm`.
2. In frame 1, draw into it with `loadOp: 'clear'`, `storeOp: 'discard'`, and `resolveTarget` the canvas's current texture.
3. In a later frame, draw into it the same way with `resolveTarget` a new `rgba8unorm` texture with `RENDER_ATTACHMENT | COPY_SRC`, and read that texture back.

The engine's case also uses the transient attachment usage on the multisampled texture, but the fault stayed without it.

Workaround in the engine: the frame graph makes its multisampled targets again when the pass to the canvas changes. A capture draws such targets into textures of its own (see "Browser faults").

To report: as above, after a standalone page confirms the three steps.

## Firefox: freeing a moved MessagePort's old object drops the unread messages that its new owner sent

Status: not reported yet. Found 7 October 2026.

- Browser: Firefox 156.0 on Linux (GitHub's Ubuntu 24.04 runner, x86-64, and an ARM container on a Mac), with a software renderer. The code below is the same on every platform, so Firefox on macOS and Windows should fail the same way.
- Seen in: null3D's image channel from the sketch worker to the render worker, and the merge queue run 37599350642 of pull request #346 (E1404).

What happens: a page makes a `MessageChannel`. It moves `port1` to worker A and `port2` to worker B, and lets the channel go. Worker A posts image bitmaps through its port while worker B is busy. When the page's garbage collector frees the old `port1` object, every message that A sent and B has not read yet is lost. B gets a `messageerror` event for each. Messages that can leave the process, such as array buffers, are not lost. Firefox keeps a message that must stay in the process in `RefMessageBodyService`, under the sending port's ID. The destructor and the cycle collector's unlink call `MessagePort::CloseInternal`. It runs `ForgetPort` with the object's own ID. A moved port keeps that ID in its new thread.

Smallest known case: a page and two workers of about 60 lines in all. One worker posts 20 image bitmaps, the other is busy for 6 s, and the page makes garbage meanwhile. 6 of 10 runs lost bitmaps when the page let the channel go, 0 of 10 when it kept it.

Workaround in the engine: the page keeps every channel that it makes for the engine's threads until the engine stops ([Browser faults](implementation-notes.md#browser-faults)).

To report: Mozilla's Bugzilla (Core, DOM: postMessage), with the test page.
