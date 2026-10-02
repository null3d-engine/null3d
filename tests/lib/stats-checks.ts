// Checks of the stats page's result, shared by the Playwright test and the real-browser runner: the
// overlay sits on the canvas's top-left corner, lets the pointer through and shows the figures, and
// the sketch's frame figures name every engine thread as `engine.measure` names them.

/** The figures of `debug.frameStats`, as the sketch posts their JSON. */
export interface StatsFigures {
	frames: number;
	presentedFps: number;
	completedFps: number;
	cpuMs: number;
	tier: string;
	preset: string;
	renderScale: number;
	threads: { name: string; busyMs: number; phases: Record<string, number> }[];
}

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
	/** The overlay's text, its place from the canvas's top-left corner, and its pointer events. */
	overlay: { text: string; offset: [number, number]; pointerEvents: string } | null;
	figures: StatsFigures;
};

/** The threads that a mode's figures name, as `engine.measure` names them. */
export function statsThreads(mode: StatsResult['mode']): string[] {
	const sketch =
		mode.latency === 'single' || mode.sketchThread === 'main' ? 'main' : 'sketch-worker';
	const named = mode.renderThread === sketch ? [sketch] : [sketch, mode.renderThread];
	return [...named, ...Array.from({ length: mode.jobWorkers }, (_, k) => `job-${k}`)];
}

/** What is wrong with a stats page's result; empty when nothing is. */
export function statsProblems(result: StatsResult): string[] {
	const { overlay, figures, mode, tier } = result;
	if (!overlay) return ['the page shows no stats overlay'];
	const problems: string[] = [];
	if (overlay.offset[0] !== 0 || overlay.offset[1] !== 0)
		problems.push(`the overlay sits ${overlay.offset.join(', ')} px from the canvas's corner`);
	if (overlay.pointerEvents !== 'none') problems.push('the overlay takes pointer events');
	const threads = statsThreads(mode);
	const named = threads.filter((name) => !name.startsWith('job-'));
	const expectedText = [
		`${tier}  ${mode.preset}  scale 1.00`,
		'fps presented',
		...named.map((name) => `${name}  `),
		...(mode.jobWorkers > 0 ? [`job workers (${mode.jobWorkers})`] : []),
	];
	for (const text of expectedText)
		if (!overlay.text.includes(text)) problems.push(`the overlay does not show "${text.trim()}"`);
	if (!(figures.frames > 0)) problems.push('the sketch got no frame figures');
	if (figures.tier !== tier) problems.push(`the figures name the tier ${figures.tier}`);
	if (figures.preset !== mode.preset)
		problems.push(`the figures name the preset ${figures.preset}`);
	if (figures.renderScale !== 1)
		problems.push(`the figures give a render scale of ${figures.renderScale}`);
	for (const name of ['presentedFps', 'completedFps', 'cpuMs'] as const)
		if (!(figures[name] > 0)) problems.push(`the figures give ${name} ${figures[name]}`);
	const names = figures.threads.map((thread) => thread.name).join(', ');
	if (names !== threads.join(', ')) problems.push(`the figures name the threads ${names}`);
	return problems;
}
