// The showcase scenes' controls HUD. A translucent chevron sits at the bottom of the panel; pressing
// it slides a full panel of controls up over glass. The panel is tabbed: one tab per group of the
// model, and only the selected group's buttons show, so the panel stays short on any screen, a phone
// included. The tab bar scrolls across, the selected group scrolls inside a bounded panel, and the
// selected tab is remembered while the panel is open. The sketch posts the model, this shell draws
// it, and a pick goes back to the sketch as a message. The CSS lives with the examples' styles.
//
// A button's tip describes what it does alone, with no input device named. The tip shows on hover,
// keyboard focus and a press, and hides on a leave, a blur, a tap elsewhere, a scroll or after a
// few seconds. It lives outside the scrolling panel, so it is never clipped.
import type { HudModel, HudSlider } from './controls';

export type { HudButton, HudGroup, HudModel } from './controls';

/** How long a tip stays after a press, in milliseconds. */
const TIP_HOLD = 2800;

/** The controls HUD of a showcase scene. */
export interface Hud {
	/** Draws the model, and shows or hides the whole control. */
	render(model: HudModel, visible: boolean): void;
	/** Removes the HUD's nodes and its listeners, so a page may start another demo in the same one. */
	dispose(): void;
}

/** A new element with its class and its text. */
function node<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

/**
 * A place on a dial, in percent of its box, for a share of the way round from the bottom, turning
 * clockwise, at `radius` percent from the middle.
 */
function dialPlace(share: number, radius: number): [number, number] {
	const turn = share * Math.PI * 2;
	return [50 - Math.sin(turn) * radius, 50 + Math.cos(turn) * radius];
}

/** The color between a dial's two stops round a value, as CSS, and its luminance from 0 to 1. */
function dialColor(
	colors: readonly (readonly [number, string])[],
	value: number,
): [string, number] {
	const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
	for (let k = 0; k < colors.length - 1; k++) {
		const [a, from] = colors[k] as readonly [number, string];
		const [b, to] = colors[k + 1] as readonly [number, string];
		if (value < a || value > b) continue;
		const t = b > a ? (value - a) / (b - a) : 0;
		const [x, y] = [rgb(from), rgb(to)];
		const mixed = x.map((v, i) => Math.round(v + ((y[i] as number) - v) * t));
		const [r, g, bl] = mixed.map((v) => v / 255) as [number, number, number];
		return [`rgb(${mixed.join(' ')})`, 0.2126 * r + 0.7152 * g + 0.0722 * bl];
	}
	return [(colors[0] as readonly [number, string])[1], 0];
}

