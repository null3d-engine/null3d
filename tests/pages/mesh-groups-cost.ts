// What the slot pass costs and saves on this device: the rock field of
// `sketches/mesh-pieces-sketch.ts` twice, once with pieces whose triangles also split into groups
// (NULL3D_pieces version 2, which the camera's view culls group by group through its slots) and
// once with pieces alone. The page starts an engine for each side in turn, warms up at the first
// view, then measures, so drift on the computer touches both sides alike. It reports the medians
// of GPU time per frame where the device has a GPU timer, of the frame interval and of each
// thread's CPU time, with the triangles and draw calls that each side drew. `?pixels=large` fills
// the viewport's canvas from the spec's viewport, for a frame that is short of pixels rather than
// triangles.
import { createEngine, type Engine } from '@null3d/engine';
import { differingPixels } from './lib/occlusion';
import { run } from './lib/result';
import { VIEWS } from './sketches/mesh-pieces-sketch';

const params = new URLSearchParams(location.search);
const LARGE = params.get('pixels') === 'large';
/** The copies of the single-sided rock, whose neighbour count follows it. */
const ROCKS = Number(params.get('rocks') ?? '') || 0;
/** Seconds of play before a side's measurement. */
const WARM_UP_SECONDS = 2;
/** Seconds of a side's measurement. */
const SECONDS = 2;
/** The turns of the two sides: each round measures the off side then the on side, and the rounds
 * start with the other side in turn, so a drift that grows through the run lands on both.
 */
const ROUNDS = 3;

/** Starts an engine on a new canvas, with or without the fine level's groups. */
async function start(groups: boolean): Promise<Engine> {
	document.querySelector('canvas')?.remove();
	const canvas = document.createElement('canvas');
	if (LARGE) {
		canvas.style.width = `${innerWidth}px`;
		canvas.style.height = `${innerHeight}px`;
	} else {
		canvas.style.width = '320px';
		canvas.style.height = '180px';
	}
	document.body.prepend(canvas);
	const sketch = new URL('./sketches/mesh-pieces-sketch.ts', import.meta.url);
	const big = params.get('big') === '1' ? '&big=1' : '';
	sketch.search = `?pieces=1${groups ? '&groups=1' : ''}${ROCKS ? `&rocks=${ROCKS}` : ''}${big}`;
	const engine = await createEngine({ canvas, sketch, preset: 'medium', maxPixelRatio: 1 });
	await engine.firstFrame;
	return engine;
}

/** Moves the camera to a view, and resolves once the thread that draws has taken a frame there. */
function turn(engine: Engine, view: number): Promise<void> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((name) => {
			if (name !== 'turned') return;
			off();
			resolve();
		});
		engine.postToSketch('view', view);
	});
}

/** One side's medians over one round. */
async function measure(groups: boolean) {
	const engine = await start(groups);
	await turn(engine, 0);
	await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
	await turn(engine, 0);
	const stats = await engine.measure(SECONDS);
	const threads: Record<string, number | null> = {};
	for (const [name, thread] of Object.entries(stats.threads)) threads[name] = thread.busyMs.median;
	const frame = (await engine.captureFrame()).pixels;
	const side = {
		frame,
		tier: engine.capabilities.tier,
		gpuMs: stats.gpuMs?.median ?? null,
		intervalMs: stats.intervalMs.median,
		cpuMs: stats.cpuMs.median,
		threads,
		triangles: stats.triangles.median,
		draws: stats.drawCalls.median,
	};
	await engine.destroy();
	return side;
}

run('mesh-groups-cost', async () => {
	const failures: string[] = [];
	type Side = Awaited<ReturnType<typeof measure>>;
	const offs: Side[] = [];
	const ons: Side[] = [];
	for (let round = 0; round < ROUNDS; round++) {
		// The side that this round measures first.
		const offFirst = round % 2 === 0;
		const a = offFirst ? await measure(false) : await measure(true);
		const b = offFirst ? await measure(true) : await measure(false);
		(offFirst ? offs : ons).push(a);
		(offFirst ? ons : offs).push(b);
	}
	const median = (values: number[]) => values.slice().sort((x, y) => x - y)[1] ?? null;
	type Measured = Side & { frame?: Uint8Array };
	type Stripped = Omit<Measured, 'frame'>;
	const side = (rounds: Stripped[]) => ({
		gpuMs: median(rounds.map((round) => round.gpuMs).filter((ms) => ms !== null) as number[]),
		intervalMs: median(rounds.map((round) => round.intervalMs)),
		cpuMs: median(rounds.map((round) => round.cpuMs)),
		threads: rounds[0]?.threads ?? {},
		gpuRoundsMs: rounds
			.map((round) => round.gpuMs)
			.filter((value): value is number => value !== null),
		intervalRoundsMs: rounds
			.map((round) => round.intervalMs)
			.filter((value): value is number => value !== null),
		triangles: median(rounds.map((round) => round.triangles)),
		draws: median(rounds.map((round) => round.draws)),
	});
	// The two sides draw the same pixels: the groups only order a piece's triangles, and the slots
	// that cull them draw conservatively.
	const differing =
		offs[0]?.frame && ons[0]?.frame ? differingPixels(offs[0].frame, ons[0].frame) : -1;
	const strip = (round: (typeof offs)[number]) => {
		const { frame: _frame, ...rest } = round;
		return rest;
	};
	return {
		differingPixels: differing,
		tier: offs[0]?.tier ?? 'webgpu',
		window: [innerWidth, innerHeight] as [number, number],
		off: side(offs.map(strip)),
		on: side(ons.map(strip)),
		failures,
	};
});
