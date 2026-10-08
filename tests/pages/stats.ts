// Starts the engine with the stats overlay on from the page: through the `stats` option, or through
// the `?stats` switch when the address holds it. The sketch reads its frame figures every frame.
// Once the overlay and the sketch both show a window's figures, with the triangles and objects
// drawn and the meshes' memory, it reports what the overlay shows, its place on the canvas and its
// pointer events, and the sketch's figures.
//
// `?no-page-memory` hides the browser's JavaScript heap and page memory figures, as a browser
// without them would. `?instances=N` asks the sketch for N instance rows and a light that casts
// shadows, and waits until the figures and the overlay count at least their GPU memory. `?quiet` runs a sketch that reads no figures, so that only the overlay turns
// the engine's sampling on, and reports once the first frame is on screen. With `?render=main` the
// engine draws on this thread, where the page counts the GPU timing work that it does.
//
// The window then gets `showStats(show)`, which asks the sketch to show or hide the overlay,
// `showPageStats(request)`, which asks the page, `readOverlay()`, `gpuCalls()` and `stopEngine()`.
import { createEngine, type StatsOverlayOptions } from '@null3d/engine';
import {
	gpuTimerFeature,
	instanceFloors,
	type OverlayBoxes,
	type OverlayView,
	type StatsFigures,
	type StatsInstances,
	type StatsResult,
	tenths,
} from '../lib/stats-checks';
import { run } from './lib/result';

declare global {
	interface Window {
		showStats?: (show: boolean) => void;
		showPageStats?: (show: boolean | StatsOverlayOptions) => void;
		readOverlay?: () => OverlayView | null;
		gpuCalls?: () => GpuCalls;
		overlayBoxes?: () => OverlayBoxes;
		focusRing?: () => { focused: boolean; outline: string };
		elementAt?: (x: number, y: number) => string | undefined;
		inputSeen?: () => { keys: string[]; canvasDowns: number };
		stopEngine?: () => Promise<void>;
	}
}

/** The input that reached the page's window and the canvas. */
const seen = { keys: [] as string[], canvasDowns: 0 };
addEventListener('keydown', (event) => seen.keys.push(event.key));
window.inputSeen = () => ({ keys: [...seen.keys], canvasDowns: seen.canvasDowns });

/** The overlay's header button, inside its shadow root. */
const headerButton = () =>
	document.querySelector('[data-null3d-stats]')?.shadowRoot?.querySelector('button') ?? null;

window.focusRing = () => {
	const button = headerButton();
	return {
		focused: button?.matches(':focus-visible') ?? false,
		outline: button ? getComputedStyle(button).outlineStyle : '',
	};
};
window.elementAt = (x, y) => document.elementFromPoint(x, y)?.tagName;

/** The GPU timing work that the page's thread did: timer queries, query resolves and readbacks. */
interface GpuCalls {
	timerQueries: number;
	resolves: number;
	readbacks: number;
}

/** How long the page waits for the figures of a window. */
const WAIT_MS = 10_000;

const params = new URLSearchParams(location.search);

if (params.has('no-page-memory'))
	for (const name of ['memory', 'measureUserAgentSpecificMemory'])
		Object.defineProperty(performance, name, { value: undefined, configurable: true });

const calls: GpuCalls = { timerQueries: 0, resolves: 0, readbacks: 0 };
window.gpuCalls = () => ({ ...calls });

/** Counts the calls of a method on a prototype, where the browser has it. */
function count(prototype: object | undefined, method: string, counter: keyof GpuCalls): void {
	if (!prototype) return;
	const original = Reflect.get(prototype, method);
	if (typeof original !== 'function') return;
	Reflect.set(prototype, method, function (this: unknown, ...args: unknown[]) {
		calls[counter]++;
		return original.apply(this, args);
	});
}
count(globalThis.GPUCommandEncoder?.prototype, 'resolveQuerySet', 'resolves');
count(globalThis.GPUBuffer?.prototype, 'mapAsync', 'readbacks');
count(globalThis.WebGL2RenderingContext?.prototype, 'beginQuery', 'timerQueries');

