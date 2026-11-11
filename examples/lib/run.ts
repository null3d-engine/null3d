// Starts a demo on a canvas. The examples page uses it, and so can any page that shows the demos
// in a layout of its own, such as the website's: the page owns the canvas, the text and the
// styles, and this module owns how a demo starts.
import {
	createEngine,
	type Engine,
	type EngineOptions,
	type QualityPreset,
	type StartupProgress,
	type StartupStage,
} from '@null3d/engine';
import type { Demo } from '../demos';
import type { HudGroup } from './controls';
import { createDrivePad } from './drive-pad';
import { createHud } from './hud';
import {
	bytesOf,
	LOAD_LANES,
	type LoadLane,
	LoadMeter,
	type LoadPhase,
	LoadPhases,
	StartMeter,
} from './progress';

/** The message that a demo posts to show a label, or to change its text. */
interface LabelMessage {
	/** The id that the sketch tracks the label under with ui.trackLabel. */
	id: string;
	text: string;
	/** A line under the text, for a `'page'` element. */
	detail?: string;
	/** True to highlight the label, such as for a selected object. */
	active?: boolean;
	/** The element's width in CSS pixels, for a label that is a plane of the scene. */
	width?: number;
	/**
	 * The element's height in CSS pixels, for a label that is a plane of the scene. A label with
	 * `kind: 'page'` is a page of its own, with a title bar and the text and detail on it.
	 */
	height?: number;
	/** `'page'` shows the element as a small embedded page; the default is plain text. */
	kind?: 'text' | 'page';
}

export interface StartOptions {
	canvas: HTMLCanvasElement;
	demo: Demo;
	/**
	 * The element that holds the demo's labels: it should cover the canvas and let the pointer
	 * through. Each label is a div with the class `label`, and `active` while the demo highlights
	 * it. Without a layer, the demo shows no labels. A demo with `backdrop` puts the layer below
	 * its canvas instead.
	 */
	labels?: HTMLElement;
	/**
	 * True shows the engine's stats overlay over the canvas's top-right corner, collapsed to its
	 * frame rate, which is the default. False leaves it off. The `?stats=off` switch hides it too,
	 * and a held frame never shows it.
	 */
	stats?: boolean;
	/**
	 * The quality preset that the page's address names. A production build reads no URL switches,
	 * so the page reads `?preset=` itself and passes it here. `createEngine`'s own switch wins in a
	 * development build.
	 */
	preset?: QualityPreset;
	/** The anti-aliasing mode that the page asks for, instead of the preset's own. */
	antialias?: 'msaa' | 'fxaa' | 'none';
	/**
	 * Settings that the page fixes at the engine's start, such as a measurement's shadow shape. They
	 * win over the preset's values, as `createEngine`'s options do.
	 */
	settings?: Partial<
		Pick<
			EngineOptions,
			| 'shadowCascades'
			| 'shadowMapSize'
			| 'shadowTiles'
			| 'shadowTileSize'
			| 'heroTileSize'
			| 'morphTargets'
		>
	>;
	/**
	 * The element that holds the buttons of the demo's choices, such as a time of day, for a demo
	 * that has some. Without it, the demo runs with its own first options.
	 */
	choices?: HTMLElement;
	/**
	 * The element that holds the demo's on-screen help, which a showcase scene posts: its keys and
	 * the camera mode. Without it, the demo shows no help. A held frame has none.
	 */
	hud?: HTMLElement;
	/**
	 * Aborting it removes the listeners, the loading overlay and the controls HUD that this demo
	 * added, so a page that starts a second demo in the same document leaves nothing of the first.
	 * The page still owns the canvas, its own elements and the engine.
	 */
	signal?: AbortSignal;
}

/** How long the loading overlay waits after the last loading message before it hides, in ms. */
const LOADER_QUIET_MS = 400;
/** The most of the sketch's early messages that the page keeps, as the engine keeps its own. */
const MAX_EARLY_MESSAGES = 256;

