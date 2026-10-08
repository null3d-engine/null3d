// The quality governor's stress test page (lib/governor.ts): it runs the stage that ?stage= names,
// `walk` by default, on the GPU path that ?gpu= asks for, and reports the governor's steps, the
// frames captured after each step and the measurements of the frames meanwhile. ?work= fixes the
// hold's loop count, for a load that a device needs. The engine's ?fps= switch lowers the target
// rate, as for a GPU that cannot draw the scene at the display's rate.
import { createEngine, type Engine, type FrameMetrics } from '@null3d/engine';
import {
	compareFrames,
	GOVERNOR,
	type GovernorCapture,
	type GovernorChunk,
	type GovernorResult,
	type GovernorStage,
	type GovernorState,
	stateKey,
	targetHz,
} from './lib/governor';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const stage: GovernorStage = params.get('stage') === 'hold' ? 'hold' : 'walk';
/** The hold's loop count from ?work=, which skips the search for a load that overloads the GPU. */
const fixedWork = params.has('work') ? Number(params.get('work')) : undefined;

/** A measurement's figures that the checks read. */
function chunkOf(stats: FrameMetrics): GovernorChunk {
	return {
		seconds: stats.seconds,
		presentedFps: stats.presentedFps,
		completedFps: stats.completedFps,
		intervalP99Ms: stats.intervalMs.p99,
		refreshHz: stats.refreshHz,
		gpuDelayMs: stats.gpuLatencyMs?.median ?? null,
		pipelines: stats.pipelines,
		skippedDraws: stats.skippedDraws,
	};
}

/** The governor's states as the sketch posts them, and a wait for the next one. */
class StateLog {
	readonly states: GovernorState[] = [];
	private from = performance.now();
	private waiting: (() => void) | undefined;

	constructor(engine: Engine) {
		engine.onSketchMessage((name, data) => {
			if (name !== 'governor-state') return;
			const [renderScale, budgetScale, steps, farCascadeInterval, shadowFilter] = data as number[];
			const state = {
				at: (performance.now() - this.from) / 1000,
				renderScale: renderScale as number,
				budgetScale: budgetScale as number,
				steps: steps as number,
				farCascadeInterval: farCascadeInterval as number,
				shadowFilter: shadowFilter as number,
			};
			// A change of another setting also reaches the sketch's change handlers.
			const last = this.states.at(-1);
			if (last && stateKey(last) === stateKey(state)) return;
			this.states.push(state);
			progress(`state ${stateKey(state)}`);
			this.waiting?.();
		});
	}

	/** Counts the time of later states from now, and forgets the states so far but the last. */
	restart(): void {
		this.from = performance.now();
		this.states.splice(0, this.states.length - 1);
		const last = this.states[0];
		if (last) last.at = 0;
	}

	/** Resolves with true at the next state, or with false after `seconds`. */
	next(seconds: number): Promise<boolean> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.waiting = undefined;
				resolve(false);
			}, seconds * 1000);
			this.waiting = () => {
				clearTimeout(timer);
				this.waiting = undefined;
				resolve(true);
			};
		});
	}
}

/** Measures the frames in chunks until `done` resolves. */
async function measureUntil(engine: Engine, done: Promise<unknown>): Promise<GovernorChunk[]> {
	let finished = false;
	void done.then(() => {
		finished = true;
	});
	const chunks: GovernorChunk[] = [];
	while (!finished) chunks.push(chunkOf(await engine.measure(GOVERNOR.chunkSeconds)));
	return chunks;
}

/**
 * The walk: a load that no setting lightens takes the governor down every step, and the steps come
 * back up once the load stops. A frame is captured after each step.
 */