/** What the overlay shows, read through its shadow root. */
function readOverlay(canvas: HTMLCanvasElement): OverlayView | null {
	const host = document.querySelector<HTMLElement>('[data-null3d-stats]');
	const root = host?.shadowRoot;
	if (!host || !root) return null;
	const figures: Record<string, string> = {};
	for (const node of root.querySelectorAll<HTMLElement>('[data-figure]'))
		if (!node.closest('[hidden]')) figures[node.dataset.figure as string] = node.textContent ?? '';
	const box = host.getBoundingClientRect();
	const canvasBox = canvas.getBoundingClientRect();
	return {
		figures,
		expanded: root.querySelector('button')?.getAttribute('aria-expanded') ?? null,
		offset: [canvasBox.right - box.right, box.top - canvasBox.top],
		pointerEvents: getComputedStyle(host).pointerEvents,
	};
}

run('stats', async (): Promise<StatsResult> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const bySwitch = params.has('stats');
	const quiet = params.has('quiet');
	const engine = await createEngine({
		canvas,
		sketch: quiet
			? new URL('./sketches/stats-quiet-sketch.ts', import.meta.url)
			: new URL('./sketches/stats-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		...(bySwitch ? {} : { stats: true }),
	});
	await engine.firstFrame;
	window.showStats = (show) => engine.postToSketch('show', show);
	window.showPageStats = (show) => engine.stats(show);
	window.readOverlay = () => readOverlay(canvas);
	canvas.addEventListener('pointerdown', () => seen.canvasDowns++);
	window.overlayBoxes = () => {
		const box = (element: Element | null): OverlayBoxes['canvas'] => {
			const { left, top, right, bottom } = (element as Element).getBoundingClientRect();
			return { left, top, right, bottom };
		};
		return {
			canvas: box(canvas),
			host: box(document.querySelector('[data-null3d-stats]')),
			button: box(headerButton()),
		};
	};
	window.stopEngine = () => engine.destroy();
	const gpuTimer = engine.capabilities.features.includes(gpuTimerFeature(engine.capabilities.tier));
	const result = {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		gpuTimer,
		noPageMemory: params.has('no-page-memory'),
		instances: null,
	};
	if (quiet) return { ...result, overlay: readOverlay(canvas), figures: null };
	/** Posts a message to the sketch, and resolves with the data of its answer of the same name. */
	const ask = <T>(message: string, data?: unknown) =>
		new Promise<T>((resolve) => {
			const off = engine.onSketchMessage((name, answer) => {
				if (name !== message) return;
				off();
				resolve(answer as T);
			});
			engine.postToSketch(message, data);
		});
	const askFigures = () => ask<StatsFigures>('figures');
	const rows = Number(params.get('instances') ?? 0);
	const instances: StatsInstances | null =
		rows > 0 ? { rows, ...(await ask<Omit<StatsInstances, 'rows'>>('instances', rows)) } : null;
	const floors = instances && instanceFloors(instances);
	/** True once the figures and the overlay count the GPU memory of the instances asked for. */
	const counted = (figures: StatsFigures) => {
		if (!floors) return true;
		const shown = readOverlay(canvas)?.figures ?? {};
		return (
			figures.gpuBufferBytes >= floors.buffers &&
			figures.gpuTextureBytes >= floors.textures &&
			tenths(shown['gpu-buffers']) >= Math.floor((floors.buffers * 10) / 2 ** 20) &&
			tenths(shown['gpu-textures']) >= Math.floor((floors.textures * 10) / 2 ** 20)
		);
	};
	const ready = (figures: StatsFigures) =>
		figures.frames > 0 &&
		figures.triangles > 0 &&
		figures.meshBytes > 0 &&
		figures.gpuTextureBytes > 0 &&
		figures.gpuBufferBytes > 0 &&
		counted(figures) &&
		(!gpuTimer || figures.gpuMs !== null) &&
		// The overlay refreshes a few times a second, so it can show the GPU row as still measuring
		// for a moment after the figures hold a GPU time.
		(!gpuTimer || /^\d/.test(readOverlay(canvas)?.figures.gpu ?? '')) &&
		/^[1-9]/.test(readOverlay(canvas)?.figures.triangles ?? '');
	const until = performance.now() + WAIT_MS;
	let figures = await askFigures();
	while (!ready(figures) && performance.now() < until) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		figures = await askFigures();
	}
	return { ...result, instances, overlay: readOverlay(canvas), figures };
});
