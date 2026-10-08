// Checks of the stats page's result, shared by the Playwright test and the real-browser runner: the
// overlay sits on the canvas's top-right corner, lets the pointer through apart from its header
// button, and shows the figures: a bar of work for each engine thread and the GPU, memory parts
// that add up to the total, and the counts. The sketch's frame figures name every engine thread as
// `engine.measure` names them, and count the triangles and objects drawn and the engine's memory.

/** The figures of `debug.frameStats`, as the sketch posts their JSON. */
export interface StatsFigures {
	frames: number;
	presentedFps: number;
	completedFps: number;
	cpuMs: number;
	gpuMs: number | null;
	triangles: number;
	objects: number;
	wasmBytes: number;
	meshBytes: number;
	tier: string;
	preset: string;
	renderScale: number;
	threads: { name: string; busyMs: number; phases: Record<string, number> }[];
}

/** What the page reads from the overlay. */
export interface OverlayView {
	/** The text of each figure that shows, by its name. A hidden figure is left out. */
	figures: Record<string, string>;
	/** The header button's `aria-expanded`. */
	expanded: string | null;
	/** How far the overlay's right and top edges sit inside the canvas's top-right corner. */
	offset: [number, number];
	/** The pointer events of the overlay's element. */
	pointerEvents: string;
}

type Box = { left: number; top: number; right: number; bottom: number };
/** The boxes of the canvas, the overlay's element and its header button, in the page. */
export type OverlayBoxes = { canvas: Box; host: Box; button: Box };

/** The GPU feature or WebGL2 extension that GPU time needs on a tier. */
export function gpuTimerFeature(tier: string): string {
	return tier === 'webgl2' ? 'EXT_disjoint_timer_query_webgl2' : 'timestamp-query';
}

/** The triangles of the stats page's box, which every frame draws at least once. */
const BOX_TRIANGLES = 12;

/** What the stats page publishes once the overlay and the sketch both show a window's figures. */
export type StatsResult = {
	tier: string;
	mode: {
		latency: string;
		sketchThread: string;
		renderThread: string;
		jobWorkers: number;
		preset: string;
	};
	/** True when the GPU path offers the timer that GPU time needs. */
	gpuTimer: boolean;
	/** True when the page hid the browser's JavaScript heap and page memory figures. */
	noPageMemory: boolean;
	overlay: OverlayView | null;
	/** The sketch's figures, or null on the page that reads none. */
	figures: StatsFigures | null;
};

/** The threads that a mode's figures name, as `engine.measure` names them. */
export function statsThreads(mode: StatsResult['mode']): string[] {
	const sketch =
		mode.latency === 'single' || mode.sketchThread === 'main' ? 'main' : 'sketch-worker';
	const named = mode.renderThread === sketch ? [sketch] : [sketch, mode.renderThread];
	return [...named, ...Array.from({ length: mode.jobWorkers }, (_, k) => `job-${k}`)];
}

/** The bar of each thread that is not a job worker, by the thread's name. */
const THREAD_BARS: Record<string, string> = {
	'sketch-worker': 'sketch',
	'render-worker': 'drawing',
	main: 'page',
};

/**
 * The work bars that a mode shows, by the names of their figures. A thread that runs the sketch and
 * then draws has one bar for both.
 */
export function workBars(mode: StatsResult['mode']): string[] {
	const names = statsThreads(mode).filter((name) => !name.startsWith('job-'));
	const both = mode.renderThread === names[0];
	return [
		...(both ? ['sketch-drawing'] : names.map((name) => THREAD_BARS[name] ?? name)),
		...(mode.jobWorkers > 0 ? ['jobs'] : []),
	];
}

/** A memory figure's text, such as `64.0 MiB`, in tenths of a MiB, or NaN. */
const tenths = (text: string | undefined) => Math.round(Number.parseFloat(text ?? '') * 10);

