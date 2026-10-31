// A compute pass's output that a custom material's vertex offset reads, in every build that draws
// the material: the main view, the shadow caster, the motion pass and the pick. The pass writes the
// frame's value and the value of the frame before, and a vertex offset reads the row that
// `frame.lastFrame` names, so the motion pass's second call reads the frame before.
//
// The image test holds at the time the pass steps from its old value to its held one, so a pass
// that ran after the shadow pass would leave the box's shadow a metre behind it. ?case=motion
// draws the motion debug view of a plane that the pass moves at a steady speed. ?case=pick asks a
// live engine for the moved box and for the place where the box was authored: only a pick build
// that samples the pass's texture finds the box at its moved place.
import { defineFeature, defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const CASE = params.get('case');
/** The hold time, the step between hold mode's two frames, and the image case's held value. The
 * pass writes a share of the offset, under one, so an 8-bit path holds it too. */
const HOLD = 0.5;
const STEP = 1 / 60;
const HELD = 1 / 6;
/** The speed of the motion case, in meters a second, which the vertex offset applies. */
const SPEED = 6;
// The Vite plugin compiles tagged WGSL at build time, so the shaders hold these as literals.
if (HOLD !== 0.5 || SPEED !== 6) throw new Error('the shaders hold these as literals: update them');

const FIELD = /* wgsl */ `
struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var field: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(2, 2)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 2u || id.y >= 2u) { return; }
    // Row 0 holds this frame's value and row 1 the frame before's.
    let now = block.clock.x;
    let before = now - block.u0.x;
    let t = select(before, now, id.y == 0u);
    var value = t;
    if (block.u0.y > 0.5) { value = select(0.0, block.u0.w, t >= block.u0.z); }
    textureStore(field, vec2i(id.xy), 0, vec4f(value, 0.0, 0.0, 1.0));
}
`;

const FIELD_FRAGMENTS = /* wgsl */ `
struct Uniforms { step: f32, mode: f32, hold: f32, amount: f32 }

fn effect(input: EffectInput) -> vec4f {
    // The pass texture holds its first row at the bottom, and input.uv counts from the top left.
    let now = input.time;
    let before = now - uniforms.step;
    let t = select(before, now, input.uv.y >= 0.5);
    var value = t;
    if (uniforms.mode > 0.5) { value = select(0.0, uniforms.amount, t >= uniforms.hold); }
    return vec4f(value, 0.0, 0.0, 1.0);
}
`;

const OFFSET = /* wgsl */ `
var offsets: texture_2d<f32>;

fn vertexOffset(input: VertexInput) -> vec3f {
    let row = select(0, 1, frame.lastFrame);
    // Six meters a second, and the pass's texture holds the time in seconds.
    return vec3f(textureLoad(offsets, vec2i(0, row), 0).r * 6.0, 0.0, 0.0);
}
`;

export default defineSketch(
	({ scene, materials, geometry, textures, render, debug, page, time }) => {
		const field = render.addPass({
			kind: 'compute',
			description: defineFeature({
				name: 'offsetRows',
				frame: 'background',
				kind: 'compute',
				outputs: { offsetRows: { default: 'black' } },
			}),
			wgsl: FIELD,
			size: [2, 2],
			workgroupSize: [2, 2, 1],
			values: [STEP, CASE === 'motion' ? 0 : 1, HOLD, HELD],
			fallback: { wgsl: FIELD_FRAGMENTS },
		});
		const moving = materials.shader({
			wgsl: OFFSET,
			textures: { offsets: textures.fromPass(field) },
			color: '#d06a3a',
			doubleSided: true,
		});

		if (CASE === 'motion') {
			debug.view('motion');
			scene.setBackground('#202020');
			scene.setActiveCamera(
				scene.createOrthographicCamera({
					height: 9,
					near: 0.1,
					far: 50,
					position: [0, 0, 10],
					target: [0, 0, 0],
				}),
			);
			// A still wall behind, which shows the camera's motion as none.
			scene.createMesh({
				mesh: geometry.box({ width: 40, height: 20, depth: 0.1 }),
				material: materials.standard({ color: '#808080' }),
				position: [0, 0, -5],
			});
			scene.createMesh({ mesh: geometry.plane({ width: 2, height: 2 }), material: moving });
			return {};
		}

		scene.setBackground('#161b22');
		const camera = scene.createPerspectiveCamera({
			fov: 45,
			position: [0, 3.5, 8],
			target: [0, 1, 0],
		});
		scene.setActiveCamera(camera);
		scene.createDirectionalLight({ direction: [-1, -1, -0.2], intensity: 3, castShadows: true });
		scene.createAmbientLight({ intensity: 0.4 });
		scene.createMesh({
			mesh: geometry.box({ width: 24, height: 0.2, depth: 24 }),
			material: materials.standard({ color: '#8d949e' }),
			position: [0, -0.1, 0],
			receiveShadows: true,
		});
		const box = scene.createMesh({
			mesh: geometry.box({ width: 1.5, height: 2, depth: 1.5 }),
			material: moving,
			position: [0, 1, 0],
			castShadows: true,
		});
		if (CASE !== 'pick') return {};

		// The box moves one metre along x when the pass steps its value. A pick at the moved place must
		// find the box, and a pick at the place where the box was authored must not: a raycast tests the
		// mesh's own triangles, which stay where the box was authored.
		const screen = [0, 0, 0];
		let asked = false;
		return {
			onUpdate() {
				// The first frames build the picking pipelines, and the pass that moves the box needs a
				// frame of its own before a pick can read it.
				if (asked || time.now < HOLD + 0.1) return;
				asked = true;
				camera.worldToScreen([1, 1, 0], screen);
				const moved = scene.pick(screen[0] as number, screen[1] as number);
				camera.worldToScreen([0, 1, 0], screen);
				const authored = scene.pick(screen[0] as number, screen[1] as number);
				void Promise.all([moved, authored]).then(
					([atMoved, atAuthored]) => {
						const found = atMoved?.object === box;
						const stale = atAuthored?.object === box;
						page.post('picked', {
							case: 'pick',
							moved: found,
							authored: stale,
							...(found && !stale
								? {}
								: {
										error: `the pick found the box at its moved place: ${found}, at its authored place: ${stale}`,
									}),
						});
					},
					(error: unknown) => {
						page.post('picked', { case: 'pick', error: String(error) });
					},
				);
			},
		};
	},
);