/** Starts the demo's sketch on the canvas, and resolves to its engine once it runs. */
export async function startDemo({
	canvas,
	demo,
	labels,
	stats = true,
	preset,
	antialias,
	settings,
	choices,
	hud,
	signal,
}: StartOptions): Promise<Engine> {
	// The demos zoom with the wheel and a trackpad pinch, which would otherwise scroll or zoom the page.
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false, signal });
	// The loading overlay covers the canvas from before the engine starts until the first frame draws.
	const loader = createLoader(canvas);
	// A stopped demo takes its loading overlay away with it; the controls HUD follows below.
	signal?.addEventListener('abort', () => loader.hide());
	// A demo with a backdrop draws over a page: the backdrop and the labels' layer go behind the
	// canvas, and the engine draws on a see-through canvas above them.
	const behind = demo.backdrop === true;
	if (behind) {
		const parent = canvas.parentElement;
		if (parent) {
			const page = createBackdrop();
			parent.insertBefore(page, canvas);
			// The canvas paints over the backdrop and the labels. A canvas in the page's flow keeps
			// its place with a relative position, which changes no layout.
			if (getComputedStyle(canvas).position === 'static') canvas.style.position = 'relative';
			if (labels) parent.insertBefore(labels, canvas);
			// A stopped demo takes its backdrop away with it, as it takes its overlay.
			signal?.addEventListener('abort', () => page.remove());
		}
	}
	// A scene that builds in stages posts its own loading messages, and its worker can outlive the
	// engine's first frame. The overlay then waits for a quiet gap after the last message or the
	// frame, so it fades once at the end of the build rather than twice over a drawn scene.
	let firstFrame = false;
	let firstFrameAt = 0;
	let lastLoadingAt = 0;
	const hideWhenQuiet = (): void => {
		if (!firstFrame) return;
		// A scene that posts nothing hides at the first frame. One that reports its own stages waits
		// for a quiet gap after the frame or its last message, so a stage that arrives late never
		// changes a card that is already going.
		const from = lastLoadingAt === 0 ? 0 : Math.max(lastLoadingAt, firstFrameAt);
		const wait = from + LOADER_QUIET_MS - performance.now();
		if (wait > 0) window.setTimeout(hideWhenQuiet, wait);
		else loader.hide();
	};
	const reachedFirstFrame = (): void => {
		firstFrame = true;
		firstFrameAt = performance.now();
		hideWhenQuiet();
	};
	let engine: Engine | undefined;
	/** The presses that arrived before the engine existed, which wait for it. */
	const pendingPresses: [string, string][] = [];
	/** Sends a press to the sketch, or keeps it until the engine exists. */
	const sendToSketch = (name: string, value: string): void => {
		if (engine) engine.postToSketch(name, value);
		else pendingPresses.push([name, value]);
	};
	/**
	 * The handlers of the demo's help and controls. They need only the page, so they take their
	 * messages as the sketch posts them. A showcase scene posts its controls once they exist, and
	 * the scene's own builds, which a slow machine takes minutes over, then follow: a page that
	 * held these messages until its start ended would show the controls only after the whole scene,
	 * which is the wait that a software GPU makes too long.
	 */
	const pageReaders = hud
		? [
				hudReader(sendToSketch, hud, signal),
				padReader(sendToSketch, hud, signal),
				pressReader(sendToSketch),
			]
		: [];
	/** The sketch's messages that need the engine, kept until it exists. */
	const early: [string, unknown][] = [];
	/** The handlers that need the engine, such as the labels' layer. */
	let engineReaders: ((type: string, data: unknown) => void)[] = [];
	// The page passes this handler at the start, so the sketch's loading messages arrive as its
	// setup runs rather than all at once at the end: the overlay follows the scene's own progress.
	const handleMessage = (type: string, data: unknown): void => {
		if (type === 'loading') {
			lastLoadingAt = performance.now();
			loader.note(data);
			hideWhenQuiet();
			return;
		}
		if (type === 'starting') {
			// A scene's own start-up work, counted against the stage it runs in. The message keeps the
			// card quiet until the work ends, so a scene that grows its first plants does not lose the
			// overlay to the quiet timer while they are still building.
			const at = data as { done?: unknown; total?: unknown } | undefined;
			if (typeof at?.done === 'number' && typeof at?.total === 'number') {
				lastLoadingAt = performance.now();
				loader.work(at.done, at.total);
				hideWhenQuiet();
			}
			return;
		}
		for (const reader of pageReaders) reader(type, data);
		if (!engine) {
			if (early.push([type, data]) > MAX_EARLY_MESSAGES) early.shift();
			return;
		}
		for (const reader of engineReaders) reader(type, data);
	};
	try {
		// Without a preset: the engine's start-up check picks one that the device holds at its frame
		// rate. A production build reads no URL switches, so the page passes the address's preset.
		engine = await createEngine({
			canvas,
			sketch: demo.sketch,
			largeWorld: demo.largeWorld,
			hdr: demo.hdr,
			momentTransparency: demo.momentTransparency,
			transparent: behind,
			preset,
			antialias,
			...settings,
			// Collapsed, the overlay stays small until clicked.
			stats: stats && { collapsed: true },
			onProgress: (stage: StartupStage, progress?: StartupProgress) => {
				// The loader hears of the first frame through `hideWhenQuiet`, with any last message.
				if (stage === 'first-frame') {
					reachedFirstFrame();
					return;
				}
				loader.stage(stage, progress);
			},
			onSketchMessage: handleMessage,
		});
	} catch (error) {
		loader.fail(error instanceof Error ? error.message : String(error));
		// The controls may have shown before the failure; they would act on a scene that never came.
		if (hud) hud.hidden = true;
		throw error;
	}
	if (choices) showChoices(engine, demo, choices);
	// One message handler for the page: the engine gives the messages that a sketch sent before the
	// page listened to the first handler alone, so two handlers would drop the help that a showcase
	// scene posts at its start. The same handler carries the loading progress that a scene posts.
	engineReaders = labels ? [labelReader(engine, labels)] : [];
	for (const [name, value] of pendingPresses.splice(0)) engine.postToSketch(name, value);
	// The engine's start handler stays the sketch's one handler, so the messages that arrived before
	// it existed now reach the handlers that need it, in the order that the sketch sent them.
	for (const [type, data] of early.splice(0))
		for (const reader of engineReaders) reader(type, data);
	// The overlay leaves once the first frame is drawn and the scene's own loading has gone quiet,
	// so a stage that reports after the frame never changes a card that is already going.
	void engine.firstFrame.then(reachedFirstFrame, reachedFirstFrame);
	// Browsers lock the pointer only right after the user acts, and refuse it on phones.
	if (demo.pointerLock)
		canvas.addEventListener('click', () => engine.requestPointerLock().catch(() => {}), { signal });
	return engine;
}

