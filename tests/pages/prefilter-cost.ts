// Prototype L1: the built-in room made on the GPU in steps, with switches for each variant. It
// reports each step's time and the total, and compares the map with the asset tool's own file of
// the room within D-19's tolerance.
//
// Switches:
//   ?gpu=webgpu|compat|webgl2           the GPU path
//   ?write=pack|spare|direct            how each draw reaches the map (lib/room-gpu.ts)
//   ?format=rgba16float|rg11b10ufloat   the float format of `spare` and `direct`; `pack` is RGB9_E5
//   ?nofloat=1                          WebGL2 only: enable no float color extension, as on a
//                                       device that cannot draw half floats
//   ?sizing=kind|adaptive|first|fixed   how the steps are sized (lib/room-sizing.ts)
//   ?target=6                           the time that a sized step aims at, in ms
//   ?probe=16                           a first step holds 1/probe of the modelled work: of each
//                                       kind of draw under `kind` (16), else of the map (64)
//   ?measure=gpu|wall                   size from the GPU's timer where the device has one, or
//                                       always from the step's time less an empty step's
//   ?warm=0                             no warm-up draw of each pipeline before the first map
//   ?debug=1                            WebGL2 only: name the draw kind of each GL error
//   ?slices=32                          the fixed split's slice count
//   ?runs=2                             maps after the first, which runs on fresh pipelines
//
// Each map's steps run one at a time, each waited for until the GPU finished it, as the engine
// runs one a frame. A step's time is from its first call until the GPU had finished it. The
// device's GPU timer gives its own figure where it has one. After the sized maps, one more map runs
// in a single step, for the cost of the work without the steps' gaps.
import { ENVIRONMENT_SHADER as GLSL } from '../../packages/engine/src/generated/shaders-environment-glsl';
import { ENVIRONMENT_SHADER as WGSL } from '../../packages/engine/src/generated/shaders-environment-wgsl';
import { rowCost } from '../../packages/engine/src/gpu/environment-steps';
import { readEnvironmentFile } from '../../packages/engine/src/scene/environment-file';
import { progress, run } from './lib/result';
import {
	type Format,
	fromRgb9e5,
	type Generator,
	LEVELS,
	type StepTime,
	UNSUPPORTED,
	type Write,
	webgl2Generator,
	webgpuGenerator,
} from './lib/room-gpu';
import { type Sizing, StepPlanner, wholeMap } from './lib/room-sizing';

const params = new URLSearchParams(location.search);
const gpu = (params.get('gpu') ?? 'webgpu') as 'webgpu' | 'compat' | 'webgl2';
const write = (params.get('write') ?? 'pack') as Write;
const format = (params.get('format') ??
	(write === 'pack' ? 'rgb9e5ufloat' : 'rgba16float')) as Format;
const noFloat = params.get('nofloat') === '1';
const sizing = (params.get('sizing') ?? 'kind') as Sizing;
const targetMs = Number(params.get('target') ?? '6');
const probeShare = 1 / Number(params.get('probe') ?? (sizing === 'kind' ? '16' : '64'));
const slices = Number(params.get('slices') ?? '32');
const runs = Number(params.get('runs') ?? '2');
const warmUp = params.get('warm') !== '0';
/** `gpu` sizes from the GPU's timer where the device has one; `wall` always from the step's time. */
const measure = params.get('measure') === 'wall' ? 'wall' : 'gpu';

/** D-19's tolerance for the generated room: mean / p99 steps of 1/255 per level, total light. */
const TOLERANCE = { mean: 0.25, p99: 1, ratio: 0.005 };
/** The pass rule's longest step and the slowest phone's whole room, in ms. */
const STEP_LIMIT_MS = 8;
const TOTAL_LIMIT_MS = 200;

interface StepRecord extends StepTime {
	cost: number;
	predictedMs: number;
	/** The time that sized the steps: the GPU's, or the step's time less the delay of an empty one. */
	measuredMs: number;
}

const round = (x: number | undefined, digits = 2) =>
	x === undefined || Number.isNaN(x) ? undefined : Number(x.toFixed(digits));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

/** The time that sizes a step, from its times and the delay of an empty step. */
function measured(time: StepTime, delayMs: number): number {
	if (measure === 'gpu' && time.gpuMs !== undefined && Number.isFinite(time.gpuMs))
		return time.gpuMs;
	return Math.max(time.wallMs - delayMs, 0.01);
}

/** Makes one map in steps, and gives each step's figures. */
async function sizedMap(generator: Generator, delayMs: number): Promise<StepRecord[]> {
	const planner = new StepPlanner(generator.steps, { sizing, slices, targetMs, probeShare });
	const records: StepRecord[] = [];
	for (let step = planner.next(); step; step = planner.next()) {
		const time = await generator.run(step.bands);
		const measuredMs = measured(time, delayMs);
		planner.record(measuredMs);
		records.push({ cost: step.cost, predictedMs: step.predictedMs, measuredMs, ...time });
	}
	return records;
}

function summary(records: StepRecord[]) {
	const of = (key: 'measuredMs' | 'cpuMs' | 'wallMs') => records.map((r) => r[key]);
	const gpuTimes = records.map((r) => r.gpuMs).filter((x): x is number => x !== undefined);
	const timed = gpuTimes.length === records.length;
	return {
		steps: records.length,
		/** The sum and the most of the times that sized the steps. */
		totalMs: round(sum(of('measuredMs'))),
		maxMs: round(Math.max(...of('measuredMs'))),
		cpuMaxMs: round(Math.max(...of('cpuMs'))),
		wallTotalMs: round(sum(of('wallMs'))),
		gpuTotalMs: timed ? round(sum(gpuTimes)) : undefined,
		gpuMaxMs: timed ? round(Math.max(...gpuTimes)) : undefined,
		/** Each step: modelled work in millions, the guess, the measure, CPU, wall and GPU times. */
		list: records.map((r) => [
			round(r.cost / 1e6, 3),
			round(r.predictedMs),
			round(r.measuredMs),
			round(r.cpuMs),
			round(r.wallMs),
			round(r.gpuMs),
		]),
	};
}

