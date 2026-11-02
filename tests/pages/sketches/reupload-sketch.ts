// A reproduction scene for a WebGL2 fault: a pass whose fragment form runs beside a scene that
// draws itself a second time for a reflection. A model with compressed textures fills the scene, so
// the frame's texture uploads show whether the scene's own maps upload again. `?pass=0` leaves the
// pass out, `?reflect=0` leaves the reflection out, and `?model=0` leaves the model out, so each
// part's share of the uploads shows. `?every=` sets the reflection's cadence: a view that rests
// between its turns left the render plan on the WebGL2 path, which is the fault. `?recompile=1`
// changes the render scale every frame, which makes the plan compile and its targets again, and
// shows that a plan change alone uploads no texture.
import { defineFeature, defineSketch } from '@null3d/engine';
import { sampleUrl } from '../../../examples/lib/samples';

const params = new URL(import.meta.url).searchParams;
const WITH_PASS = params.get('pass') !== '0';
const WITH_REFLECTION = params.get('reflect') !== '0';
const WITH_MODEL = params.get('model') !== '0';
/** The reflection's cadence: a view that draws in one frame of `every` rests in the others. */
const EVERY = Number(params.get('every') ?? 1);
/** True changes the render scale every frame, so the render plan compiles and makes its targets again. */
const RECOMPILE = params.get('recompile') === '1';

// A pass that counts its runs in the first channel, one texel a run of the state before.
const COMPUTE = /* wgsl */ `
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
@group(0) @binding(1) var output: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var history: texture_2d_array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let prev = textureLoad(history, vec2i(id.xy), id.z, 0).r;
    textureStore(output, vec2i(id.xy), id.z, vec4f(prev + 1.0, 0.0, 0.0, 1.0));
}
`;

const FALLBACK = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    return vec4f(input.color.r + 1.0, 0.0, 0.0, 1.0);
}
`;

// The floor's surface: the reflection pass's picture, as the showcase scenes read it.
const MIRROR = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var mirror: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, uv, 0.0).rgb, 0.9);
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render } = ctx;
	// The governor lowers the render scale while frames take long, and each change compiles the
	// plan again, so a page that counts the plan's turns keeps it off.
	if (params.get('governor') === 'off') await ctx.quality.set({ governor: false });
	scene.setBackground('#20242a');
	scene.setFog({ color: '#20242a', density: 0.02 });
	const room = await assets.builtinEnvironment('room');
	scene.setEnvironment(room);
	scene.createDirectionalLight({
		direction: [0.4, -1, 0.3],
		color: '#fff2e0',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 30 },
	});
	const flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
	scene.createMesh({
		mesh: geometry.circle({ radius: 30, segments: 48 }),
		material: materials.standard({ color: '#3a3f46', roughness: 0.8 }),
		rotation: flat,
		receiveShadows: true,
	});
	if (WITH_REFLECTION) {
		const reflection = render.addPass({
			kind: 'reflection',
			writes: 'mirror',
			plane: { point: [0, 0.01, 0] },
			every: EVERY,
		});
		scene.createMesh({
			mesh: geometry.circle({ radius: 12, segments: 48 }),
			material: materials.shader({
				wgsl: MIRROR,
				color: '#0c0d10',
				roughness: 0.1,
				metalness: 0.5,
				textures: { mirror: textures.fromPass(reflection) },
			}),
			position: [0, 0.02, 0],
			rotation: flat,
		});
	}
	if (WITH_PASS) {
		const pass = render.addPass({
			kind: 'compute',
			description: defineFeature({
				name: 'reupload',
				frame: 'background',
				kind: 'compute',
				outputs: { state: { default: 'black' } },
			}),
			wgsl: COMPUTE,
			fallback: { wgsl: FALLBACK },
			format: 'rgba16float',
			size: [64, 64],
			history: true,
			name: 'reupload',
		});
		const state = textures.fromPass(pass);
		scene.createMesh({
			mesh: geometry.plane({ width: 2, height: 2 }),
			material: materials.unlit({ map: state }),
			position: [0, 1.4, -4],
			rotation: [0, 0, 0, 1],
		});
	}
	if (WITH_MODEL) {
		const trees = await assets.loadGltf(sampleUrl('sources/showcase/creek/trees.glb'));
		scene.instantiate(trees, { position: [0, 0, 0], scale: [0.12, 0.12, 0.12] });
	}
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 200,
		position: [7, 5, 9],
		target: [0, 1.5, 0],
	});
	scene.setActiveCamera(camera);
	let frame = 0;
	return {
		onUpdate() {
			if (!RECOMPILE) return;
			frame++;
			const scale = frame % 2 === 0 ? 0.9 : 0.95;
			ctx.quality.set({ minRenderScale: scale, maxRenderScale: scale });
		},
	};
});
