// Measures the wind field's own cost on this device: the add-on's real solver, one history pass
// that runs a whole cycle, and a chain of the same work per step whose pressure count and grid
// shape can be swept. The page plays the same scene with each part off and on in turns, so the cost
// per cycle, a step's fixed cost and its cost per cell come apart. It reports the medians of each
// side's GPU time per frame, its frame interval and CPU time, and the GPU time of the field's own
// passes, and reads the memory once the timing is done. Open it with ?gpu= for each path, and give
// ?shape= one of the grid shapes that the report names.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { overlayMemory, waitForOverlay } from './lib/overlay-figures';
import { run } from './lib/result';
import type { SideMemory } from './lib/side-memory';

const params = new URLSearchParams(location.search);
/** The grid shapes: a tile's width, its height per slice, and how many slices it stacks. */
const SHAPES: Record<string, { w: number; slice: number; slices: number }> = {
	'flat-32': { w: 32, slice: 32, slices: 1 },
	'flat-64': { w: 64, slice: 64, slices: 1 },
	'flat-128': { w: 128, slice: 128, slices: 1 },
	'flat-256': { w: 256, slice: 256, slices: 1 },
	'layered-4x64': { w: 64, slice: 64, slices: 4 },
	'layered-8x64': { w: 64, slice: 64, slices: 8 },
	'layered-4x128': { w: 128, slice: 128, slices: 4 },
	'layered-8x128': { w: 128, slice: 128, slices: 8 },
	'volume-32': { w: 32, slice: 32, slices: 32 },
	'volume-48x16x48': { w: 48, slice: 16, slices: 48 },
	'volume-64x24x64': { w: 64, slice: 24, slices: 64 },
};
const shapeName = params.get('shape') ?? 'flat-128';
const shape = SHAPES[shapeName];
if (!shape) throw new Error(`unknown shape ${shapeName}`);
/** The real solver takes a square grid of one slice. */
const real = shape.slices === 1 && shape.slice === shape.w;
/** The chain steps to measure. */
const points = (params.get('points') ?? '1,8,16,24,40,80').split(',').map(Number);
/** The seconds of each measurement, and the rounds of each side. */
const seconds = Number(params.get('seconds') ?? '2');
const rounds = Number(params.get('rounds') ?? '3');

/** One configuration that the page switches to. */
interface Config {
	label: string;
	mode: 'off' | 'real' | 'step';
	steps: number;
	drag: number;
}

/** One side's medians. */
interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	refreshHz: number | null;
	/** The GPU time of the field's own compute passes, summed. */
	computeMs: number | null;
	/**
	 * The GPU time of the part before the frame's first timed pass, which holds the field's
	 * dispatches because a compute pass at the background point runs before the timed passes.
	 */
	copiesMs: number | null;
	/** Each pass's GPU time, in the order the device reported it. */
	passes: { name: string; ms: number | null }[];
	threads: Record<string, number | null>;
}