/** What is wrong with the overlay's memory figures: the parts that show must add up to the total. */
export function memoryProblems(figures: Record<string, string>): string[] {
	const parts = ['engine-memory', 'gpu-memory', 'js-heap'].filter((name) => name in figures);
	const sum = parts.reduce((total, name) => total + tenths(figures[name]), 0);
	const total = tenths(figures.memory);
	return sum === total
		? []
		: [`the memory parts (${parts.join(', ')}) add up to ${sum / 10} MiB, not ${figures.memory}`];
}

/** What is wrong with a stats page's result; empty when nothing is. */
export function statsProblems(result: StatsResult): string[] {
	const { overlay, figures, mode, tier } = result;
	if (!overlay) return ['the page shows no stats overlay'];
	if (!figures) return ['the sketch posted no figures'];
	const problems: string[] = [];
	if (overlay.offset[0] !== 0 || overlay.offset[1] !== 0)
		problems.push(
			`the overlay sits ${overlay.offset.join(', ')} px from the canvas's top-right corner`,
		);
	if (overlay.pointerEvents !== 'none') problems.push('the overlay takes pointer events');
	if (overlay.expanded !== 'true') problems.push('the overlay does not start with its card open');
	const shown = overlay.figures;
	const expect = (name: string, pattern: RegExp) => {
		const text = shown[name];
		if (text === undefined) problems.push(`the overlay does not show ${name}`);
		else if (!pattern.test(text)) problems.push(`the overlay shows ${name} as "${text}"`);
	};
	expect('heading', new RegExp(`^${tier}  ${mode.preset}  scale 1\\.00$`));
	expect('fps', /^\d+ fps$/);
	expect('target', /^Target \d+ fps · \d+\.\d ms$/);
	const bars = workBars(mode);
	for (const bar of bars) expect(bar, /^\d+\.\d ms$/);
	for (const bar of ['sketch-drawing', 'sketch', 'drawing', 'jobs', 'page'])
		if (!bars.includes(bar) && bar in shown) problems.push(`the overlay shows a ${bar} bar`);
	const modes = Object.keys(shown).filter((name) => name.startsWith('mode:'));
	if (modes.join() !== `mode:${mode.latency}`)
		problems.push(`the overlay shows the mode symbols ${modes.join(', ') || 'none'}`);
	expect('gpu', result.gpuTimer ? /^\d+\.\d ms$/ : /^not measured$/);
	expect('memory', /^\d+\.\d MiB$/);
	expect('engine-memory', /^[1-9]\d*\.\d MiB$/);
	expect('gpu-memory', /^\d+\.\d MiB$/);
	problems.push(...memoryProblems(shown));
	for (const name of ['js-heap', 'page-memory'])
		if (result.noPageMemory && name in shown)
			problems.push(`the overlay shows ${name}, which the browser does not give`);
	expect('draws', /^[1-9]\d*$/);
	expect('triangles', /^[1-9]/);
	expect('objects', /^[1-9]/);
	if (!(figures.frames > 0)) problems.push('the sketch got no frame figures');
	if (figures.tier !== tier) problems.push(`the figures name the tier ${figures.tier}`);
	if (figures.preset !== mode.preset)
		problems.push(`the figures name the preset ${figures.preset}`);
	if (figures.renderScale !== 1)
		problems.push(`the figures give a render scale of ${figures.renderScale}`);
	for (const name of [
		'presentedFps',
		'completedFps',
		'cpuMs',
		'objects',
		'wasmBytes',
		'meshBytes',
	] as const)
		if (!(figures[name] > 0)) problems.push(`the figures give ${name} ${figures[name]}`);
	if (!(figures.triangles >= BOX_TRIANGLES))
		problems.push(`the figures give ${figures.triangles} triangles, fewer than the box's`);
	const names = figures.threads.map((thread) => thread.name).join(', ');
	const threads = statsThreads(mode);
	if (names !== threads.join(', ')) problems.push(`the figures name the threads ${names}`);
	return problems;
}