/** The text that a scene posts while it loads its files, for the loading overlay. */
interface LoadingMessage {
	/** What the scene is doing now, such as how many files have loaded. */
	text: string;
	/** A second line with the count, such as the bytes that arrived of a total. */
	detail?: string;
	/** How far the load has gone, from 0 to 1, for the bar. Without it, the bar keeps moving. */
	value?: number;
	/**
	 * `'files'` keeps the message in the downloads' lane, so it runs beside the scene's own
	 * milestones. `'build'` counts the scene's own work, such as the plants it grows, so the bar
	 * follows that work rather than a timer. Without either, the message names the scene's current
	 * phase.
	 */
	kind?: 'files' | 'build';
}

/** The loading overlay of a starting demo. */
export interface Loader {
	/** Shows the engine's start stage as the engine's phase under the main bar. */
	stage(stage: StartupStage, progress?: StartupProgress): void;
	/** Shows the progress that a scene posts while it loads, as the scene's phase. */
	note(data: unknown): void;
	/**
	 * Shows work that a scene does as part of starting itself, such as growing its first plants, as
	 * the scene's counted phase under the main bar.
	 */
	work(done: number, total: number): void;
	/** Fades the overlay out; the first frame is drawn. */
	hide(): void;
	/** Shows the error text in place of the progress; the start failed. */
	fail(text: string): void;
}

/** The text that the main bar names while the sketch starts. */
const START_TEXT = 'Starting the sketch';

/** The parts of a phase's row that the overlay updates. */
interface PhaseRow {
	root: HTMLElement;
	text: HTMLElement;
	detail: HTMLElement;
	fill: HTMLElement;
}

/**
 * Makes the loading overlay over the canvas: a glass card whose main bar shows the overall progress
 * of the start under the words "Starting the sketch". Below it, one temporary bar names each piece
 * of work as it happens — the engine's download, the engine and its workers starting, the scene's
 * files and its build. Each phase appears in its lane when its work begins and gives way when the
 * next phase of that lane begins, so a finished phase never keeps a bar. A phase whose work is
 * counted shows its percentage, and one without a total leaves its bar moving. The overlay fades
 * out when the first frame is drawn, and shows the error instead when the start fails.
 */
