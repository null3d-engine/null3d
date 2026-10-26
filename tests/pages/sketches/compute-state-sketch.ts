// A compute pass that keeps its state between runs, and reads of its texels: the pass adds one to
// the state of the run before, so the state counts the runs. The sketch asks for a region back
// through `render.readPass` and reports the value and the frames that the read took, per case:
//
// - steps: 100 runs in one frame, then a read. The value is 100.
// - forty-row: 40 runs in one frame, then a read.
// - forty-passes: one run a frame for 40 frames, then a read. The same value as forty-row.
// - layers: a pass of three layers writes its layer's number into each, and a read of each layer
//   gives what it wrote.
// - stopped: five runs, then the pass switches off, and a read keeps the last state.
// - reset: the state starts again from zero, and a run then reads one.
import { defineFeature, defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const CASE = params.get('case') ?? 'steps';

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

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    // The view holds the state that this run writes, so its layer is the state's own layer.
    let prev = textureLoad(history, vec2i(id.xy), id.z).r;
    textureStore(output, vec2i(id.xy), id.z, vec4f(prev + 1.0, 0.0, 0.0, 1.0));
}
`;

const FALLBACK = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    // The state of the run before arrives as the input image.
    return vec4f(input.color.r + 1.0, 0.0, 0.0, 1.0);
}
`;

const CONSTANT = /* wgsl */ `
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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 64u || id.y >= 64u) { return; }
    // A white texel with no coverage: a material that shows the image reads white, and one that
    // reads the alpha reads zero.
    textureStore(output, vec2i(id.xy), 0, vec4f(1.0, 1.0, 1.0, 0.0));
}
`;

const CONSTANT_FRAGMENTS = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    return vec4f(1.0, 1.0, 1.0, 0.0);
}
`;

/** The coverage of the pass's texel, as light, so a lost alpha shows as white. */
const ALPHA_SURFACE = /* wgsl */ `
var field: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let coverage = textureSampleLevel(field, fieldSampler, input.uv, 0.0).a;
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(coverage * 4.0);
    s.roughness = 1.0;
    s.metallic = 0.0;
    return s;
}
`;

const LAYERS = /* wgsl */ `
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

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    textureStore(output, vec2i(id.xy), id.z, vec4f(f32(id.z + 1u), 0.0, 0.0, 1.0));
}
`;

export default defineSketch(({ scene, geometry, materials, textures, render, page }) => {
	scene.setBackground({ color: '#000000' });
	const layered = CASE === 'layers';
	const kept = CASE === 'kept';
	if (kept) {
		scene.setActiveCamera(
			scene.createOrthographicCamera({ height: 1, position: [0, 0, 2], target: [0, 0, 0] }),
		);
	} else {
		scene.setActiveCamera(
			scene.createPerspectiveCamera({ position: [0, 0, 4], target: [0, 0, 0] }),
		);
	}

	const field = render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: 'field',
			frame: 'background',
			kind: 'compute',
			outputs: { counter: { default: 'black' } },
		}),
		wgsl: kept ? CONSTANT : layered ? LAYERS : COMPUTE,
		fallback: layered ? undefined : { wgsl: kept ? CONSTANT_FRAGMENTS : FALLBACK },
		format: 'rgba16float',
		size: kept ? [64, 64] : [4, 4],
		history: !kept && !layered,
		layers: layered ? 3 : 1,
		// Every case starts without a run, and the sequence below asks for the runs that it counts.
		steps: 0,
	});
	const shown = textures.fromPass(field);
	if (kept) {
		// The left half shows the image, and the right half shows its coverage: a lost alpha shows
		// there as light.
		const image = materials.unlit({ map: shown });
		const coverage = materials.shader({
			wgsl: ALPHA_SURFACE,
			textures: { field: shown },
		});
		for (const [x, material] of [
			[-0.25, image],
			[0.25, coverage],
		] as const) {
			scene.createMesh({
				mesh: geometry.plane({ width: 0.5, height: 1 }),
				material,
				position: [x, 0, 0],
			});
		}
		scene.createDirectionalLight({ direction: [0, 0, -1], intensity: 1 });
	} else {
		const material = materials.unlit({ map: shown });
		scene.createMesh({
			mesh: geometry.plane({ width: 4, height: 4 }),
			material,
			position: [0, 0, 0],
		});
	}

	// A frame's update resolves the waiters, so the sequence below waits for frames that recorded the
	// pass, without a timer.
	const waiters: (() => void)[] = [];
	const nextFrame = (): Promise<void> =>
		new Promise((resolve) => {
			waiters.push(resolve);
		});
	const wait = async (frames: number): Promise<void> => {
		for (let k = 0; k < frames; k++) await nextFrame();
	};

	const wake = (): void => {
		for (let k = 0; k < waiters.length; k++) (waiters[k] as () => void)();
		waiters.length = 0;
	};

	if (kept) {
		// The page captures the frame while the pass runs, stops it, and captures again: the image and
		// its coverage must stay.
		page.onMessage((type) => {
			if (type !== 'stop') return;
			render.setPassEnabled(field, false);
			page.post('stopped');
		});
		void (async () => {
			await wait(3);
			page.post('running');
		})();
		return { onUpdate: wake };
	}

	let readFrames = 0;
	/**
	 * The texel at the top-left of `layer`, or of the state that the pass wrote last when `layer` is
	 * left out.
	 */
	const read = async (layer?: number): Promise<number> => {
		const region =
			layer === undefined
				? { x: 0, y: 0, width: 1, height: 1 }
				: { x: 0, y: 0, width: 1, height: 1, layer };
		const result = await render.readPass(field, region);
		page.post('read', {
			case: CASE,
			layer: layer ?? -1,
			value: result.data[0],
			frames: result.frames,
		});
		if (layer === undefined) readFrames = result.frames;
		return result.data[0] as number;
	};

	void (async () => {
		// The first update sets the case's runs before its frame records, so each wait below counts
		// the frames that the pass really ran in.
		await wait(1);
		const values: number[] = [];
		if (CASE === 'steps') {
			render.setPassSteps(field, 100);
			await wait(1);
			// The frame that counts the runs is recorded; later frames must not count more.
			render.setPassSteps(field, 0);
			values[0] = await read();
		} else if (CASE === 'forty-row') {
			render.setPassSteps(field, 40);
			await wait(1);
			render.setPassSteps(field, 0);
			values[0] = await read();
		} else if (CASE === 'forty-passes') {
			render.setPassSteps(field, 1);
			await wait(40);
			render.setPassSteps(field, 0);
			values[0] = await read();
		} else if (CASE === 'layers') {
			await wait(1);
			for (let layer = 0; layer < 3; layer++) values[layer] = await read(layer);
		} else if (CASE === 'stopped') {
			render.setPassSteps(field, 1);
			await wait(3);
			render.setPassEnabled(field, false);
			await wait(1);
			values[0] = await read();
		} else if (CASE === 'reset') {
			render.setPassSteps(field, 1);
			await wait(2);
			render.setPassSteps(field, 0);
			render.resetPass(field);
			await wait(2);
			values[0] = await read();
			render.setPassSteps(field, 1);
			await wait(1);
			render.setPassSteps(field, 0);
			values[1] = await read();
		}
		page.post('state', { case: CASE, values, frames: readFrames });
	})();

	return { onUpdate: wake };
});
