// A compute pass that keeps its state between runs, and reads of its texels: the pass adds one to
// the state of the run before, so the state counts the runs. The sketch asks for a region back
// through `render.readPass` and reports the value and the frames that the read took, per case:
//
// - steps: 100 runs in one frame, then a read. The value is 100.
// - forty-row: 40 runs in one frame, then a read.
// - forty-passes: one run a frame for 40 frames, then a read. The same value as forty-row.
// - layers: a pass of three layers writes its layer's number into each, and a read of each layer
//   gives what it wrote.
// - rows: a 4 by 4 pass writes its row and column into each texel, counted from 1, and a read of
//   the image's top half gives those rows from the top. The reads skip the image's bottom two
//   rows, so a region copied from the wrong end of the texture shows. The values sit at a quarter
//   of full scale, so an 8-bit path keeps them apart.
// - map: a pass of two layers copies a map of two layers, whose texels name the layer and place
//   they came from, so a map bound at the wrong layer or scale shows in the read.
// - stopped: five runs, then the pass switches off, and a read keeps the last state.
// - reset: the state starts again from zero, and a run then reads one.
// - loss: two runs read two, the page loses the GPU, and one run then reads one.
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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    // The view holds the state that this run writes, so its layer is the state's own layer. The
    // green and blue channels name the texel, so a read that takes the wrong row or column shows.
    let prev = textureLoad(history, vec2i(id.xy), id.z, 0).r;
    textureStore(output, vec2i(id.xy), id.z, vec4f(prev + 1.0, f32(id.x), f32(id.y), 1.0));
}
`;

const FALLBACK = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    // The state of the run before arrives as the input image. The green and blue channels name the
    // texel, as the compute shader's do. A pass's texture holds its image's bottom row first and
    // input.uv counts from the image's top, so the row turns to name the same texel.
    let cell = floor(vec2f(input.uv.x, 1.0 - input.uv.y) * input.size);
    return vec4f(input.color.r + 1.0, cell.x, cell.y, 1.0);
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
    s.metalness = 0.0;
    return s;
}
`;

/** A pass whose red channel names its image row and whose green names its column, from 1. */
const ROWS = /* wgsl */ `
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

@compute @workgroup_size(4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= 4u || id.y >= 4u) { return; }
    textureStore(output, vec2i(id.xy), 0, vec4f(f32(id.y + 1u), f32(id.x + 1u), 0.0, 4.0) * 0.25);
}
`;

/** The fragment form of the row pass: the image's own row and column, from 1. */
const ROWS_FRAGMENTS = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    // The pass's texture holds its image's bottom row first and input.uv counts from the image's
    // top row, so the texel's row turns to name the same row that the compute form names.
    let cell = floor(vec2f(input.uv.x, 1.0 - input.uv.y) * input.size);
    return vec4f(cell.y + 1.0, cell.x + 1.0, 0.0, 4.0) * 0.25;
}
`;

/** The pass image on a plane, sampled at the place that the docs give for a pass's texture. */
const ROWS_SURFACE = /* wgsl */ `
var field: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // A pass's texture holds its image's bottom row first, so a material reads its top row at the
    // top of the plane by sampling the row turned.
    let image = textureSampleLevel(field, fieldSampler, vec2f(input.uv.x, 1.0 - input.uv.y), 0.0);
    s.baseColor = vec3f(0.0);
    s.emissive = image.rgb;
    s.roughness = 1.0;
    s.metalness = 0.0;
    return s;
}
`;

/** The fragment form of the layered pass: its layer's number, which the engine gives it. */
const LAYERS_FRAGMENTS = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    return vec4f(f32(input.layer + 1u), 0.0, 0.0, 1.0);
}
`;

/** A pass of two layers that copies its map, which holds the values that the copy must keep. */
const MAP = /* wgsl */ `
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
@group(1) @binding(0) var source: texture_2d_array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    textureStore(output, vec2i(id.xy), id.z, textureLoad(source, vec2i(id.xy), id.z, 0));
}
`;

/** The fragment form of the copy: the map's texel at the layer that the pass writes. */
const MAP_FRAGMENTS = /* wgsl */ `
var source: texture_2d_array<f32>;

fn effect(input: EffectInput) -> vec4f {
    let cell = vec2i(floor(vec2f(input.uv.x, 1.0 - input.uv.y) * input.size));
    return textureLoad(source, cell, input.layer, 0);
}
`;