export function createLoader(canvas: HTMLCanvasElement): Loader {
	const host = canvas.parentElement ?? document.body;
	const overlay = document.createElement('div');
	overlay.className = 'loader';
	overlay.setAttribute('role', 'status');
	overlay.setAttribute('aria-live', 'polite');
	const box = document.createElement('div');
	box.className = 'loader__box';
	const head = document.createElement('div');
	head.className = 'loader__head';
	const label = document.createElement('p');
	label.className = 'loader__label';
	label.textContent = START_TEXT;
	// The visuals stay out of the live region: the hidden line below carries the text that a screen
	// reader announces, so a percentage that moves with every chunk never queues an announcement.
	label.setAttribute('aria-hidden', 'true');
	const percent = document.createElement('span');
	percent.className = 'loader__percent';
	percent.textContent = '0%';
	percent.setAttribute('aria-hidden', 'true');
	head.append(label, percent);
	const bar = document.createElement('div');
	bar.className = 'loader__bar';
	bar.setAttribute('aria-hidden', 'true');
	const fill = document.createElement('div');
	fill.className = 'loader__fill loader__fill--set';
	fill.style.width = '0%';
	bar.append(fill);
	const tasks = document.createElement('div');
	tasks.className = 'loader__tasks';
	tasks.setAttribute('aria-hidden', 'true');
	const say = document.createElement('p');
	say.className = 'loader__say';
	say.textContent = START_TEXT;
	box.append(head, bar, tasks, say);
	overlay.append(box);
	host.append(overlay);

	const phases = new LoadPhases();
	/** Each lane's percentage measure, which holds while its phase keeps its key. */
	const meters = Object.fromEntries(LOAD_LANES.map((lane) => [lane, new LoadMeter()])) as Record<
		LoadLane,
		LoadMeter
	>;
	const rows = new Map<LoadLane, PhaseRow>();
	const main = new StartMeter();
	/** Each lane's current phase key, so a repeated message does not start its phase again. */
	const laneKeys: Record<LoadLane, string> = { engine: '', files: '', scene: '' };
	/** True once the sketch posts its own messages, which only a running engine can send. */
	let sceneStarted = false;
	let painted = 0;
	let hidden = false;
	let said = '';

	/** The row for a lane's phase, made on first use and kept in lane order. */
	const rowFor = (lane: LoadLane): PhaseRow => {
		const existing = rows.get(lane);
		if (existing) return existing;
		const root = document.createElement('div');
		root.className = 'loader__task';
		const line = document.createElement('div');
		line.className = 'loader__task-head';
		const text = document.createElement('p');
		text.className = 'loader__task-text';
		const detail = document.createElement('span');
		detail.className = 'loader__task-detail';
		line.append(text, detail);
		const taskBar = document.createElement('div');
		taskBar.className = 'loader__task-bar';
		const taskFill = document.createElement('div');
		taskFill.className = 'loader__fill';
		taskBar.append(taskFill);
		root.append(line, taskBar);
		// A lane's row goes above the rows of the lanes that follow it, however late it appears.
		const later = LOAD_LANES.slice(LOAD_LANES.indexOf(lane) + 1)
			.map((other) => rows.get(other)?.root)
			.find((root) => root !== undefined);
		tasks.insertBefore(root, later ?? null);
		const row = { root, text, detail, fill: taskFill };
		rows.set(lane, row);
		return row;
	};

	/**
	 * Draws the main bar and the lanes' phases. The main bar eases while uncounted work runs, so a
	 * frame follows each paint until the estimate settles.
	 */
	const paint = (): void => {
		painted = 0;
		if (hidden) return;
		const now = performance.now();
		const overall = Math.round(main.value(now) * 100);
		percent.textContent = `${overall}%`;
		fill.style.width = `${overall}%`;
		const active = phases.list();
		for (const row of rows.values()) row.root.hidden = true;
		for (const { lane, phase } of active) {
			const row = rows.get(lane);
			if (!row) continue;
			row.root.hidden = false;
			row.text.textContent = phase.text;
			row.detail.textContent = phase.detail ?? '';
			if (phase.value === undefined) {
				row.fill.classList.remove('loader__fill--set');
				row.fill.style.width = '';
			} else {
				const value = Math.round(Math.min(1, Math.max(0, phase.value)) * 100);
				row.fill.classList.add('loader__fill--set');
				row.fill.style.width = `${value}%`;
			}
		}
		const spoken = active.map(({ phase }) => phase.text);
		const next = `${START_TEXT}, ${Math.floor(overall / 10) * 10} per cent${
			spoken.length ? `. ${spoken.join('. ')}` : ''
		}`;
		if (next !== said) {
			said = next;
			say.textContent = next;
		}
		if (main.moving(now)) painted = requestAnimationFrame(paint);
	};

	/** Draws at most once per frame, however many messages a scene posts. */
	const schedulePaint = (): void => {
		if (!painted && !hidden) painted = requestAnimationFrame(paint);
	};

	/** Shows a lane's phase with its meter's figure, replacing the lane's previous phase. */
	const showPhase = (lane: LoadLane, phase: LoadPhase): void => {
		rowFor(lane);
		phases.show(lane, meters[lane].show(phase));
		schedulePaint();
	};

	/** Ends a lane's phase, so its finished bar stops showing on the next paint. */
	const clearPhase = (lane: LoadLane): void => {
		phases.clear(lane);
		schedulePaint();
	};

	/**
	 * Marks the sketch as running. Its own first message ends the engine's start phase: only an
	 * engine that has started can send it, so its row would otherwise keep a moving bar through the
	 * whole scene build.
	 */
	const beginScene = (): void => {
		if (sceneStarted) return;
		sceneStarted = true;
		clearPhase('engine');
	};

	const hide = (): void => {
		if (hidden) return;
		// The first frame earns the whole bar, which the fade then carries out.
		main.finish();
		percent.textContent = '100%';
		fill.style.width = '100%';
		hidden = true;
		if (painted) cancelAnimationFrame(painted);
		painted = 0;
		overlay.classList.add('loader--done');
		const remove = () => overlay.remove();
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
		else setTimeout(remove, 320);
	};

	// The overlay shows before the engine reports anything: the main bar begins its first stretch.
	main.begin();
	schedulePaint();

	return {
		work(done, total) {
			if (hidden || !(total > 0) || done < 0) return;
			beginScene();
			const value = Math.min(1, done / total);
			laneKeys.scene = 'build';
			showPhase('scene', {
				key: 'build',
				text: 'Building the scene',
				detail: `${done} of ${total}`,
				value,
			});
			main.build(value);
		},
		stage(stage, progress) {
			if (stage === 'first-frame') {
				hide();
				return;
			}
			const now = performance.now();
			if (stage === 'core-download') {
				const done = progress?.done ?? 0;
				const total = progress?.total ?? 0;
				// A body that arrives larger than its announced length, as a compressed response can,
				// leaves no fraction to show: the bytes that arrived still count.
				const measured = total > 0 && done <= total;
				if (!sceneStarted)
					showPhase('engine', {
						key: 'engine-download',
						text: 'Downloading the engine',
						detail: measured ? `${bytesOf(done)} of ${bytesOf(total)}` : bytesOf(done),
						value: measured ? done / total : undefined,
					});
				main.engine(measured ? done / total : undefined, now);
				return;
			}
			if (stage === 'memory-wait') {
				if (!sceneStarted)
					showPhase('engine', { key: 'memory-wait', text: 'Waiting for the engine memory' });
				main.waitForMemory(now);
				return;
			}
			if (stage === 'core') {
				if (!sceneStarted) showPhase('engine', { key: 'core', text: 'Starting the engine' });
				main.core(now);
				return;
			}
			// The sketch's own messages may arrive before this stage; the scene is then already
			// running, and a workers phase would put a finished bar back on the card.
			if (sceneStarted) return;
			showPhase('engine', { key: 'workers', text: 'Starting the workers' });
			main.workers(now);
		},
		note(data) {
			if (hidden) return;
			if (typeof data === 'string') {
				beginScene();
				const key = `text:${data}`;
				if (key !== laneKeys.scene) {
					laneKeys.scene = key;
					main.scene();
				}
				showPhase('scene', { key, text: data });
				return;
			}
			const message = data as Partial<LoadingMessage> | null;
			if (!message || typeof message.text !== 'string') return;
			beginScene();
			const lane: LoadLane = message.kind === 'files' ? 'files' : 'scene';
			const counted = typeof message.value === 'number' && Number.isFinite(message.value);
			const key = `${lane}:${message.text}`;
			if (counted && message.kind === 'build') main.build(message.value as number);
			else if (counted) main.files(message.value as number);
			else if (key !== laneKeys[lane]) main.scene();
			laneKeys[lane] = key;
			showPhase(lane, {
				key,
				text: message.text,
				detail: typeof message.detail === 'string' ? message.detail : undefined,
				value: counted ? (message.value as number) : undefined,
			});
		},
		hide,
		fail(text) {
			hidden = true;
			if (painted) cancelAnimationFrame(painted);
			painted = 0;
			overlay.classList.add('loader--error');
			label.textContent = text;
			label.classList.add('loader__label--error');
			percent.hidden = true;
			tasks.hidden = true;
			bar.hidden = true;
			say.textContent = text;
		},
	};
}

