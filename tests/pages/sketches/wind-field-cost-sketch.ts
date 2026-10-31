// The wind field's cost: the add-on's real solver, one history pass that runs a whole cycle, and a
// chain of the same work per step whose pressure count and grid shape can be swept. The page
// switches each part on and off and sets the chain's steps, so the field's cost per cycle, the
// fixed cost of a step and its cost per cell come apart.
//
// The chain reads four neighbours of one slice and, for a tile of several slices, the two
// neighbours above and below, so a layered or volume shape is one 2D texture that both GPU paths
// run the same way. Drag reads one more texel per cell, which stands in for the canopy grid.
import { defineFeature, defineSketch, type RenderPass, type SketchContext } from '@null3d/engine';
import gridFallback from '../../../packages/wind/src/grid.fallback.wgsl';
import gridShader from '../../../packages/wind/src/grid.wgsl';

const params = new URL(import.meta.url).searchParams;
/** The tile's width in texels, its height per slice, and the slices it stacks. */
const WIDTH = Number(params.get('w') ?? '128');
const SLICE = Number(params.get('slice') ?? '128');
const SLICES = Number(params.get('slices') ?? '1');
const HEIGHT = SLICE * SLICES;
/** True when the real solver measures this shape: it takes a square grid of one slice. */
const REAL = params.get('real') === '1';

/** The runs that one solver cycle takes: advection, the pressure's iterations, the projection. */
const CYCLE_STEPS = 22;

/** The chain's step shader: a damped Jacobi stencil over one slice's neighbours. */
const STEP = /* wgsl */ `
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
    let p = vec2i(id.xy);
    let last = vec2i(size) - 1;
    // The texels in one slice, the drag strength, and how many slices the tile stacks.
    let slice = i32(block.u0.x);
    let drag = block.u0.y;
    let slices = block.u0.z;
    let cur = textureLoad(history, p, id.z, 0);
    var sum = vec4f(0.0);
    sum += textureLoad(history, vec2i(clamp(p.x - 1, 0, last.x), p.y), id.z, 0);
    sum += textureLoad(history, vec2i(clamp(p.x + 1, 0, last.x), p.y), id.z, 0);
    sum += textureLoad(history, vec2i(p.x, clamp(p.y - 1, 0, last.y)), id.z, 0);
    sum += textureLoad(history, vec2i(p.x, clamp(p.y + 1, 0, last.y)), id.z, 0);
    if (slices > 1.0) {
        sum += textureLoad(history, vec2i(p.x, clamp(p.y - slice, 0, last.y)), id.z, 0);
        sum += textureLoad(history, vec2i(p.x, clamp(p.y + slice, 0, last.y)), id.z, 0);
    }
    var next = cur * 0.5 + sum * (1.0 / 12.0);
    if (drag > 0.0) {
        // One more texel, a slice's width across, as the canopy grid sits beside the field.
        let cover = textureLoad(history, vec2i(clamp(p.x + slice, 0, last.x), p.y), id.z, 0);
        next = next * (1.0 - 0.1 * drag * cover.r);
    }
    textureStore(output, p, id.z, next);
}
`;

/** The chain's WebGL2 form, which reads the previous state through `effectPixel`. */
const STEP_FALLBACK = /* wgsl */ `
struct Uniforms {
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
}

fn at(p: vec2i, last: vec2i) -> vec4f {
    return effectPixel(vec2i(clamp(p.x, 0, last.x), clamp(p.y, 0, last.y)));
}

fn effect(input: EffectInput) -> vec4f {
    let last = vec2i(input.size) - 1;
    let p = vec2i(floor(input.pixel));
    let slice = i32(uniforms.u0.x);
    let drag = uniforms.u0.y;
    let slices = uniforms.u0.z;
    let cur = at(p, last);
    var sum = vec4f(0.0);
    sum += at(p + vec2i(-1, 0), last);
    sum += at(p + vec2i(1, 0), last);
    sum += at(p + vec2i(0, -1), last);
    sum += at(p + vec2i(0, 1), last);
    if (slices > 1.0) {
        sum += at(p + vec2i(0, -slice), last);
        sum += at(p + vec2i(0, slice), last);
    }
    var next = cur * 0.5 + sum * (1.0 / 12.0);
    if (drag > 0.0) {
        let cover = at(p + vec2i(slice, 0), last);
        next = next * (1.0 - 0.1 * drag * cover.r);
    }
    return next;
}
`;

/** A command from the page: which parts run, how many chain steps, and whether drag reads. */
interface StepCommand {
	mode: 'off' | 'real' | 'step';
	steps: number;
	drag: number;
}