/// The texels of the copy's map, in rows from its first: each texel names its layer and place.
const MAP_SIDE = 8;
const MAP_TEXELS = new Float32Array(MAP_SIDE * MAP_SIDE * 4 * 2);
for (let layer = 0; layer < 2; layer++)
	for (let y = 0; y < MAP_SIDE; y++)
		for (let x = 0; x < MAP_SIDE; x++) {
			const at = ((layer * MAP_SIDE + y) * MAP_SIDE + x) * 4;
			MAP_TEXELS[at] = 0.002;
			MAP_TEXELS[at + 1] = 0.0001 * x;
			MAP_TEXELS[at + 2] = layer + 1;
			MAP_TEXELS[at + 3] = 0;
		}

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
	scene.setBackground('#000000');
	const layered = CASE === 'layers';
	const shownRows = CASE === 'rows-shown';
	const rows = CASE === 'rows' || shownRows;
	const mapped = CASE === 'map';
	const fullscreenKept = CASE === 'fs-kept';
	const cadenceKept = CASE === 'cadence-kept';
	const kept = CASE === 'kept' || fullscreenKept || cadenceKept;
	if (kept || shownRows) {
		scene.setActiveCamera(
			scene.createOrthographicCamera({ height: 1, position: [0, 0, 2], target: [0, 0, 0] }),
		);
	} else {
		scene.setActiveCamera(
			scene.createPerspectiveCamera({ position: [0, 0, 4], target: [0, 0, 0] }),
		);
	}

	const copyMap = mapped
		? textures.fromData({
				width: MAP_SIDE,
				height: MAP_SIDE,
				depth: 2,
				format: 'rgba16float',
				data: MAP_TEXELS,
				filter: 'nearest',
				colorSpace: 'linear',
			})
		: undefined;
	const field = fullscreenKept
		? render.addPass({
				kind: 'fullscreen',
				wgsl: CONSTANT_FRAGMENTS,
				writes: 'counter',
				size: [64, 64],
			})
		: render.addPass({
				kind: 'compute',
				description: defineFeature({
					name: 'field',
					frame: 'background',
					kind: 'compute',
					outputs: { counter: { default: 'black' } },
				}),
				wgsl: mapped ? MAP : kept ? CONSTANT : rows ? ROWS : layered ? LAYERS : COMPUTE,
				fallback: {
					wgsl: mapped
						? MAP_FRAGMENTS
						: kept
							? CONSTANT_FRAGMENTS
							: rows
								? ROWS_FRAGMENTS
								: layered
									? LAYERS_FRAGMENTS
									: FALLBACK,
				},
				format: 'rgba16float',
				size: CASE === 'cost' ? [256, 256] : kept ? [64, 64] : [4, 4],
				history: !kept && !layered && !rows && !mapped,
				layers: mapped ? 2 : layered ? 3 : 1,
				textures: mapped ? [copyMap] : undefined,
				// The cadence case draws in one frame of two from its first frame on.
				every: cadenceKept ? 2 : undefined,
				// Every case starts without a run, and the sequence below asks for the runs that it counts.
				steps: cadenceKept ? 1 : 0,
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
	} else if (shownRows) {
		// The pass image fills the view, sampled the way the docs say a pass's texture is read:
		// a material shows the image upright, so the top of the screen holds its first row.
		const material = materials.shader({
			wgsl: ROWS_SURFACE,
			textures: { field: shown },
		});
		scene.createMesh({
			mesh: geometry.plane({ width: 1, height: 1 }),
			material,
			position: [0, 0, 0],
		});
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

	if (kept || shownRows) {
		if (kept) {
			// The page captures the frame while the pass runs, stops it, and captures again: the image
			// and its coverage must stay.
			page.onMessage((type) => {
				if (type !== 'stop') return;
				// The cadence case leaves the pass switched on and pushes its turn far away, so the
				// frames that follow skip it while a material still samples its target.
				if (cadenceKept) render.setPassEvery(field, 64);
				else render.setPassEnabled(field, false);
				page.post('stopped');
			});
		}
		// The page reads the drawn frame once the pass has run, so it waits for the sketch to say
		// that a few frames have drawn it.
		void (async () => {
			await wait(3);
			page.post('running');
		})();
		return { onUpdate: wake };
	}

	let readFrames = 0;
	let callMs: number | undefined;
	let texels: number[] | undefined;
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

	// The page answers 'lost' once the engine has a new device after it asks for the loss.
	let lost = (): void => {};
	const lostPromise = new Promise<void>((resolve) => {
		lost = resolve;
	});
	page.onMessage((type) => {
		if (type === 'lost') lost();
	});

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
			// A region of the field, which varies by texel, so a wrong row, column or flip shows.
			const region = await render.readPass(field, { x: 1, y: 1, width: 2, height: 2 });
			values[0] = region.data[0] as number;
			texels = [...region.data];
			readFrames = region.frames;
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
		} else if (CASE === 'rows') {
			await wait(1);
			// The image's top two rows, then its bottom two: a copy from the wrong end of the
			// texture fetches other rows, and a turned region puts them in the other read.
			const top = await render.readPass(field, { x: 0, y: 0, width: 2, height: 2 });
			const bottom = await render.readPass(field, { x: 0, y: 2, width: 2, height: 2 });
			values[0] = top.data[0] as number;
			texels = [...top.data, ...bottom.data];
			readFrames = top.frames;
		} else if (CASE === 'layers') {
			await wait(1);
			for (let layer = 0; layer < 3; layer++) values[layer] = await read(layer);
		} else if (CASE === 'map') {
			// The map's texels upload in the first frames, so the copy waits for them.
			await wait(5);
			for (let layer = 0; layer < 2; layer++) values[layer] = await read(layer);
			// One texel of each layer, whose red and green name its place and whose blue names the
			// layer: a single texel takes no row order, so a map that gives the wrong layer or place
			// shows on every path.
			const corners: [number, number, number][] = [
				[1, 1, 0],
				[1, 1, 1],
				[2, 1, 1],
			];
			texels = [];
			for (const [x, y, layer] of corners) {
				const texel = await render.readPass(field, { x, y, width: 1, height: 1, layer });
				texels.push(...texel.data);
			}
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
		} else if (CASE === 'loss') {
			render.setPassSteps(field, 1);
			await wait(2);
			render.setPassSteps(field, 0);
			values[0] = await read();
			// A lost device makes every texture again, so the pass starts again from an empty state.
			page.post('lose');
			await lostPromise;
			await wait(12);
			render.setPassSteps(field, 1);
			await wait(1);
			render.setPassSteps(field, 0);
			values[1] = await read();
		} else if (CASE === 'cost') {
			// The page measures the running pass with the engine's frame probe, then the same scene
			// with the pass switched off, so the pass's own cost shows.
			render.setPassSteps(field, 40);
			page.onMessage((type) => {
				if (type !== 'baseline') return;
				render.setPassEnabled(field, false);
				page.post('measuring-off', { format: shown.format });
			});
			await wait(10);
			page.post('measuring', { format: shown.format });
			return;
		} else if (CASE === 'cadence') {
			// The pass draws in one frame of two for eight frames, then in every frame for four,
			// so the value counts what the cadence drew rather than the frames that went by.
			render.setPassSteps(field, 1);
			render.setPassEvery(field, 2);
			await wait(8);
			render.setPassSteps(field, 0);
			values[0] = await read();
			render.setPassEvery(field, 1);
			render.setPassSteps(field, 1);
			await wait(4);
			render.setPassSteps(field, 0);
			values[1] = await read();
		} else if (CASE === 'refuse') {
			render.setPassSteps(field, 1);
			await wait(1);
			// A 4 by 4 pass: x 3 with width 2 reaches past its right edge.
			let refused = 0;
			try {
				await render.readPass(field, { x: 3, y: 3, width: 2, height: 2 });
			} catch (error) {
				refused = (error as { code?: string }).code === 'E1220' ? 1 : 0;
			}
			values[0] = refused;
		} else if (CASE === 'slow') {
			render.setPassSteps(field, 1);
			await wait(1);
			render.setPassSteps(field, 0);
			const started = performance.now();
			const reading = render.readPass(field, { x: 0, y: 0, width: 1, height: 1 });
			// The call returned before the stall: the answer comes from the frame loop, not the call.
			callMs = performance.now() - started;
			const until = performance.now() + 150;
			for (let spin = 0; performance.now() < until; spin++) {
				if (spin < 0) break;
			}
			const result = await reading;
			values[0] = result.data[0] as number;
			readFrames = result.frames;
		}
		page.post('state', { case: CASE, values, frames: readFrames, callMs, texels });
	})();

	return { onUpdate: wake };
});