/**
 * Shows each of the demo's choices as a group of buttons, and sends each pick to the sketch as a
 * message named by the choice. Each group is a `div` with the class `choice`, which holds a label
 * and a button for each option. The picked button has `aria-pressed="true"`, and the first option
 * starts picked, as the sketch starts with it.
 */
function showChoices(engine: Engine, demo: Demo, element: HTMLElement): void {
	for (const choice of demo.choices ?? []) {
		const group = document.createElement('div');
		group.className = 'choice';
		group.setAttribute('role', 'group');
		const label = document.createElement('span');
		label.textContent = choice.label;
		group.append(label);
		const buttons = choice.options.map((option, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = option;
			button.setAttribute('aria-pressed', String(index === 0));
			button.addEventListener('click', () => {
				for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
				engine.postToSketch(choice.name, option);
			});
			return button;
		});
		group.setAttribute('aria-label', choice.label);
		group.append(...buttons);
		element.append(group);
	}
}

/** Reads the labels that the demo posts, each into a tag that follows the label's object. */
function labelReader(engine: Engine, layer: HTMLElement): (type: string, data: unknown) => void {
	const tags = new Map<string, HTMLElement>();
	return (type, data) => {
		if (type !== 'label') return;
		const { id, text, detail, active = false, width, height, kind = 'text' } = data as LabelMessage;
		let tag = tags.get(id);
		if (!tag) {
			tag = kind === 'page' ? pageCard(width, height) : document.createElement('div');
			if (kind !== 'page') {
				// A label that is a plane of the scene is sized in CSS pixels, which are the scene's units.
				const sized = width !== undefined || height !== undefined;
				tag.className = sized ? 'label label--card' : 'label';
				if (width !== undefined) tag.style.width = `${width}px`;
				if (height !== undefined) tag.style.height = `${height}px`;
				if (sized) tag.style.boxSizing = 'border-box';
			}
			layer.append(tag);
			tags.set(id, tag);
			engine.labels.bind(id, tag);
		}
		const parts = pageParts.get(tag);
		if (parts) {
			parts.title.textContent = text;
			parts.detail.textContent = detail ?? '';
			return;
		}
		tag.textContent = text;
		tag.classList.toggle('active', active);
	};
}