export default defineSketch((ctx: SketchContext) => {
	const { scene, render, page, time, textures, post } = ctx;
	scene.setBackground('#000000');
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 0, 4], target: [0, 0, 0] }));

	// The real solver's settings, as the add-on writes them: one fixed step, a steady air with a
	// little gust and swirl, and the box across the ground.
	const realValues = new Array<number>(32).fill(0);
	realValues[0] = 1 / 60;
	realValues[1] = 8;
	realValues[2] = 0.6;
	realValues[3] = 0.5;
	realValues[5] = 24;
	realValues[6] = 0.2;
	realValues[7] = 16;
	realValues[8] = 0.3;
	realValues[9] = 0.05;
	realValues[10] = 0.2;
	realValues[11] = 1;
	realValues[28] = -64;
	realValues[29] = -64;
	realValues[30] = 128;
	realValues[31] = 4;

	// The chain's settings: the slice's height in texels, the drag strength, and how many slices
	// the tile stacks.
	const stepValues = new Array<number>(32).fill(0);
	stepValues[0] = SLICE;
	stepValues[2] = SLICES;

	const real: RenderPass | undefined = REAL
		? render.addPass({
				kind: 'compute',
				description: defineFeature({
					name: 'wind-real',
					frame: 'background',
					kind: 'compute',
					outputs: { windReal: { default: 'black' } },
				}),
				wgsl: gridShader,
				fallback: { wgsl: gridFallback },
				format: 'rgba16float',
				size: [WIDTH, HEIGHT],
				history: true,
				steps: CYCLE_STEPS,
				values: realValues,
				name: 'wind-real',
			})
		: undefined;
	const step = render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: 'wind-step',
			frame: 'background',
			kind: 'compute',
			outputs: { windStep: { default: 'black' } },
		}),
		wgsl: STEP,
		fallback: { wgsl: STEP_FALLBACK },
		format: 'rgba16float',
		size: [WIDTH, HEIGHT],
		history: true,
		steps: 0,
		values: stepValues,
		name: 'wind-step',
	});
	if (real) render.setPassEnabled(real, false);
	render.setPassEnabled(step, false);

	// The graph drops a pass that nothing reads, so one effect at the end of the frame samples the
	// outputs and keeps the passes alive. Its own cost is the same on every side.
	const consume = /* wgsl */ `
var realTex: texture_2d_array<f32>;
var stepTex: texture_2d_array<f32>;

fn effect(input: EffectInput) -> vec4f {
    let real = textureSampleLevel(realTex, realTexSampler, input.uv, 0, 0.0).a;
    let step = textureSampleLevel(stepTex, stepTexSampler, input.uv, 0, 0.0).a;
    return input.color + vec4f(real + step) * 0.0001;
}
`;
	post.addEffect({
		wgsl: consume,
		textures: {
			realTex: real
				? textures.fromPass(real)
				: textures.fromData({
						width: 1,
						height: 1,
						depth: 2,
						data: new Uint8Array(8),
					}),
			stepTex: textures.fromPass(step),
		},
	});

	// Each command takes effect on the next frame, and the frame after that draws it. The sketch
	// answers once two frames have passed, so the page never measures the switch.
	let pending = 0;
	page.onMessage((name, data) => {
		if (name === 'graph') {
			page.post('graph', render.dumpGraph());
			return;
		}
		if (name === 'read') {
			// A small region of the field, read back through the promise that M3-V13 adds. The
			// sketch reports the wait and the frames of delay, and the page adds them to its result.
			if (!real) {
				page.post('read', { error: 'this shape keeps no real pass' });
				return;
			}
			const started = performance.now();
			render.readPass(real, { x: 0, y: 0, width: 16, height: 16 }).then(
				(region) =>
					page.post('read', {
						ms: performance.now() - started,
						frames: region.frames,
						width: region.width,
						height: region.height,
					}),
				(error: unknown) => page.post('read', { error: String(error) }),
			);
			return;
		}
		if (name !== 'config') return;
		const command = data as StepCommand;
		if (!command || typeof command !== 'object') return;
		if (real) {
			render.setPassEnabled(real, command.mode === 'real');
			render.setPassSteps(real, CYCLE_STEPS);
		}
		render.setPassEnabled(step, command.mode === 'step');
		render.setPassSteps(step, Math.max(0, Math.floor(command.steps)));
		stepValues[1] = command.drag;
		render.setPassUniforms(step, stepValues);
		pending = 2;
	});

	return {
		onUpdate() {
			if (pending <= 0) return;
			pending -= 1;
			if (pending > 0) return;
			page.post('settled', { time: time.now });
		},
	};
});
