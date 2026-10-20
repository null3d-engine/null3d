// The comparison panel of the clone's examples page: `?compare=<name>` runs a comparison with one
// engine, which `?engine=null3d` or `?engine=threejs` names, in the mode that `?mode=scene-graph` or
// `?mode=instanced` names. A caption over the canvas holds the controls: the engine and mode
// switches, the count slider, the effect switches, "Run the ramp", and the "about this comparison"
// panel. Each engine runs on a page of its own, so the switch loads the
// page again, and the ramp does too: it runs on the engine that runs, keeps the result for the
// session, loads the page with the other engine, runs there, and shows both results.
//
// A visitor gets the guided walkthrough: an intro before anything draws, null3D's ramp, three.js's
// ramp on the same counts, and a summary of both. `?walkthrough=off` keeps the manual controls for
// a developer, and picking an engine, an effect set or the manual ramp leaves the walkthrough.

import type { Comparison } from './compare/comparisons';
import {
	type ComparisonRun,
	ENGINE_TITLES,
	type EngineName,
	FAIRNESS_RULES,
	type GpuChoice,
	measureDisplayHz,
	rampComparison,
	startComparison,
	thisDeviceClass,
} from './lib/compare';
import { type CompareMode, effectsFromText, modeFromText } from './lib/compare-scene';
import {
	countToSlider,
	FLOOR_FPS,
	noFrameText,
	type RampPlan,
	type RampResult,
	rampSteps,
	SLIDER_STEPS,
	sliderToCount,
	startCount,
	stopText,
} from './lib/ramp';
import { createLoader, type Loader } from './lib/run';
import { sourceUrl } from './lib/source';
import {
	clearWalkthrough,
	readWalkthrough,
	startingStep,
	summaryRows,
	summaryWins,
	WalkthroughFlow,
	type WalkthroughRun,
	winsSentences,
	writeWalkthrough,
} from './lib/walkthrough';

/** A new element with its text and, for a link, its address. */
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', href?: string) {
	const node = document.createElement(tag);
	node.textContent = text;
	if (href !== undefined) node.setAttribute('href', href);
	return node;
}

/** A button that runs its action. */
function button(text: string, action: () => void, primary = false): HTMLButtonElement {
	const node = element('button', text);
	node.type = 'button';
	if (primary) node.className = 'primary';
	node.addEventListener('click', action);
	return node;
}

/** A ramp's result, as the session keeps it between the two engines' pages. */
interface KeptRamp {
	engine: EngineName;
	label: string;
	result: RampResult;
}

const rampKey = (comparison: Comparison, mode: CompareMode) =>
	`null3d-compare-ramp:${comparison.name}:${mode}`;

function keptRamps(comparison: Comparison, mode: CompareMode): KeptRamp[] {
	try {
		return JSON.parse(sessionStorage.getItem(rampKey(comparison, mode)) ?? '[]') as KeptRamp[];
	} catch {
		return [];
	}
}

function keepRamps(comparison: Comparison, mode: CompareMode, ramps: KeptRamp[]): void {
	try {
		sessionStorage.setItem(rampKey(comparison, mode), JSON.stringify(ramps));
	} catch {
		// Without session storage, the page shows each engine's result on its own.
	}
}

const other = (engine: EngineName): EngineName => (engine === 'null3d' ? 'threejs' : 'null3d');

/**
 * The headline: each engine's largest count at the ramp's floor or above, on this device, then
 * where and why each engine's ramp stopped.
 */
function rampLine(comparison: Comparison, ramps: KeptRamp[]): string {
	const kept = (engine: EngineName) => ramps.find((ramp) => ramp.engine === engine);
	const parts = (['null3d', 'threejs'] as const)
		.map((engine) => {
			const ramp = kept(engine);
			return ramp
				? `${ENGINE_TITLES[engine]} held ${ramp.result.held.toLocaleString('en-US')}`
				: '';
		})
		.filter(Boolean);
	const floor = ramps[0]?.result.floorFps ?? FLOOR_FPS;
	const stops = ramps.map((ramp) => {
		const title = ENGINE_TITLES[ramp.engine];
		return [
			stopText(title, ramp.result, comparison.countUnit),
			noFrameText(title, ramp.result, comparison.countUnit),
		]
			.filter(Boolean)
			.join(' ');
	});
	return [
		`${parts.join(', ')} ${comparison.countUnit} at ${floor} fps or more on this device.`,
		...stops,
	]
		.filter(Boolean)
		.join(' ');
}