const timeText = (t: StepTime) => ({
	cpuMs: round(t.cpuMs),
	wallMs: round(t.wallMs),
	gpuMs: round(t.gpuMs),
});

/** Each level against the tool's: mean and p99 steps of 1/255 after tone mapping, total light. */
function compare(ours: Float32Array[], file: ReturnType<typeof readEnvironmentFile>) {
	// Reinhard's operator at an exposure that puts the room's average light at a third of white.
	const sh = file.sh;
	const average =
		0.282095 *
		(0.2126 * (sh[0] as number) + 0.7152 * (sh[1] as number) + 0.0722 * (sh[2] as number));
	const exposure = 0.5 / average;
	const tone = (x: number) => (255 * x * exposure) / (1 + x * exposure);
	return ours.map((light, level) => {
		const bytes = file.texels[level] as Uint8Array;
		const words = new Uint32Array(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		);
		const steps = new Float32Array(words.length);
		let [mine, theirs] = [0, 0];
		for (let t = 0; t < words.length; t++) {
			const b = fromRgb9e5(words[t] as number);
			const tb = tone(b);
			let worst = 0;
			for (let c = 0; c < 3; c++) {
				const a = light[t * 3 + c] as number;
				worst = Math.max(worst, Math.abs(tone(a) - tb));
				mine += a;
			}
			steps[t] = worst;
			theirs += 3 * b;
		}
		const mean = sum(Array.from(steps)) / steps.length;
		steps.sort();
		const p99 = steps[Math.floor(0.99 * (steps.length - 1))] as number;
		const ratio = mine / theirs;
		return {
			level,
			mean: round(mean, 3),
			p99: round(p99, 2),
			ratio: round(ratio, 4),
			ok:
				Number.isFinite(mean) &&
				mean <= TOLERANCE.mean &&
				p99 <= TOLERANCE.p99 &&
				Math.abs(ratio - 1) <= TOLERANCE.ratio,
		};
	});
}

run('prefilter-cost', async () => {
	const reference = fetch('/sample-environments/builtin/room.ktx2').then(async (r) => {
		if (!r.ok) throw new Error(`the tool's room: ${r.status} ${await r.text()}`);
		return readEnvironmentFile(await r.arrayBuffer());
	});
	progress('making the generator');
	let generator: Generator;
	try {
		generator =
			gpu === 'webgl2'
				? await webgl2Generator(GLSL.webgl2, format, write, noFloat, params.get('debug') === '1')
				: await webgpuGenerator(WGSL.webgpu, gpu === 'compat', format, write);
	} catch (e) {
		const message = (e as Error).message;
		if (message.startsWith(UNSUPPORTED)) return { gpu, write, format, unsupported: message };
		throw e;
	}
	const started = performance.now();
	await generator.prepare();
	const prepareMs = performance.now() - started;
	// The delay from a step's call until the GPU reports it finished, for a step with no work.
	const empty: number[] = [];
	for (let k = 0; k < 5; k++) empty.push((await generator.run([])).wallMs);
	const delayMs = median(empty);
	const warm = warmUp ? await generator.warm() : undefined;
	const maps = [];
	for (let k = 0; k <= runs; k++) {
		progress(`map ${k}`);
		maps.push(summary(await sizedMap(generator, delayMs)));
	}
	progress('whole map');
	const whole = await generator.run(wholeMap(generator.steps));
	// Each draw of the map on its own, the least of three, against its modelled work.
	progress('each draw alone');
	const draws = [];
	for (const [k, step] of generator.steps.entries()) {
		const times: StepTime[] = [];
		for (let n = 0; n < 3; n++)
			times.push(await generator.run([{ step: k, y: 0, rows: step.size }]));
		const best = Math.min(...times.map((t) => measured(t, delayMs)));
		const cost = step.size * rowCost(step);
		draws.push({
			pipeline: step.pipeline,
			level: step.level,
			workM: round(cost / 1e6, 3),
			ms: round(best, 3),
			unitsPerUs: round(cost / best / 1000, 1),
		});
	}
	progress('reading back');
	const levels = compare(await generator.read(), await reference);
	const errors = await generator.errors();
	generator.destroy();
	const longest = Math.max(...maps.map((m) => Math.max(m.maxMs ?? 0, m.cpuMaxMs ?? 0)));
	const first = maps[0];
	const result = {
		gpu,
		...generator.facts,
		sizing,
		targetMs,
		probeShare,
		slices,
		levelCount: LEVELS,
		measure,
		prepareMs: round(prepareMs),
		delayMs: round(delayMs),
		warm: warm && Object.fromEntries(Object.entries(warm).map(([k, t]) => [k, timeText(t)])),
		maps,
		whole: timeText(whole),
		draws,
		levels,
		errors,
		pass: {
			match: levels.every((l) => l.ok),
			stepUnderLimit: longest <= STEP_LIMIT_MS,
			totalUnderLimit: (first?.totalMs ?? Infinity) <= TOTAL_LIMIT_MS,
			noErrors: errors.length === 0,
		},
	};
	return result;
});