/** The title and the detail of a page card, which the label's messages update. */
interface PageParts {
	title: HTMLElement;
	detail: HTMLElement;
}

/** The parts of each page card that a label's messages update. */
const pageParts = new WeakMap<HTMLElement, PageParts>();

/**
 * A label shown as a small embedded page: a title bar, a heading and a line of detail, sized in
 * CSS pixels. The page is styled through the DOM so it looks the same in any page's layout.
 */
function pageCard(width?: number, height?: number): HTMLElement {
	const card = document.createElement('div');
	card.className = 'label-page';
	Object.assign(card.style, {
		boxSizing: 'border-box',
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column',
		borderRadius: '12px',
		border: '1px solid rgb(255 255 255 / 0.14)',
		background: 'linear-gradient(165deg, #141c29 0%, #0a0f18 60%, #0c1726 100%)',
		boxShadow: '0 30px 90px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.08)',
		color: '#e8f1ff',
		fontFamily: 'Helvetica, Arial, sans-serif',
		pointerEvents: 'none',
	});
	if (width !== undefined) card.style.width = `${width}px`;
	if (height !== undefined) card.style.height = `${height}px`;
	const bar = document.createElement('div');
	Object.assign(bar.style, {
		height: '26px',
		flex: '0 0 auto',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
		padding: '0 12px',
		background: 'rgb(255 255 255 / 0.05)',
	});
	for (const tone of ['#ff6b5f', '#ffc94d', '#5fd48a']) {
		const dot = document.createElement('span');
		Object.assign(dot.style, {
			width: '7px',
			height: '7px',
			borderRadius: '50%',
			background: tone,
		});
		bar.append(dot);
	}
	const body = document.createElement('div');
	Object.assign(body.style, {
		flex: '1 1 auto',
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'center',
		alignItems: 'center',
		gap: '10px',
		padding: '0 26px',
		textAlign: 'center',
	});
	const title = document.createElement('div');
	Object.assign(title.style, { fontSize: '26px', fontWeight: '700', letterSpacing: '0.18em' });
	const detail = document.createElement('div');
	Object.assign(detail.style, {
		fontSize: '13px',
		lineHeight: '1.45',
		color: '#9fb6d4',
		maxWidth: '300px',
	});
	const action = document.createElement('div');
	action.textContent = 'Open the hall';
	Object.assign(action.style, {
		marginTop: '4px',
		padding: '7px 16px',
		borderRadius: '999px',
		fontSize: '12px',
		letterSpacing: '0.08em',
		background: 'rgb(126 180 255 / 0.18)',
		border: '1px solid rgb(126 180 255 / 0.35)',
		color: '#cfe4ff',
	});
	body.append(title, detail, action);
	card.append(bar, body);
	pageParts.set(card, { title, detail });
	return card;
}

