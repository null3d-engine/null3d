# D-139: Joint overrides and look-at

Status: decided by the helper of M2-EX24 on 11 October 2026, for the owner's review. The owner asked for the feature on 11 October 2026. Built: joint overrides are on main (`a150d94b4`). The owner's review of the design is pending. Date: 2026-10-11. Task: M2-EX24.

Summary: The animator gains `joint(name)`, `setJointRotation`, `addJointRotation`, `clearJoint` and `lookAt`. Game code sets or adds a joint's rotation with a weight, on top of the clips. It also turns a chain of up to 4 joints toward a point in the world, each within a limit. The job workers apply them in the frame step, after the clips blend and before the skinning matrices compose. The calls write engine memory, allocate nothing, and hold until cleared. The table that holds them exists only from the first call, so a scene without them pays nothing.

## Question

The engine animates joints in its core, and joints are not objects. Game code could not turn a joint. So Battle's soldiers turned their whole bodies to aim, and heads could not look at things. three.js code sets `bone.quaternion` after `mixer.update`, or calls `bone.lookAt`. How does a null3D sketch turn joints each frame, on top of the clips, in a crowd, at low cost?

## Rule

- Design principles 2, 4, 7 and 8 ([AGENTS.md](../../AGENTS.md#design-principles)): flat arrays, no allocation per frame, work where the data is, and no cost when unused.
- Hard rule 1: no allocation per frame in TypeScript hot paths or in Rust frame code.
- One clear way to do each task (principle 10), in the animator's style: per-frame numbers go into engine memory, as `setWeight`, `setLayerWeight` and `setBlend` write them.
- It works on all three GPU paths. Joint overrides change only the skinning matrices, which each path already uploads and skins.
- Intent parity ([D-52](D-52-intent-parity.md)): the result of a three.js port's bone rotations, and a look-at that is at least as good as `bone.lookAt`.

## Options

### Where the overrides apply

| Option | Verdict |
| --- | --- |
| A: in the core's frame step, per instance, between the blend and the compose, on the job workers | Chosen |
| B: the sketch reads the skinning matrices back and writes changed ones | Rejected. It runs on the sketch's thread, one character at a time, after the pose, and composes every joint below the turned one a second time |
| C: expose joints as scene objects, as three.js's bones are | Rejected. A crowd of 500 characters of 40 joints would cost 20,000 objects, the cost that the engine's skeletons avoid ([api/animation](../../docs/api/animation.md#models-from-gltf-files)) |

Option A turns the local pose, which the compose then turns into skinning matrices as before. Joints below a turned joint follow, and so do meshes that hang on joints. The pose-change check that skips skinning for still characters keeps working, since it compares the matrices.

### How game code reaches them

| Option | Verdict |
| --- | --- |
| A: a table in engine memory, one block of 81 floats per animated object: 8 rotation slots (joint, mode, weight, quaternion) and a look-at record (weight, chain, shares, limits, aim). TypeScript writes it directly | Chosen |
| B: a core call per override per frame | Rejected. Each call crosses into WebAssembly, and numbers passed to a call that the browser does not inline can each allocate ([implementation notes](../implementation-notes.md)) |
| C: a command in the scene's command ring | Rejected. Commands suit changes that happen now and then, and each one costs a record and a decode |

The first joint call makes the table (`enableJointOverrides`). A scene that never calls one has no table, and its frame step skips the work with one test per object. With the table, an object without overrides costs a scan of its 8 slot words and its look-at weight. Look-at targets sit in a table of 64-bit floats, 3 per object. So an aim keeps its precision far from the origin in large worlds.

Overrides hold until cleared, as `setWeight` does. three.js's bone writes last one frame. A sketch then writes nothing in frames where the aim does not change. A crowd that aims at one point costs only the target writes.

### The look-at

The chain has up to 4 joints, parents first, each below the one before. For each joint in turn, the step finds the last joint's place and aim. It then finds the turn from that aim to the target's direction. The joint takes its share of the turn that the joints before it left, up to its limit. It turns about the axis of the shortest turn. The last joint therefore finishes the aim, within its limit. Each step updates only the matrices of the joints between the skeleton's root and the chain's last joint. The compose then runs once, as without a look-at. Last, the weight blends each joint's rotation between the animated one and the turned one, by spherical interpolation.

By default, the aim is +Z in the object's space at bind time. The last joint's inverse bind matrix carries it into the joint's frame. A glTF model faces +Z, so a head aims where the model faced when it was bound, whatever its bone's own axes. A `forward` option names another direction, such as a gun along +X.

The target is a point in the world. The animation step runs before the transform update, so the object's world matrix from the frame before would aim one frame late. So the serial step before the parallel loop composes each aiming object's world matrix again (`next_world_matrix64`). It uses the current local transforms of the object and its ancestors, and carries the target into the object's space. A soldier that walks and turns then aims without a frame of lag. The browser test checks this with a soldier that circles and sways its heading every frame.

| Option for the solve | Verdict |
| --- | --- |
| A: shares of the remaining turn per joint, with limits, as above | Chosen. Exact for the last joint when the limits allow, closed form, a few matrix products per joint |
| B: an iterative solver such as CCD or FABRIK | Rejected for now. Those suit reaching with a hand, where positions matter. Aiming is about directions, and option A reaches the aim in one pass |
| C: `bone.lookAt` on one joint, as three.js has | Rejected. A head alone turns too far, and a spine alone cannot follow a target close by |

## Data

| Measure | Result | Device and browser |
| --- | --- | --- |
| Core unit tests: set, add, weights, bad slots, chains, limits, weight, a joint off the chain, slerp | 6 of 6 pass | Mac, native Rust |
| Core tests: overrides in a full frame step turn only their joints and those below; a look-at from an object moved and turned a quarter matches one at the origin within 1e-4, and aims within 1e-4 of the target; a removed object's overrides go with it | 2 of 2 pass | Mac, native Rust |

How the data was produced: `cargo test -p null3d-core --lib --test animation -- joint look slerp chain`, 11 October 2026.

## Decision

Option A in each part: rotation overrides and a chain look-at, which the job workers apply in the frame step. TypeScript writes them into a table that exists only from its first use.

## Consequences

- Core: `animation::joints` holds the block layout, the overrides and the look-at solve. `Animations` gains the lazy table, the look-at targets, the object of each instance, and `resolve_look_targets`. The scene gains `next_world_matrix64`.
- Glue: `createAnimatedInstance` takes the object's handle; `enableJointOverrides` makes the table; `animationArrays` returns its two arrays. The generated constants gain `JOINT_OVERRIDE_*`.
- TypeScript: the animator's joint calls and `LookAtOptions`.
- Docs: [api/animation](../../docs/api/animation.md#joint-overrides), and the three.js mapping's `bone-rotation` entry. Skills: the develop skill's quick reference and character recipe.
- Tests: the core tests above, the animator's unit tests, the browser test's soldier, and the `skinning-joints` image test on every GPU path. The core's allocation test and `bench:allocation --animated 64` now turn joints too.
- The demo `examples/look-at` shows knights that watch a wisp of light that the pointer leads.
- A weight passed as a call argument boxes when the browser does not inline the call. `bench:allocation --animated 64` first failed with 183 to 247 bytes per frame in the crowd's frame step, against a budget of 4. With inlining off (`--no-inline`), no engine function allocated: all of it was at the crowd's call sites. Its frame step was too large for the browser to inline the new calls. The crowd now makes the joint calls from a small step that takes only the animator and its index, and reads the time from an array. Inside the engine, the private helper that finds a slot takes no weight. `lookAt` keeps its options path in a helper of its own. So the public calls stay small enough to inline. A game with a large frame step meets the same limit. So the [animation docs](../../docs/api/animation.md#order-and-cost) show the small-step pattern. Changing the weight into an array was rejected. `setLayerWeight`, `setWeight` and `setPosition` take fractions as arguments too. And the default weight of 1 never boxes.
