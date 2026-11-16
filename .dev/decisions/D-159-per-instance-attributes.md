# D-159: Per-row values and the instance index close custom per-instance attributes

Status: decided by the helper of M2-K2, for the owner's review. Built: custom per-instance attributes are on main (`0480c50fd`). The owner's review is pending. Task: M2-K2.

Summary: M2-K2 closes with no engine change: `object.values` gives custom materials four numbers a row on all GPU paths, and `input.instance` the row's place. D-127 rejected a named map of any size and type for a stated reason. K2 reopens only for a scene or port that needs more than four numbers a row, or a type that floats cannot hold.

## Question

Should M2-K2 build named per-instance attributes of any size and type? Or do the per-row values and the instance index already answer the need that the task was written for?

## Rule

A task closes when its outcome is already shipped and documented, and when every scene and port that needs it works. It also closes when the form it named was rejected with a recorded reason. A note in the plan asks the review to narrow K2 to what row values do not cover, or to close it.

## Data

| K2 asked for | What exists | Where |
| --- | --- | --- |
| Named per-instance attributes, any size and type | Four floats per row, read as `object.values` (a `vec4f`) in `vertexOffset` and `surface` functions | D-127, `#481` |
| A typed array per attribute | `batch.values`, one `Float32Array`, four floats per row | [Instances and batching](../../docs/concepts/instances.md#per-row-values) |
| An integer or typed attribute | Pack it into a float, or read the row's place as `input.instance` | D-138, `#505` |
| All three GPU tiers | Row values draw on WebGPU, WebGPU compatibility mode and WebGL2 | D-127 (image tests `row-values` and `row-values-later`) |
| The mapping entry `InstancedBufferGeometry / InstancedBufferAttribute` | Maps to `values` and `input.instance`, status `changed`, since 0.2 | [Three.js mapping](../../docs/porting/threejs-mapping.md) |

The per-row values followed hard rule 7. They reach the vertex shader through a data texture, two texels per row, never a storage buffer. So compatibility mode draws them too. The instance index and the batch id come from a uniform table of object ranges, which the vertex shader searches (D-138).

Every scene that needs per-row data works. Battle, the one port with a real `InstancedBufferAttribute`, holds a single float of grass phase. Its null3D side works the phase out from `object.position.xz`, and the twin's shader matches it. No scene or port uses more than four numbers for one row.

## Decision

Close M2-K2. The four per-row values of D-127 give a sketch four numbers of its own for each row. The instance index of D-138 gives the row's place and its batch. Together they cover what three.js's `InstancedBufferAttribute` gives an author, as the three.js mapping already says. D-127 rejected a named map of any size and type. Each name needs a size and a WGSL declaration, which the shader compiler would have to type. Four floats cover a phase, an age, a tint and a size.

K2 reopens when a real scene or a three.js port needs more than four numbers for one row. It also reopens for an integer or typed attribute that packing into floats cannot serve. The owner rules on the reopening, and a new record settles the form.

## Consequences

- The plan marks M2-K2 closed. No engine code, public API, docs page or skill changes. `values`, `input.instance` and `object.id` are already shipped and documented.
- Docs: none. [Instances and batching](../../docs/concepts/instances.md#per-row-values) and [Built-in shader inputs](../../docs/shaders/builtins.md#object) already describe the four values, the row's place and the batch id. The three.js mapping already maps instanced attributes to them.
- Skills: none. The develop and port skills already name `object.values` and `input.instance` for per-instance data.
