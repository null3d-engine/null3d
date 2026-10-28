# D-131: Particles in closed form on the GPU

Status: decided by the helper of M2-EX20, for the owner's review. Built: the particles add-on is on main (`24f500d5a`). Task: M2-EX20.

Summary: The `@null3d/particles` add-on makes particle systems that the GPU works out in closed form from each particle's birth and age, with gravity, drag, turbulence, a ground and curves over life. The CPU writes a 32-byte record once per birth and no pass simulates, so the same shaders run on all three GPU paths. Soft particles read a depth copy that exists only while a soft system draws, and nothing loads before the first system.

## Question

The owner's look bar ([D-132](D-132-showcase-look-and-features.md), after [D-117](D-117-showcase-features-before-1-0.md)) asks for very beautiful showcase scenes. Creek, Battle and Night town need sparks, smoke, leaves, fireflies and magic. How do particles move, where does their state live, and how do they reach the screen on all three GPU paths? What does a scene without particles pay?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)): the look of three.quarks and Unity's particle systems, at a frame cost that a phone can pay.
- Both backends are first-class (design principle 9): one look on WebGPU, compatibility mode and WebGL2, with image references on the Mac's GPU and on SwiftShader.
- Pay only for what you use (design principle 8). Without a particle system there is no pass, target, bind group or download, and without a soft one no depth copy.
- No allocation per frame in the add-on's `update` or the engine's frame code (hard rule 1).
- A held frame at a given time is the same whatever frames came before it, as the image tests need.
- Heavy or niche features are add-ons ([D-54](D-54-addon-modules.md)): particles ship as `@null3d/particles`, which reaches the engine only through public API.

## Options

### Where particles move

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: closed form in the vertex shader, from each particle's birth record | Unity's VFX Graph "stateless" mode, many WebGL demos | Chosen |
| B: compute integration on WebGPU, transform feedback on WebGL2 | three.js's `WebGPURenderer` examples, Babylon.js's GPU particles | Rejected |
| C: integration on the CPU, with the whole buffer uploaded each frame | three.js `Points` examples, three.quarks | Rejected |

Option B needs a pass per frame on each path. The engine's WebGL2 path has no compute and no transform feedback, so it would need a second simulation written for it. Integration also depends on the frame rate, and sub-emitters, sorting and bounds would need the GPU's state read back. Option C cost 98 ms per frame for a million particles in one JavaScript thread, and it uploads 32 MB per frame at that count.

Option A gives up forces that depend on a particle's own state, such as collisions with meshes and attraction between particles. Turbulence becomes a displacement along the particle's way, which reads as the same swirls. The ground plane is exact: the shader finds each impact time with Newton's method, and bounces twice.

### How a system reaches the frame

A system is a scene object with a material of the particle shading. It culls, takes layers and sorts among the blended objects as one object, by its bounding sphere. The sorted layout gives it a bucket of its own. Both frame builders record its draw: six vertices for each record, from the system's own vertex buffer, with the record as instance data. On WebGL2 the vertex arrays take a divisor for an instance-step layout, and integer attributes.

### Soft particles

| Option | Verdict |
| --- | --- |
| A: a copy of the opaque depth into a 32-bit float target after the opaque pass, as the transmission copy does | Chosen |
| B: bind the depth target read-only in the transparent pass | Rejected: blended surfaces write depth in the engine, as in three.js, so the pass cannot hold the depth read-only |
| C: read ambient occlusion's half-size depth | Rejected for now: it exists only while ambient occlusion is on, and only with the depth prepass |

The copy splits the camera's opaque and transparent passes into two render passes, as transmission does, and runs only while a system with `softness` draws.

### Quality

- The `softParticles` quality setting is off on Low and on above it. Phones keep one render pass for the camera, and draw particles with hard edges where they cut into the scene. The governor does not turn it off during play: a pass split that comes and goes would make the frame's cost jump.
- Each system's cost is its capacity's vertex work and its particles' pixels. The add-on does not scale emission by preset. A sketch scales `system.rate` with `quality.preset`, as the [quality presets](../../docs/concepts/quality-presets.md) page shows for its own particle counts.
- A scene without particles pays nothing: no pass, target, pipeline, bind group or download.

## Data

Route benchmark: MacBook Pro M5 Max, Chrome, headless, in a quiet window (1-minute load 3.2 to 3.4). The target is 1280 x 720, with additive quads of 0.03 m. Each figure is the median time of one iteration, a clear and a draw, with the GPU's work:

| Particles | A: closed form, WebGPU | B: compute and draw, WebGPU | A: closed form, WebGL2 | B: transform feedback and draw, WebGL2 | C: CPU, one thread, with upload |
| --- | --- | --- | --- | --- | --- |
| 10,000 | 0.23 ms | 0.09 ms | 0.23 ms | 0.20 ms | 1.4 ms |
| 100,000 | 0.38 ms | 0.35 ms | 0.47 ms | 0.37 ms | 10.9 ms |
| 1,000,000 | 3.59 ms | 3.99 ms | 4.72 ms | 4.06 ms | 96.3 ms |

An empty pass took 0.08 ms on WebGPU and 0.03 ms on WebGL2. The closed form costs about what a simulation pass and its draw cost together. At a million particles it is within 10% on WebGPU. On WebGL2 it costs 16% more, where the transform feedback route draws a simpler vertex shader. It needs no simulation pass, no second state buffer and no readback, on every path. The CPU route is 20 to 30 times slower.