async function walk(engine: Engine, log: StateLog, budgetMs: number) {
	const captures: GovernorCapture[] = [];
	let first: Uint8Array | undefined;
	const capture = async () => {
		const state = log.states.at(-1);
		// The sketch posts a step while it records the step's first frame, before the frame is drawn.
		await new Promise((resolve) => setTimeout(resolve, GOVERNOR.captureAfterMs));
		const { width, pixels } = await engine.captureFrame();
		first ??= pixels;
		captures.push({ state: state ? stateKey(state) : '', ...compareFrames(first, pixels, width) });
	};
	/** Captures after each step until the governor reaches `bottom` or `top`, or the time runs out. */
	const follow = async (reached: () => boolean, seconds: number) => {
		const end = performance.now() + seconds * 1000;
		while (!reached()) {
			const left = (end - performance.now()) / 1000;
			if (left <= 0 || !(await log.next(left))) return false;
			await capture();
		}
		return true;
	};
	const last = () => log.states.at(-1);
	const bottom = () => {
		const state = last();
		return (
			state !== undefined &&
			state.shadowFilter === 3 &&
			state.farCascadeInterval === 8 &&
			Math.abs(state.renderScale - GOVERNOR.walkMinScale) < 1e-6 &&
			state.budgetScale === GOVERNOR.budgetMin
		);
	};
	const top = () => {
		const state = last();
		return (
			state !== undefined && state.steps === 0 && state.renderScale === 1 && state.budgetScale === 1
		);
	};
	await capture();
	log.restart();
	engine.postToSketch('load', { spinMs: GOVERNOR.spinBudgets * budgetMs, work: 0 });
	let timedOut: string | null = null;
	const walked = (async () => {
		if (!(await follow(bottom, GOVERNOR.walkDownSeconds))) {
			timedOut = 'down';
			return;
		}
		engine.postToSketch('load', { spinMs: 0, work: 0 });
		if (!(await follow(top, GOVERNOR.walkUpSeconds))) timedOut = 'up';
	})();
	const chunks = await measureUntil(engine, walked);
	await walked;
	return { captures, chunks, timedOut };
}

/**
 * The hold: with the governor off, the plane's loop grows until the GPU falls well behind the
 * target. Then the governor runs, and the page measures each second.
 */
async function hold(engine: Engine, log: StateLog, target: number) {
	let loaded: (() => void) | undefined;
	engine.onSketchMessage((name) => {
		if (name === 'loaded') loaded?.();
	});
	const load = (work: number) =>
		new Promise<void>((resolve) => {
			loaded = resolve;
			engine.postToSketch('load', { spinMs: 0, work });
		});
	engine.postToSketch('governor', false);
	let work: number | null = null;
	const first = fixedWork ?? GOVERNOR.firstWork;
	const last = fixedWork ?? GOVERNOR.lastWork;
	for (let next = first; next <= last; next = Math.round(next * GOVERNOR.workGrowth)) {
		await load(next);
		await new Promise((resolve) => setTimeout(resolve, GOVERNOR.settleSeconds * 1000));
		const stats = await engine.measure(GOVERNOR.stepSeconds);
		const lower = Math.min(stats.presentedFps, stats.completedFps ?? 0);
		progress(`loop ${next}: ${lower.toFixed(1)} fps`);
		if (fixedWork !== undefined || lower < target * GOVERNOR.overloadedShare) {
			work = next;
			break;
		}
	}
	if (work === null) return { work, chunks: [], perSecond: [] };
	log.restart();
	engine.postToSketch('governor', true);
	const stats = await engine.measure(GOVERNOR.holdSeconds);
	return {
		work,
		chunks: [chunkOf(stats)],
		perSecond: stats.perSecond.map(({ presentedFps, completedFps }) => ({
			presentedFps,
			completedFps,
		})),
	};
}

run('governor', async (): Promise<GovernorResult> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/governor-sketch.ts', import.meta.url);
	sketch.searchParams.set(
		'min',
		String(100 * (stage === 'walk' ? GOVERNOR.walkMinScale : GOVERNOR.holdMinScale)),
	);
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	const log = new StateLog(engine);
	await engine.firstFrame;
	// The grace after the first frame passes, and the refresh rate is measured meanwhile.
	const { refreshHz } = await engine.measure(3);
	const fps = params.has('fps') ? Number(params.get('fps')) : undefined;
	const target = targetHz(refreshHz, fps);
	progress(`refresh ${refreshHz} Hz, target ${target} fps`);
	const tier = engine.capabilities.tier;
	try {
		if (stage === 'walk') {
			const walked = await walk(engine, log, 1000 / target);
			return {
				stage,
				tier,
				refreshHz,
				targetHz: target,
				states: log.states,
				work: null,
				perSecond: [],
				failures,
				...walked,
			};
		}
		const held = await hold(engine, log, target);
		return {
			stage,
			tier,
			refreshHz,
			targetHz: target,
			states: log.states,
			captures: [],
			failures,
			timedOut: null,
			...held,
		};
	} finally {
		await engine.destroy();
	}
});
