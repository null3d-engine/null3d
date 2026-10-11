# D-131: Particles in closed form on the GPU

Status: decided by the helper of M2-EX20 on 11 October 2026, for the owner's review. Date: 2026-10-11. Task: M2-EX20.

Summary: The `@null3d/particles` add-on makes particle systems whose particles the GPU works out in closed form, from each particle's birth and age: gravity, drag toward the wind, simplex-noise turbulence, a ground that bounces, stops or ends them, and curves of color, alpha and size over life. The CPU writes a 32-byte record once per birth, and no pass simulates particles, so the same shaders run on WebGPU, compatibility mode and WebGL2. Soft particles read a copy of the camera's opaque depth, which the frame makes only while a soft system draws. Nothing downloads or runs until a sketch makes its first system.

## Question

The owner's ruling of 11 October 2026 ([D-117](D-117-showcase-features-before-1-0.md), D-132) asks for very beautiful showcase scenes: Creek, Battle and Night town need sparks, smoke, leaves, fireflies and magic. How do particles move, where does their state live, and how do they reach the screen on all three GPU paths? What does a scene without particles pay?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)): the look of three.quarks and Unity's particle systems, at a frame cost that a phone can pay.
- Both backends are first-class (design principle 9): one look on WebGPU, compatibility mode and WebGL2, with image references on the Mac's GPU and on SwiftShader.
- Pay only for what you use (design principle 8): no pass, target, bind group or download without a particle system, and no depth copy without a soft one.
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

A system is a scene object with a material of the particle shading. It culls, takes layers and sorts among the blended objects as one object, by its bounding sphere. The sorted layout gives it a bucket of its own. Both frame builders record its draw: six vertices for each record, from the system's own vertex buffer, with the record as instance data. The engine had no instance-step vertex buffers on WebGL2: its vertex arrays now take a divisor for an instance-step layout and integer attributes.

### Soft particles

| Option | Verdict |
| --- | --- |
| A: a copy of the opaque depth into a 32-bit float target after the opaque pass, as the transmission copy does | Chosen |
| B: bind the depth target read-only in the transparent pass | Rejected: blended surfaces write depth in the engine, as in three.js, so the pass cannot hold the depth read-only |
| C: read ambient occlusion's half-size depth | Rejected for now: it exists only while ambient occlusion is on, and only with the depth prepass |

The copy splits the camera's opaque and transparent passes into two render passes, as transmission does, and runs only while a system with `softness` draws.

## Data

Route benchmark, 11 October 2026, MacBook Pro M5 Max, Chrome, headless, quiet window (1-minute load 3.2 to 3.4), 1280 x 720, additive quads of 0.03 m. Each figure is the median time of one iteration, a clear and a draw, with the GPU's work:

| Particles | A: closed form, WebGPU | B: compute and draw, WebGPU | A: closed form, WebGL2 | B: transform feedback and draw, WebGL2 | C: CPU, one thread, with upload |
| --- | --- | --- | --- | --- | --- |
| 10,000 | 0.23 ms | 0.09 ms | 0.23 ms | 0.20 ms | 1.4 ms |
| 100,000 | 0.38 ms | 0.35 ms | 0.47 ms | 0.37 ms | 10.9 ms |
| 1,000,000 | 3.59 ms | 3.99 ms | 4.72 ms | 4.06 ms | 96.3 ms |

An empty pass took 0.08 ms on WebGPU and 0.03 ms on WebGL2. The closed form costs about what a simulation pass and its draw cost together: within 10% on WebGPU at a million particles, and 16% more on WebGL2, where the transform feedback route draws a simpler vertex shader. It needs no simulation pass, no second state buffer and no readback, on every path. The CPU route is 20 to 30 times slower.

The first runs of B and of the WebGL2 rows measured nothing real. The compute route bound its records as writable storage in the draw's render pass, which WebGPU rejected, and the WebGL2 page read a float target back as bytes, so it never waited for the GPU. Both bugs were fixed before these figures.

How the data was produced: a scratch page that draws each route with raw WebGPU and WebGL2, served with the isolation headers and run in headless Chrome through Playwright, 12 rounds of 8 iterations after 3 warm-up rounds, medians of the rounds.

## Decision

Option A for the motion, the soft particles' depth copy for soft particles, and one sorted object per system.

## Consequences

- The engine: `scene.createParticleBuffer` (first use) and the `ParticleBuffer` class, the particle templates (53 to 56) and bind layouts (32, 33 and 35), the depth copy pass in the render graph, and the shader manifest's `particles` set.
- The add-on `@null3d/particles`: emitters, bursts, sub-emitters, the follow mode for trails, culling bounds, and textures made in code.
- Docs: `api/particles`, the three.js mapping's particles entry, and the develop skill's quick reference and recipe.
- Limits: a system does not sort its own particles, cast shadows or take light. Views other than the camera's draw particles without the soft fade.