/** A value of hours as a clock time: 18.4 reads 18:24. */
function clockTime(hours: number): string {
	const minutes = Math.round(hours * 60) % 1440;
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A slider drawn as a dial, with its readout, and the box that the group's buttons go in. */
interface Dial {
	root: HTMLElement;
	buttons: HTMLElement;
	/** Shows the slider's value now, unless the user is turning the dial. */
	update(slider: HudSlider): void;
}

/** How bright the ring's color must be for the dial's middle to show the sun rather than the moon. */
const DAYLIGHT = 0.16;

/**
 * Makes a dial for `slider`, whose value goes to `post` as the user turns it: a drag round the
 * ring, a tap on it, or the arrow and page keys. The value wraps round, so a drag carries on past
 * the end into the start.
 */
function createDial(
	title: string,
	slider: HudSlider,
	post: (value: string) => void,
	bindTip: (element: HTMLElement) => void,
): Dial {
	const dial = slider.dial;
	if (!dial) throw new Error('createDial needs a slider with a dial');
	const { min, max } = slider;
	const span = max - min;
	const wrap = (value: number) => min + ((((value - min) % span) + span) % span);
	const share = (value: number) => (wrap(value) - min) / span;
	const root = node('div', 'hud__clock');
	const face = node('div', 'hud__dial');
	face.tabIndex = 0;
	face.setAttribute('role', 'slider');
	face.setAttribute('aria-label', title);
	face.setAttribute('aria-valuemin', String(min));
	face.setAttribute('aria-valuemax', String(max));
	face.dataset.tip = slider.tip;
	const ring = node('div', 'hud__ring');
	const stops = dial.colors.map(([at, color]) => `${color} ${(share(at) * 100).toFixed(2)}%`);
	// The last stop sits at the end of the ring, which wraps to its start.
	stops[stops.length - 1] = `${dial.colors.at(-1)?.[1]} 100%`;
	ring.style.background = `conic-gradient(from 180deg, ${stops.join(', ')})`;
	const ticks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	ticks.setAttribute('class', 'hud__ticks');
	ticks.setAttribute('viewBox', '0 0 100 100');
	ticks.setAttribute('aria-hidden', 'true');
	// A tick at each whole step of a 24th of the way round, and a longer, darker one where each named
	// span starts.
	const starts = new Set(dial.names.map(([, from]) => from));
	const at = (value: number, radius: number) => dialPlace(share(value), radius);
	for (let k = 0; k < 24; k++) {
		const value = min + (span * k) / 24;
		const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		const [x1, y1] = at(value, 49.5);
		const [x2, y2] = at(value, 45.5);
		line.setAttribute('x1', x1.toFixed(2));
		line.setAttribute('y1', y1.toFixed(2));
		line.setAttribute('x2', x2.toFixed(2));
		line.setAttribute('y2', y2.toFixed(2));
		line.setAttribute('class', 'hud__tick');
		ticks.append(line);
	}
	for (const from of starts) {
		const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		const [x1, y1] = at(from, 49.5);
		const [x2, y2] = at(from, 39);
		line.setAttribute('x1', x1.toFixed(2));
		line.setAttribute('y1', y1.toFixed(2));
		line.setAttribute('x2', x2.toFixed(2));
		line.setAttribute('y2', y2.toFixed(2));
		line.setAttribute('class', 'hud__tick hud__tick--start');
		ticks.append(line);
	}
	const numbers = node('div', 'hud__numbers');
	numbers.setAttribute('aria-hidden', 'true');
	for (let k = 0; k < 4; k++) {
		const value = min + (span * k) / 4;
		const label = node('span', undefined, String(Math.round(value)).padStart(2, '0'));
		const [x, y] = at(value, 31);
		label.style.left = `${x}%`;
		label.style.top = `${y}%`;
		numbers.append(label);
	}
	const middle = node('div', 'hud__face');
	const orb = node('div', 'hud__orb');
	middle.append(orb);
	const knob = node('div', 'hud__knob');
	face.append(ring, ticks, numbers, middle, knob);
	const readout = node('div', 'hud__readout');
	const time = node('div', 'hud__time');
	time.setAttribute('aria-hidden', 'true');
	const name = node('div', 'hud__name');
	name.setAttribute('aria-hidden', 'true');
	const dot = node('i');
	const label = node('span');
	name.append(dot, label);
	const buttons = node('div', 'hud__buttons');
	readout.append(time, name, buttons);
	root.append(face, readout);

	/** True while a finger or the pointer holds the dial, so a render does not move it back. */
	let holding = false;
	let value = slider.value;
	let latest = slider;
	const nameOf = (v: number) =>
		dial.names.find(([, from, to]) =>
			from < to ? v >= from && v < to : v >= from || v < to,
		)?.[0] ?? '';
	const show = (v: number, current: HudSlider): void => {
		const [color, light] = dialColor(dial.colors, wrap(v));
		const [x, y] = at(v, 44.5);
		knob.style.left = `${x}%`;
		knob.style.top = `${y}%`;
		face.style.setProperty('--hud-dial-color', color);
		name.style.setProperty('--hud-dial-color', color);
		const off = current.dial?.off;
		face.classList.toggle('hud__dial--off', off !== undefined);
		face.classList.toggle('hud__dial--live', current.live);
		orb.classList.toggle('hud__orb--moon', light < DAYLIGHT);
		time.textContent = off === undefined ? clockTime(wrap(v)) : '--:--';
		label.textContent = off ?? nameOf(wrap(v));
		face.setAttribute('aria-valuenow', wrap(v).toFixed(2));
		face.setAttribute(
			'aria-valuetext',
			off ?? `${clockTime(wrap(v))}, ${nameOf(wrap(v))}${current.live ? ', moving by itself' : ''}`,
		);
	};
	const set = (v: number): void => {
		value = wrap(v);
		show(value, { ...latest, live: false, dial: { ...dial, off: undefined } as typeof dial });
		post(String(value));
	};
	const fromPointer = (event: PointerEvent): number => {
		const box = face.getBoundingClientRect();
		const dx = event.clientX - (box.left + box.width / 2);
		const dy = event.clientY - (box.top + box.height / 2);
		return min + ((((Math.atan2(-dx, dy) / (Math.PI * 2)) % 1) + 1) % 1) * span;
	};
	face.addEventListener('pointerdown', (event) => {
		face.setPointerCapture(event.pointerId);
		holding = true;
		set(fromPointer(event));
	});
	face.addEventListener('pointermove', (event) => {
		if (holding && face.hasPointerCapture(event.pointerId)) set(fromPointer(event));
	});
	const release = (): void => {
		holding = false;
	};
	face.addEventListener('pointerup', release);
	face.addEventListener('pointercancel', release);
	face.addEventListener('keydown', (event) => {
		const fine = Math.max(slider.step, span / 96);
		const coarse = span / 24;
		const step = {
			ArrowRight: fine,
			ArrowUp: fine,
			ArrowLeft: -fine,
			ArrowDown: -fine,
			PageUp: coarse,
			PageDown: -coarse,
		}[event.key];
		if (step === undefined) return;
		event.preventDefault();
		set(value + step);
	});
	bindTip(face);
	show(value, slider);
	return {
		root,
		buttons,
		update(next) {
			latest = next;
			if (holding) return;
			value = next.value;
			show(value, next);
		},
	};
}

/**
 * Makes the controls HUD in `element`, which the page owns, and posts each pick with `post` as the
 * button's group name and its id. `stage` holds the tip, so the tip is not clipped by the panel.
 */
export function createHud(
	element: HTMLElement,
	stage: HTMLElement,
	post: (name: string, value: string) => void,
): Hud {
	element.replaceChildren();
	element.classList.add('hud');
	const panel = node('div', 'hud__panel');
	panel.id = 'hud-panel';
	panel.setAttribute('role', 'region');
	panel.setAttribute('aria-label', 'Scene controls');
	const tabs = node('div', 'hud__tabs');
	tabs.setAttribute('role', 'tablist');
	tabs.setAttribute('aria-label', 'Scene control groups');
	const body = node('div', 'hud__body');
	panel.append(tabs, body);
	const chevron = node('button', 'hud__chevron');
	chevron.type = 'button';
	chevron.setAttribute('aria-expanded', 'false');
	chevron.setAttribute('aria-controls', 'hud-panel');
	chevron.setAttribute('aria-keyshortcuts', 'H');
	chevron.setAttribute('title', 'Scene controls (H)');
	const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	arrow.setAttribute('viewBox', '0 0 24 24');
	arrow.setAttribute('width', '22');
	arrow.setAttribute('height', '22');
	arrow.setAttribute('fill', 'none');
	arrow.setAttribute('aria-hidden', 'true');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', 'M6 15l6-6 6 6');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	arrow.append(path);
	const badge = node('kbd', 'hud__key', 'H');
	chevron.append(arrow, badge);
	element.append(panel, chevron);

	// The tip floats over the stage, above the panel and outside its scroll box.
	const tip = node('div', 'hud__tip');
	tip.setAttribute('role', 'tooltip');
	stage.append(tip);

	const setOpen = (open: boolean): void => {
		element.classList.toggle('open', open);
		chevron.setAttribute('aria-expanded', String(open));
		chevron.setAttribute('aria-label', open ? 'Hide scene controls' : 'Show scene controls');
		if (!open) hideTip();
	};
	/** The listeners that outlive `element`, which one signal drops together. */
	const listeners = new AbortController();
	const { signal } = listeners;
	let tipTimer: ReturnType<typeof setTimeout> | 0 = 0;
	function hideTip(): void {
		clearTimeout(tipTimer);
		tip.classList.remove('show');
	}
	function showTip(button: HTMLElement, hold: boolean): void {
		const text = button.dataset.tip;
		if (!text) return;
		clearTimeout(tipTimer);
		tip.textContent = text;
		tip.classList.add('show');
		const stageBox = stage.getBoundingClientRect();
		const buttonBox = button.getBoundingClientRect();
		const width = tip.offsetWidth;
		const height = tip.offsetHeight;
		let left = buttonBox.left - stageBox.left + buttonBox.width / 2 - width / 2;
		left = Math.max(8, Math.min(left, stageBox.width - width - 8));
		let top = buttonBox.top - stageBox.top - height - 8;
		if (top < 8) top = buttonBox.bottom - stageBox.top + 8;
		tip.style.left = `${left}px`;
		tip.style.top = `${top}px`;
		if (hold) tipTimer = setTimeout(hideTip, TIP_HOLD);
	}
	// The tip answers a pointer, keyboard focus and a press alike, so no device is assumed.
	const bindTip = (button: HTMLElement): void => {
		button.addEventListener('pointerenter', () => showTip(button, false));
		button.addEventListener('pointerleave', hideTip);
		button.addEventListener('focus', () => showTip(button, false));
		button.addEventListener('blur', hideTip);
		button.addEventListener('click', () => showTip(button, true));
	};
	bindTip(chevron);
	chevron.addEventListener('click', () => setOpen(!element.classList.contains('open')));
	panel.addEventListener('scroll', hideTip);
	stage.addEventListener(
		'pointerdown',
		(event) => {
			const target = event.target;
			if (!(target instanceof Element) || !target.closest('[data-tip]')) hideTip();
		},
		{ signal },
	);
	document.addEventListener(
		'keydown',
		(event) => {
			// A shortcut never fights a browser or an editor shortcut, and never types into a field.
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable || target.matches('input, textarea, select'))
			)
				return;
			if (event.key === 'h' || event.key === 'H') setOpen(!element.classList.contains('open'));
			else if (event.key === 'Escape') setOpen(false);
		},
		{ signal },
	);

	/** The buttons drawn now, by their group and id, so a render only turns them on and off. */
	let drawn = new Map<string, HTMLButtonElement>();
	/** The sliders drawn now, by their group's name, so a render only moves their values. */
	let sliders = new Map<string, HTMLInputElement>();
	/** The dials drawn now, by their group's name, which a render turns to their values. */
	let dials = new Map<string, Dial>();
	/** The tab and the panel drawn for each group, by the group's name. */
	let tabButtons = new Map<string, HTMLButtonElement>();
	let tabPanels = new Map<string, HTMLElement>();
	/** The selected tab's group name. Camera, the first group, until a tab picks another. */
	let active = 'camera';
	let signature = '';
	/** Shows one group: its tab is selected and only its panel is visible. */
	const selectTab = (name: string, focus = false): void => {
		active = name;
		for (const [group, tab] of tabButtons) {
			const on = group === name;
			tab.setAttribute('aria-selected', String(on));
			tab.tabIndex = on ? 0 : -1;
			tab.classList.toggle('hud__tab--on', on);
		}
		for (const [group, section] of tabPanels) section.hidden = group !== name;
		if (focus) tabButtons.get(name)?.focus();
	};
	/** Moves the selection along the tab bar with the arrow keys, as a tablist does. */
	const moveTab = (names: readonly string[], from: string, key: string): void => {
		const index = names.indexOf(from);
		let to = -1;
		if (key === 'ArrowRight') to = (index + 1) % names.length;
		else if (key === 'ArrowLeft') to = (index - 1 + names.length) % names.length;
		else if (key === 'Home') to = 0;
		else if (key === 'End') to = names.length - 1;
		const name = names[to];
		if (to >= 0 && name !== undefined) selectTab(name, true);
	};
	const draw = (model: HudModel): void => {
		const next = model.groups
			.map(
				(group) =>
					`${group.name}|${group.title}|${group.radio}|${group.slider ? `${group.slider.min}~${group.slider.max}~${group.slider.step}~${group.slider.tip}~${group.slider.dial ? 'dial' : ''}~${group.slider.marks.map((m) => `${m.at}~${m.label}`).join(',')}` : ''}|${group.buttons.map((b) => `${b.id}~${b.label}~${b.key ?? ''}~${b.tip}`).join(';')}|${(group.extras ?? []).map((b) => `${b.id}~${b.label}~${b.tip}`).join(';')}`,
			)
			.join('||');
		if (next !== signature) {
			signature = next;
			drawn = new Map();
			sliders = new Map();
			dials = new Map();
			tabButtons = new Map();
			tabPanels = new Map();
			const names = model.groups.map((group) => group.name);
			tabs.replaceChildren(
				...model.groups.map((group) => {
					const tab = node('button', 'hud__tab');
					tab.type = 'button';
					tab.id = `hud-tab-${group.name}`;
					tab.setAttribute('role', 'tab');
					tab.setAttribute('aria-controls', `hud-panel-${group.name}`);
					tab.textContent = group.title;
					tab.addEventListener('click', () => selectTab(group.name));
					tab.addEventListener('keydown', (event) => {
						if (!event.key.startsWith('Arrow') && event.key !== 'Home' && event.key !== 'End')
							return;
						event.preventDefault();
						moveTab(names, group.name, event.key);
					});
					tabButtons.set(group.name, tab);
					return tab;
				}),
			);
			body.replaceChildren(
				...model.groups.map((group) => {
					const section = node('section', 'hud__group');
					section.id = `hud-panel-${group.name}`;
					section.setAttribute('role', 'tabpanel');
					section.setAttribute('aria-labelledby', `hud-tab-${group.name}`);
					const { slider } = group;
					let holder: HTMLElement = section;
					if (slider?.dial) {
						// A value that wraps round draws as a dial, with its readout and the group's
						// buttons beside it.
						const dial = createDial(
							group.title,
							slider,
							(value) => post(group.name, value),
							bindTip,
						);
						section.append(dial.root);
						holder = dial.buttons;
						dials.set(group.name, dial);
					} else if (slider) {
						// The track sets one continuous value, and its labels name the key points along it.
						const wrap = node('div', 'hud__slider');
						const range = document.createElement('input');
						range.type = 'range';
						range.className = 'hud__range';
						range.min = String(slider.min);
						range.max = String(slider.max);
						range.step = String(slider.step);
						range.value = String(slider.value);
						range.dataset.tip = slider.tip;
						range.setAttribute('aria-label', group.title);
						range.addEventListener('input', () => post(group.name, range.value));
						bindTip(range);
						const marks = node('div', 'hud__marks');
						for (const mark of slider.marks) {
							const label = node('span', 'hud__mark', mark.label);
							const share = (mark.at - slider.min) / (slider.max - slider.min);
							// A label near an end is anchored to that end, so it never runs past the track.
							label.style.left = `${share * 100}%`;
							if (share < 0.06) label.style.transform = 'translateX(0)';
							else if (share > 0.94) label.style.transform = 'translateX(-100%)';
							marks.append(label);
						}
						wrap.append(range, marks);
						section.append(wrap);
						sliders.set(group.name, range);
					}
					const buttons = holder === section ? node('div', 'hud__buttons') : holder;
					for (const button of group.buttons) {
						const el = node('button', `hud__btn${group.radio ? '' : ' hud__btn--toggle'}`);
						el.type = 'button';
						el.dataset.tip = button.tip;
						el.append(
							document.createTextNode(button.label),
							...(button.key ? [node('kbd', undefined, button.key)] : []),
						);
						el.addEventListener('click', () => post(button.name ?? group.name, button.id));
						bindTip(el);
						buttons.append(el);
						drawn.set(`${group.name}\u0000${button.id}`, el);
					}
					if (group.extras?.length) {
						// A group may also carry switches, such as the level of detail under Quality. They
						// follow the row's choice after a separator, so the row stays one line.
						buttons.append(node('span', 'hud__sep'));
						for (const button of group.extras) {
							const el = node('button', 'hud__btn hud__btn--toggle');
							el.type = 'button';
							el.dataset.tip = button.tip;
							el.append(document.createTextNode(button.label));
							el.addEventListener('click', () => post(button.name ?? group.name, button.id));
							bindTip(el);
							buttons.append(el);
							drawn.set(`${group.name}\u0000extra:${button.id}`, el);
						}
					}
					if (buttons !== holder) section.append(buttons);
					tabPanels.set(group.name, section);
					return section;
				}),
			);
			if (!tabButtons.has(active)) active = model.groups[0]?.name ?? '';
			selectTab(active);
		}
		for (const group of model.groups) {
			if (group.slider) dials.get(group.name)?.update(group.slider);
			const range = sliders.get(group.name);
			if (range && group.slider) {
				// A value that moves by itself, as the hour does in Auto, moves the thumb with it, unless
				// the user is holding it.
				if (document.activeElement !== range) range.value = String(group.slider.value);
				range.setAttribute('aria-valuetext', group.slider.live ? 'Auto' : range.value);
				range.classList.toggle('hud__range--live', group.slider.live);
			}
			for (const button of [...group.buttons, ...(group.extras ?? [])]) {
				const extra = group.extras?.includes(button) ?? false;
				const el = drawn.get(`${group.name}\u0000${extra ? 'extra:' : ''}${button.id}`);
				if (!el) continue;
				el.setAttribute('aria-pressed', String(button.active));
				el.classList.toggle('hud__btn--on', button.active);
			}
		}
	};
	// The toast that names each change, at the top of the view. A new one replaces the old, and it
	// never takes a click.
	const toast = node('div', 'hud__toast');
	stage.append(toast);
	let toastTimer: ReturnType<typeof setTimeout> | 0 = 0;
	const showToast = (text: string): void => {
		clearTimeout(toastTimer);
		toast.textContent = text;
		toast.classList.add('show');
		toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
	};
	/** Each button's state at the last render, so a change can name itself. It is undefined before
	 * the first render, so the first state that arrives does not toast. */
	let shown: Map<string, boolean> | undefined;
	/** Names a change in the controls, as a toast: a mode's new value, or a toggle's on and off. */
	const toastChanges = (model: HudModel): void => {
		const next = new Map<string, boolean>();
		// One render can change two buttons at once, such as Auto coming on as Studio goes off. The
		// control that the press turned on names the change; an off names it only when nothing came on.
		let turnedOn: string | undefined;
		let switched: string | undefined;
		let turnedOff: string | undefined;
		for (const group of model.groups)
			for (const button of [...group.buttons, ...(group.extras ?? [])]) {
				const key = `${group.name}\u0000${button.id}`;
				next.set(key, button.active);
				const before = shown?.get(key);
				if (shown === undefined || before === undefined || before === button.active) continue;
				// A group's own choice outranks a switch beside it, which a preset change can flip too.
				if (button.active) {
					const named = group.radio
						? `${group.title}: ${button.label}`.toLowerCase()
						: `${button.label}: on`;
					if (group.extras?.includes(button)) switched = named;
					else turnedOn = named;
				} else if (!group.radio) turnedOff = `${button.label}: off`;
			}
		const named = turnedOn ?? switched ?? turnedOff;
		if (named !== undefined) showToast(named);
		shown = next;
	};
	return {
		render(model, visible) {
			element.hidden = !visible;
			draw(model);
			toastChanges(model);
		},
		dispose() {
			listeners.abort();
			clearTimeout(tipTimer);
			clearTimeout(toastTimer);
			tip.remove();
			toast.remove();
			element.replaceChildren();
		},
	};
}
