// Prototype S3 (not for merging): what ambient occlusion and contact shadows cost on this device,
// for M2-F2 and M2-F12. The page draws a fixed scene (lib/proto-s3-scene.ts) with GPU calls of its
// own, in each setup: how AO gets its depth (M2-F2's copy of the depth prepass, or a separate
// structure pass into r16float), the AO variant, the upsample in the lit pass, and contact shadows.
//
// Method. Where the browser has a GPU timer (WebGPU's timestamp queries, WebGL2's timer queries),
// each setup draws frames one at a time, each waited for, and the timer gives each pass's GPU time
// and the frame's. Frames that overlap on the GPU would stretch a pass's timestamps, so none do.
// Every device also draws batches of frames back to back, each frame in a submit of its own, and
// waits once for the GPU to finish the batch: the time per frame is the batch's time, less an
// empty batch's, over its frames. That measures the GPU only where the GPU is slower than issuing
// the commands, so the page reports the issue time beside it. Without a GPU timer, each pass is
// also timed alone in batches. Setups take turns over several rounds, so heat slows each alike,
// and each figure is the median of its rounds. A setup's cost is its time less the baseline's,
// which draws the lit pass alone.
//
// Switches: ?gpu=webgpu|webgl2, ?preset=low|medium|high|ultra (the pixel ratio cap and MSAA of
// that preset), ?scale= (render scale), ?aoscale= (AO size as a share of the render size),
// ?inputs=, ?aos=, ?ups= (comma lists), ?contact=0, ?steps=0, ?rounds=, ?target= (milliseconds
// per batch), ?images=1 with ?imagesize=WxH, ?size=WxH (a fixed render size), ?copyformat=r16float,
// ?grid= (spheres per side), ?timedframes=.

import {
	AO_INPUTS,
	AO_KINDS,
	type AoInput,
	type AoKind,
	framePasses,
	median,
	type Pass,
	passKey,
	pngBase64,
	type Renderer,
	type Setup,
	type Sizes,
	setupName,
	sizesFor,
	type Upsample,
} from './lib/proto-s3-scene';
import { createWebGL2Renderer } from './lib/proto-s3-webgl2';
import { createWebGPURenderer } from './lib/proto-s3-webgpu';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const tier = params.get('gpu') === 'webgl2' ? 'webgl2' : 'webgpu';
const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
const preset = (PRESETS as readonly string[]).includes(params.get('preset') ?? '')
	? (params.get('preset') as (typeof PRESETS)[number])
	: 'high';
const presetIndex = PRESETS.indexOf(preset);
/** The engine's preset rows: the pixel ratio cap, and MSAA from Medium up. */
const maxPixelRatio = [1.5, 2, 2, Number.POSITIVE_INFINITY][presetIndex] as number;
const samples = presetIndex === 0 ? 1 : 4;
const scale = Number(params.get('scale') ?? 1);
const aoScale = Number(params.get('aoscale') ?? 0.5);
const list = <T extends string>(name: string, all: readonly T[]): T[] =>
	(params.get(name)?.split(',') ?? [...all]).filter((v): v is T =>
		(all as readonly string[]).includes(v),
	);
const inputs = list<AoInput>('inputs', AO_INPUTS);
const aos = list<AoKind>('aos', AO_KINDS);
const ups = list<Upsample>('ups', ['bilinear', 'depth']);
const contact = params.get('contact') !== '0';
const steps = params.get('steps') !== '0';
const rounds = Number(params.get('rounds') ?? 5);
const targetMs = Number(params.get('target') ?? 120);
const images = params.get('images') === '1';
const copyFormat = params.get('copyformat') === 'r16float' ? 'r16float' : 'r32float';
const grid = Number(params.get('grid') ?? 5);

const status = document.querySelector('#status') as HTMLElement;
const show = (text: string) => {
	status.textContent = text;
	progress(text);
};