Two faults make such a page measure nothing. A compute route that binds its records as writable storage in the draw's render pass fails, because WebGPU refuses it. A WebGL2 page that reads a float target back as bytes never waits for the GPU. The page has neither fault.

How the data was produced: a scratch page draws each route with raw WebGPU and WebGL2, served with the isolation headers. Playwright runs it in headless Chrome: 3 warm-up rounds, then 12 rounds of 8 iterations, and the median of the rounds.

**Allocation.** `bun run bench:allocation --particles` on the Mac's GPU, S1 with two systems that emit 5,500 particles per second, one of them soft. The add-on keeps each particle's numbers in typed arrays and fields, and the buffer's `write` takes a typed array. Passed as arguments to calls that the engine does not inline, every number boxes: 3,671 bytes per frame on the sketch's thread. The thread allocates 345 bytes per frame on WebGPU and 342 on WebGL2, the same as S1 without particles within a few bytes, apart from the sample's own loop. The culling sphere changes only when the births outgrow it or shrink well inside it, as a call that sets it boxes its radius. The soft system's depth copy adds one render pass, whose encoder takes 64 bytes on WebGPU, as each of bloom's passes does.

**Cost per preset.** `bun run bench:run` on S1, with and without the `particles` switch, on the Mac's GPU in a quiet window (1-minute load 3.1 to 6.4). The switch adds about 12,500 live particles in two systems, one of them soft. Each figure is the median of 3 runs of 10 seconds:

| Preset | Page | CPU ms, without | CPU ms, with | GPU ms, without | GPU ms, with |
| --- | --- | --- | --- | --- | --- |
| High | WebGPU | 1.69 | 1.71 | 2.92 | 3.67 |
| High | WebGL2 | 2.05 | 1.97 | 4.52 | 4.27 |
| Low | WebGPU | 1.69 | 1.71 | 3.00 | 3.42 |
| Low | WebGL2 | 1.94 | 1.87 | 4.27 | 4.83 |

The CPU time does not change beyond the runs' spread (1.63 to 2.05 ms). On WebGPU the particles cost 0.75 ms of GPU time at High, with the soft system's depth copy, and 0.42 ms at Low, without it. The WebGL2 GPU figures move by 0.3 to 0.6 ms between runs, more than the particles' cost, so they show no clear cost. Without particles, nothing changes: `bun run bench:gpu-check` found S4 and S6 within 2% of main at Medium and High.

## Decision

Option A for the motion, the soft particles' depth copy for soft particles, and one sorted object per system.

## Consequences

- The engine: `scene.createParticleBuffer` (first use) and the `ParticleBuffer` class. The particle templates (53 to 56) and bind layouts (32, 33 and 35). The depth copy pass in the render graph, and the shader manifest's `particles` set.
- The add-on `@null3d/particles`: `createParticles(ctx, options)` and `system.update()`, which reads the frame's step from the sketch's clock, as the camera controls read `ctx`. Emitters, bursts, sub-emitters, the follow mode for trails, culling bounds, and textures made in code.
- Docs: `api/particles`, the three.js mapping's particles entry, and the develop skill's quick reference and recipe.
- Limits: a system does not sort its own particles, cast shadows or take light. Views other than the camera's draw particles without the soft fade.

## Shared template data

The particle record layout adds data to the shared GPU modules of the page, sketch worker and render worker. Built-in template tables read this layout when a GPU path starts. Particle shader text and the particle add-on still load on first use.

It adds 70 bytes after Brotli to the page module, which takes 3,476 bytes in place of 3,406, and the same cause grows the two worker modules. Loading every built-in template definition on first use would need an engine change of its own.

## Long runs

- **The rebase.** Birth times are 32-bit floats, so every 1,024 seconds a system moves the time that its buffer's time counts from. Rewriting every record up to the capacity in one frame would cost a rain system of 1,000,000 particles about 1,000,000 reads and writes and a 32 MB upload in one frame, every 17 minutes.
- **Rewriting only the live records does not work.** A record that the move skips keeps its old birth time, so its age falls by the shift. A particle that died less than one lifetime before the move then comes back to life. A system at its default capacity also has about 90% of its records live, so the saving would be small.
- **The rebase over many frames.** The two spare frame values carry the rebase: the first record whose birth time still counts from the old base, and the shift in seconds. The particle vertex shader takes the shift off the birth times of the records from that one up (`@builtin(instance_index)`, the record's index, since a system draws from its first record). The emitter rewrites 16,384 records per frame, and writes a new birth in a record that the rewrite has not reached with the old base's time. A million records move in 62 frames, about 512 KB of upload each. The unit test `long runs` in `packages/particles/src/system.test.ts` checks every particle's age, as the GPU works it out, in every frame of a move.
- **The event table.** A system with sub-emitters keeps a table of pending events, 80 bytes per event. It starts at 64 events and doubles when it fills, up to one event per sub-emitter for each record. Reserved at that limit at creation, it would take 80 MB for a capacity of 1,000,000. It grows while the system warms up, so `update` allocates only then.
- **A destroyed buffer drops its views.** `ParticleBuffer.destroy` drops the buffer's views. Views that it only marked stale would stay, because `dropViews` skips a destroyed buffer. A sketch that held a destroyed buffer would then keep a view of the engine's memory past a growth, against hard rule 20. `packages/engine/src/scene/particles.test.ts` checks both the growth and the destroy.
- **One cell offset per system.** The render worker computes the offset of the system's own cell (`CellTable::offset`), not the offset of every cell in use from each view's camera.