/**
 * The page that a demo with `backdrop` draws over: a light surface behind the canvas, so the
 * see-through parts of the scene show the page rather than the layout's background.
 */
function createBackdrop(): HTMLElement {
	const page = document.createElement('div');
	page.className = 'demo-backdrop';
	page.setAttribute('aria-hidden', 'true');
	Object.assign(page.style, {
		position: 'absolute',
		inset: '0',
		pointerEvents: 'none',
		// A ruled page, so the see-through canvas reads as a layer over a document.
		background:
			'repeating-linear-gradient(0deg, rgb(32 42 62 / 0.05) 0 1px, transparent 1px 44px), ' +
			'repeating-linear-gradient(90deg, rgb(32 42 62 / 0.05) 0 1px, transparent 1px 44px), ' +
			'radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #f2eee6 38%, #dfe6f0 100%)',
	});
	return page;
}

/**
 * Sends on a press that a scene's controls took in the world, such as on a vehicle's console, as
 * the page's own controls panel sends a press: the scene answers both alike.
 */
function pressReader(
	post: (name: string, value: string) => void,
): (type: string, data: unknown) => void {
	return (type, data) => {
		if (type !== 'hud-press') return;
		const { name, value } = data as { name: string; value: string };
		post(name, value);
	};
}

/**
 * Shows the on-screen driving pad while a scene that the user drives asks for it, with a
 * `drive-pad` message. The pad sits under the controls panel, which stays above it.
 */
function padReader(
	post: (name: string, value: string) => void,
	hud: HTMLElement,
	signal?: AbortSignal,
): (type: string, data: unknown) => void {
	let pad: ReturnType<typeof createDrivePad> | undefined;
	signal?.addEventListener('abort', () => pad?.dispose());
	return (type, data) => {
		if (type !== 'drive-pad') return;
		const on = (data as { visible: boolean }).visible;
		// A scene that never drives makes no pad.
		if (!pad && !on) return;
		pad ??= createDrivePad(hud.parentElement ?? hud, hud, post);
		pad.show(on);
	};
}

/** The message that a showcase scene posts with its controls. */
interface HudMessage {
	/** The groups of buttons: modes and effects, with the camera group first. */
	groups: HudGroup[];
	/** False hides the whole control. */
	visible: boolean;
}

/**
 * Draws the controls that a showcase scene posts: a chevron that opens a glass panel of grouped
 * buttons. A row with an action is a button, which sends the action's message to the sketch, so a
 * touch screen with no keyboard can press it. A held frame posts none.
 */
function hudReader(
	post: (name: string, value: string) => void,
	element: HTMLElement,
	signal?: AbortSignal,
): (type: string, data: unknown) => void {
	const stage = element.parentElement ?? element;
	const hud = createHud(element, stage, post);
	// The page may start another demo here: the HUD leaves with the demo's own signal.
	signal?.addEventListener('abort', () => hud.dispose());
	return (type, data) => {
		if (type !== 'hud') return;
		const { groups, visible } = data as HudMessage;
		hud.render({ groups }, visible);
	};
}