function parseSize(text: string | null): [number, number] | null {
	const match = text?.match(/^(\d+)x(\d+)$/);
	return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The render size: the window at the preset's pixel ratio cap and the render scale. */
function renderSize(): [number, number] {
	const fixed = parseSize(params.get('size'));
	if (fixed) return fixed;
	const ratio = Math.min(devicePixelRatio, maxPixelRatio);
	return [
		Math.max(1, Math.round(innerWidth * ratio * scale)),
		Math.max(1, Math.round(innerHeight * ratio * scale)),
	];
}

function setups(): Setup[] {
	const all: Setup[] = [{ input: null, ao: null, upsample: 'none', contact: false }];
	for (const input of inputs) {
		all.push({ input, ao: null, upsample: 'none', contact: false });
		for (const ao of aos)
			for (const upsample of ups) all.push({ input, ao, upsample, contact: false });
		if (contact) {
			all.push({ input, ao: null, upsample: 'none', contact: true });
			if (aos.includes('gtao'))
				all.push({ input, ao: 'gtao', upsample: 'bilinear', contact: true });
		}
	}
	return all;
}

/** The passes timed alone, by key: each pass of every setup once. */
function stepPasses(all: readonly Pass[][]): Map<string, Pass> {
	const found = new Map<string, Pass>();
	for (const passes of all)
		for (const pass of passes) if (!found.has(passKey(pass))) found.set(passKey(pass), pass);
	return found;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Frames that each timed measurement waits for one at a time. */
const TIMED_FRAMES = Number(params.get('timedframes') ?? 24);

/** Adds a round's figure to a key's list. */
function push(rounds: Record<string, number[]>, key: string, value: number): void {
	const list = rounds[key];
	if (list) list.push(value);
	else rounds[key] = [value];
}

/** A setup's lists of figures by pass. */
function roundsOf(
	all: Record<string, Record<string, number[]>>,
	name: string,
): Record<string, number[]> {
	const found = all[name];
	if (found) return found;
	const made: Record<string, number[]> = {};
	all[name] = made;
	return made;
}

const medians = (rounds: Record<string, number[]>) =>
	Object.fromEntries(Object.entries(rounds).map(([key, values]) => [key, round3(median(values))]));

async function measure(renderer: Renderer) {
	const [width, height] = renderSize();
	const sizes: Sizes = sizesFor(width, height, aoScale);
	renderer.resize(sizes);
	const all = setups();
	const passesOf = new Map(
		all.map((setup) => [setupName(setup), framePasses(setup, renderer.resolvesDepth)]),
	);
	show('building pipelines');
	await renderer.prepare([...passesOf.values()].flat());
	// Warm-up: each setup draws a few frames, which also fills every target.
	for (const passes of passesOf.values()) await renderer.throughput(passes, 3);
	const names = [...passesOf.keys()];
	const order = (r: number) => names.map((_, k) => names[(k + r) % names.length] as string);

	// The GPU timer, one frame at a time: each pass's own GPU time, and the frame's.
	let timed: {
		frameMs: Record<string, number>;
		costMs: Record<string, number>;
		passMs: Record<string, Record<string, number>>;
	} | null = null;
	if (renderer.timer) {
		const frameRounds: Record<string, number[]> = {};
		const passRounds: Record<string, Record<string, number[]>> = {};
		for (let r = 0; r < rounds; r++)
			for (const name of order(r)) {
				show(`GPU timer, round ${r + 1} of ${rounds}: ${name}`);
				const result = await renderer.timed(passesOf.get(name) as Pass[], TIMED_FRAMES);
				if (!result) continue;
				push(frameRounds, name, result.frameMs);
				for (const [key, ms] of Object.entries(result.passMs))
					push(roundsOf(passRounds, name), key, ms);
			}
		const frameMs = medians(frameRounds);
		timed = {
			frameMs,
			costMs: Object.fromEntries(
				names.map((n) => [n, round3((frameMs[n] ?? 0) - (frameMs.baseline ?? 0))]),
			),
			passMs: Object.fromEntries(Object.entries(passRounds).map(([n, keys]) => [n, medians(keys)])),
		};
	}

	// Batches of frames back to back: the time per frame where the GPU limits the batch.
	const overheads: number[] = [];
	for (let i = 0; i < 5; i++) overheads.push((await renderer.throughput([], 1)).ms);
	const overheadMs = median(overheads);
	const probe = (await renderer.throughput(passesOf.get('baseline') as Pass[], 8)).ms;
	const frames = Math.max(
		4,
		Math.min(300, Math.round(targetMs / Math.max(0.05, (probe - overheadMs) / 8))),
	);
	const frameRounds: Record<string, number[]> = {};
	const issueRounds: Record<string, number[]> = {};
	for (let r = 0; r < rounds; r++)
		for (const name of order(r)) {
			show(`batches, round ${r + 1} of ${rounds}: ${name}`);
			const result = await renderer.throughput(passesOf.get(name) as Pass[], frames);
			push(frameRounds, name, (result.ms - overheadMs) / frames);
			push(issueRounds, name, result.issueMs / frames);
		}
	const batchMs = medians(frameRounds);
	const batches = {
		frames,
		overheadMs: round3(overheadMs),
		frameMs: batchMs,
		issueMs: medians(issueRounds),
		costMs: Object.fromEntries(
			names.map((n) => [n, round3((batchMs[n] ?? 0) - (batchMs.baseline ?? 0))]),
		),
	};

	// Each pass alone in batches, where no GPU timer times the passes.
	let stepMs: Record<string, number> | null = null;
	if (steps && !renderer.timer) {
		const alone = stepPasses([...passesOf.values()]);
		const stepFrames: Record<string, number> = {};
		for (const [key, pass] of alone) {
			const quick = (await renderer.throughput([pass], 4)).ms;
			stepFrames[key] = Math.max(
				4,
				Math.min(600, Math.round(targetMs / Math.max(0.02, (quick - overheadMs) / 4))),
			);
		}
		const keys = [...alone.keys()];
		const stepRounds: Record<string, number[]> = {};
		for (let r = 0; r < rounds; r++)
			for (let k = 0; k < keys.length; k++) {
				const key = keys[(k + r) % keys.length] as string;
				show(`passes alone, round ${r + 1} of ${rounds}: ${key}`);
				const n = stepFrames[key] as number;
				const result = await renderer.throughput([alone.get(key) as Pass], n);
				push(stepRounds, key, (result.ms - overheadMs) / n);
			}
		stepMs = medians(stepRounds);
	}

	return {
		render: [sizes.width, sizes.height],
		ao: [sizes.aoWidth, sizes.aoHeight],
		timer: renderer.timer,
		timedFrames: TIMED_FRAMES,
		timed,
		batches,
		stepMs,
	};
}

/** The pictures for the side-by-side comparison, by file name, as base64 PNGs. */
async function pictures(renderer: Renderer): Promise<Record<string, string>> {
	const [width, height] = parseSize(params.get('imagesize')) ?? [960, 540];
	const sizes = sizesFor(width, height, aoScale);
	renderer.resize(sizes);
	const shots: [string, Setup, boolean][] = [
		['baseline', { input: null, ao: null, upsample: 'none', contact: false }, false],
	];
	for (const ao of aos) {
		shots.push([
			`copy-${ao}-bilinear`,
			{ input: 'copy', ao, upsample: 'bilinear', contact: false },
			false,
		]);
		shots.push([
			`copy-${ao}-bilinear-ao`,
			{ input: 'copy', ao, upsample: 'bilinear', contact: false },
			true,
		]);
		shots.push([
			`copy-${ao}-depth-ao`,
			{ input: 'copy', ao, upsample: 'depth', contact: false },
			true,
		]);
	}
	shots.push([
		'structure-gtao-bilinear-ao',
		{ input: 'structure', ao: 'gtao', upsample: 'bilinear', contact: false },
		true,
	]);
	shots.push([
		'structure-bitmask-bilinear-ao',
		{ input: 'structure', ao: 'bitmask', upsample: 'bilinear', contact: false },
		true,
	]);
	shots.push([
		'copy-no-ao-none-contact',
		{ input: 'copy', ao: null, upsample: 'none', contact: true },
		false,
	]);
	shots.push([
		'copy-gtao-bilinear-contact',
		{ input: 'copy', ao: 'gtao', upsample: 'bilinear', contact: true },
		false,
	]);
	const all = shots.map(([, setup]) => framePasses(setup, renderer.resolvesDepth));
	await renderer.prepare(all.flat());
	const out: Record<string, string> = {};
	const canvas = document.querySelector('canvas') as HTMLCanvasElement;
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	for (const [index, [name, , showAo]] of shots.entries()) {
		show(`picture ${name}`);
		renderer.setShowAo(showAo);
		const pixels = await renderer.picture(all[index] as Pass[]);
		context?.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
		out[`${name}.png`] = await pngBase64(pixels, width, height);
	}
	renderer.setShowAo(false);
	return out;
}

run('proto-s3', async () => {
	show(`starting ${tier}`);
	const renderer =
		tier === 'webgl2'
			? await createWebGL2Renderer(samples, copyFormat, grid)
			: await createWebGPURenderer(samples, copyFormat, grid);
	try {
		const measured = await measure(renderer);
		const shots = images ? await pictures(renderer) : null;
		show('done');
		return {
			tier,
			preset,
			scale,
			aoScale,
			samples,
			copyFormat,
			grid,
			rounds,
			devicePixelRatio,
			window: [innerWidth, innerHeight],
			gpu: renderer.info,
			...measured,
			images: shots,
		};
	} finally {
		renderer.destroy();
	}
});