function median(values: number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The sum of the field's compute passes in one measurement, or null when the device times none. */
function computeTime(stats: FrameMetrics): number | null {
	const passes = stats.gpuPassMs;
	if (!passes) return null;
	let total = 0;
	let seen = false;
	for (const pass of passes) {
		if (!pass.name.startsWith('compute')) continue;
		total += pass.ms.median;
		seen = true;
	}
	return seen ? total : 0;
}

run('wind-field-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/wind-field-cost-sketch.ts', import.meta.url);
	sketch.search = `?w=${shape.w}&slice=${shape.slice}&slices=${shape.slices}&real=${real ? 1 : 0}`;
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.message));
	await engine.firstFrame;

	const settle = (command: Config): Promise<void> =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				off();
				resolve();
			});
			engine.postToSketch('config', {
				mode: command.mode,
				steps: command.steps,
				drag: command.drag,
			});
		});

	const configs: Config[] = [
		{ label: 'off', mode: 'off', steps: 0, drag: 0 },
		...(real ? [{ label: 'real', mode: 'real', steps: 0, drag: 0 } as Config] : []),
		...points.map((steps): Config => ({ label: `step-${steps}`, mode: 'step', steps, drag: 0 })),
		{
			label: `step-${points[points.length - 1]}-drag`,
			mode: 'step',
			steps: points[points.length - 1] as number,
			drag: 1,
		},
	];
	const taken = new Map<
		string,
		{
			gpu: number[];
			interval: number[];
			cpu: number[];
			compute: number[];
			passes: Map<string, number[]>;
			threads: Map<string, number[]>;
			refresh: number[];
		}
	>();
	for (const config of configs) {
		taken.set(config.label, {
			gpu: [],
			interval: [],
			cpu: [],
			compute: [],
			passes: new Map(),
			threads: new Map(),
			refresh: [],
		});
	}
	// A warm-up before the first measurement, so the first shader builds cost no figure.
	await settle({ label: 'warm', mode: real ? 'real' : 'step', steps: 22, drag: 0 });
	await new Promise((resolve) => setTimeout(resolve, 1500));
	for (let round = 0; round < rounds; round++) {
		const order = round % 2 === 1 ? [...configs].reverse() : configs;
		for (const config of order) {
			await settle(config);
			// A short settle, so the switch's own frame costs none of the figure.
			await new Promise((resolve) => setTimeout(resolve, 250));
			const stats = await engine.measure(seconds);
			const taken1 = taken.get(config.label) as NonNullable<ReturnType<typeof taken.get>>;
			if (stats.gpuMs) taken1.gpu.push(stats.gpuMs.median);
			taken1.interval.push(stats.intervalMs.median);
			taken1.cpu.push(stats.cpuMs.median);
			if (stats.refreshHz) taken1.refresh.push(stats.refreshHz);
			const compute = computeTime(stats);
			if (compute !== null) taken1.compute.push(compute);
			for (const pass of stats.gpuPassMs ?? []) {
				const values = taken1.passes.get(pass.name) ?? [];
				values.push(pass.ms.median);
				taken1.passes.set(pass.name, values);
			}
			for (const [name, thread] of Object.entries(stats.threads)) {
				const values = taken1.threads.get(name) ?? [];
				values.push(thread.busyMs.median);
				taken1.threads.set(name, values);
			}
		}
	}
	const sides: Record<string, Side> = {};
	for (const [label, figures] of taken) {
		const passes = [...figures.passes].map(([name, values]) => ({ name, ms: median(values) }));
		sides[label] = {
			gpuMs: median(figures.gpu),
			intervalMs: median(figures.interval),
			cpuMs: median(figures.cpu),
			refreshHz: median(figures.refresh),
			computeMs: figures.compute.length ? median(figures.compute) : null,
			copiesMs: passes.find((pass) => pass.name === 'copies')?.ms ?? null,
			passes,
			threads: Object.fromEntries(
				[...figures.threads]
					.map(([name, values]) => [name, median(values)] as const)
					.filter(([, ms]) => ms !== null && ms > 0),
			),
		};
	}

	// The memory comes from the overlay, which samples the GPU's tables. It shows after the timing,
	// so its sampling costs none of the frames above.
	const graph = await new Promise<string>((resolve) => {
		const timer = setTimeout(() => resolve('no graph'), 3000);
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'graph') return;
			clearTimeout(timer);
			off();
			resolve(String(data));
		});
		engine.postToSketch('graph');
	});
	const wasmBytes = (await engine.measure(0.5)).memory.wasmBytes;
	engine.stats(true);
	const ready = await waitForOverlay('gpu-textures');
	const memory: SideMemory = { ready, ...overlayMemory(wasmBytes) };
	engine.stats(false);
	await engine.destroy();

	const height = shape.slice * shape.slices;
	return {
		tier: engine.capabilities.tier,
		shape: shapeName,
		real,
		width: shape.w,
		height,
		cells: shape.w * height,
		points,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		sides,
		graph,
		memory,
		/** The two states of a history pass over the tile, in bytes. */
		fieldBytes: shape.w * height * 2 * 8,
		failures,
	};
});