/** A count with the scene's unit, as the page writes it. */
const countText = (comparison: Comparison, count: number) =>
	`${count.toLocaleString('en-US')} ${comparison.countUnit}`;

/** An inline SVG icon, sized for a control's glyph. */
function icon(size: number): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');
	return svg;
}

/** A stroked path of an icon. */
function stroked(svg: SVGSVGElement, d: string, width = 1.7): void {
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', d);
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', String(width));
	path.setAttribute('stroke-linecap', 'round');
	svg.append(path);
}

/** The small "scene and comparison details" glyph beside the title. */
function infoIcon(): SVGSVGElement {
	const svg = icon(17);
	stroked(svg, 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0', 1.6);
	stroked(svg, 'M12 10.6v5.6', 1.8);
	const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	dot.setAttribute('cx', '12');
	dot.setAttribute('cy', '7.6');
	dot.setAttribute('r', '1.15');
	dot.setAttribute('fill', 'currentColor');
	svg.append(dot);
	return svg;
}

/** The sheet's close glyph. */
function closeIcon(): SVGSVGElement {
	const svg = icon(14);
	stroked(svg, 'M6 6l12 12M18 6L6 18', 2);
	return svg;
}

/** Waits, and returns at once when the signal aborts. */
function abortableWait(seconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		};
		const timer = setTimeout(done, seconds * 1000);
		signal.addEventListener('abort', done, { once: true });
	});
}

