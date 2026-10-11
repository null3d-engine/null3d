// The comparison panel of the clone's examples page: `?compare=<name>` runs a comparison with one
// engine, which `?engine=null3d` or `?engine=threejs` names, in the mode that `?mode=scene-graph` or
// `?mode=instanced` names. A caption over the canvas holds the controls: the engine and mode
// switches, the count slider, the effect switches, "Run the ramp", and the "about this comparison"
// panel. Each engine runs on a page of its own, so the switch loads the
// page again, and the ramp does too: it runs on the engine that runs, keeps the result for the
// session, loads the page with the other engine, runs there, and shows both results.

import type { Comparison } from './compare/comparisons';
import {
	type ComparisonRun,
	ENGINE_TITLES,
	type EngineName,
	FAIRNESS_RULES,
	type GpuChoice,
	MODE_TITLES,
	rampComparison,
	startComparison,
	thisDeviceClass,
} from './lib/compare';
import {
	COMPARE_MODES,
	type CompareMode,
	EFFECT_NAMES,
	type Effects,
	effectsFromText,
	effectsToText,
	modeFromText,
} from './lib/compare-scene';
import {
	countToSlider,
	type RampResult,
	SLIDER_STEPS,
	sliderToCount,
	startCount,
} from './lib/ramp';
import { sourceUrl } from './lib/source';

/** A new element with its text and, for a link, its address. */
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', href?: string) {
	const node = document.createElement(tag);
	node.textContent = text;
	if (href !== undefined) node.setAttribute('href', href);
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

/** The headline: each engine's largest count held at the display rate, on this device. */
function rampLine(comparison: Comparison, ramps: KeptRamp[]): string {
	const held = (engine: EngineName) => ramps.find((ramp) => ramp.engine === engine);
	const parts = (['null3d', 'threejs'] as const)
		.map((engine) => {
			const ramp = held(engine);
			return ramp
				? `${ENGINE_TITLES[engine]} held ${ramp.result.held.toLocaleString('en-US')}`
				: '';
		})
		.filter(Boolean);
	const hz = ramps[0]?.result.displayHz;
	return `${parts.join(', ')} ${comparison.countUnit} at ${hz} fps on this device.`;
}

/** Runs a comparison in the page's panel, with its controls in a caption at the top left. */
export async function runComparison(stage: HTMLElement, comparison: Comparison): Promise<void> {
	const params = new URLSearchParams(location.search);
	const engine: EngineName = params.get('engine') === 'threejs' ? 'threejs' : 'null3d';
	const effects = effectsFromText(params.get('effects'));
	const mode = modeFromText(params.get('mode'));
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
	const caption = element('details');
	caption.className = 'caption compare';
	caption.open = matchMedia('(min-width: 768px)').matches;
	const summary = element('summary');
	summary.append(element('h1', `${comparison.title}: ${ENGINE_TITLES[engine]}`));
	caption.append(summary, element('p', comparison.summary));

	// The engine switch: each engine on a page of its own.
	const switcher = element('p');
	switcher.className = 'switch';
	for (const name of ['null3d', 'threejs'] as const) {
		const link = element('a', ENGINE_TITLES[name], address({ engine: name, ramp: null }));
		if (name === engine) link.setAttribute('aria-current', 'page');
		switcher.append(link);
	}
	caption.append(switcher);

	// The mode switch: both engines build the scene the same way in each mode.
	const modes = element('p');
	modes.className = 'switch';
	for (const name of COMPARE_MODES) {
		const link = element('a', MODE_TITLES[name], address({ mode: name, ramp: null }));
		if (name === mode) link.setAttribute('aria-current', 'page');
		modes.append(link);
	}
	caption.append(modes);

	// The count slider, on a log scale.
	const slider = element('input');
	slider.type = 'range';
	slider.min = '0';
	slider.max = String(SLIDER_STEPS);
	slider.setAttribute('aria-label', comparison.countUnit);
	const countText = element('output');
	const counter = element('label');
	counter.className = 'count';
	counter.append(slider, countText);
	caption.append(counter);

	// The effect switches load the page again with the new set.
	const switches = element('p');
	switches.className = 'effects';
	for (const name of EFFECT_NAMES) {
		const box = element('input');
		box.type = 'checkbox';
		box.checked = effects[name];
		box.addEventListener('change', () => {
			const next: Effects = { ...effects, [name]: box.checked };
			location.search = address({ effects: effectsToText(next), ramp: null });
		});
		const label = element('label');
		label.append(box, ` ${name}`);
		switches.append(label);
	}
	caption.append(switches);

	const rampButton = element('button', 'Run the ramp');
	rampButton.type = 'button';
	const result = element('p');
	result.className = 'result';
	result.setAttribute('aria-live', 'polite');
	caption.append(rampButton, result);

	const about = element('details');
	about.className = 'about';
	about.append(element('summary', 'About this comparison'));
	const rules = element('ul');
	const modeNotes = COMPARE_MODES.map((name) => comparison.modes[name]);
	for (const rule of [...modeNotes, ...FAIRNESS_RULES, ...comparison.notes])
		rules.append(element('li', rule));
	about.append(rules);
	caption.append(about);

	const code = element('a', 'View code', sourceUrl(comparison));
	code.target = '_blank';
	code.rel = 'noopener';
	const links = element('p');
	links.className = 'quiet';
	links.append(code);
	caption.append(links);
	stage.append(canvas, caption);

	const kept = keptRamps(comparison, mode);
	if (kept.length > 0) result.textContent = rampLine(comparison, kept);

	let run: ComparisonRun;
	try {
		run = await startComparison({
			canvas,
			comparison,
			engine,
			mode,
			count: startCount(params.get('count'), comparison.ramps[thisDeviceClass()]),
			effects,
			gpu: (params.get('gpu') as GpuChoice | null) ?? 'auto',
			threeRenderer: params.get('renderer') === 'webgpu' ? 'webgpu' : undefined,
			stats: params.get('stats') === 'off' ? false : params.get('stats') === 'open' ? 'open' : true,
		});
	} catch (error) {
		const message = element('p', error instanceof Error ? error.message : String(error));
		message.className = 'error';
		caption.append(message);
		caption.open = true;
		return;
	}
	summary.title = run.label;
	const showCount = (count: number) => {
		countText.textContent = `${count.toLocaleString('en-US')} ${comparison.countUnit}`;
	};
	slider.value = String(countToSlider(run.count, run.plan));
	showCount(run.count);
	slider.addEventListener('input', () => {
		const count = sliderToCount(Number(slider.value), run.plan);
		run.setCount(count);
		showCount(count);
		history.replaceState(null, '', address({ count: String(count) }));
	});

	const ramp = async () => {
		rampButton.disabled = true;
		slider.disabled = true;
		result.textContent = `Running the ramp on ${ENGINE_TITLES[engine]}...`;
		const found = await rampComparison(run, {
			onStep: ({ count, fps }) => {
				slider.value = String(countToSlider(count, run.plan));
				showCount(count);
				result.textContent = `${ENGINE_TITLES[engine]}: ${count.toLocaleString('en-US')} ${comparison.countUnit} at ${fps.toFixed(0)} fps`;
			},
		});
		const ramps = keptRamps(comparison, mode).filter((kept) => kept.engine !== engine);
		ramps.push({ engine, label: run.label, result: found });
		keepRamps(comparison, mode, ramps);
		// The other engine's turn, on a page of its own, unless it has run already.
		if (!ramps.some((kept) => kept.engine === other(engine))) {
			location.search = address({ engine: other(engine), ramp: 'continue', count: null });
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
	if (params.get('ramp') === 'continue') void ramp();
}
