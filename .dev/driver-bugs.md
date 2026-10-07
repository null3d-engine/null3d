# Driver bug reports

Faults of GPU drivers and browsers that the engine works around, written up to report upstream. Each report names the device, the driver and the browser, and gives the smallest known case. It also says where the engine's workaround and evidence are. [Browser faults](implementation-notes.md#browser-faults) holds the full story of each.

## Adreno 830: a uniform array read at a per-thread index returns one thread's entry

Status: not reported yet. Found 7 October 2026.

- Device: Samsung Galaxy S25 (SM-S931B), Qualcomm Adreno 830, Android 15, in BrowserStack's device cloud.
- Browser: Chrome 149.0.7827.160, WebGPU and WebGPU compatibility mode. Both run on Vulkan: the compatibility adapter has `core-features-and-limits`. WebGL2 on the same phone is right.
- Seen in: null3D's culling compute shader, `crates/null3d-shaders/wgsl/cull.wgsl` at commit 74d5f4956.

What happens: the shader reads `params.cell_offsets[entry >> 23u]`. `params` is a uniform buffer of 12,416 bytes, and `entry` comes from a storage buffer at the thread's own index. Every thread of a group gets the same element: the one that the group's first thread asked for. Reads of storage buffers at an index from the same `entry` are right.

Smallest known case: the culling shader alone, with plain WebGPU, on 512 synthetic sources in 4 cells. Each source's cell differs from its neighbour's. 384 of 512 output rows held another cell's offset. The case differs from main's shader only in its inputs. A smaller uniform struct was right in the compute, vertex and fragment stages. It held an array of 512 `vec4f` after one `vec4f`, read at a per-thread index. So the fault needs more of the culling shader's shape. These changes did not help: a clamped index, the offset read before the first early return, and a plane loop with no early return. These did: the parameters in a storage buffer, and a copy of the whole array into a local variable before the read.

Workaround in the engine: the offsets moved into a float texture read with `textureLoad` ([D-95](decisions/D-95-culling-cell-offsets.md)).

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