/** Runs a comparison in the page's panel, with its controls in a caption at the top left. */
export async function runComparison(stage: HTMLElement, comparison: Comparison): Promise<void> {
	const params = new URLSearchParams(location.search);
	const engine: EngineName = params.get('engine') === 'threejs' ? 'threejs' : 'null3d';
	const effects = effectsFromText(params.get('effects'));
	const mode = modeFromText(params.get('mode'));
	const named = params.get('renderer');
	const threeRenderer = named === 'webgpu' || named === 'webgl' ? named : undefined;
	// A developer's page: no intro, and the controls start the engine at once.
	const manual = params.get('walkthrough') === 'off' || params.has('ramp');
	// A device run measures the running engine for this many seconds and publishes the figures.
	const measureSeconds = Number(params.get('measure') ?? '0');
	const devicePlan = comparison.ramps[thisDeviceClass()];
	document.title = `${comparison.title}, null3D and three.js: null3D demos`;
	const address = (changes: Record<string, string | null>) => {
		const next = new URLSearchParams(params);
		for (const [name, value] of Object.entries(changes)) {
			if (value === null) next.delete(name);
			else next.set(name, value);
		}
		return `?${next}`;
	};

	const canvas = element('canvas');
	const caption = element('section');
	caption.className = 'caption compare';
	caption.setAttribute('aria-label', 'Comparison controls');

	// The title, with the scene's details behind one small button beside it.
	const head = element('div');
	head.className = 'caption-head';
	const title = element('h1', comparison.title);
	const infoWrap = element('span');
	infoWrap.className = 'info-wrap';
	const infoButton = element('button');
	infoButton.type = 'button';
	infoButton.className = 'info-button';
	infoButton.setAttribute('aria-label', 'Scene and comparison details');
	infoButton.setAttribute('aria-haspopup', 'dialog');
	infoButton.setAttribute('aria-expanded', 'false');
	infoButton.append(infoIcon());
	infoWrap.append(infoButton);
	head.append(title, infoWrap);
	caption.append(head);

	// The tip floats over the stage, outside the panel, so no edge of the panel can clip it.
	const tip = element('div', 'Scene and comparison details');
	tip.className = 'compare-tip';
	tip.setAttribute('role', 'tooltip');
	tip.hidden = true;
	stage.append(tip);
	const showTip = (): void => {
		const box = infoButton.getBoundingClientRect();
		const stageBox = stage.getBoundingClientRect();
		tip.style.left = `${box.left - stageBox.left + box.width / 2}px`;
		tip.style.top = `${box.bottom - stageBox.top + 6}px`;
		tip.hidden = false;
	};
	const hideTip = (): void => {
		tip.hidden = true;
	};
	infoButton.addEventListener('pointerenter', showTip);
	infoButton.addEventListener('pointerleave', hideTip);
	infoButton.addEventListener('focus', showTip);
	infoButton.addEventListener('blur', hideTip);

	// The engine switch: each engine on a page of its own, with the manual controls.
	const switcher = element('p');
	switcher.className = 'switch engines';
	for (const name of ['null3d', 'threejs'] as const) {
		const link = element(
			'a',
			ENGINE_TITLES[name],
			address({ engine: name, ramp: null, walkthrough: 'off' }),
		);
		if (name === engine) link.setAttribute('aria-current', 'page');
		switcher.append(link);
	}
	caption.append(switcher);

	// The count slider, on a log scale.
	const slider = element('input');
	slider.type = 'range';
	slider.min = '0';
	slider.max = String(SLIDER_STEPS);
	slider.setAttribute('aria-label', comparison.countUnit);
	const countLabel = element('output');
	const counter = element('label');
	counter.className = 'count';
	counter.append(slider, countLabel);
	caption.append(counter);

	const rampButton = element('button', 'Run the ramp');
	rampButton.type = 'button';
	const result = element('p');
	result.className = 'result';
	result.setAttribute('aria-live', 'polite');
	caption.append(rampButton, result);

	const code = element('a', 'View code', sourceUrl(comparison));
	code.target = '_blank';
	code.rel = 'noopener';
	const links = element('p');
	links.className = 'quiet';
	links.append(code);
	caption.append(links);

	// The details sheet: the scene's description, how each engine draws it, and what both share.
	const backdrop = element('div');
	backdrop.className = 'sheet-backdrop';
	backdrop.hidden = true;
	const sheet = element('section');
	sheet.className = 'sheet';
	sheet.hidden = true;
	sheet.setAttribute('role', 'dialog');
	sheet.setAttribute('aria-modal', 'true');
	sheet.setAttribute('aria-labelledby', 'sheet-title');
	const sheetHead = element('div');
	sheetHead.className = 'sheet-head';
	const sheetTitle = element('h2', comparison.title);
	sheetTitle.id = 'sheet-title';
	const closeButton = element('button');
	closeButton.type = 'button';
	closeButton.className = 'sheet-close';
	closeButton.setAttribute('aria-label', 'Close details');
	closeButton.append(closeIcon());
	sheetHead.append(sheetTitle, closeButton);
	const sheetBody = element('div');
	sheetBody.className = 'sheet-body';
	// The route this page measures, so the sheet never claims a route the page is not drawing.
	const route = mode === 'instanced' ? 'The instanced route' : 'The scene graph route';
	sheetBody.append(
		element('p', comparison.summary),
		element('p', `${route}: ${comparison.modes[mode]}`),
		element('h3', 'How each engine draws it'),
	);
	const table = element('div');
	table.className = 'compare-table';
	const header = element('div');
	header.className = 'compare-row compare-head';
	const blank = element('span');
	const nullColumn = element('span', 'null3D');
	nullColumn.className = 'null3d';
	const threeColumn = element('span', 'three.js');
	threeColumn.className = 'three';
	header.append(blank, nullColumn, threeColumn);
	table.append(header);
	for (const difference of comparison.differences) {
		const row = element('div');
		row.className = 'compare-row';
		const topic = element('span', difference.topic);
		topic.className = 'topic';
		row.append(topic, element('span', difference.null3d), element('span', difference.threejs));
		table.append(row);
	}
	sheetBody.append(table, element('h3', 'Same in both engines'));
	const shared = element('ul');
	shared.className = 'shared';
	for (const rule of FAIRNESS_RULES) shared.append(element('li', rule));
	sheetBody.append(shared, element('h3', 'More about this comparison'));
	const more = element('ul');
	more.className = 'shared';
	for (const note of comparison.notes) more.append(element('li', note));
	sheetBody.append(more);
	sheet.append(sheetHead, sheetBody);

	const openSheet = (open: boolean): void => {
		sheet.hidden = !open;
		backdrop.hidden = !open;
		stage.classList.toggle('sheet-open', open);
		infoButton.setAttribute('aria-expanded', String(open));
		if (open) closeButton.focus();
		else infoButton.focus();
	};
	infoButton.addEventListener('click', () => openSheet(sheet.hidden === true));
	closeButton.addEventListener('click', () => openSheet(false));
	backdrop.addEventListener('click', () => openSheet(false));
	addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !sheet.hidden) openSheet(false);
	});

	// The walkthrough's card, over the canvas.
	const card = element('section');
	card.className = 'walkthrough';
	card.hidden = true;
	card.setAttribute('aria-label', 'Guided comparison');
	card.setAttribute('aria-live', 'polite');

	stage.append(canvas, caption, backdrop, sheet, card);

	// The walkthrough's state, kept in the address and the session between the engines' pages.
	const keptRun: WalkthroughRun = readWalkthrough(comparison.name, mode);
	const hasFirstRamp = keptRun.ramps.some((ramp) => ramp.engine === 'null3d');
	const flow = manual
		? null
		: new WalkthroughFlow(engine, startingStep(params.get('walkthrough'), engine, hasFirstRamp));
	// The guided walkthrough runs the engine itself, so the panel shows only the scene's title and
	// the button to its details, not controls that would compete with the walkthrough's card.
	caption.classList.toggle('guided', flow !== null);
	let run: ComparisonRun | null = null;
	let manualMode = manual;
	/** A stop is final: an engine that starts after it is destroyed at once. */
	let stopping = false;
	let destroyed = false;
	let startError: string | null = null;
	let rampAbort: AbortController | null = null;
	/** The walkthrough's live status line and progress bar, while a ramp runs. */
	let rampStatus: HTMLElement | null = null;
	let rampProgress: HTMLProgressElement | null = null;

	const showCount = (count: number) => {
		countLabel.textContent = countText(comparison, count);
	};
	// The address's count shows at once, before the engine loads, so a reload keeps the slider.
	const initialCount = startCount(params.get('count'), devicePlan);
	slider.value = String(countToSlider(initialCount, devicePlan));
	showCount(initialCount);

	/** The loading overlay, while an engine builds its scene and its programs. */
	let loader: Loader | null = null;

	/** Starts the engine that this page's address names, once. */
	const startRun = async (): Promise<ComparisonRun | null> => {
		if (run) return run;
		if (destroyed || startError !== null) return null;
		loader ??= createLoader(canvas);
		try {
			const next = await startComparison({
				canvas,
				comparison,
				engine,
				mode,
				count: startCount(params.get('count'), devicePlan),
				effects,
				gpu: (params.get('gpu') as GpuChoice | null) ?? 'auto',
				threeRenderer,
				stats:
					params.get('stats') === 'off' ? false : params.get('stats') === 'open' ? 'open' : true,
			});
			loader.hide();
			// A stop while the engine started leaves nothing running.
			if (stopping) {
				await next.destroy().catch(() => {});
				return null;
			}
			run = next;
			title.title = next.label;
			slider.value = String(countToSlider(next.count, next.plan));
			showCount(next.count);
			slider.disabled = !manualMode;
			return next;
		} catch (error) {
			startError = error instanceof Error ? error.message : String(error);
			loader?.fail(startError);
			const message = element('p', startError);
			message.className = 'error';
			caption.append(message);
			if (flow) showProblem('The comparison did not start', startError);
			return null;
		}
	};

	/** Stops the engine, once. */
	const destroyRun = async (): Promise<void> => {
		if (destroyed) return;
		destroyed = true;
		const current = run;
		run = null;
		if (current) await current.destroy().catch(() => {});
	};

	slider.addEventListener('input', () => {
		if (!run) return;
		const count = sliderToCount(Number(slider.value), run.plan);
		run.setCount(count);
		showCount(count);
		history.replaceState(null, '', address({ count: String(count) }));
	});

	// The manual ramp: each engine on its own page, the result kept for the session.
	const ramp = async () => {
		const current = run;
		if (!current) return;
		rampButton.disabled = true;
		slider.disabled = true;
		result.textContent = `Running the ramp on ${ENGINE_TITLES[engine]}...`;
		const found = await rampComparison(current, {
			onStep: ({ count, fps }) => {
				slider.value = String(countToSlider(count, current.plan));
				showCount(count);
				result.textContent = `${ENGINE_TITLES[engine]}: ${countText(comparison, count)} at ${fps.toFixed(0)} fps`;
			},
		});
		const ramps = keptRamps(comparison, mode).filter((kept) => kept.engine !== engine);
		ramps.push({ engine, label: current.label, result: found });
		keepRamps(comparison, mode, ramps);
		// The other engine's turn, on a page of its own, unless it has run already.
		if (!ramps.some((kept) => kept.engine === other(engine))) {
			location.search = address({
				engine: other(engine),
				ramp: 'continue',
				count: null,
				walkthrough: 'off',
			});
			return;
		}
		result.textContent = rampLine(comparison, ramps);
		rampButton.disabled = false;
		slider.disabled = false;
	};
	rampButton.addEventListener('click', () => {
		keepRamps(comparison, mode, []);
		void ramp();
	});

	if (keptRamps(comparison, mode).length > 0 && !flow)
		result.textContent = rampLine(comparison, keptRamps(comparison, mode));

	// The walkthrough's screens.

	const showCard = (...children: HTMLElement[]): void => {
		card.hidden = false;
		card.replaceChildren(...children);
	};

	const eyebrow = (text: string): HTMLElement => {
		const node = element('p', text);
		node.className = 'walkthrough__eyebrow';
		return node;
	};

	const heading = (text: string): HTMLElement => {
		const node = element('h2', text);
		node.tabIndex = -1;
		return node;
	};

	const actions = (...buttons: HTMLButtonElement[]): HTMLElement => {
		const row = element('div');
		row.className = 'walkthrough__actions';
		row.append(...buttons);
		return row;
	};

	const useControls = (): void => {
		flow?.act('stop');
		manualMode = true;
		caption.classList.remove('guided');
		card.hidden = true;
		slider.disabled = false;
		rampButton.hidden = false;
		result.hidden = false;
		// A destroyed engine's canvas cannot draw again, and a failed start needs a fresh page, so
		// those cases load the manual page. Otherwise the running engine stays.
		if (destroyed || (run === null && startError !== null)) {
			location.search = address({ walkthrough: 'off' });
			return;
		}
		history.replaceState(null, '', address({ walkthrough: 'off' }));
		if (!run) void startRun();
	};

	const startAgain = (): void => {
		flow?.act('restart');
		clearWalkthrough(comparison.name, mode);
		rampAbort?.abort();
		void destroyRun().then(() => {
			location.search = address({
				engine: 'null3d',
				walkthrough: null,
				ramp: null,
				count: null,
			});
		});
	};

	const showIntro = (): void => {
		const start = button(
			'Start the comparison',
			() => {
				const move = flow?.act('start');
				if (!move) return;
				if (move.reload) {
					location.search = address({
						engine: move.engine,
						walkthrough: 'go',
						ramp: null,
						count: null,
					});
					return;
				}
				// A fresh run measures the display again and keeps no old figures.
				clearWalkthrough(comparison.name, mode);
				keptRun.hz = 0;
				keptRun.ramps = [];
				void beginRamp(move.engine);
			},
			true,
		);
		const modeText = element('p', comparison.modes[mode]);
		modeText.className = 'walkthrough__mode';
		const modeDetails = element('details');
		modeDetails.className = 'walkthrough__detail';
		modeDetails.append(element('summary', 'What this run measures'), modeText);
		showCard(
			eyebrow('Guided comparison'),
			heading(comparison.title),
			element('p', comparison.summary),
			element(
				'p',
				`null3D draws the scene first, then three.js, on the same counts. A summary follows. You can stop at any time.`,
			),
			modeDetails,
			element('p', 'Both engines draw the same shared scene, with the same settings.'),
			actions(start, button('Use the controls', useControls)),
		);
		start.focus({ preventScroll: true });
	};

	const showProblem = (title: string, message: string): void => {
		if (!flow) return;
		const headingNode = heading(title);
		showCard(
			eyebrow('Guided comparison'),
			headingNode,
			element('p', message),
			actions(button('Try again', startAgain, true), button('Use the controls', useControls)),
		);
		headingNode.focus({ preventScroll: true });
	};

	const showStopped = (): void => {
		const title = heading('The walkthrough stopped');
		showCard(
			eyebrow('Guided comparison'),
			title,
			element('p', 'The scene stopped drawing, and the run is over.'),
			actions(button('Start again', startAgain, true), button('Use the controls', useControls)),
		);
		title.focus({ preventScroll: true });
	};

	const showRampStarting = (name: EngineName): void => {
		rampStatus = element('p', `${ENGINE_TITLES[name]} is starting.`);
		rampStatus.className = 'walkthrough__status';
		rampProgress = null;
		const title = heading(`${ENGINE_TITLES[name]} draws the scene`);
		showCard(
			eyebrow(name === 'null3d' ? 'Ramp 1 of 2: null3D' : 'Ramp 2 of 2: three.js'),
			title,
			rampStatus,
			actions(button('Stop', stopWalkthrough)),
		);
		title.focus({ preventScroll: true });
	};

	const showRampDrawing = (name: EngineName, plan: RampPlan): void => {
		const title = ENGINE_TITLES[name];
		rampStatus = element(
			'p',
			`${title} is drawing ${countText(comparison, plan.start)}. The count rises step by step.`,
		);
		rampStatus.className = 'walkthrough__status';
		rampProgress = element('progress');
		rampProgress.max = rampSteps(plan);
		rampProgress.value = 0;
		rampProgress.setAttribute('aria-label', `${title}'s ramp`);
		showCard(
			eyebrow(name === 'null3d' ? 'Ramp 1 of 2: null3D' : 'Ramp 2 of 2: three.js'),
			heading(`${title} draws the scene`),
			rampStatus,
			rampProgress,
			actions(button('Skip', skipRamp), button('Stop', stopWalkthrough)),
		);
	};

	const showSummary = (): void => {
		const first = keptRun.ramps.find((ramp) => ramp.engine === 'null3d');
		const second = keptRun.ramps.find((ramp) => ramp.engine === 'threejs');
		const hz = keptRun.hz || first?.hz || second?.hz || 0;
		const rows = summaryRows(first?.result, second?.result, hz);
		const path = second?.gpu ?? first?.gpu;
		const pathText = path === 'webgl2' ? 'WebGL2' : path === 'webgpu' ? 'WebGPU' : null;

		const table = element('table');
		table.append(
			element(
				'caption',
				`Frames a second at each count, in ${comparison.countUnit}. The ratio is null3D divided by three.js.`,
			),
		);
		const head = element('tr');
		for (const title of ['Count', 'null3D', 'three.js', 'Ratio']) head.append(element('th', title));
		const thead = element('thead');
		thead.append(head);
		table.append(thead);
		const body = element('tbody');
		let capped = false;
		for (const row of rows) {
			const line = element('tr');
			line.append(element('td', row.count.toLocaleString('en-US')));
			for (const figure of [
				{ fps: row.null3d, atCap: row.null3dAtCap },
				{ fps: row.threejs, atCap: row.threejsAtCap },
			]) {
				const cell = element('td', figure.fps === null ? '—' : figure.fps.toFixed(1));
				if (figure.atCap) {
					capped = true;
					const mark = element('span', '†');
					mark.className = 'cap';
					mark.title = 'At the display cap';
					cell.append(' ', mark);
				}
				line.append(cell);
			}
			line.append(element('td', row.ratio === null ? '—' : `${row.ratio.toFixed(2)}×`));
			body.append(line);
		}
		table.append(body);
		const scroll = element('div');
		scroll.className = 'walkthrough__table-scroll';
		scroll.append(table);

		const notes = element('ul');
		notes.className = 'walkthrough__notes';
		for (const sentence of summaryNotes(rows, first, second, hz, capped))
			notes.append(element('li', sentence));

		showCard(
			eyebrow('Summary'),
			heading(`${comparison.title}: the result`),
			element(
				'p',
				`Both engines draw the same shared scene, with the same settings.${pathText === null ? '' : ` The GPU path is ${pathText}.`}`,
			),
			scroll,
			notes,
			actions(button('Start again', startAgain, true), button('Use the controls', useControls)),
		);
		const title = card.querySelector<HTMLElement>('h2');
		title?.focus({ preventScroll: true });
	};

	/** The sentences under the summary's table: who won where, the cap, and where each ramp stopped. */
	const summaryNotes = (
		rows: ReturnType<typeof summaryRows>,
		first: WalkthroughRun['ramps'][number] | undefined,
		second: WalkthroughRun['ramps'][number] | undefined,
		hz: number,
		capped: boolean,
	): string[] => {
		const notes: string[] = [];
		const wins = summaryWins(rows);
		notes.push(...winsSentences(wins));
		const both = rows.filter((row) => row.null3d !== null && row.threejs !== null).length;
		if (both > 0 && wins.measured.length === 0)
			notes.push('Both engines drew at the display cap at every count where both drew.');
		if (capped && hz > 0)
			notes.push(
				`† At the display cap of ${hz} frames a second: the display sets the pace, so the scene may keep more.`,
			);
		for (const ramp of [first, second]) {
			if (!ramp) continue;
			const title = ENGINE_TITLES[ramp.engine];
			if (ramp.skipped) {
				notes.push(
					ramp.result.steps.length > 0
						? `You skipped part of ${title}'s ramp, so some counts have no figure from it.`
						: `You skipped ${title}'s ramp before it measured a count.`,
				);
			}
			if (ramp.result.steps.length > 0) {
				// A skipped ramp did not stop at its maximum or at the floor: the skip sentence says
				// how it ended. A count that drew no frame still has its reason.
				const stopped = [
					...(ramp.skipped ? [] : [stopText(title, ramp.result, comparison.countUnit)]),
					noFrameText(title, ramp.result, comparison.countUnit),
				]
					.filter(Boolean)
					.join(' ');
				if (stopped) notes.push(stopped);
			}
		}
		const labels = [first, second]
			.filter((ramp): ramp is WalkthroughRun['ramps'][number] => ramp !== undefined)
			.map((ramp) => ramp.label);
		if (labels.length > 0) notes.push(`${labels.join('. ')}.`);
		return notes;
	};

	const skipRamp = (): void => {
		rampAbort?.abort();
	};

	const stopWalkthrough = (): void => {
		if (!flow || stopping) return;
		flow.act('stop');
		stopping = true;
		rampAbort?.abort();
		clearWalkthrough(comparison.name, mode);
		rampStatus = null;
		rampProgress = null;
		showCard(
			eyebrow('Guided comparison'),
			heading('The walkthrough is stopping'),
			element('p', 'The scene is closing.'),
		);
		void destroyRun().then(showStopped);
	};

	/** Runs one engine's ramp, then moves to the next step. */
	async function beginRamp(name: EngineName): Promise<void> {
		if (stopping) return;
		showRampStarting(name);
		rampAbort = new AbortController();
		const signal = rampAbort.signal;
		// The display's rate comes from the first page, where no engine draws yet.
		let hz = keptRun.hz;
		if (hz <= 0) {
			hz = await measureDisplayHz();
			if (stopping) return;
			keptRun.hz = hz;
			writeWalkthrough(comparison.name, mode, keptRun);
		}
		const next = await startRun();
		if (!next || stopping) return;
		showRampDrawing(name, next.plan);
		let found: RampResult;
		try {
			found = await rampComparison(next, {
				signal,
				wait: (seconds) => abortableWait(seconds, signal),
				onStep: ({ step, count, noFrame }) => {
					slider.value = String(countToSlider(count, next.plan));
					showCount(count);
					if (rampStatus) {
						// The walkthrough's line names the count alone: the rate moves as the ramp
						// changes it, and a changing figure on a card that is not a result confuses.
						rampStatus.textContent = noFrame
							? `${ENGINE_TITLES[name]} drew no frame at ${countText(comparison, count)}.`
							: `${ENGINE_TITLES[name]} is drawing ${countText(comparison, count)}.`;
					}
					if (rampProgress) rampProgress.value = step + 1;
				},
			});
		} catch (error) {
			rampAbort = null;
			const message = error instanceof Error ? error.message : String(error);
			showProblem(`The ramp on ${ENGINE_TITLES[name]} stopped`, message);
			return;
		}
		rampAbort = null;
		if (stopping) return;
		keptRun.hz = hz;
		keptRun.ramps = keptRun.ramps.filter((ramp) => ramp.engine !== name);
		keptRun.ramps.push({
			engine: name,
			label: next.label,
			gpu: next.gpu,
			hz,
			skipped: signal.aborted,
			result: found,
		});
		writeWalkthrough(comparison.name, mode, keptRun);
		const move = flow?.act(signal.aborted ? 'skip' : 'done');
		if (!move) return;
		if (move.reload) {
			location.search = address({
				engine: move.engine,
				walkthrough: 'go',
				gpu: next.gpu,
				ramp: null,
				count: null,
			});
			return;
		}
		showSummary();
	}

	window.addEventListener('pagehide', (event) => {
		// A page held for the back button may come back, so it keeps its engine.
		if (event.persisted) return;
		rampAbort?.abort();
		void destroyRun();
	});

	/** Measures the running engine for a device run and publishes it where the runner reads it. */
	const reportMeasurement = async (current: ComparisonRun, seconds: number): Promise<void> => {
		// The scene's first frames build its shaders and settle its counts; the measurement starts
		// once the page has run for a while, as the ramp's first step does.
		await new Promise((resolve) => setTimeout(resolve, 5000));
		const measured = await current.measure(seconds);
		const figures = {
			page: 'compare-bench',
			ok: true,
			engine: current.engine,
			engineLabel: current.label,
			mode: current.mode,
			gpu: current.gpu,
			count: current.count,
			pixelRatio: current.pixelRatio,
			measureSeconds: seconds,
			fps: measured.fps,
			cpuMs: measured.cpuMs,
			updateErrors: measured.updateErrors,
			detail: measured.detail,
			userAgent: navigator.userAgent,
			url: location.href,
			off: { intervalMs: 1000 / (measured.fps || 1) },
			on: {
				intervalMs: 1000 / (measured.fps || 1),
				cpuMs: measured.cpuMs ?? 0,
			},
		};
		(window as unknown as { __null3dResult?: unknown }).__null3dResult = figures;
	};

	if (!flow) {
		// The manual controls: the engine draws at once, as it always has.
		slider.disabled = true;
		const started = await startRun();
		slider.disabled = false;
		if (started && measureSeconds > 0) void reportMeasurement(started, measureSeconds);
		return;
	}
	rampButton.hidden = true;
	result.hidden = true;
	slider.disabled = true;
	if (flow.step === 'intro') showIntro();
	else void beginRamp(flow.engine);
}
